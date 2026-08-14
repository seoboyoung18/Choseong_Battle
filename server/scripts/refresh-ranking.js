/**
 * 주간 랭킹 재집계.
 *
 *   npm run rank:refresh              이번 주
 *   npm run rank:refresh -- 2026-W33  특정 주
 *
 * 평소에는 게임이 끝날 때마다 자동으로 갱신된다. 이 스크립트는 데이터를
 * 직접 손봤거나, 집계 규칙을 바꾼 뒤 과거 주를 다시 계산할 때 쓴다.
 */

import { pool, query } from '../src/db/pool.js';
import { PostgresStore } from '../src/db/store.js';
import { isValidWeek, rangeOfWeek, weekOf } from '../src/ranking/week.js';

async function main() {
  const arg = process.argv[2];
  if (arg && !isValidWeek(arg)) {
    throw new Error(`주차 형식이 올바르지 않습니다: ${arg} (예: 2026-W33)`);
  }

  const range = arg ? rangeOfWeek(arg) : weekOf();
  const store = new PostgresStore({ db: { query }, dictionary: { idOf: () => undefined } });

  console.log(
    `[rank] ${range.week} 집계 — ${range.start.toISOString()} ~ ${range.end.toISOString()}`,
  );

  const count = await store.refreshWeeklyRanking(range);
  const board = await store.getWeeklyRanking({ week: range.week });

  console.log(`[rank] 등재 ${count}명`);
  for (const row of board.top.slice(0, 10)) {
    const speed = row.avgAnswerMs === null ? '—' : `${(row.avgAnswerMs / 1000).toFixed(1)}초`;
    console.log(`  ${String(row.rank).padStart(3)}위  ${row.nickname}  ${row.roundWins}승  (평균 ${speed}, ${row.gamesCounted}판)`);
  }
  if (board.top.length === 0) console.log('  (등재된 사람이 없습니다)');
}

main()
  .catch((err) => {
    console.error('[rank] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
