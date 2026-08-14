/**
 * 방 관리 — 친구 방과 빠른 매칭 임시 방을 같은 구조로 다룬다.
 *
 * 진행 중 상태의 원천은 이 프로세스의 메모리이고, Redis에는 재접속 복구용
 * 스냅샷을 함께 남긴다. 서버를 여러 대로 늘릴 때는 이 클래스가 Redis pub/sub
 * 위로 올라가야 한다 (NFR-3).
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { RULES } from '../config.js';
import { deleteRoomState, saveRoomState } from '../redis/locks.js';
import { Game } from './round.js';

/** 초대 코드 문자 집합 — 0/O, 1/I처럼 헷갈리는 글자는 뺀다 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @returns {string} 6자리 초대 코드 */
function generateCode() {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

/** 비밀번호(숫자 4자리)를 해시한다 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 비밀번호를 대조한다. 타이밍 공격을 피해 상수 시간으로 비교한다 */
export function verifyPassword(password, stored) {
  if (!stored) return true;
  const [saltHex, hashHex] = stored.split(':');
  const hash = scryptSync(String(password ?? ''), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export class Room {
  constructor({ id, code, name, hostId, category, totalRounds, passwordHash, isPublic }) {
    this.id = id;
    this.code = code;
    this.name = name;
    this.hostId = hostId ? String(hostId) : null;
    this.category = category;
    this.totalRounds = totalRounds;
    this.passwordHash = passwordHash ?? null;
    this.isPublic = isPublic;
    this.status = 'WAITING';

    /** @type {Map<string, { userId: any, nickname: string, avatarId: number, isReady: boolean, connected: boolean }>} */
    this.members = new Map();
    /** @type {Game | null} */
    this.game = null;
  }

  get size() {
    return this.members.size;
  }

  get isFull() {
    return this.size >= RULES.MAX_PLAYERS;
  }

  get locked() {
    return this.passwordHash !== null;
  }

  /** API room.state 페이로드 */
  toState() {
    return {
      roomId: this.id,
      code: this.code,
      name: this.name,
      status: this.status,
      settings: {
        category: this.category,
        totalRounds: this.totalRounds,
        locked: this.locked,
        isPublic: this.isPublic,
      },
      players: [...this.members.values()].map((m) => ({
        userId: m.userId,
        nickname: m.nickname,
        avatarId: m.avatarId,
        isHost: String(m.userId) === this.hostId,
        isReady: m.isReady,
        connected: m.connected,
      })),
    };
  }

  /** 공개 방 목록 한 줄 */
  toListItem() {
    return {
      code: this.code,
      name: this.name,
      category: this.category,
      totalRounds: this.totalRounds,
      players: this.size,
      maxPlayers: RULES.MAX_PLAYERS,
      locked: this.locked,
    };
  }

  /**
   * 시작할 수 있는 상태인가.
   *
   * @param {boolean} [solo] 혼자 시작하기. 최소 인원 조건을 건너뛴다 —
   *   방을 만들어놓고 상대를 기다리는 대신 혼자 연습하려는 경우다.
   * @returns {boolean}
   */
  canStart(solo = false) {
    if (this.status !== 'WAITING') return false;
    if (solo) return this.size === 1;
    if (this.size < RULES.MIN_PLAYERS) return false;
    return [...this.members.values()].every((m) => m.isReady || String(m.userId) === this.hostId);
  }
}

export class RoomManager {
  /**
   * @param {object} deps
   * @param {import('ioredis').Redis} deps.redis
   * @param {{ has: Function, pickWord: Function }} deps.dictionary
   * @param {import('socket.io').Namespace} deps.io /game 네임스페이스
   * @param {object} [deps.store]
   */
  constructor({ redis, dictionary, io, store = null }) {
    this.redis = redis;
    this.dictionary = dictionary;
    this.io = io;
    this.store = store;

    /** @type {Map<string, Room>} roomId → Room */
    this.rooms = new Map();
    /** @type {Map<string, string>} code → roomId */
    this.byCode = new Map();
    /** @type {Map<string, string>} userId → roomId */
    this.byUser = new Map();

    this.seq = 0;
  }

  /** 유저가 현재 속한 방 */
  roomOf(userId) {
    const roomId = this.byUser.get(String(userId));
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  findByCode(code) {
    const roomId = this.byCode.get(String(code).toUpperCase());
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  /** 공개 방 목록 — 대기 중이고 자리가 남은 방만 */
  listPublicRooms() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.status === 'WAITING' && !r.isFull)
      .map((r) => r.toListItem());
  }

  /**
   * 방을 만든다.
   * @returns {Room}
   */
  createRoom({ host, name, category, totalRounds = RULES.DEFAULT_ROUNDS, password = null, isPublic = true }) {
    const rounds = Math.min(RULES.MAX_ROUNDS, Math.max(RULES.MIN_ROUNDS, Number(totalRounds) || RULES.DEFAULT_ROUNDS));

    let code = generateCode();
    while (this.byCode.has(code)) code = generateCode();

    const room = new Room({
      id: `r${++this.seq}-${code}`,
      code,
      name: name || `${host.nickname}의 방`,
      hostId: host.userId,
      category,
      totalRounds: rounds,
      passwordHash: password ? hashPassword(password) : null,
      isPublic,
    });

    this.rooms.set(room.id, room);
    this.byCode.set(code, room.id);
    this.#addMember(room, host);
    return room;
  }

  /**
   * 코드로 입장한다.
   * @param {object} params
   * @param {boolean} [params.skipPassword] 초대 링크 입장은 비밀번호를 묻지 않는다 (FR-R3)
   * @returns {{ ok: true, room: Room } | { ok: false, code: string }}
   */
  joinRoom({ code, user, password = null, skipPassword = false }) {
    const room = this.findByCode(code);
    if (!room) return { ok: false, code: 'ROOM_NOT_FOUND' };
    if (room.status !== 'WAITING') return { ok: false, code: 'GAME_ALREADY_STARTED' };
    if (room.isFull) return { ok: false, code: 'ROOM_FULL' };
    if (this.byUser.has(String(user.userId))) return { ok: false, code: 'ALREADY_IN_ROOM' };
    if (!skipPassword && !verifyPassword(password, room.passwordHash)) {
      return { ok: false, code: 'INVALID_PASSWORD' };
    }

    this.#addMember(room, user);
    return { ok: true, room };
  }

  #addMember(room, user) {
    room.members.set(String(user.userId), {
      userId: user.userId,
      nickname: user.nickname,
      avatarId: user.avatarId ?? 1,
      isReady: false,
      connected: true,
    });
    this.byUser.set(String(user.userId), room.id);
  }

  /** 준비 상태 토글 */
  setReady(userId, isReady) {
    const room = this.roomOf(userId);
    const member = room?.members.get(String(userId));
    if (!member) return null;
    member.isReady = Boolean(isReady);
    return room;
  }

  /** 방장 전용 설정 변경 — 대기 중에만 */
  updateSettings(userId, { totalRounds, category, password }) {
    const room = this.roomOf(userId);
    if (!room || room.hostId !== String(userId) || room.status !== 'WAITING') return null;

    if (totalRounds !== undefined) {
      room.totalRounds = Math.min(RULES.MAX_ROUNDS, Math.max(RULES.MIN_ROUNDS, Number(totalRounds)));
    }
    if (category !== undefined) room.category = category;
    if (password !== undefined) room.passwordHash = password ? hashPassword(password) : null;
    return room;
  }

  /**
   * 방을 나간다. 방장이 나가면 남은 사람에게 방장을 넘긴다.
   * @returns {Room | null} 갱신된 방 (해산됐으면 null)
   */
  leaveRoom(userId) {
    const id = String(userId);
    const room = this.roomOf(id);
    if (!room) return null;

    room.members.delete(id);
    this.byUser.delete(id);

    if (room.size === 0) {
      this.disposeRoom(room);
      return null;
    }
    if (room.hostId === id) {
      room.hostId = String([...room.members.values()][0].userId);
    }
    return room;
  }

  disposeRoom(room) {
    room.game?.stop();
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    for (const memberId of room.members.keys()) this.byUser.delete(memberId);
    deleteRoomState(this.redis, room.id).catch(() => {});
  }

  /**
   * 게임을 시작한다.
   *
   * games 행을 먼저 만든다 — 첫 라운드가 기록될 때 이미 있어야 FK가 걸린다.
   *
   * @returns {Promise<Game | null>}
   */
  async startGame(room) {
    if (room.status !== 'WAITING') return null;
    room.status = 'PLAYING';

    const gameId = `${room.id}-g${Date.now()}`;

    await this.store?.createGame?.({
      gameId,
      category: room.category,
      totalRounds: room.totalRounds,
      players: [...room.members.values()],
    });
    const game = new Game({
      gameId,
      players: [...room.members.values()],
      category: room.category,
      totalRounds: room.totalRounds,
      dictionary: this.dictionary,
      redis: this.redis,
      store: this.store,
      emit: {
        toRoom: (event, payload) => {
          this.io.to(room.id).emit(event, payload);
          if (event === 'game.ended') this.#onGameEnded(room);
        },
        toUser: (userId, event, payload) => {
          const member = room.members.get(String(userId));
          if (member?.socketId) this.io.to(member.socketId).emit(event, payload);
        },
      },
    });

    room.game = game;
    this.persist(room);
    return game;
  }

  #onGameEnded(room) {
    room.status = 'WAITING';
    for (const member of room.members.values()) member.isReady = false;
    room.game = null;
    this.persist(room);
  }

  /** 재접속 복구용 스냅샷을 Redis에 남긴다 */
  persist(room) {
    saveRoomState(this.redis, room.id, {
      ...room.toState(),
      game: room.game?.snapshot() ?? null,
    }).catch((err) => console.error('[room] 상태 저장 실패', err));
  }
}
