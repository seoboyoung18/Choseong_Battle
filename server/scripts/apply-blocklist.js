/**
 * 차단 목록을 이미 들어 있는 words 테이블에 적용한다.
 *
 *   npm run db:block
 *
 * blocklist.js에 낱말을 한 줄 더할 때마다 사전 27,000개를 다시 넣을 수는 없다.
 * 신고(word_reports)로 올라온 낱말을 막을 때도 이걸 쓴다.
 */

import { pool } from '../src/db/pool.js';
import { applyBlocklist } from '../src/words/blocklist.js';

async function main() {
  const { banned } = await applyBlocklist(pool);

  const { rows: [total] } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'BANNED') AS banned,
            count(*) FILTER (WHERE status = 'ACTIVE') AS active,
            count(*) FILTER (WHERE status = 'ACTIVE' AND is_curated) AS curated
       FROM words`,
  );

  console.log(`[block] 이번에 막은 단어 ${banned}개`);
  console.log(
    `[block] 차단 ${total.banned}개 · 판정용 ${Number(total.active).toLocaleString()}개 · 출제용 ${Number(total.curated).toLocaleString()}개`,
  );
  console.log('[block] 서버를 다시 띄워야 사전이 새로 적재된다');
}

main()
  .catch((err) => {
    console.error('[block] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
