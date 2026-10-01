/**
 * 인프라 점검.
 *
 * 다른 통합 테스트 파일들은 Redis·PostgreSQL이 없으면 조용히 건너뛴다. 그러면
 * 요약이 `fail 0`이라 통과처럼 보이는데, 실제로는 선착 락·룸 상태·재접속·전적이
 * 하나도 검증되지 않은 상태다. 이 파일이 그 상황을 실패로 만든다.
 *
 * 실패 메시지는 한 번만 나온다 — 건너뛴 파일마다 터뜨리면 원인이 묻힌다.
 *
 * 단위 테스트만 돌리려면 SKIP_INFRA_TESTS=1 로 이 점검까지 끌 수 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { probeDb, probeRedis, skipInfra } from '../test-helpers/infra.js';

test('Redis가 떠 있다 — 없으면 선착 락·룸 상태 테스트가 통째로 빠진다', async (t) => {
  if (skipInfra) return t.skip('SKIP_INFRA_TESTS=1');

  const { ok, reason } = await probeRedis();
  assert.ok(
    ok,
    `Redis에 붙지 못했습니다 (${reason}).\n` +
      `  해결: docker compose up -d\n` +
      `  인프라 없이 단위 테스트만 돌리려면: SKIP_INFRA_TESTS=1 npm test`,
  );
});

test('PostgreSQL에 시드가 들어 있다 — 없으면 전적·랭킹 테스트가 통째로 빠진다', async (t) => {
  if (skipInfra) return t.skip('SKIP_INFRA_TESTS=1');

  const { ok, reason, seeded } = await probeDb();
  assert.ok(
    ok,
    `PostgreSQL에 붙지 못했습니다 (${reason}).\n` +
      `  해결: docker compose up -d && npm run db:migrate\n` +
      `  인프라 없이 단위 테스트만 돌리려면: SKIP_INFRA_TESTS=1 npm test`,
  );
  assert.ok(
    seeded,
    'words 테이블이 비어 있습니다.\n' +
      '  해결: npm run db:seed (또는 npm run db:import 으로 사전 전체)',
  );
});
