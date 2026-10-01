/**
 * 힌트 난이도 분석 — 출제 풀에서 "답이 거의 없는 문제"를 찾는다.
 *
 *   npm run words:hints                      기본 (답 3개 이하를 문제로 본다)
 *   npm run words:hints -- --threshold 5     기준을 바꾼다
 *   npm run words:hints -- --limit 50        더 많이 본다
 *   npm run words:hints -- --type OPEN       한 힌트 타입만
 *   npm run words:hints -- --csv > hints.csv 전부 CSV로 (사람이 추려낼 때)
 *
 * ── 왜 이 지표인가 ────────────────────────────────────────────────────────
 *
 * 출제 단어는 "정답"이 아니라 **힌트를 만드는 재료**다. 플레이어는 그 힌트에
 * 맞고 판정 사전에 있는 낱말이면 무엇이든 쓸 수 있다(README 「정답 판정」).
 *
 * 그래서 '금일'처럼 어려운 한자어가 출제돼도 라운드가 어려워지지 않는다 —
 * 힌트는 ㄱㅇ이고 거기 맞는 답이 수천 개다. 라운드를 흉악하게 만드는 건
 * **그 힌트에 맞는 답이 몇 개 없을 때**다. 답이 1개면 출제된 낱말 자신만
 * 정답이라, 사실상 그 낱말을 맞히라는 문제가 된다.
 *
 * ── 세는 방법 ─────────────────────────────────────────────────────────────
 *
 * 힌트는 무작위라 한 낱말이 여러 힌트를 만든다. 가능한 힌트를 전부 펼쳐
 * (운이 나쁠 때를 봐야 하므로) 그중 **가장 답이 적은 것**을 그 낱말의 점수로 삼는다.
 *
 *   CHO/JUNG  글자마다 초성·중성 전체 공개라 모양이 하나다
 *   MIX       글자마다 초성/중성 중 하나. 두 종류가 모두 나오도록 보정되므로
 *             전부-초성·전부-중성은 빠진다 (가능한 마스크 2^n − 2개)
 *   OPEN      한 글자만 공개. 공개 위치마다 하나씩 n개
 *
 * 대조 규칙은 judge/hint.js의 matchHint와 같다 — 길이가 같고, 공개된 자리의
 * 초성·중성·글자가 일치하면 정답이다. 종성은 보지 않는다.
 *
 * 읽기 전용이다. 무엇을 내릴지는 사람이 정한다 (`npm run words:review -- --serve` 참고).
 */

import { pool } from '../src/db/pool.js';
import { choSequence, jungSequence } from '../src/judge/hangul.js';
import { HINT_TYPE, LENGTH_RANGE } from '../src/judge/hint.js';

/** `--name 값` 또는 `--name=값` */
function arg(name, fallback) {
  const argv = process.argv;
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return fallback;
  const raw = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  return raw ?? fallback;
}

const THRESHOLD = Number(arg('threshold', 3));
const LIMIT = Number(arg('limit', 30));
const ONLY_TYPE = arg('type', null);
const AS_CSV = process.argv.includes('--csv');

/** 그 길이에서 MIX가 만들 수 있는 마스크 — 비트 1이면 초성, 0이면 중성 */
function mixMasks(n) {
  const all = (1 << n) - 1;
  const masks = [];
  // 0(전부 중성)과 all(전부 초성)은 보정으로 걸러지므로 제외한다
  for (let m = 1; m < all; m += 1) masks.push(m);
  return masks;
}

/** 마스크에 따라 낱말에서 힌트 값을 뽑는다 */
function mixKey(cho, jung, mask, n) {
  let key = '';
  for (let i = 0; i < n; i += 1) key += (mask >> i) & 1 ? cho[i] : jung[i];
  return key;
}

/** 그 길이를 쓰는 힌트 타입들 */
function typesForLength(len) {
  return Object.values(HINT_TYPE).filter(
    (t) => len >= LENGTH_RANGE[t].min && len <= LENGTH_RANGE[t].max,
  );
}

async function main() {
  const { rows } = await pool.query(
    `SELECT text, is_curated FROM words WHERE status = 'ACTIVE'`,
  );

  // 판정 사전 전체를 길이별로 쪼개 둔다. 답은 길이가 같아야 하기 때문이다.
  /** @type {Map<number, Array<{ text: string, cho: string, jung: string }>>} */
  const byLength = new Map();
  const curated = [];
  for (const row of rows) {
    const text = row.text;
    const entry = { text, cho: choSequence(text), jung: jungSequence(text) };
    const len = [...text].length;
    if (!byLength.has(len)) byLength.set(len, []);
    byLength.get(len).push(entry);
    if (row.is_curated) curated.push({ ...entry, length: len });
  }

  // 힌트 모양 → 답 개수. 출제 풀을 훑기 전에 사전 전체로 한 번만 센다.
  /** @type {Map<string, number>} */
  const counts = new Map();
  const bump = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);

  for (const [len, words] of byLength) {
    const types = typesForLength(len);
    const masks = types.includes(HINT_TYPE.MIX) ? mixMasks(len) : [];
    for (const { cho, jung, text } of words) {
      if (types.includes(HINT_TYPE.CHO)) bump(`${len}|C|${cho}`);
      if (types.includes(HINT_TYPE.JUNG)) bump(`${len}|J|${jung}`);
      for (const m of masks) bump(`${len}|M|${m}|${mixKey(cho, jung, m, len)}`);
      if (types.includes(HINT_TYPE.OPEN)) {
        const chars = [...text];
        for (let i = 0; i < len; i += 1) bump(`${len}|O|${i}|${chars[i]}`);
      }
    }
  }

  /** 한 낱말이 만들 수 있는 모든 힌트 — [타입, 보기 좋은 모양, 답 개수] */
  function hintsOf({ text, cho, jung, length: len }) {
    const chars = [...text];
    const out = [];
    const want = (t) => !ONLY_TYPE || ONLY_TYPE === t;

    for (const t of typesForLength(len)) {
      if (!want(t)) continue;
      if (t === HINT_TYPE.CHO) out.push([t, [...cho].join(' '), counts.get(`${len}|C|${cho}`) ?? 0]);
      if (t === HINT_TYPE.JUNG) out.push([t, [...jung].join(' '), counts.get(`${len}|J|${jung}`) ?? 0]);
      if (t === HINT_TYPE.MIX) {
        for (const m of mixMasks(len)) {
          const key = mixKey(cho, jung, m, len);
          out.push([t, [...key].join(' '), counts.get(`${len}|M|${m}|${key}`) ?? 0]);
        }
      }
      if (t === HINT_TYPE.OPEN) {
        for (let i = 0; i < len; i += 1) {
          const shape = chars.map((c, j) => (i === j ? c : '⬜')).join(' ');
          out.push([t, shape, counts.get(`${len}|O|${i}|${chars[i]}`) ?? 0]);
        }
      }
    }
    return out;
  }

  const scored = [];
  for (const word of curated) {
    const hints = hintsOf(word);
    if (hints.length === 0) continue;
    let worst = hints[0];
    for (const h of hints) if (h[2] < worst[2]) worst = h;

    // 최악만 보면 과장된다. CHO·JUNG은 모양이 하나라 그 난이도가 늘 나오지만,
    // MIX는 마스크가 여럿이고 OPEN은 공개 위치가 여럿이라 가끔만 걸린다.
    // 같은 타입 안에서 몇 번에 한 번 걸리는지를 함께 센다.
    const sameType = hints.filter((h) => h[0] === worst[0]);
    const badSameType = sameType.filter((h) => h[2] <= THRESHOLD).length;

    scored.push({
      text: word.text,
      length: word.length,
      type: worst[0],
      shape: worst[1],
      answers: worst[2],
      bad: badSameType,
      total: sameType.length,
    });
  }
  scored.sort((a, b) => a.answers - b.answers || b.bad / b.total - a.bad / a.total || a.text.localeCompare(b.text));

  if (AS_CSV) {
    console.log('word,length,hint_type,hint,answers,bad_shapes,total_shapes');
    for (const s of scored) {
      console.log(`${s.text},${s.length},${s.type},"${s.shape}",${s.answers},${s.bad},${s.total}`);
    }
    return;
  }

  console.log(`[hints] 판정 사전 ${rows.length}개 · 출제 풀 ${curated.length}개`);
  if (ONLY_TYPE) console.log(`[hints] 힌트 타입 ${ONLY_TYPE}만 봤다`);
  console.log('[hints] 각 낱말이 만들 수 있는 힌트 중 가장 답이 적은 경우로 줄을 세웠다\n');

  // 분포 — 기준을 어디에 둘지 사람이 판단할 수 있게 먼저 보여준다
  const buckets = [1, 2, 3, 5, 10, 25, 50, 100];
  console.log('답 개수 분포 (최악의 힌트 기준)');
  let prev = 0;
  for (const b of buckets) {
    const n = scored.filter((s) => s.answers > prev && s.answers <= b).length;
    const pct = ((n / scored.length) * 100).toFixed(1);
    console.log(`  ${String(prev + 1).padStart(4)}~${String(b).padEnd(4)} ${String(n).padStart(5)}개  ${pct}%`);
    prev = b;
  }
  const rest = scored.filter((s) => s.answers > prev).length;
  console.log(`  ${String(prev + 1).padStart(4)}+    ${String(rest).padStart(5)}개  ${((rest / scored.length) * 100).toFixed(1)}%\n`);

  const bad = scored.filter((s) => s.answers <= THRESHOLD);
  console.log(`답 ${THRESHOLD}개 이하 — ${bad.length}개 (출제 풀의 ${((bad.length / scored.length) * 100).toFixed(1)}%)`);
  console.log('타입별:');
  for (const t of Object.values(HINT_TYPE)) {
    const n = bad.filter((s) => s.type === t).length;
    if (n) console.log(`  ${t.padEnd(5)} ${n}개`);
  }

  // 늘 나쁜 것과 가끔 나쁜 것을 가른다. 손대야 할 순서가 다르다.
  const always = bad.filter((s) => s.bad === s.total);
  console.log(`  그중 그 타입에서 ${THRESHOLD}개 이하가 늘 나오는 것: ${always.length}개`);

  console.log(`\n가장 나쁜 ${Math.min(LIMIT, bad.length)}개`);
  console.log('  낱말        타입   힌트              답   그 타입에서');
  for (const s of bad.slice(0, LIMIT)) {
    const freq = s.bad === s.total ? '늘' : `${s.bad}/${s.total}`;
    console.log(
      `  ${s.text.padEnd(10)} ${s.type.padEnd(5)} ${s.shape.padEnd(16)} ${String(s.answers).padStart(3)}   ${freq}`,
    );
  }

  if (bad.length > LIMIT) console.log(`  … 그리고 ${bad.length - LIMIT}개 더 (--limit 로 늘린다)`);
  console.log('\n내릴 낱말은 사람이 고른다. 이 스크립트는 DB를 바꾸지 않는다.');
}

main()
  .catch((err) => {
    console.error('[hints] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
