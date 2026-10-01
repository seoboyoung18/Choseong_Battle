/**
 * 위키데이터에서 고유명사를 들여온다 — 판정 전용.
 *
 *   npm run db:import:wd -- --dry            무엇이 들어갈지 먼저 본다
 *   npm run db:import:wd                     인명(배우·가수)을 넣는다
 *   npm run db:import:wd -- --only film      다른 분류
 *   npm run db:import:wd -- --only all       전부
 *   npm run db:import:wd -- --dry --dump .   새로 들어갈 낱말을 파일로 적는다
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

import { writeFileSync } from 'node:fs';

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
  /**
   * 한국 국적 배우·가수·감독·작가. 성인물 문제가 없고 순증가가 가장 크다.
   *
   * 국적은 `대한민국(Q884)`만으로 부족하다. 시대마다 다른 나라가 붙는다.
   *
   *   대한민국 Q884    현대
   *   한국     Q18097  윤동주. 대한민국 수립 이전
   *   조선     Q28179  장영실·세종대왕·이순신·정약용
   *
   * 하나만 보면 그 시대 사람이 통째로 빠진다. 셋 다 본다.
   */
  person: {
    label: '배우·가수·감독·작가',
    where: `?x wdt:P27 ?nat ; wdt:P106 ?job ; rdfs:label ?l .
            VALUES ?nat { wd:Q884 wd:Q18097 wd:Q28179 }
            VALUES ?job { wd:Q33999 wd:Q177220 wd:Q2526255
                          wd:Q36180 wd:Q49757 wd:Q6625963 }`,
  },

  /**
   * 한국 운동선수.
   *
   * 직업 코드로 잡으면 종목마다 달라서(축구 선수 Q937857 · 야구 선수 Q10871364 ·
   * 피겨 스케이팅 선수 Q13219587 …) 빠뜨리기 쉽다. 대신 **종목 속성(P641)이
   * 달렸는지**로 본다 — 종목이 있으면 운동선수다. 한 줄로 전 종목을 덮는다.
   */
  athlete: {
    label: '운동선수',
    where: `?x wdt:P27 ?nat ; wdt:P641 ?sport ; rdfs:label ?l .
            VALUES ?nat { wd:Q884 wd:Q18097 wd:Q28179 }`,
  },

  politician: {
    label: '정치인',
    where: `?x wdt:P27 ?nat ; wdt:P106 wd:Q82955 ; rdfs:label ?l .
            VALUES ?nat { wd:Q884 wd:Q18097 wd:Q28179 }`,
  },

  /**
   * 과학자 — 분야 코드를 손으로 적는다.
   *
   * 운동선수처럼 상위 개념으로 묶으려 했지만 안 됐다. `과학자(Q901)` 아래를
   * 전개해도(`P279*`) 우장춘(농학자)·황우석(유전학자)이 안 잡힌다 — 분야 직업이
   * 과학자 하위로 일관되게 달려 있지 않다. 게다가 전개 질의는 45~60초가 걸려
   * WDQS 제한에 걸릴 위험이 있다.
   *
   * 그래서 목록이다. **완전하지 않다** — 빠진 분야는 발견될 때 더한다.
   */
  scientist: {
    label: '과학자',
    where: `?x wdt:P27 ?nat ; wdt:P106 ?job ; rdfs:label ?l .
            VALUES ?nat { wd:Q884 wd:Q18097 wd:Q28179 }
            VALUES ?job { wd:Q901 wd:Q169470 wd:Q593644 wd:Q864503 wd:Q170790
                          wd:Q11063 wd:Q1781198 wd:Q2374149 wd:Q3126128
                          wd:Q205375 wd:Q1906857 wd:Q81096 }`,
  },

  /**
   * 포켓몬.
   *
   * 캐릭터 타입으로는 안 잡힌다 — 포켓몬은 `전기 타입 포켓몬`처럼 속성별 클래스에
   * 달려 있다. 그 클래스들이 전부 `포켓몬스터(Q3966183)`의 하위라 한 단계만
   * 타고 내려가면 된다. `P279*`로 전개할 필요가 없어 가볍다.
   */
  pokemon: {
    label: '포켓몬',
    where: `?x wdt:P31 ?t . ?t wdt:P279 wd:Q3966183 . ?x rdfs:label ?l .`,
  },
  /**
   * 영화 — 성인물을 거르는 2단 필터가 붙는다.
   *
   * ① **한국어 위키백과에 문서가 있을 것.** 누군가 글을 쓸 만큼 알려진 작품만
   *    들인다. `음란기생`·`초대남`·`섹남섹녀`는 문서가 하나도 없어 여기서 걸린다.
   *    등급이 있는 기초사전만 출제에 쓰는 것과 같은 발상이다 — "사람이 아는
   *    것"을 외부 신호로 거른다. 6,031편 중 5,534편이 통과한다.
   *
   * ② **에로 영화 장르(Q599558)가 아닐 것.** ①만으로는 모자란다. 에로 태그
   *    269편 중 146편은 위키백과 문서가 있다(`쌍화점`·`어우동`·`미인도`).
   *    작품성과 무관하게 뺀다.
   *
   * 둘을 합쳐 5,413편. 자동 필터는 완전할 수 없어 넣기 전 목록을 사람이 보고,
   * 놓친 것은 단어 신고(`word_reports`)가 받는다.
   *
   * 위키백과 패턴을 맨 앞에 두는 이유: 그쪽이 선택적이라 먼저 좁히면 질의가
   * 60초에서 17초로 줄어든다.
   */
  film: {
    label: '영화',
    where: `?art schema:isPartOf <https://ko.wikipedia.org/> ; schema:about ?x .
            ?x wdt:P31 wd:Q11424 ; rdfs:label ?l .
            FILTER NOT EXISTS { ?x wdt:P136 wd:Q599558 }`,
  },
  /**
   * 캐릭터.
   *
   * `일본 만화 등장인물(Q87576284)`·`일본 애니메이션 등장인물(Q80447738)`은
   * 나중에 찾았다. 케로로가 왜 없는지 보다가 드러났는데, 이 둘만 777개이고
   * 품질이 좋다 — 정대만·송태섭(슬램덩크), 프랑키·징베(원피스), 프리저(드래곤볼)
   * 처럼 한국에서 쓰는 이름이 들어 있다.
   */
  character: {
    label: '캐릭터',
    where: `VALUES ?t { wd:Q95074 wd:Q15632617 wd:Q3658341 wd:Q15773347
                        wd:Q15773317 wd:Q15711870 wd:Q1114461 wd:Q28020127
                        wd:Q87576284 wd:Q80447738 }
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
/** --dump <디렉터리>: 새로 들어갈 낱말을 파일로 적는다. 사람이 훑어보기 위한 것 */
const DUMP = arg('dump', null);
const ONLY = arg('only', 'person');

/**
 * 한 분류를 받아 온다.
 * @param {string} key CATEGORIES 키
 * @returns {Promise<string[]>} 중복을 뺀 레이블
 */
/**
 * 자동 필터가 놓쳐서 사람이 보고 뺀 낱말.
 *
 * 영화 2단 필터(위키백과 문서 있음 + 에로 장르 아님)를 통과한 3,065개를 전부
 * 훑어 나온 것들이다. 전부 위키백과에 문서가 있고 에로 영화로 분류돼 있지도
 * 않지만, 제목 자체가 화면에 뜨면 곤란하다. 라운드를 이긴 낱말은 `round.won`으로
 * 방 전체에 뿌려진다.
 *
 * 패턴으로 거르지 않는 이유는 DICTIONARY.md에 적힌 것과 같다 — `정사`를 넣으면
 * `공정사회`가, `보지`를 넣으면 장원 감독의 `일보지요`가 함께 걸린다. 손 목록이
 * 정확하다.
 *
 * 분류를 넓힐 때마다 `--dry --dump`로 목록을 뽑아 다시 훑어야 한다.
 */
const EXCLUDE = new Set([
  '섹스돌', '섹스미션', '감옥정사', '매춘시대', '친구애인', '소녀경', '나신들',
]);

/** 초성 19개의 시작 음절. 마지막은 한글 음절 영역의 끝 다음 글자다 */
const CHO_BOUNDS = [
  '가', '까', '나', '다', '따', '라', '마', '바', '빠', '사',
  '싸', '아', '자', '짜', '차', '카', '타', '파', '하', '힤',
];

/**
 * 질의 한 번. 504(시간 초과)·429(너무 잦음)는 공개 엔드포인트에서 흔해서 다시 건다.
 * 기다리는 시간을 늘려 가며 세 번까지.
 */
async function ask(query, attempts = 3) {
  let last = 0;
  for (let i = 1; i <= attempts; i += 1) {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, { headers: HEADERS });
    if (res.ok) return res.text();
    last = res.status;
    if (i < attempts) await new Promise((r) => setTimeout(r, 10_000 * i));
  }
  throw new Error(`위키데이터 질의 실패 (HTTP ${last}) — 세 번 시도했다. 잠시 뒤 다시 돌려라`);
}

/** XML 응답에서 한국어 레이블만 뽑아 모양 규칙으로 거른다 */
function parseLabels(xml) {
  return [...xml.matchAll(/<literal xml:lang='ko'>([^<]+)<\/literal>/g)]
    .map((m) => m[1])
    .filter((t) => isHangulWord(t) && t.length >= 2 && t.length <= 4);
}

/**
 * 손 목록을 뺀다. **개수 검증이 끝난 뒤에** 부른다 —
 * 먼저 빼면 받은 수가 COUNT보다 적어져 "잘렸다"고 잘못 판단한다.
 */
function dropExcluded(texts, key) {
  const kept = texts.filter((t) => !EXCLUDE.has(t));
  const dropped = texts.length - kept.length;
  if (dropped) console.log(`[wd]   ${key}: 사람이 뺀 낱말 ${dropped}개 제외`);
  return kept;
}

/**
 * 한 분류를 받아 온다.
 *
 * **응답이 소리 없이 잘린다.** 영화는 실제로 5,413개인데 한 번에 받으면 2,754개만
 * 돌아왔다. 그대로 넣으면 절반만 들어가고도 성공처럼 보인다.
 *
 * 그래서 COUNT를 먼저 받아 기준을 잡고, 모자라면 초성 구간으로 쪼개 다시 받는다.
 * 그래도 모자라면 **넣지 않고 실패시킨다** — 반쪽짜리 사전이 조용히 들어가는 것보다
 * 낫다.
 *
 * @param {string} key CATEGORIES 키
 * @returns {Promise<string[]>} 중복을 뺀 레이블
 */
async function fetchLabels(key) {
  const { where } = CATEGORIES[key];
  const body = `{ ${where} FILTER(lang(?l)='ko') ${SHAPE} }`;

  const countXml = await ask(`SELECT (COUNT(DISTINCT ?l) AS ?n) WHERE ${body}`);
  const expected = Number(countXml.match(/<literal[^>]*>(\d+)<\/literal>/)?.[1] ?? 0);

  const once = new Set(parseLabels(await ask(`SELECT ?l WHERE ${body}`)));
  if (once.size >= expected) return dropExcluded([...once], key);

  // 잘렸다. 초성 구간으로 쪼개면 한 번에 오는 양이 줄어 안 잘린다.
  console.log(`[wd]   한 번에 ${once.size}/${expected}개만 와서 초성 구간으로 나눠 받는다`);
  const all = new Set(once);
  for (let i = 0; i < CHO_BOUNDS.length - 1; i += 1) {
    const range = `FILTER(?l >= '${CHO_BOUNDS[i]}' && ?l < '${CHO_BOUNDS[i + 1]}')`;
    const xml = await ask(`SELECT DISTINCT ?l WHERE { ${where} FILTER(lang(?l)='ko') ${SHAPE} ${range} }`);
    parseLabels(xml).forEach((t) => all.add(t));
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (all.size < expected) {
    throw new Error(
      `${key}: ${expected}개 중 ${all.size}개만 받았다. 응답이 잘렸다.\n` +
        '  잠시 뒤 다시 시도하거나 구간을 더 잘게 나눠야 한다.',
    );
  }
  return dropExcluded([...all], key);
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
        `SELECT text FROM words WHERE text = ANY($1::text[])`,
        [texts],
      );
      const have = new Set(rows.map((r) => r.text));
      const fresh = texts.filter((t) => !have.has(t));
      console.log(`[wd]   이미 있음 ${have.size}개 · 새로 들어갈 것 ${fresh.length}개`);
      console.log(`[wd]   표본: ${texts.slice(0, 10).join(' · ')}`);

      // 넣기 전에 사람이 전부 훑어볼 수 있어야 한다. 자동 필터는 완전하지 않다.
      if (DUMP) {
        writeFileSync(`${DUMP}/${key}-new.txt`, `${fresh.join('\n')}\n`, 'utf8');
        console.log(`[wd]   새로 들어갈 낱말을 ${DUMP}/${key}-new.txt 에 적었다`);
      }
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
