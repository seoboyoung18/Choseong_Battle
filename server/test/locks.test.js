/**
 * Redis 계층 통합 테스트 — 실제 Redis에 붙어 돈다.
 * 로컬에 Redis가 없으면 전체를 건너뛴다 (CI에서 조용히 통과하지 않도록 사유를 남긴다).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRedis } from '../src/redis/client.js';
import {
  claimRoundWin,
  dequeueMatch,
  enqueueMatch,
  getPasses,
  getQueueSize,
  getRoundWinner,
  getUsedWords,
  getWaitedMs,
  keys,
  loadRoomState,
  markWordUsed,
  popMatchCandidates,
  saveRoomState,
  togglePass,
} from '../src/redis/locks.js';

let redis;
let available = false;

test.before(async () => {
  redis = createRedis('test');
  try {
    await redis.ping();
    available = true;
  } catch {
    available = false;
    console.warn('[test] Redis에 붙지 못해 locks 테스트를 건너뜁니다 — redis-server를 띄우세요');
  }
});

test.after(async () => {
  if (redis) await redis.quit();
});

/** 테스트끼리 키가 겹치지 않도록 게임 id를 격리한다 */
let gameSeq = 0;
const nextGame = () => `test-${process.pid}-${++gameSeq}`;

async function cleanup(gameId) {
  const found = await redis.keys(`game:${gameId}:*`);
  if (found.length) await redis.del(...found);
}

test('선착 락은 정확히 한 명만 통과시킨다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const gameId = nextGame();
  const params = { gameId, roundNo: 6, attemptNo: 1 };

  assert.equal(await claimRoundWin(redis, { ...params, userId: 1024 }), true);
  assert.equal(await claimRoundWin(redis, { ...params, userId: 2048 }), false);
  assert.equal(await getRoundWinner(redis, params), '1024');

  await cleanup(gameId);
});

test('동시에 몰린 20건 중 승자는 하나뿐이다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const gameId = nextGame();
  const params = { gameId, roundNo: 1, attemptNo: 1 };

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => claimRoundWin(redis, { ...params, userId: i })),
  );

  assert.equal(results.filter(Boolean).length, 1, '승자가 한 명이 아니다');

  // 실제로 락을 잡은 사람과 기록된 승자가 같아야 한다
  const winnerIdx = results.indexOf(true);
  assert.equal(await getRoundWinner(redis, params), String(winnerIdx));

  await cleanup(gameId);
});

test('유찰로 교체된 출제는 새 락을 쓴다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const gameId = nextGame();

  assert.equal(await claimRoundWin(redis, { gameId, roundNo: 3, attemptNo: 1, userId: 1 }), true);
  // 같은 라운드 번호지만 attempt가 오르면 다시 경쟁할 수 있어야 한다
  assert.equal(await claimRoundWin(redis, { gameId, roundNo: 3, attemptNo: 2, userId: 2 }), true);

  await cleanup(gameId);
});

test('선착 락에는 TTL이 걸려 있다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const gameId = nextGame();
  await claimRoundWin(redis, { gameId, roundNo: 1, attemptNo: 1, userId: 7 });

  const ttl = await redis.ttl(keys.roundWinner(gameId, 1, 1));
  assert.ok(ttl > 0 && ttl <= 60, `TTL이 이상하다: ${ttl}`);

  await cleanup(gameId);
});

test('패스는 인원수로 집계되고 취소할 수 있다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const gameId = nextGame();
  const params = { gameId, roundNo: 2, attemptNo: 1 };

  assert.equal(await togglePass(redis, { ...params, userId: 1 }), 1);
  assert.equal(await togglePass(redis, { ...params, userId: 2 }), 2);
  assert.equal(await togglePass(redis, { ...params, userId: 2 }), 2, '같은 유저의 중복 패스는 세지 않는다');
  assert.equal(await togglePass(redis, { ...params, userId: 2, passed: false }), 1, '패스 취소');

  assert.deepEqual(await getPasses(redis, params), ['1']);

  await cleanup(gameId);
});

test('게임 안에서 이미 쓴 단어를 기억한다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const gameId = nextGame();

  await markWordUsed(redis, gameId, '감자');
  await markWordUsed(redis, gameId, '과자');

  const used = await getUsedWords(redis, gameId);
  assert.ok(used.has('감자') && used.has('과자'));
  assert.ok(!used.has('간장'));

  await cleanup(gameId);
});

test('매칭 큐는 먼저 기다린 사람부터 꺼낸다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const category = `TEST_${process.pid}`;
  await redis.del(keys.matchQueue(category));

  await enqueueMatch(redis, category, 'late', 3000);
  await enqueueMatch(redis, category, 'early', 1000);
  await enqueueMatch(redis, category, 'mid', 2000);

  assert.equal(await getQueueSize(redis, category), 3);
  assert.deepEqual(await popMatchCandidates(redis, category, 2), ['early', 'mid']);
  assert.equal(await getQueueSize(redis, category), 1);

  await redis.del(keys.matchQueue(category));
});

test('매칭 큐에서 같은 유저를 두 번 꺼내지 않는다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const category = `TEST_RACE_${process.pid}`;
  await redis.del(keys.matchQueue(category));

  for (let i = 0; i < 8; i += 1) await enqueueMatch(redis, category, `u${i}`, i);

  // 두 워커가 동시에 4명씩 집어간다고 가정
  const [a, b] = await Promise.all([
    popMatchCandidates(redis, category, 4),
    popMatchCandidates(redis, category, 4),
  ]);

  const all = [...a, ...b];
  assert.equal(all.length, 8);
  assert.equal(new Set(all).size, 8, '같은 유저가 두 방에 배정됐다');

  await redis.del(keys.matchQueue(category));
});

test('대기 시간과 큐 이탈을 다룬다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const category = `TEST_WAIT_${process.pid}`;
  await redis.del(keys.matchQueue(category));

  await enqueueMatch(redis, category, 'u1', 1000);
  assert.equal(await getWaitedMs(redis, category, 'u1', 16_000), 15_000);
  assert.equal(await getWaitedMs(redis, category, 'nobody'), null);

  await dequeueMatch(redis, category, 'u1');
  assert.equal(await getQueueSize(redis, category), 0);
});

test('룸 상태는 저장한 그대로 복구된다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const roomId = `test-room-${process.pid}`;
  const state = {
    code: 'AB12CD',
    category: 'ALL',
    roundNo: 3,
    attemptNo: 2,
    players: [{ userId: 1, nickname: '새벽감자', connected: true }],
  };

  await saveRoomState(redis, roomId, state);
  assert.deepEqual(await loadRoomState(redis, roomId), state);
  assert.equal(await loadRoomState(redis, 'nope-nonexistent'), null);

  await redis.del(keys.room(roomId));
});
