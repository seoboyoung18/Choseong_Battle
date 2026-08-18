/**
 * 게임 서버 엔트리 — Express(REST) + Socket.IO(실시간).
 *
 * 실시간 이벤트가 본체이고 REST는 조회성 데이터만 담당한다.
 * 판정·타이머·선착 순위·점수는 전부 서버가 정한다 (서버 권위, FR-J2).
 */

import { createServer } from 'node:http';

import express from 'express';
import { Server } from 'socket.io';

import { validateAppearance } from '../../shared/avatar.js';
import { PRACTICE_TIERS, RULES, config } from './config.js';
import { pool, query } from './db/pool.js';
import { PostgresStore } from './db/store.js';
import { PracticeSession } from './game/practice.js';
import { RoomManager } from './game/rooms.js';
import { Matchmaker, isValidCategory, isValidSize } from './matching/queue.js';
import { isValidWeek } from './ranking/week.js';
import { closeRedis, getRedis } from './redis/client.js';
import { clearPresence, touchPresence } from './redis/locks.js';
import { loadDictionary } from './words/dictionary.js';

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: config.corsOrigins, credentials: true },
});

const redis = getRedis();

// 사전은 기동 시 한 번 메모리에 올린다 — 제출 판정 경로에 DB 왕복을 두지 않는다.
const dictionary = await loadDictionary({ query });

/** 실시간 이벤트는 전부 /game 네임스페이스에서 오간다 (API 명세 3장) */
const gameNsp = io.of('/game');

const store = new PostgresStore({ db: { query }, dictionary });

const rooms = new RoomManager({ redis, dictionary, io: gameNsp, store });
const matchmaker = new Matchmaker({ redis, rooms, io: gameNsp });
matchmaker.start();

// ── REST ─────────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  const checks = { redis: 'down', postgres: 'down' };
  try {
    await redis.ping();
    checks.redis = 'up';
  } catch { /* down으로 둔다 */ }
  try {
    await query('SELECT 1');
    checks.postgres = 'up';
  } catch { /* down으로 둔다 */ }

  const healthy = Object.values(checks).every((v) => v === 'up');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    dictionary: { judge: dictionary.size, curated: dictionary.curatedSize },
    rooms: rooms.rooms.size,
  });
});

app.get('/api/v1/rooms', (_req, res) => {
  res.json({ rooms: rooms.listPublicRooms() });
});

// ── WebSocket ────────────────────────────────────────────────────────────────

/**
 * 핸드쉐이크 인증.
 *
 * TODO: 토스 로그인 → 자체 JWT 검증으로 교체한다. 지금은 개발용으로
 * handshake.auth의 값을 그대로 신뢰하므로 절대 이 상태로 배포하면 안 된다.
 */
gameNsp.use(async (socket, next) => {
  const { userId, nickname } = socket.handshake.auth ?? {};
  if (!userId || !nickname) return next(new Error('UNAUTHORIZED'));

  // 클라이언트가 보낸 id는 계정 식별자일 뿐이고, 게임 안에서 쓰는 userId는
  // users 테이블의 숫자 id다. 전적·제출 로그가 FK로 묶여야 하기 때문이다.
  const account = await store.upsertUser({
    tossUserId: String(userId),
    nickname: String(nickname).slice(0, 12),
  });
  if (!account) return next(new Error('SIGNIN_FAILED'));

  // 캐릭터는 DB에 있는 것을 그대로 쓴다 — 접속할 때 클라이언트가 보내온 값이 아니다
  socket.data.user = {
    userId: account.id,
    nickname: account.nickname,
    appearance: account.appearance,
  };
  next();
});

gameNsp.on('connection', (socket) => {
  const { user } = socket.data;
  const userId = String(user.userId);

  touchPresence(redis, userId, '').catch(() => {});

  // 서버가 확정한 내 신원과 전적을 알려준다. 클라이언트는 handshake에 보낸
  // 임시 id가 아니라 이 userId로 "나"를 식별해야 한다.
  Promise.all([
    store.getUserStats(user.userId),
    store.getWeeklyRanking({ userId: user.userId }),
  ]).then(([stats, ranking]) => {
    socket.emit('session.ready', { ...user, stats, weeklyRank: ranking?.me ?? null });
  });

  /** 현재 방 상태를 방 전체에 뿌리고 Redis에도 남긴다 */
  const broadcastRoom = (room) => {
    if (!room) return;
    gameNsp.to(room.id).emit('room.state', room.toState());
    rooms.persist(room);
  };

  const fail = (code, message) => socket.emit('error.notice', { code, message });

  // ── 빠른 매칭 ──────────────────────────────────────────────────────────────

  socket.on('matching.join', async ({ category, size = RULES.MAX_PLAYERS } = {}) => {
    if (!isValidCategory(category)) return fail('INVALID_PARAM', '알 수 없는 카테고리예요');
    if (!isValidSize(size)) return fail('INVALID_PARAM', '인원수는 2~4명만 고를 수 있어요');
    if (rooms.roomOf(userId)) return fail('ALREADY_IN_ROOM', '이미 방에 있어요');
    await matchmaker.join({ user, category, size: Number(size), socketId: socket.id });
  });

  socket.on('matching.cancel', async () => {
    await matchmaker.cancel(userId);
  });

  // ── 친구 방 ────────────────────────────────────────────────────────────────

  socket.on('room.create', ({ name, totalRounds, category, password } = {}) => {
    if (!isValidCategory(category)) return fail('INVALID_PARAM', '알 수 없는 카테고리예요');
    if (rooms.roomOf(userId)) return fail('ALREADY_IN_ROOM', '이미 방에 있어요');

    const room = rooms.createRoom({ host: user, name, category, totalRounds, password });
    room.members.get(userId).socketId = socket.id;
    socket.join(room.id);
    broadcastRoom(room);
  });

  socket.on('room.join', ({ code, password, viaInvite } = {}) => {
    const result = rooms.joinRoom({ code, user, password, skipPassword: Boolean(viaInvite) });
    if (!result.ok) return fail(result.code, '입장할 수 없어요');

    result.room.members.get(userId).socketId = socket.id;
    socket.join(result.room.id);
    broadcastRoom(result.room);
  });

  socket.on('room.leave', () => {
    const room = rooms.roomOf(userId);
    if (!room) return;
    socket.leave(room.id);
    broadcastRoom(rooms.leaveRoom(userId));
  });

  socket.on('room.ready', ({ isReady } = {}) => {
    broadcastRoom(rooms.setReady(userId, isReady));
  });

  socket.on('room.updateSettings', (settings = {}) => {
    const room = rooms.updateSettings(userId, settings);
    if (!room) return fail('FORBIDDEN', '방장만 바꿀 수 있어요');
    broadcastRoom(room);
  });

  socket.on('game.start', async ({ solo = false } = {}) => {
    const room = rooms.roomOf(userId);
    if (!room) return fail('ROOM_NOT_FOUND', '방이 없어요');
    if (room.hostId !== userId) return fail('FORBIDDEN', '방장만 시작할 수 있어요');
    if (!room.canStart(solo)) {
      return fail(
        'NOT_READY',
        solo ? '혼자 시작은 방에 나만 있을 때만 돼요' : '아직 준비가 끝나지 않았어요',
      );
    }

    const instance = await rooms.startGame(room, { solo });
    await instance?.start();
  });

  // ── 라운드 ─────────────────────────────────────────────────────────────────

  socket.on('round.submit', async ({ word } = {}) => {
    const room = rooms.roomOf(userId);
    if (!room?.game) return;
    await room.game.submit({ userId, word });
  });

  socket.on('round.pass', async ({ passed = true } = {}) => {
    const room = rooms.roomOf(userId);
    if (!room?.game) return;
    await room.game.pass({ userId, passed });
  });

  socket.on('reaction.send', ({ emoji } = {}) => {
    const room = rooms.roomOf(userId);
    if (!room) return;
    if (!['👍', '😂', '😱', '🔥'].includes(emoji)) return;
    gameNsp.to(room.id).emit('reaction.broadcast', { userId: user.userId, emoji });
  });

  // ── 혼자 연습 ──────────────────────────────────────────────────────────────

  /** @type {PracticeSession | null} 소켓 하나당 한 세션 */
  let practice = null;

  /** 도전이 끝나면 기록을 남기고 결과를 덧붙여 보낸다 */
  const finishPractice = async (payload) => {
    const saved = await store.savePracticeRecord({
      userId: user.userId,
      tier: payload.tier,
      category: payload.category,
      streak: payload.streak,
    });
    socket.emit('practice.ended', { ...payload, ...(saved ?? {}) });
    practice = null;
  };

  socket.on('practice.start', ({ category, tier } = {}) => {
    if (!isValidCategory(category)) return fail('INVALID_PARAM', '알 수 없는 카테고리예요');
    if (!PRACTICE_TIERS[tier]) return fail('INVALID_PARAM', '알 수 없는 단계예요');
    if (rooms.roomOf(userId)) return fail('ALREADY_IN_ROOM', '방에서 나온 뒤에 해주세요');

    practice?.dispose();
    practice = new PracticeSession({
      userId: user.userId,
      category,
      tier,
      dictionary,
      emit: (event, payload) => {
        // 종료만 가로채 기록을 남긴다. 나머지는 그대로 흘려보낸다.
        if (event === 'practice.ended') {
          finishPractice(payload).catch((err) => console.error('[practice] 기록 실패', err));
          return;
        }
        socket.emit(event, payload);
      },
    });
    practice.start();
  });

  socket.on('practice.submit', ({ word } = {}) => practice?.submit(word));
  socket.on('practice.pass', () => practice?.pass());
  socket.on('practice.quit', () => practice?.quit());

  socket.on('practice.records', async () => {
    socket.emit('practice.records', { records: await store.getPracticeRecords(user.userId) });
  });

  // ── 랭킹 · 전적 ────────────────────────────────────────────────────────────

  // API 명세는 REST(GET /rankings/weekly)로 잡혀 있지만, 아직 REST를 지킬
  // 인증 수단이 없다. JWT가 붙으면 REST로 옮긴다.
  socket.on('ranking.weekly', async ({ week } = {}) => {
    if (week !== undefined && !isValidWeek(week)) {
      return fail('INVALID_PARAM', '주차 형식이 올바르지 않아요');
    }
    const ranking = await store.getWeeklyRanking({
      ...(week ? { week } : {}),
      userId: user.userId,
    });
    socket.emit('ranking.weekly', ranking ?? { week: null, top: [], me: null });
  });

  socket.on('me.refresh', async () => {
    const [stats, ranking] = await Promise.all([
      store.getUserStats(user.userId),
      store.getWeeklyRanking({ userId: user.userId }),
    ]);
    socket.emit('session.ready', { ...user, stats, weeklyRank: ranking?.me ?? null });
  });

  // ── 마이페이지 ────────────────────────────────────────────────────────────

  // 홈에 띄우는 요약과 달리 마이페이지는 있는 기록을 한 번에 다 내려보낸다 —
  // 화면 하나를 그리려고 네 번 왕복하는 것보다 낫다.
  socket.on('me.profile', async () => {
    const [stats, ranking, recentGames, rankHistory, practiceRecords, progress] = await Promise.all([
      store.getUserStats(user.userId),
      store.getWeeklyRanking({ userId: user.userId }),
      store.getRecentGames(user.userId),
      store.getRankHistory(user.userId),
      store.getPracticeRecords(user.userId),
      store.getUnlockProgress(user.userId),
    ]);
    socket.emit('me.profile', {
      ...user,
      stats,
      weeklyRank: ranking?.me ?? null,
      recentGames,
      rankHistory,
      practiceRecords,
      progress,
    });
  });

  socket.on('me.update', async ({ nickname, appearance } = {}) => {
    // 방 안에서 이름·캐릭터가 바뀌면 다른 사람 화면과 어긋난다. 마이페이지는
    // 홈에서만 열리니 여기서 막아도 잃는 게 없다.
    if (rooms.roomOf(userId)) return fail('ALREADY_IN_ROOM', '게임 중에는 바꿀 수 없어요');

    const name = String(nickname ?? '').trim().slice(0, 12);
    if (name.length < 1) return fail('INVALID_PARAM', '닉네임을 입력해 주세요');

    // 잠긴 파츠를 입고 오는 요청을 막는 유일한 지점이다 — 화면의 자물쇠는 안내일 뿐이다
    const progress = await store.getUnlockProgress(user.userId);
    const checked = validateAppearance(appearance, progress);
    if (!checked.ok) {
      return fail(
        'INVALID_PARAM',
        checked.reason === 'LOCKED' ? '아직 잠긴 파츠예요' : '없는 파츠예요',
      );
    }

    const updated = await store.updateProfile({
      userId: user.userId,
      nickname: name,
      appearance: checked.appearance,
    });
    if (!updated) return fail('UPDATE_FAILED', '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요');

    // socket.data.user를 그대로 고친다 — 이후 방 입장·게임에 새 캐릭터가 따라간다
    user.nickname = updated.nickname;
    user.appearance = updated.appearance;

    const [stats, ranking] = await Promise.all([
      store.getUserStats(user.userId),
      store.getWeeklyRanking({ userId: user.userId }),
    ]);
    socket.emit('session.ready', { ...user, stats, weeklyRank: ranking?.me ?? null });
  });

  // ── 연결 유지 · 종료 ───────────────────────────────────────────────────────

  socket.on('presence.ping', () => {
    const room = rooms.roomOf(userId);
    touchPresence(redis, userId, room?.id ?? '').catch(() => {});
  });

  socket.on('disconnect', async () => {
    // 연결이 끊기면 진행 중인 도전은 기록 없이 버린다 — 끊김을 기록 수단으로
    // 쓸 수 있으면 안 되고, 반대로 끊겼다고 벌을 줄 이유도 없다
    practice?.dispose();
    practice = null;

    await matchmaker.cancel(userId).catch(() => {});
    await clearPresence(redis, userId).catch(() => {});

    const room = rooms.roomOf(userId);
    if (!room) return;

    if (room.game) {
      // 진행 중이면 자리를 비워두고 유예 시간 안에 돌아오길 기다린다 (FR-R6).
      const member = room.members.get(userId);
      if (member) member.connected = false;
      await room.game.disconnect(userId);
      rooms.persist(room);

      setTimeout(() => {
        const current = rooms.roomOf(userId);
        if (current && !current.members.get(userId)?.connected) {
          broadcastRoom(rooms.leaveRoom(userId));
        }
      }, RULES.REJOIN_GRACE_MS).unref?.();
      return;
    }

    broadcastRoom(rooms.leaveRoom(userId));
  });
});


// ── 기동 · 종료 ──────────────────────────────────────────────────────────────

httpServer.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(`[server] CORS 허용: ${config.corsOrigins.join(', ')}`);
});

async function shutdown(signal) {
  console.log(`[server] ${signal} 수신 — 정리 중`);
  matchmaker.stop();
  io.close();
  httpServer.close();
  await closeRedis().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
