/**
 * 국립국어원 한국어기초사전(krdict) XML을 words 테이블로 들여온다 (NFR-7).
 *
 *   npm run db:import -- --dry            넣지 않고 무엇이 들어갈지만 본다
 *   npm run db:import                     실제로 넣는다
 *   npm run db:import -- --dir=경로       XML 폴더를 직접 지정한다
 *
 * 원본 받는 법 — 로그인 없이 받을 수 있다.
 *   https://krdict.korean.go.kr/download/downloadPopup → 'XML 전체 내려받기'
 *   압축을 풀어 server/db/krdict/ 아래에 *.xml 을 둔다 (git에는 넣지 않는다)
 *
 * 출처·라이선스: 국립국어원 한국어기초사전, CC BY-SA 2.0 KR.
 * 자세한 건 db/DICTIONARY.md 참고.
 *
 * 왜 표제어만 쓰는가
 *   뜻풀이·예문·발음 음성은 원저작물 인용이 섞여 있어 개방 대상이 아니다.
 *   초성배틀에 필요한 건 "이 낱말이 사전에 있는가"뿐이라 표제어만 가져온다.
 *
 * 무엇을 거르는가
 *   품사      명사만. 동사·형용사 기본형을 넣으면 '하다·되다·가다' 같은 말이
 *             수많은 초성 힌트의 정답이 되어 라운드가 시시해진다.
 *   단위      '단어'만. 관용구·속담·문법 표현은 한 낱말이 아니다.
 *   글자 수   2~4글자 완성형 한글만 (FR-G1).
 *   출제 등급 초급·중급만 문제로 낸다. 고급·미지정은 판정용으로만 인정한다 —
 *             힌트만 보고 '첩첩산중'을 떠올릴 사람은 없다.
 *   낮춤말    뜻풀이에 '낮잡아 이르는 말' 표시가 붙으면 출제 풀에서 뺀다.
 *             판정에서는 인정한다 — 사전에 있는 말을 "없는 단어"라고 하면 안 된다.
 *
 * 마지막에 부적절어 목록을 적용한다 (src/words/blocklist.js). 대부분은 출제만
 * 막고 판정은 인정하며, 완전 차단은 노골적 욕설에만 쓴다.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pool } from '../src/db/pool.js';
import { isHangulWord } from '../src/judge/hangul.js';
import { applyBlocklist, isDerogatory } from '../src/words/blocklist.js';
import { toWordRow } from '../src/words/dictionary.js';

/** 문제로 낼 어휘 등급 */
const CURATED_LEVELS = new Set(['초급', '중급']);

/** 등급 → words.difficulty (1 쉬움 ~ 3 어려움) */
const DIFFICULTY = { 초급: 1, 중급: 2 };

/** 한 번에 밀어 넣을 행 수 — 파라미터 배열이 너무 커지지 않게 */
const CHUNK = 2000;

const DEFAULT_DIR = fileURLToPath(new URL('../db/krdict', import.meta.url));

/**
 * LMF XML 한 덩이에서 표제어 정보를 뽑는다.
 *
 * 전용 XML 파서를 쓰지 않는 이유: 필요한 건 표제어 앞부분의 feat 몇 개뿐인데
 * 파일이 11개 400MB라 전체를 DOM으로 올릴 이유가 없다.
 *
 * @param {string} chunk `<LexicalEntry ` 로 시작하는 덩이
 */
function parseEntry(chunk) {
  // 표제어 정보(품사·등급·Lemma)는 Sense보다 앞에 몰려 있다. 뒤쪽 예문까지
  // 훑으면 RelatedForm의 writtenForm을 잘못 집을 수 있다.
  const head = chunk.slice(0, 900);
  const feat = (att) => head.match(new RegExp(`att="${att}" val="([^"]*)"`))?.[1];

  // 낮춤 표시는 어느 뜻에 붙어도 걸러야 하니 덩이 전체에서 definition만 모은다.
  // 예문(example)은 보지 않는다 — "바보 같다" 같은 문장에 우연히 걸린다.
  const definitions = [...chunk.matchAll(/att="definition" val="([^"]*)"/g)]
    .map((m) => m[1])
    .join(' ');

  return {
    word: head.match(/<Lemma>\s*<feat att="writtenForm" val="([^"]*)"/)?.[1],
    unit: feat('lexicalUnit'),
    pos: feat('partOfSpeech'),
    level: feat('vocabularyLevel') ?? '없음',
    derogatory: isDerogatory(definitions),
  };
}

/**
 * XML 폴더를 훑어 words 행으로 바꾼다.
 * @param {string} dir
 */
function collect(dir) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xml'));
  if (files.length === 0) {
    throw new Error(`${dir} 에 XML이 없다. 한국어기초사전 전체 내려받기를 풀어 두었는지 확인할 것`);
  }

  /** @type {Map<string, { level: string, curated: boolean }>} 표제어 → 가장 쉬운 등급 */
  const picked = new Map();
  const stat = { entries: 0, notWord: 0, notNoun: 0, badShape: 0, dup: 0, derogatory: 0 };
  /** 한 뜻이라도 낮춤말이면 출제하지 않는다 */
  const derogatory = new Set();

  for (const file of files) {
    const xml = readFileSync(`${dir}/${file}`, 'utf8');
    for (const chunk of xml.split('<LexicalEntry ').slice(1)) {
      stat.entries += 1;
      const { word, unit, pos, level, derogatory: low } = parseEntry(chunk);

      if (unit !== '단어') { stat.notWord += 1; continue; }
      if (pos !== '명사') { stat.notNoun += 1; continue; }
      if (!word || !isHangulWord(word) || word.length < 2 || word.length > 4) {
        stat.badShape += 1;
        continue;
      }

      // 동음이의어 중 하나만 낮춤말이어도 출제하지 않는다. '봉사'처럼 멀쩡한
      // 낱말이 함께 빠지지만, 5,000개 남짓한 출제 풀에서 열몇 개 잃는 쪽이 낫다.
      if (low) derogatory.add(word);

      // 동음이의어는 표제어가 여러 번 나온다. 가장 쉬운 등급을 남긴다 —
      // 한 뜻이라도 초급이면 그 낱말은 초급으로 취급하는 게 맞다.
      const prior = picked.get(word);
      const rank = DIFFICULTY[level] ?? 3;
      if (prior) {
        stat.dup += 1;
        if (rank >= (DIFFICULTY[prior.level] ?? 3)) continue;
      }
      picked.set(word, { level, curated: CURATED_LEVELS.has(level) });
    }
  }

  const rows = [...picked].map(([text, { level }]) => {
    const curated = CURATED_LEVELS.has(level) && !derogatory.has(text);
    if (CURATED_LEVELS.has(level) && !curated) stat.derogatory += 1;
    return toWordRow(text, { isCurated: curated, source: 'STD', difficulty: DIFFICULTY[level] ?? 3 });
  });
  return { rows, stat, files: files.length, derogatory };
}

/**
 * 낮춤말을 출제 풀에서 뺀다.
 *
 * upsert의 is_curated는 OR로 합치기 때문에(손으로 고른 시드를 지키려고) 한 번
 * 출제 풀에 들어간 낱말은 스스로 빠지지 못한다. 차단 기준이 바뀌면 이렇게
 * 명시적으로 내려야 한다.
 *
 * @param {Set<string>} words
 */
async function uncurate(words) {
  if (words.size === 0) return 0;
  const { rowCount } = await pool.query(
    `UPDATE words SET is_curated = false WHERE text = ANY($1::text[]) AND is_curated`,
    [[...words]],
  );
  return rowCount;
}

/** 한 덩이를 upsert한다 */
async function insert(rows) {
  // 손으로 고른 시드가 krdict 등급 때문에 출제 풀에서 빠지면 안 된다.
  // 그래서 is_curated는 OR로, difficulty는 더 쉬운 쪽으로 합친다.
  const { rowCount } = await pool.query(
    `INSERT INTO words (text, length, cho, jung, is_curated, difficulty, source)
     SELECT * FROM UNNEST(
       $1::text[], $2::smallint[], $3::text[], $4::text[],
       $5::boolean[], $6::smallint[], $7::word_source[]
     )
     ON CONFLICT (text) DO UPDATE
       SET cho        = EXCLUDED.cho,
           jung       = EXCLUDED.jung,
           is_curated = words.is_curated OR EXCLUDED.is_curated,
           difficulty = LEAST(words.difficulty, EXCLUDED.difficulty)`,
    [
      rows.map((r) => r.text),
      rows.map((r) => r.length),
      rows.map((r) => r.cho),
      rows.map((r) => r.jung),
      rows.map((r) => r.is_curated),
      rows.map((r) => r.difficulty),
      rows.map((r) => r.source),
    ],
  );
  return rowCount;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? DEFAULT_DIR;

  console.log(`[import] 원본 ${dir}`);
  const { rows, stat, files, derogatory } = collect(dir);

  const curated = rows.filter((r) => r.is_curated).length;
  const byLength = rows.reduce((m, r) => m.set(r.length, (m.get(r.length) ?? 0) + 1), new Map());

  console.log(`[import] XML ${files}개 · 표제어 ${stat.entries.toLocaleString()}개`);
  console.log(
    `[import] 제외 — 낱말 아님 ${stat.notWord} · 명사 아님 ${stat.notNoun} · 글자 규칙 ${stat.badShape} · 동음이의 ${stat.dup}`,
  );
  console.log(`[import] 낮춤말이라 출제에서 뺀 단어 ${stat.derogatory}개`);
  console.log(
    `[import] 채택 ${rows.length.toLocaleString()}개 (출제 ${curated.toLocaleString()} · 판정 전용 ${(rows.length - curated).toLocaleString()})`,
  );
  console.log(
    `[import] 글자 수 — ${[...byLength].sort().map(([len, n]) => `${len}글자 ${n}`).join(' · ')}`,
  );

  if (dry) {
    console.log('[import] --dry 라 넣지 않았다');
    return;
  }

  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    done += await insert(rows.slice(i, i + CHUNK));
    process.stdout.write(`\r[import] ${done.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }
  process.stdout.write('\n');

  const lowered = await uncurate(derogatory);
  const { banned, unserved, restored } = await applyBlocklist(pool);
  console.log(`[import] 출제에서 내림 — 낮춤말 ${lowered}개 · 목록 ${unserved}개`);
  console.log(`[import] 완전 차단 ${banned}개 · 기준에서 빠져 되살림 ${restored}개`);

  const { rows: [total] } = await pool.query(
    `SELECT count(*) AS judge,
            count(*) FILTER (WHERE is_curated) AS curated
       FROM words WHERE status = 'ACTIVE'`,
  );
  console.log(`[import] 완료 — 판정용 ${Number(total.judge).toLocaleString()}개 · 출제용 ${Number(total.curated).toLocaleString()}개`);
}

main()
  .catch((err) => {
    console.error('[import] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
