/**
 * 라운드 루프 테스트. 선착 락은 실제 Redis를 쓰고, 시간만 가상 시계로 돌린다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RULES } from '../src/config.js';
import { GAME_STATUS, Game } from '../src/game/round.js';
import { createRedis } from '../src/redis/client.js';
import { Dictionary } from '../src/words/dictionary.js';

let redis;
let available = false;

test.before(async () => {
  redis = createRedis('test');
  try {
    await redis.ping();
    available = true;
  } catch {
    console.warn('[test] Redis에 붙지 못해 라운드 루프 테스트를 건너뜁니다');
  }
});

test.after(async () => {
  if (redis) await redis.quit();
});

/** 실제 이벤트 루프를 한 바퀴 돌려 대기 중인 async 작업을 끝낸다 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** 가상 시계 — 주입한 now/timers가 이 시계를 본다 */
function createClock(start = 1_700_000_000_000) {
  let now = start;
  let seq = 0;
  const tasks = new Map();

  return {
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++seq;
        tasks.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimeout: (id) => tasks.delete(id),
    },
    /** ms만큼 시간을 흘려보내며 만기된 타이머를 순서대로 실행한다 */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...tasks.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, task] = due[0];
        tasks.delete(id);
        now = Math.max(now, task.at);
        task.fn();
        await settle();
      }
      now = target;
    },
  };
}

/** 방송된 이벤트를 모으는 가짜 emit */
function createEmit() {
  const room = [];
  const direct = [];
  return {
    room,
    direct,
    toRoom: (event, payload) => room.push({ event, payload }),
    toUser: (userId, event, payload) => direct.push({ userId, event, payload }),
    last: (event) => [...room].reverse().find((e) => e.event === event)?.payload,
    count: (event) => room.filter((e) => e.event === event).length,
    lastDirect: (userId) => [...direct].reverse().find((e) => e.userId === String(userId)),
  };
}

/** 자음 카테고리 고정 — 힌트 타입 난수를 없애 결과를 예측 가능하게 만든다 */
function createDictionary() {
  const words = ['감자', '간장', '과자', '기적', '사과', '학교', '친구', '바다', '하늘', '구름'];
  return new Dictionary(words.map((text) => ({ text, is_curated: true })));
}

let gameSeq = 0;
function createGame({ totalRounds = 3, players = 2, clock = createClock(), emit = createEmit() } = {}) {
  const roster = Array.from({ length: players }, (_, i) => ({
    userId: i + 1,
    nickname: `player${i + 1}`,
  }));

  const game = new Game({
    gameId: `rt-${process.pid}-${++gameSeq}`,
    players: roster,
    category: 'CHO',
    totalRounds,
    dictionary: createDictionary(),
    redis,
    emit,
    now: clock.now,
    timers: clock.timers,
  });

  return { game, clock, emit };
}

async function cleanup(game) {
  const found = await redis.keys(`game:${game.gameId}:*`);
  if (found.length) await redis.del(...found);
}

test('게임을 시작하면 카운트다운과 첫 문제가 나간다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame();

  await game.start();

  assert.equal(emit.count('game.countdown'), 1);
  const start = emit.last('round.start');
  assert.equal(start.roundNo, 1);
  assert.equal(start.totalRounds, 3);
  assert.ok(Array.isArray(start.hint) && start.hint.length >= 2);
  assert.ok(start.deadlineTs > 0);
  assert.equal(game.status, GAME_STATUS.PLAYING);

  // 정답 단어는 절대 클라이언트로 나가면 안 된다
  assert.ok(!('word' in start), 'round.start에 정답이 실려 나갔다');

  game.stop();
  await cleanup(game);
});

test('첫 정답자가 라운드를 가져가고 1점을 얻는다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame();
  await game.start();

  const answer = game.round.word;
  const result = await game.submit({ userId: 1, word: answer });

  assert.deepEqual(result, { ok: true });
  const won = emit.last('round.won');
  assert.equal(won.winner.userId, 1);
  assert.equal(won.word, answer);
  assert.equal(won.scores['1'], 1);
  assert.equal(won.scores['2'], 0);

  game.stop();
  await cleanup(game);
});

test('같은 라운드의 두 번째 정답은 ROUND_CLOSED로 거절된다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame();
  await game.start();

  const answer = game.round.word;
  await game.submit({ userId: 1, word: answer });
  const late = await game.submit({ userId: 2, word: answer });

  assert.deepEqual(late, { ok: false, reason: 'ROUND_CLOSED' });
  assert.equal(emit.count('round.won'), 1, '승자가 두 번 나왔다');
  assert.equal(emit.lastDirect(2).payload.reason, 'ROUND_CLOSED');

  game.stop();
  await cleanup(game);
});

test('오답은 본인에게만 거절 통보되고 라운드는 계속된다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame();
  await game.start();

  const result = await game.submit({ userId: 2, word: '없는단어' });

  assert.equal(result.ok, false);
  assert.equal(emit.count('round.won'), 0);
  assert.equal(emit.lastDirect(2).event, 'submit.rejected');
  assert.equal(game.round.closed, false, '오답으로 라운드가 닫혔다');

  // 그 뒤에 정답을 내면 정상적으로 이긴다 — 오답에 잠금·감점이 없어야 한다 (FR-J4)
  await game.submit({ userId: 2, word: game.round.word });
  assert.equal(emit.last('round.won').winner.userId, 2);

  game.stop();
  await cleanup(game);
});

test('제한시간이 지나면 라운드 번호를 유지한 채 문제만 바뀐다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, clock, emit } = createGame();
  await game.start();

  const firstWord = game.round.word;
  await clock.advance(RULES.ROUND_TIME_MS + RULES.REPLACE_INTERVAL_MS);

  const replaced = emit.last('round.replaced');
  assert.ok(replaced, 'round.replaced가 나오지 않았다');
  assert.equal(replaced.roundNo, 1, '라운드 번호가 올라갔다');
  assert.equal(replaced.reason, 'TIMEOUT');
  assert.notEqual(game.round.word, firstWord, '같은 문제가 다시 나왔다');
  assert.equal(game.attemptNo, 2);
  assert.equal(emit.count('round.won'), 0);

  game.stop();
  await cleanup(game);
});

test('일부만 패스하면 문제는 바뀌지 않고 인원수만 알린다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame({ players: 3 });
  await game.start();
  const word = game.round.word;

  await game.pass({ userId: 1 });

  const state = emit.last('round.passState');
  assert.deepEqual(state, { roundNo: 1, passed: 1, total: 3 });
  assert.equal(emit.count('round.replaced'), 0);
  assert.equal(game.round.word, word);

  // 누가 눌렀는지는 나가지 않는다
  assert.ok(!('userId' in state) && !('players' in state));

  game.stop();
  await cleanup(game);
});

test('접속자 전원이 패스하면 라운드 유지한 채 문제가 교체된다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, clock, emit } = createGame({ players: 3 });
  await game.start();
  const firstWord = game.round.word;

  await game.pass({ userId: 1 });
  await game.pass({ userId: 2 });
  await game.pass({ userId: 3 });
  await clock.advance(RULES.REPLACE_INTERVAL_MS);

  const replaced = emit.last('round.replaced');
  assert.equal(replaced.reason, 'ALL_PASSED');
  assert.equal(replaced.roundNo, 1, '라운드 번호가 올라갔다');
  assert.notEqual(game.round.word, firstWord);

  game.stop();
  await cleanup(game);
});

test('패스를 취소하면 전원 패스가 성립하지 않는다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame({ players: 2 });
  await game.start();

  await game.pass({ userId: 1 });
  await game.pass({ userId: 1, passed: false });
  await game.pass({ userId: 2 });

  assert.equal(emit.last('round.passState').passed, 1);
  assert.equal(emit.count('round.replaced'), 0);

  game.stop();
  await cleanup(game);
});

test('패스한 사람도 정답을 낼 수 있다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame({ players: 3 });
  await game.start();

  await game.pass({ userId: 1 });
  const result = await game.submit({ userId: 1, word: game.round.word });

  assert.deepEqual(result, { ok: true });
  assert.equal(emit.last('round.won').winner.userId, 1);

  game.stop();
  await cleanup(game);
});

test('이탈로 인원이 줄면 남은 인원 기준으로 전원 패스가 성립한다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, clock, emit } = createGame({ players: 3 });
  await game.start();

  await game.pass({ userId: 1 });
  await game.pass({ userId: 2 });
  assert.equal(emit.count('round.replaced'), 0, '3명 중 2명이라 아직 아니다');

  await game.disconnect(3); // 분모가 2로 줄어 이미 전원 패스다
  await clock.advance(RULES.REPLACE_INTERVAL_MS);

  assert.equal(emit.last('round.replaced').reason, 'ALL_PASSED');

  game.stop();
  await cleanup(game);
});

test('모든 라운드를 마치면 승수 순으로 순위가 매겨진다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, clock, emit } = createGame({ totalRounds: 2, players: 2 });
  await game.start();

  await game.submit({ userId: 1, word: game.round.word });
  await clock.advance(RULES.ROUND_INTERVAL_MS);

  assert.equal(emit.last('round.start').roundNo, 2);
  await game.submit({ userId: 1, word: game.round.word });
  await clock.advance(RULES.ROUND_INTERVAL_MS);

  const ended = emit.last('game.ended');
  assert.ok(ended, 'game.ended가 나오지 않았다');
  assert.equal(ended.ranks[0].userId, 1);
  assert.equal(ended.ranks[0].roundWins, 2);
  assert.equal(ended.ranks[1].userId, 2);
  assert.equal(ended.ranks[1].roundWins, 0);
  assert.equal(ended.ranks[1].avgAnswerMs, null, '한 번도 못 맞히면 평균 속도가 없다');
  assert.equal(game.status, GAME_STATUS.ENDED);

  await cleanup(game);
});

test('1위가 동점이면 서든데스 한 라운드로 가린다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, clock, emit } = createGame({ totalRounds: 2, players: 2 });
  await game.start();

  await game.submit({ userId: 1, word: game.round.word });
  await clock.advance(RULES.ROUND_INTERVAL_MS);
  await game.submit({ userId: 2, word: game.round.word });
  await clock.advance(RULES.ROUND_INTERVAL_MS);

  // 1 : 1 동점 → 게임이 끝나지 않고 서든데스로 넘어간다
  assert.equal(emit.count('game.ended'), 0);
  const sudden = emit.last('game.suddenDeath');
  assert.equal(sudden.players.length, 2);
  assert.equal(game.suddenDeath, true);

  await game.submit({ userId: 2, word: game.round.word });
  await settle();

  const ended = emit.last('game.ended');
  assert.equal(ended.ranks[0].userId, 2, '서든데스 승자가 1위여야 한다');
  assert.equal(ended.ranks[1].userId, 1);
  assert.equal(ended.summary.suddenDeath, true);

  await cleanup(game);
});

test('서든데스에서 동점자가 아닌 사람의 제출은 막는다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, clock, emit } = createGame({ totalRounds: 2, players: 3 });
  await game.start();

  // 1, 2번만 1승씩 — 3번은 0승이라 서든데스 대상이 아니다
  await game.submit({ userId: 1, word: game.round.word });
  await clock.advance(RULES.ROUND_INTERVAL_MS);
  await game.submit({ userId: 2, word: game.round.word });
  await clock.advance(RULES.ROUND_INTERVAL_MS);

  assert.equal(game.suddenDeath, true);
  const blocked = await game.submit({ userId: 3, word: game.round.word });
  assert.deepEqual(blocked, { ok: false, reason: 'ROUND_CLOSED' });
  assert.equal(emit.count('round.won'), 2, '서든데스 비대상자가 라운드를 가져갔다');

  game.stop();
  await cleanup(game);
});

test('전원이 나가면 게임이 끝난다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game, emit } = createGame({ players: 2 });
  await game.start();

  await game.disconnect(1);
  await game.disconnect(2);

  assert.equal(game.status, GAME_STATUS.ENDED);
  assert.ok(emit.last('game.ended'));

  await cleanup(game);
});

test('재접속하면 정답 없는 스냅샷으로 동기화한다', async (t) => {
  if (!available) return t.skip('Redis 없음');
  const { game } = createGame({ players: 2 });
  await game.start();

  await game.disconnect(2);
  const snapshot = game.reconnect(2);

  assert.equal(snapshot.roundNo, 1);
  assert.ok(Array.isArray(snapshot.hint));
  assert.ok(snapshot.deadlineTs > 0);
  assert.ok(!('word' in snapshot), '스냅샷에 정답이 들어 있다');
  assert.equal(game.players.get('2').connected, true);

  game.stop();
  await cleanup(game);
});
