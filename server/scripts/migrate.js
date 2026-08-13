/**
 * 스키마 적용. db/schema.sql을 그대로 실행한다.
 *
 *   npm run db:migrate           이미 있으면 실패한다 (안전)
 *   npm run db:migrate -- --reset  public 스키마를 통째로 지우고 다시 만든다
 *
 * 마이그레이션 도구를 붙이기 전까지 쓰는 임시 러너다.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';

const schemaPath = fileURLToPath(new URL('../db/schema.sql', import.meta.url));

async function main() {
  const reset = process.argv.includes('--reset');

  console.log(`[migrate] 대상 ${config.postgres.user}@${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`);

  if (reset) {
    // 다른 프로젝트 DB를 지우는 사고를 막는다 — 이름을 명시적으로 확인한다.
    if (config.postgres.database !== 'choseong_battle') {
      throw new Error(
        `--reset은 choseong_battle에서만 쓴다. 현재 대상: ${config.postgres.database}`,
      );
    }
    console.log('[migrate] --reset: public 스키마를 삭제하고 다시 만든다');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  const sql = await readFile(schemaPath, 'utf8');
  await pool.query(sql);

  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  console.log(`[migrate] 완료 — 테이블 ${rows.length}개: ${rows.map((r) => r.table_name).join(', ')}`);
}

main()
  .catch((err) => {
    console.error('[migrate] 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
