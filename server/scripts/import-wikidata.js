/**
 * 위키데이터에서 고유명사를 들여온다 — 판정 전용.
 *
 *   npm run db:import:wd -- --dry            무엇이 들어갈지 먼저 본다
 *   npm run db:import:wd                     인명(배우·가수)을 넣는다
 *   npm run db:import:wd -- --only film      다른 분류
 *   npm run db:import:wd -- --only all       전부
 *
 * ── 왜 판정 전용인가 ──────────────────────────────────────────────────────
 *
 * 우리말샘과 같은 이유다. 위키데이터는 전수 데이터베이스라 아무도 모르는 항목이
 * 대부분이고(아네도킷·포코냥), 출제에 쓰면 힌트만 보고 떠올릴 수 없는 문제가
 * 나온다. 그래서 `is_curated = false`로만 넣는다 — 답으로 치면 인정하되
 * 문제로 내지는 않는다.
 *
 * ── 라이선스 ──────────────────────────────────────────────────────────────
 *
 * 위키데이터의 구조화 데이터는 **CC0**(퍼블릭 도메인)다. 저작자 표시 의무도
 * 없어서, 기초사전·우리말샘 때문에 이미 지고 있는 CC BY-SA 부담이 늘지 않는다.
 * https://www.wikidata.org/wiki/Wikidata:Licensing
 *
 * ── 성인물 ────────────────────────────────────────────────────────────────
 *
 * 영화 분류에는 에로 영화 제목이 섞여 있다(음란기생·초대남 따위). 판정에 넣는
 * 것만으로도 위험하다 — 이긴 낱말은 `round.won`으로 방 전체 화면에 뜨고, 채팅이
 * 없는 이 게임에서 그게 남에게 글자를 보내는 유일한 통로다.
 *
 * 그래서 장르 `Q599558`(에로 영화)를 **쿼리 단계에서 뺀다.** 다만 그것으로
 * 끝나지 않는다 — 태그가 빠진 작품이 있을 수 있어 사람 검수가 필요하다.
 * 자세한 내용은 docs/proper-noun-mode.md 참고.
 */

import { pool } from '../src/db/pool.js';
import { isHangulWord } from '../src/judge/hangul.js';
import { toWordRow } from '../src/words/dictionary.js';
import { applyBlocklist } from '../src/words/blocklist.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';

/** 위키미디어는 연락처가 담긴 User-Agent를 요구한다. 없으면 JSON 대신 거부 문구가 온다 */
const HEADERS = {
  'User-Agent': 'ChoseongBattle/0.1 (https://github.com/seoboyoung18/Choseong_Battle)',
  // XML로 받는다. JSON 응답에는 제어문자가 섞여 들어와 엄격한 파서가 깨진다.
  Accept: 'application/sparql-results+xml',
};

/** 2~4글자 완성형 한글만 (FR-G1). 서버에서 걸러야 전송량이 준다 */
const SHAPE = "FILTER(STRLEN(?l) >= 2 && STRLEN(?l) <= 4) FILTER(REGEX(?l,'^[가-힣]+$'))";

/**
 * 분류별 질의.
 *
 * 타입 id는 짐작하지 말 것 — 알려진 항목의 P31을 직접 읽어 확인한 값이다.
 * (도라에몽·짱구·슬램덩크가 전부 Q21198342였다)
 */
const CATEGORIES = Object.freeze({
  /** 한국 국적 배우·가수. 성인물 문제가 없고 순증가가 가장 크다 */
  person: {
    label: '배우·가수',
    where: `?x wdt:P27 wd:Q884 ; wdt:P106 ?job ; rdfs:label ?l .
            VALUES ?job { wd:Q33999 wd:Q177220 }`,
  },
  film: {
    label: '영화',
    // 에로 영화는 제외한다. MINUS가 아니라 FILTER NOT EXISTS를 쓰는 이유는
    // 장르가 여러 개 달린 작품도 하나라도 걸리면 빼야 하기 때문이다.
    where: `?x wdt:P31 wd:Q11424 ; rdfs:label ?l .
            FILTER NOT EXISTS { ?x wdt:P136 wd:Q599558 }`,
  },
  character: {
    label: '캐릭터',
    where: `VALUES ?t { wd:Q95074 wd:Q15632617 wd:Q3658341 wd:Q15773347
                        wd:Q15773317 wd:Q15711870 wd:Q1114461 wd:Q28020127 }
            ?x wdt:P31 ?t ; rdfs:label ?l .`,
  },
  manga: {
    label: '만화',
    where: `VALUES ?t { wd:Q21198342 wd:Q8274 } ?x wdt:P31 ?t ; rdfs:label ?l .`,
  },
  anime: {
    label: '애니',
    where: `VALUES ?t { wd:Q63952888 wd:Q1107 wd:Q220898 } ?x wdt:P31 ?t ; rdfs:label ?l .`,
  },
});

/** `--name 값` 또는 `--name=값` */
function arg(name, fallback) {
  const argv = process.argv;
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  const raw = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  return raw ?? fallback;
}

const DRY = process.argv.includes('--dry');
const ONLY = arg('only', 'person');

/**
 * 한 분류를 받아 온다.
 * @param {string} key CATEGORIES 키
 * @returns {Promise<string[]>} 중복을 뺀 레이블
 */
async function fetchLabels(key) {
  const { where } = CATEGORIES[key];
  const query = `SELECT ?l WHERE { ${where} FILTER(lang(?l)='ko') ${SHAPE} }`;
  const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`위키데이터 질의 실패 (HTTP ${res.status}) — 잠시 뒤 다시 시도`);

  const xml = await res.text();
  const found = [...xml.matchAll(/<literal xml:lang='ko'>([^<]+)<\/literal>/g)].map((m) => m[1]);
  return [...new Set(found.filter((t) => isHangulWord(t) && t.length >= 2 && t.length <= 4))];
}

/**
 * 판정 사전에만 넣는다. 이미 있는 낱말은 건드리지 않는다 —
 * 기초사전에서 출제용으로 들어온 낱말을 여기서 덮어쓰면 안 된다.
 */
async function insert(texts) {
  const rows = texts.map((t) => toWordRow(t, { isCurated: false, source: 'WIKIDATA' }));
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

/** source enum에 WIKIDATA가 있는지. 없으면 무엇을 해야 하는지 알려 준다 */
async function assertSourceValue() {
  const { rows } = await pool.query(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'word_source' AND e.enumlabel = 'WIKIDATA'`,
  );
  if (rows.length === 0) {
    throw new Error(
      "word_source enum에 'WIKIDATA'가 없다. 한 번만 돌리면 된다:\n" +
        "    ALTER TYPE word_source ADD VALUE 'WIKIDATA';\n" +
        '  (db/schema.sql에는 이미 들어 있어 새로 만드는 DB는 필요 없다)',
    );
  }
}

async function main() {
  const keys = ONLY === 'all' ? Object.keys(CATEGORIES) : ONLY.split(',').map((s) => s.trim());
  for (const k of keys) {
    if (!CATEGORIES[k]) throw new Error(`알 수 없는 분류: ${k} (가능: ${Object.keys(CATEGORIES).join(', ')}, all)`);
  }
  if (!DRY) await assertSourceValue();

  let total = 0;
  let added = 0;
  for (const key of keys) {
    const { label } = CATEGORIES[key];
    const texts = await fetchLabels(key);
    total += texts.length;
    console.log(`[wd] ${label} — 받은 낱말 ${texts.length}개`);

    if (DRY) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM words WHERE text = ANY($1::text[])`,
        [texts],
      );
      console.log(`[wd]   이미 있음 ${rows[0].n}개 · 새로 들어갈 것 ${texts.length - rows[0].n}개`);
      console.log(`[wd]   표본: ${texts.slice(0, 10).join(' · ')}`);
      continue;
    }

    added += await insert(texts);
  }

  if (DRY) {
    console.log('[wd] --dry 라 넣지 않았다');
    return;
  }

  // 새 출처에도 차단 목록을 태운다. 빠뜨리면 사전에 공들여 만든 필터를 우회한다.
  const { banned, unserved, tooFew } = await applyBlocklist(pool);
  console.log(`[wd] 차단 적용 — 완전 차단 ${banned}개 · 출제 금지 ${unserved}개 · 답 없음 ${tooFew}개`);

  const { rows: [stat] } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS judge,
            count(*) FILTER (WHERE status = 'ACTIVE' AND is_curated) AS curated
       FROM words`,
  );
  console.log(`[wd] 완료 — 받은 ${total}개 중 ${added}개 추가`);
  console.log(`[wd] 판정용 ${stat.judge}개 · 출제용 ${stat.curated}개`);
  console.log('[wd] 서버를 다시 띄워야 사전이 새로 적재된다');
}

main()
  .catch((err) => {
    console.error('[wd] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
