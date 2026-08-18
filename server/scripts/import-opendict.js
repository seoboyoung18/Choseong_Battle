/**
 * 국립국어원 우리말샘(개방형 한국어 지식 대사전) XML을 판정 사전에 들여온다.
 *
 *   npm run db:import:open -- --dry        넣지 않고 무엇이 들어갈지만 본다
 *   npm run db:import:open                 실제로 넣는다
 *   npm run db:import:open -- --dialect    지역어(방언)·북한어도 인정한다
 *   npm run db:import:open -- --dir=경로   XML 폴더를 직접 지정한다
 *
 * 원본 받는 법 — 회원 가입·로그인이 필요하다.
 *   https://opendict.korean.go.kr → 내 정보 관리 → 사전 내려받기 → 전체 내려받기
 *   압축을 풀어 server/db/opendict/ 아래에 *.xml 을 둔다 (약 2GB, git 제외)
 *
 * 출처·라이선스: 국립국어원 우리말샘, CC BY-SA 2.0 KR. db/DICTIONARY.md 참고.
 *
 * 기초사전(import-krdict.js)과 역할이 다르다
 *   기초사전  학습자용이라 어휘 등급이 있다 → 출제 풀을 만든다
 *   우리말샘  전수 대사전이라 등급이 없다   → 판정만 넓힌다
 *
 * 그래서 여기서 들어오는 낱말은 is_curated가 항상 false다. 등급이 없으니 어떤
 * 낱말이 "누구나 아는 말"인지 판단할 근거가 없고, 근거 없이 출제 풀에 넣으면
 * 힌트만 보고 아무도 못 맞히는 문제가 나온다.
 *
 * XML 구조가 기초사전과 다르다 (LMF가 아니라 RSS 비슷한 자체 형식)
 *   <item><wordInfo><word>표제어</word><word_unit>어휘</word_unit></wordInfo>
 *         <senseInfo><pos>명사</pos><type>일반어</type><definition>…
 *   값이 CDATA로 감싸여 있고, 한 <item>이 표제어가 아니라 뜻 하나에 해당한다.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { pool } from '../src/db/pool.js';
import { isHangulWord } from '../src/judge/hangul.js';
import { applyBlocklist } from '../src/words/blocklist.js';
import { toWordRow } from '../src/words/dictionary.js';

/**
 * 기본으로 인정할 어휘 범주.
 *
 * 옛말은 항상 뺀다 — 지금 자판으로 칠 수 없는 옛 철자(ᄒᆞᆫ글)가 섞여 있고,
 * 칠 수 있는 것도 현대인이 답으로 떠올릴 낱말이 아니다.
 */
const TYPES = new Set(['일반어']);

/** --dialect 를 주면 함께 인정한다 */
const DIALECT_TYPES = ['지역어', '방언', '북한어'];

/** 한 번에 밀어 넣을 행 수 */
const CHUNK = 2000;

const DEFAULT_DIR = fileURLToPath(new URL('../db/opendict', import.meta.url));

/** <tag><![CDATA[값]]></tag> 또는 <tag>값</tag> 에서 값만 꺼낸다 */
function tagValue(chunk, tag) {
  const m = chunk.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m?.[1]?.trim();
}

/**
 * <item> 한 덩이에서 필요한 것만 꺼낸다.
 *
 * 전용 XML 파서를 쓰지 않는 이유: 파일 26개 2GB인데 필요한 건 태그 네 개다.
 * DOM으로 올리면 메모리가 먼저 터진다.
 */
function parseItem(chunk) {
  // word는 wordInfo 안의 것이어야 한다. relation_info 안에도 <word>가 있어서
  // 덩이 전체에서 찾으면 '자음-자001' 같은 관계어를 집는다.
  const wordInfo = chunk.slice(0, chunk.indexOf('</wordInfo>') + 1);
  return {
    word: tagValue(wordInfo, 'word'),
    unit: tagValue(wordInfo, 'word_unit'),
    pos: tagValue(chunk, 'pos'),
    type: tagValue(chunk, 'type'),
  };
}

/**
 * XML 폴더를 훑어 판정용 행으로 바꾼다.
 * @param {string} dir
 * @param {Set<string>} types 인정할 어휘 범주
 */
function collect(dir, types) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xml'));
  if (files.length === 0) {
    throw new Error(`${dir} 에 XML이 없다. 우리말샘 전체 내려받기를 풀어 두었는지 확인할 것`);
  }

  const words = new Set();
  const stat = { items: 0, notWord: 0, notNoun: 0, badType: 0, badShape: 0, dup: 0 };
  const byType = new Map();

  for (const file of files) {
    // 파일 하나가 78MB쯤 된다. 통째로 읽되 한 번에 한 파일만 들고 있는다.
    const xml = readFileSync(`${dir}/${file}`, 'utf8');
    for (const chunk of xml.split('<item>').slice(1)) {
      stat.items += 1;
      const { word, unit, pos, type } = parseItem(chunk);

      if (unit !== '어휘') { stat.notWord += 1; continue; }
      if (pos !== '명사') { stat.notNoun += 1; continue; }
      if (!types.has(type)) { stat.badType += 1; continue; }
      if (!word || !isHangulWord(word) || word.length < 2 || word.length > 4) {
        stat.badShape += 1;
        continue;
      }

      // 한 표제어에 뜻이 여럿이면 <item>도 여럿이다. 판정에는 등재 여부만
      // 필요하므로 낱말 하나로 합친다.
      if (words.has(word)) { stat.dup += 1; continue; }
      words.add(word);
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    process.stdout.write(`\r[open] ${file} 까지 ${words.size.toLocaleString()}개`);
  }
  process.stdout.write('\n');

  // 판정 전용이라 is_curated는 항상 false, 난이도는 가장 어려운 등급으로 둔다
  const rows = [...words].map((text) =>
    toWordRow(text, { isCurated: false, source: 'OPEN_DICT', difficulty: 3 }),
  );
  return { rows, stat, byType, files: files.length };
}

/**
 * 판정 사전에만 넣는다.
 *
 * 이미 있는 낱말은 건드리지 않는다 — 기초사전에서 출제용으로 들어온 낱말을
 * 우리말샘이 덮어써 출제 풀에서 빼면 안 된다.
 */
async function insert(rows) {
  const { rowCount } = await pool.query(
    `INSERT INTO words (text, length, cho, jung, is_curated, difficulty, source)
     SELECT * FROM UNNEST(
       $1::text[], $2::smallint[], $3::text[], $4::text[],
       $5::boolean[], $6::smallint[], $7::word_source[]
     )
     ON CONFLICT (text) DO NOTHING`,
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

  const types = new Set(TYPES);
  if (process.argv.includes('--dialect')) for (const t of DIALECT_TYPES) types.add(t);

  console.log(`[open] 원본 ${dir}`);
  console.log(`[open] 인정할 범주 — ${[...types].join(', ')}`);

  const { rows, stat, byType, files } = collect(dir, types);

  console.log(`[open] XML ${files}개 · 뜻 ${stat.items.toLocaleString()}개`);
  console.log(
    `[open] 제외 — 어휘 아님 ${stat.notWord.toLocaleString()} · 명사 아님 ${stat.notNoun.toLocaleString()} · 범주 밖 ${stat.badType.toLocaleString()} · 글자 규칙 ${stat.badShape.toLocaleString()} · 같은 낱말 ${stat.dup.toLocaleString()}`,
  );
  console.log(`[open] 범주별 — ${[...byType].map(([t, n]) => `${t} ${n.toLocaleString()}`).join(' · ')}`);
  console.log(`[open] 채택 ${rows.length.toLocaleString()}개 (전부 판정 전용)`);

  if (dry) {
    console.log('[open] --dry 라 넣지 않았다');
    return;
  }

  let added = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    added += await insert(rows.slice(i, i + CHUNK));
    process.stdout.write(`\r[open] ${(i + CHUNK).toLocaleString()} / ${rows.length.toLocaleString()} 처리 · 새로 ${added.toLocaleString()}개`);
  }
  process.stdout.write('\n');

  // 110만 표제어에는 기초사전에 없던 말이 잔뜩 들어온다. 차단 목록을 다시 돌린다.
  const { banned, unserved } = await applyBlocklist(pool);
  console.log(`[open] 완전 차단 ${banned}개 · 출제 금지 ${unserved}개`);

  const { rows: [total] } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS judge,
            count(*) FILTER (WHERE status = 'ACTIVE' AND is_curated) AS curated
       FROM words`,
  );
  console.log(
    `[open] 완료 — 판정용 ${Number(total.judge).toLocaleString()}개 · 출제용 ${Number(total.curated).toLocaleString()}개`,
  );
  console.log('[open] 서버를 다시 띄워야 사전이 새로 적재된다');
}

main()
  .catch((err) => {
    console.error('[open] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
