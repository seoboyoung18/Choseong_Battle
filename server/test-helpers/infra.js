/**
 * 인프라가 없을 때 테스트가 조용히 통과하지 않게 한다.
 *
 * node:test는 건너뛴 테스트를 요약에 `skipped`로만 적는다. Redis·PostgreSQL이
 * 없으면 52건이 빠진 채 `fail 0`이 찍히는데, 그 숫자만 보면 통과처럼 읽힌다.
 * 실제로 빠지는 건 선착 락·룸 상태·재접속·전적처럼 혼자서는 검증할 수 없는,
 * 통합 테스트로만 확인되는 부분이다.
 *
 * 그래서 `test/infra-available.test.js` 한 파일이 인프라를 직접 확인하고
 * 없으면 실패한다. 나머지 파일은 예전처럼 건너뛴다 — 52개 테스트가 저마다
 * 같은 오류를 토해내면 원인 한 줄이 그 안에 묻히기 때문이다.
 *
 *   npm test                       인프라가 없으면 1건 실패 + 52건 건너뜀
 *   SKIP_INFRA_TESTS=1 npm test    점검까지 건너뛴다 (단위 테스트만 돌릴 때)
 *
 * 이 디렉터리가 test/ 밖에 있는 이유: node --test는 test/ 아래 .js를 전부
 * 테스트 파일로 수집한다. 안에 두면 헬퍼가 테스트 1건으로 집계된다.
 */

import { createRedis } from '../src/redis/client.js';
import { query } from '../src/db/pool.js';

/** 인프라 점검까지 건너뛰도록 명시적으로 켰는가 */
export const skipInfra = process.env.SKIP_INFRA_TESTS === '1';

/** 건너뛸 때 남길 사유 — 요약만 보고 넘기지 않게 해결 방법을 함께 적는다 */
export const SKIP_REASON = {
  REDIS: 'Redis 없음 — docker compose up -d',
  DB: 'PostgreSQL 없음 — docker compose up -d',
  SEED: '시드 단어 없음 — npm run db:seed',
};

/**
 * Redis에 붙는지 본다. 연결은 바로 닫는다 — 점검이 끝나고도 떠 있으면
 * 테스트 프로세스가 종료되지 않는다.
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function probeRedis() {
  const redis = createRedis('infra-probe');
  try {
    await redis.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    await redis.quit().catch(() => {});
  }
}

/**
 * PostgreSQL에 붙는지, 시드 단어가 들어 있는지 본다.
 * 둘은 원인이 달라서 안내도 달라야 한다 — 하나는 컨테이너, 하나는 시드다.
 *
 * @returns {Promise<{ ok: boolean, reason?: string, seeded?: boolean }>}
 */
export async function probeDb() {
  try {
    const { rows } = await query(`SELECT count(*)::int AS n FROM words`);
    return { ok: true, seeded: rows[0].n > 0 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
