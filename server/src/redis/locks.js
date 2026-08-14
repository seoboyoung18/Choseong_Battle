/**
 * 선착 락 · 매칭 큐 · 룸 상태 · 접속 상태.
 *
 * 이 파일의 핵심은 claimRoundWin이다. 동시에 들어온 제출 중 정확히 한 명만
 * 승자가 되어야 하는데, 조회와 쓰기를 두 단계로 나누면 그 사이에 다른 요청이
 * 끼어들어 둘 다 승리하는 사고가 난다.
 *
 *   ❌ const winner = await redis.get(key);
 *      if (!winner) await redis.set(key, userId);
 *
 *   ✅ await redis.set(key, userId, 'NX', 'EX', 60)
 *
 * Redis는 명령을 하나씩 순서대로 처리하므로(단일 스레드) SET NX는 판정과 기록이
 * 한 명령 안에서 끝난다. TTL을 거는 이유는 서버가 중간에 죽어도 락이 영원히
 * 남아 해당 라운드가 영영 끝나지 않는 상황을 막기 위함이다.
 */

import { RULES } from '../config.js';

/**
 * 매칭 대기열 식별자. 카테고리와 원하는 인원수가 모두 같아야 같은 줄에 선다 —
 * 2인전을 원하는 사람과 4인전을 원하는 사람을 한 방에 넣을 수는 없다.
 * @param {string} category
 * @param {number} size
 * @returns {string}
 */
export const queueId = (category, size) => `${category}:${size}`;

/** Redis 키 조립 — 키 문자열을 코드 여기저기 흩뿌리지 않는다 */
export const keys = {
  /** 라운드 선착 락. 유찰 교체마다 attemptNo가 올라가므로 키도 새로 생긴다 */
  roundWinner: (gameId, roundNo, attemptNo) =>
    `game:${gameId}:round:${roundNo}:${attemptNo}:winner`,
  /** 이번 출제에서 패스를 누른 유저 집합 */
  roundPasses: (gameId, roundNo, attemptNo) =>
    `game:${gameId}:round:${roundNo}:${attemptNo}:passes`,
  /** 게임 안에서 이미 나온 단어 — 재출제 방지 */
  recentWords: (gameId) => `game:${gameId}:recent_words`,
  /** 빠른 매칭 대기열 (카테고리별) */
  matchQueue: (category) => `match:queue:${category}`,
  /** 룸 실시간 상태 — 재접속 복구의 원천 */
  room: (roomId) => `room:${roomId}`,
  /** 접속 상태 */
  presence: (userId) => `presence:${userId}`,
};

/** 락 TTL — 라운드 제한시간보다 넉넉히 길게 잡아 늦은 제출도 거절되게 한다 */
const LOCK_TTL_SEC = 60;

// ── 선착 락 ──────────────────────────────────────────────────────────────────

/**
 * 라운드 승리를 선점한다. 판정을 통과한 제출만 여기까지 온다.
 *
 * @param {import('ioredis').Redis} redis
 * @param {object} params
 * @param {string|number} params.gameId
 * @param {number} params.roundNo
 * @param {number} params.attemptNo 같은 round_no 안에서의 출제 차수
 * @param {string|number} params.userId
 * @returns {Promise<boolean>} true면 이 유저가 승자, false면 이미 확정된 라운드
 */
export async function claimRoundWin(redis, { gameId, roundNo, attemptNo, userId }) {
  const key = keys.roundWinner(gameId, roundNo, attemptNo);
  const result = await redis.set(key, String(userId), 'NX', 'EX', LOCK_TTL_SEC);
  return result === 'OK';
}

/**
 * 현재 라운드 승자를 조회한다. 재접속 동기화용이며, 판정에는 쓰지 않는다.
 * @returns {Promise<string|null>}
 */
export function getRoundWinner(redis, { gameId, roundNo, attemptNo }) {
  return redis.get(keys.roundWinner(gameId, roundNo, attemptNo));
}

// ── 패스 ─────────────────────────────────────────────────────────────────────

/**
 * 패스를 등록한다. 접속 중인 전원이 눌러야 문제가 교체된다.
 *
 * 패스는 "이 문제 바꾸자"는 찬성표일 뿐 제출권 포기가 아니다 — 패스한 유저도
 * 계속 정답을 낼 수 있고, 그 사이 정답이 나오면 패스 집계는 그대로 버려진다.
 *
 * @param {import('ioredis').Redis} redis
 * @param {object} params
 * @param {string|number} params.gameId
 * @param {number} params.roundNo
 * @param {number} params.attemptNo
 * @param {string|number} params.userId
 * @param {boolean} [params.passed] false면 패스 취소
 * @returns {Promise<number>} 현재 패스 인원 수
 */
export async function togglePass(redis, { gameId, roundNo, attemptNo, userId, passed = true }) {
  const key = keys.roundPasses(gameId, roundNo, attemptNo);
  if (passed) {
    await redis.sadd(key, String(userId));
    await redis.expire(key, LOCK_TTL_SEC);
  } else {
    await redis.srem(key, String(userId));
  }
  return redis.scard(key);
}

/**
 * 이 출제에서 패스한 유저 목록.
 * @returns {Promise<string[]>}
 */
export function getPasses(redis, { gameId, roundNo, attemptNo }) {
  return redis.smembers(keys.roundPasses(gameId, roundNo, attemptNo));
}

// ── 재출제 방지 ──────────────────────────────────────────────────────────────

/**
 * 게임 안에서 이미 출제된 단어로 등록한다.
 * @returns {Promise<void>}
 */
export async function markWordUsed(redis, gameId, word) {
  const key = keys.recentWords(gameId);
  await redis.sadd(key, word);
  await redis.expire(key, 3600);
}

/**
 * 이미 출제된 단어 집합.
 * @returns {Promise<Set<string>>}
 */
export async function getUsedWords(redis, gameId) {
  const words = await redis.smembers(keys.recentWords(gameId));
  return new Set(words);
}

// ── 매칭 큐 ──────────────────────────────────────────────────────────────────

/**
 * 매칭 대기열에 등록한다. score는 등록 시각이라 오래 기다린 사람이 먼저 빠진다.
 * @param {import('ioredis').Redis} redis
 * @param {string} category
 * @param {string|number} userId
 * @param {number} [now] 등록 시각 (ms)
 */
export function enqueueMatch(redis, category, userId, now = Date.now()) {
  return redis.zadd(keys.matchQueue(category), now, String(userId));
}

/**
 * 매칭 대기열에서 뺀다 (취소·연결 끊김).
 */
export function dequeueMatch(redis, category, userId) {
  return redis.zrem(keys.matchQueue(category), String(userId));
}

/**
 * 대기열 앞에서 최대 count명을 꺼낸다.
 *
 * ZPOPMIN은 원자적이라 서버가 여러 대로 늘어나도 같은 유저가 두 방에
 * 배정되지 않는다.
 *
 * @returns {Promise<string[]>} 꺼낸 userId 목록 (요청보다 적을 수 있다)
 */
export async function popMatchCandidates(redis, category, count = RULES.MAX_PLAYERS) {
  const flat = await redis.zpopmin(keys.matchQueue(category), count);
  // ZPOPMIN은 [member, score, member, score, ...] 형태로 돌려준다
  const users = [];
  for (let i = 0; i < flat.length; i += 2) users.push(flat[i]);
  return users;
}

/**
 * 특정 유저가 얼마나 기다렸는지 (ms). 대기열에 없으면 null.
 * @returns {Promise<number|null>}
 */
export async function getWaitedMs(redis, category, userId, now = Date.now()) {
  const score = await redis.zscore(keys.matchQueue(category), String(userId));
  return score === null ? null : now - Number(score);
}

/** 대기열 인원 수 */
export function getQueueSize(redis, category) {
  return redis.zcard(keys.matchQueue(category));
}

// ── 룸 상태 ──────────────────────────────────────────────────────────────────

/**
 * 룸 상태를 통째로 저장한다. 재접속 복구의 원천이라 게임 진행 정보까지 담는다.
 * @param {import('ioredis').Redis} redis
 * @param {string|number} roomId
 * @param {object} state
 */
export async function saveRoomState(redis, roomId, state) {
  await redis.set(keys.room(roomId), JSON.stringify(state), 'EX', 3600);
}

/**
 * @returns {Promise<object|null>}
 */
export async function loadRoomState(redis, roomId) {
  const raw = await redis.get(keys.room(roomId));
  return raw ? JSON.parse(raw) : null;
}

export function deleteRoomState(redis, roomId) {
  return redis.del(keys.room(roomId));
}

// ── 접속 상태 ────────────────────────────────────────────────────────────────

/**
 * 접속 신호를 갱신한다. TTL이 지나 사라지면 이탈로 본다.
 */
export function touchPresence(redis, userId, roomId) {
  return redis.set(
    keys.presence(userId),
    String(roomId),
    'EX',
    Math.ceil(RULES.REJOIN_GRACE_MS / 1000),
  );
}

export function clearPresence(redis, userId) {
  return redis.del(keys.presence(userId));
}

/**
 * @returns {Promise<string|null>} 접속 중이면 소속 roomId
 */
export function getPresence(redis, userId) {
  return redis.get(keys.presence(userId));
}
