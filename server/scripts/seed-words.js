/**
 * 초기 단어를 words 테이블에 넣는다. 여러 번 돌려도 안전하다 (text UNIQUE 기준 upsert).
 *
 *   npm run db:seed
 */

import { ALL_WORDS, CURATED } from '../db/seed-words.js';
import { pool } from '../src/db/pool.js';
import { isHangulWord } from '../src/judge/hangul.js';
import { toWordRow } from '../src/words/dictionary.js';

async function main() {
  const curated = new Set(CURATED);

  const rows = [];
  const rejected = [];
  for (const text of ALL_WORDS) {
    if (!isHangulWord(text) || text.length < 2 || text.length > 4) {
      rejected.push(text);
      continue;
    }
    rows.push(toWordRow(text, { isCurated: curated.has(text) }));
  }

  if (rejected.length) {
    // 조용히 넘기지 않는다 — 사전에 이물질이 들어가면 판정이 이상해진다.
    console.warn(`[seed] 규칙 위반으로 제외한 단어 ${rejected.length}개: ${rejected.join(', ')}`);
  }

  const { rowCount } = await pool.query(
    `INSERT INTO words (text, length, cho, jung, is_curated, difficulty, source)
     SELECT * FROM UNNEST(
       $1::text[], $2::smallint[], $3::text[], $4::text[],
       $5::boolean[], $6::smallint[], $7::word_source[]
     )
     ON CONFLICT (text) DO UPDATE
       SET is_curated = EXCLUDED.is_curated,
           cho        = EXCLUDED.cho,
           jung       = EXCLUDED.jung`,
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

  const { rows: [stats] } = await pool.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE is_curated) AS curated
       FROM words WHERE status = 'ACTIVE'`,
  );

  console.log(`[seed] ${rowCount}행 반영 — 판정용 ${stats.total}개 · 출제용 ${stats.curated}개`);
}

main()
  .catch((err) => {
    console.error('[seed] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
