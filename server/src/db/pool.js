/** PostgreSQL 커넥션 풀. 프로세스당 하나만 만든다. */

import pg from 'pg';

import { config } from '../config.js';

export const pool = new pg.Pool({
  ...config.postgres,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[pg] 유휴 클라이언트 오류', err);
});

/**
 * 단일 쿼리 실행.
 * @param {string} text SQL
 * @param {unknown[]} [params] 바인딩 파라미터
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * 트랜잭션 안에서 콜백을 실행한다. 예외가 나면 롤백한다.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
