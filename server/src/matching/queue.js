/**
 * 빠른 매칭 큐 소비자.
 *
 * 규칙 (FR-M2 ~ FR-M4)
 *   - 같은 카테고리를 고른 사람끼리만 매칭한다
 *   - 4인이 모이면 즉시 시작
 *   - 가장 오래 기다린 사람이 15초를 넘겼고 2인 이상이면 현재 인원으로 시작
 *   - 60초를 넘기면 혼자 연습을 제안하고 큐에서 뺀다
 *
 * 대기열은 Redis ZSET이라 서버가 여러 대여도 ZPOPMIN이 같은 유저를 두 방에
 * 배정하지 않는다. 다만 지금은 소켓이 이 프로세스에만 있으므로, 꺼냈는데
 * 여기 없는 유저는 큐에 되돌려 놓는다.
 */

import { RULES } from '../config.js';
import { CATEGORY } from '../judge/hint.js';
import { dequeueMatch, enqueueMatch, getQueueSize, popMatchCandidates } from '../redis/locks.js';

export class Matchmaker {
  /**
   * @param {object} deps
   * @param {import('ioredis').Redis} deps.redis
   * @param {import('../game/rooms.js').RoomManager} deps.rooms
   * @param {import('socket.io').Namespace} deps.io /game 네임스페이스
   * @param {number} [deps.intervalMs] 큐를 훑는 주기
   */
  constructor({ redis, rooms, io, intervalMs = 1000 }) {
    this.redis = redis;
    this.rooms = rooms;
    this.io = io;
    this.intervalMs = intervalMs;

    /** @type {Map<string, { user: object, category: string, socketId: string, joinedAt: number }>} */
    this.waiting = new Map();
    this.timer = null;
  }

  /** 대기열에 넣는다. */
  async join({ user, category, socketId }) {
    const id = String(user.userId);
    if (this.waiting.has(id)) return;

    const entry = { user, category, socketId, joinedAt: Date.now() };
    this.waiting.set(id, entry);
    await enqueueMatch(this.redis, category, id, entry.joinedAt);
  }

  /** 대기열에서 뺀다 (취소·연결 끊김). */
  async cancel(userId) {
    const id = String(userId);
    const entry = this.waiting.get(id);
    if (!entry) return;
    this.waiting.delete(id);
    await dequeueMatch(this.redis, entry.category, id);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('[match] 큐 처리 실패', err));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 대기 중인 카테고리들을 한 번씩 살핀다. */
  async tick() {
    const now = Date.now();
    const categories = new Set([...this.waiting.values()].map((e) => e.category));

    for (const category of categories) {
      await this.#dropTimedOut(category, now);
      await this.#matchCategory(category, now);
    }
  }

  /** 60초를 넘긴 사람에게 연습을 제안하고 큐에서 뺀다. */
  async #dropTimedOut(category, now) {
    for (const [id, entry] of this.waiting) {
      if (entry.category !== category) continue;
      if (now - entry.joinedAt < RULES.MATCH_TIMEOUT_MS) continue;

      await this.cancel(id);
      this.io.to(entry.socketId).emit('matching.timeout', { suggestPractice: true });
    }
  }

  async #matchCategory(category, now) {
    const localWaiting = [...this.waiting.values()].filter((e) => e.category === category);
    if (localWaiting.length === 0) return;

    const queued = await getQueueSize(this.redis, category);
    const oldestWaitedMs = now - Math.min(...localWaiting.map((e) => e.joinedAt));

    const full = queued >= RULES.MAX_PLAYERS;
    const readyByTime = oldestWaitedMs >= RULES.MATCH_WAIT_MS && queued >= RULES.MIN_PLAYERS;
    if (!full && !readyByTime) return;

    const ids = await popMatchCandidates(this.redis, category, RULES.MAX_PLAYERS);
    const entries = [];
    for (const id of ids) {
      const entry = this.waiting.get(id);
      if (entry) {
        this.waiting.delete(id);
        entries.push(entry);
      } else {
        // 다른 서버의 유저 — 되돌려 놓는다
        await enqueueMatch(this.redis, category, id, now);
      }
    }

    if (entries.length < RULES.MIN_PLAYERS) {
      // 혼자 남았다. 큐로 되돌리고 다음 주기를 기다린다.
      for (const entry of entries) {
        this.waiting.set(String(entry.user.userId), entry);
        await enqueueMatch(this.redis, category, String(entry.user.userId), entry.joinedAt);
      }
      return;
    }

    this.#createMatchedRoom(category, entries);
  }

  /** 매칭된 인원으로 임시 방을 만들고 바로 시작한다. */
  #createMatchedRoom(category, entries) {
    const [host, ...rest] = entries;

    const room = this.rooms.createRoom({
      host: host.user,
      name: '빠른 대전',
      category,
      totalRounds: RULES.DEFAULT_ROUNDS,
      isPublic: false,
    });

    for (const entry of rest) {
      this.rooms.joinRoom({ code: room.code, user: entry.user, skipPassword: true });
    }

    // 소켓을 방에 넣고 socketId를 기록한다 (개인 전송용)
    for (const entry of entries) {
      const member = room.members.get(String(entry.user.userId));
      if (member) member.socketId = entry.socketId;
      this.io.sockets.get(entry.socketId)?.join(room.id);
    }

    this.io.to(room.id).emit('matching.matched', {
      roomId: room.id,
      code: room.code,
      category,
      players: room.toState().players,
    });

    const game = this.rooms.startGame(room);
    game?.start().catch((err) => console.error('[match] 게임 시작 실패', err));
  }
}

/** 카테고리 유효성 — 클라이언트가 아무 값이나 보내는 것을 막는다 */
export function isValidCategory(value) {
  return Object.hasOwn(CATEGORY, value);
}
