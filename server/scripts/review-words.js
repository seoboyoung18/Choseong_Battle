/**
 * 단어 검수 (FR-W2).
 *
 *   npm run words:review                    검수 대기 목록을 본다
 *   npm run words:review -- --add 밀크티,반반   사전에 넣는다 (판정용)
 *   npm run words:review -- --serve 밀크티      출제 풀에도 넣는다
 *   npm run words:review -- --deny 뷁          신고를 기각한다
 *   npm run words:review -- --ban 어떤말        판정에서도 뺀다
 *
 * 두 갈래를 함께 본다.
 *   신고    유저가 직접 짚어준 낱말. 수가 적어도 신호가 세다
 *   거절 로그  패턴은 맞는데 사전에 없어 거절된 제출. 신고까지 안 갔을 뿐
 *            같은 억울함이고, 여러 사람이 친 낱말일수록 진짜일 확률이 높다
 *
 * 넣을 때는 기본이 **판정 전용**이다. 출제 풀은 "힌트만 보고 떠올릴 수 있는 말"
 * 이어야 하는데 그건 사람이 판단할 일이라, --serve를 따로 줘야 들어간다.
 */

import { pool } from '../src/db/pool.js';
import { choSequence, isHangulWord, jungSequence } from '../src/judge/hangul.js';

/** 한 번에 보여줄 줄 수 */
const LIMIT = 30;

/** `--add 가,나` 또는 `--add=가,나` 형태를 읽는다 */
function listArg(name) {
  const argv = process.argv;
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return [];
  const raw = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  return String(raw ?? '')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
}

/** 낱말이 게임 규칙에 맞는지 — 여기서 걸러야 사전에 이물질이 안 들어간다 */
function usable(word) {
  return isHangulWord(word) && word.length >= 2 && word.length <= 4;
}

async function showPending() {
  const { rows: reports } = await pool.query(
    `SELECT text, action,
            count(*)::int                     AS reports,
            count(DISTINCT user_id)::int      AS people,
            max(created_at)                   AS last_at,
            EXISTS (SELECT 1 FROM words w WHERE w.text = wr.text) AS in_dict
       FROM word_reports wr
      WHERE status = 'PENDING'
      GROUP BY text, action
      ORDER BY people DESC, reports DESC
      LIMIT $1`,
    [LIMIT],
  );

  console.log(`\n[신고] 검수 대기 ${reports.length}건`);
  if (reports.length === 0) console.log('  없음');
  for (const r of reports) {
    const where = r.in_dict ? '이미 사전에 있음' : '사전에 없음';
    console.log(
      `  ${r.text.padEnd(6)} ${r.action}  ${String(r.people).padStart(3)}명 ` +
        `(${r.reports}건) · ${where}`,
    );
  }

  // 신고까지 가지 않은 억울함. 사전에 없는 것만 본다.
  const { rows: rejected } = await pool.query(
    `SELECT s.word,
            count(*)::int                AS tries,
            count(DISTINCT s.user_id)::int AS people
       FROM submissions s
      WHERE s.result = 'REJECTED_NOT_IN_DICT'
        AND NOT EXISTS (SELECT 1 FROM words w WHERE w.text = s.word)
      GROUP BY s.word
     HAVING count(DISTINCT s.user_id) >= 1
      ORDER BY people DESC, tries DESC
      LIMIT $1`,
    [LIMIT],
  );

  console.log(`\n[거절 로그] 사전에 없어 막힌 낱말 ${rejected.length}개`);
  if (rejected.length === 0) console.log('  없음');
  for (const r of rejected) {
    console.log(`  ${r.word.padEnd(6)} ${String(r.people).padStart(3)}명 (${r.tries}번 시도)`);
  }

  console.log('\n넣으려면: npm run words:review -- --add 낱말1,낱말2');
  console.log('출제까지: npm run words:review -- --serve 낱말1');
}

/**
 * 사전에 넣는다.
 * @param {string[]} words
 * @param {boolean} curated 출제 풀에도 넣을지
 */
async function addWords(words, curated) {
  const ok = words.filter(usable);
  const bad = words.filter((w) => !usable(w));
  if (bad.length) console.warn(`[검수] 규칙에 안 맞아 건너뜀: ${bad.join(', ')}`);
  if (ok.length === 0) return;

  await pool.query(
    `INSERT INTO words (text, length, cho, jung, is_curated, difficulty, source, status)
     SELECT * FROM UNNEST($1::text[], $2::smallint[], $3::text[], $4::text[],
                          $5::boolean[], $6::smallint[], $7::word_source[], $8::word_status[])
     ON CONFLICT (text) DO UPDATE
       SET is_curated = words.is_curated OR EXCLUDED.is_curated,
           status     = 'ACTIVE'`,
    [
      ok,
      ok.map((w) => w.length),
      ok.map((w) => choSequence(w)),
      ok.map((w) => jungSequence(w)),
      ok.map(() => curated),
      ok.map(() => 2),
      ok.map(() => 'REPORT'),
      ok.map(() => 'ACTIVE'),
    ],
  );

  const { rowCount } = await pool.query(
    `UPDATE word_reports SET status = 'APPROVED'
      WHERE text = ANY($1::text[]) AND status = 'PENDING'`,
    [ok],
  );

  console.log(
    `[검수] ${ok.length}개 사전에 넣음 (${curated ? '출제+판정' : '판정 전용'}) · 신고 ${rowCount}건 승인`,
  );
}

/** 판정에서도 뺀다 */
async function banWords(words) {
  if (words.length === 0) return;
  await pool.query(
    `INSERT INTO words (text, length, cho, jung, source, status)
     SELECT * FROM UNNEST($1::text[], $2::smallint[], $3::text[], $4::text[],
                          $5::word_source[], $6::word_status[])
     ON CONFLICT (text) DO UPDATE SET status = 'BANNED', is_curated = false`,
    [
      words,
      words.map((w) => w.length),
      words.map((w) => (usable(w) ? choSequence(w) : '')),
      words.map((w) => (usable(w) ? jungSequence(w) : '')),
      words.map(() => 'REPORT'),
      words.map(() => 'BANNED'),
    ],
  );
  await pool.query(
    `UPDATE word_reports SET status = 'APPROVED'
      WHERE text = ANY($1::text[]) AND status = 'PENDING'`,
    [words],
  );
  console.log(`[검수] ${words.length}개 차단(BANNED)`);
}

/** 신고를 기각한다 — 사전은 그대로 두고 목록에서만 내린다 */
async function denyWords(words) {
  if (words.length === 0) return;
  const { rowCount } = await pool.query(
    `UPDATE word_reports SET status = 'REJECTED'
      WHERE text = ANY($1::text[]) AND status = 'PENDING'`,
    [words],
  );
  console.log(`[검수] 신고 ${rowCount}건 기각`);
}

async function main() {
  const add = listArg('add');
  const serve = listArg('serve');
  const deny = listArg('deny');
  const ban = listArg('ban');

  if (add.length === 0 && serve.length === 0 && deny.length === 0 && ban.length === 0) {
    await showPending();
    return;
  }

  if (add.length) await addWords(add, false);
  if (serve.length) await addWords(serve, true);
  if (ban.length) await banWords(ban.filter(usable));
  if (deny.length) await denyWords(deny);

  console.log('[검수] 서버를 다시 띄워야 사전이 새로 적재된다');
}

main()
  .catch((err) => {
    console.error('[검수] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
