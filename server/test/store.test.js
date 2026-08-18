/**
 * 영속화 테스트 — 실제 PostgreSQL에 붙어 돈다.
 * 테스트가 남긴 행은 끝에서 지운다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_APPEARANCE } from '../../shared/avatar.js';
import { PostgresStore } from '../src/db/store.js';
import { pool, query } from '../src/db/pool.js';

let available = false;
let store;

/** 시드된 실제 단어를 쓴다 — words.id가 있어야 라운드가 기록된다 */
const WORD = '감자';
let wordId;

/** 테스트가 만든 유저 — 끝나고 지운다 (게임·라운드·제출은 CASCADE로 함께 사라진다) */
const createdUsers = [];

test.before(async () => {
  try {
    const { rows } = await query(`SELECT id FROM words WHERE text = $1`, [WORD]);
    if (rows.length === 0) {
      console.warn('[test] 시드 단어가 없어 store 테스트를 건너뜁니다 — npm run db:seed');
      return;
    }
    wordId = Number(rows[0].id);
    available = true;
    store = new PostgresStore({
      db: { query },
      dictionary: { idOf: (text) => (text === WORD ? wordId : undefined) },
    });
  } catch (err) {
    console.warn(`[test] PostgreSQL에 붙지 못해 store 테스트를 건너뜁니다 — ${err.message}`);
  }
});

test.after(async () => {
  if (createdUsers.length) {
    await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUsers]);
  }
  await pool.end();
});

let seq = 0;
async function makeUser(nickname) {
  const user = await store.upsertUser({
    tossUserId: `test-${process.pid}-${++seq}`,
    nickname,
  });
  createdUsers.push(user.id);
  return user;
}

test('유저를 만들고, 다시 부르면 같은 유저를 준다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const tossId = `test-${process.pid}-upsert`;
  const first = await store.upsertUser({ tossUserId: tossId, nickname: '새벽감자' });
  createdUsers.push(first.id);

  assert.ok(first.id > 0);
  assert.equal(first.nickname, '새벽감자');

  // 닉네임을 바꿔 다시 들어와도 계정은 하나여야 한다
  const second = await store.upsertUser({ tossUserId: tossId, nickname: '낮의감자' });
  assert.equal(second.id, first.id, '같은 계정인데 유저가 새로 생겼다');
  assert.equal(second.nickname, '낮의감자', '닉네임 변경이 반영되지 않았다');
});

test('판을 열면 참가자 행이 함께 생긴다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const a = await makeUser('가');
  const b = await makeUser('나');
  const gameId = `g-${process.pid}-${++seq}`;

  const dbGameId = await store.createGame({
    gameId,
    category: 'CHO',
    totalRounds: 10,
    players: [{ userId: a.id }, { userId: b.id }],
  });

  assert.ok(dbGameId > 0);
  const { rows } = await query(`SELECT user_id, round_wins FROM game_players WHERE game_id = $1`, [dbGameId]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.round_wins === 0));
});

test('라운드 승리를 기록한다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const a = await makeUser('승자');
  const gameId = `g-${process.pid}-${++seq}`;
  const dbGameId = await store.createGame({
    gameId, category: 'CHO', totalRounds: 10, players: [{ userId: a.id }],
  });

  const hint = [{ type: 'CHO', value: 'ㄱ' }, { type: 'CHO', value: 'ㅈ' }];
  await store.startRound({ gameId, roundNo: 1, attemptNo: 1, word: WORD, hintType: 'CHO', hint });
  await store.endRound({
    gameId, roundNo: 1, attemptNo: 1,
    endReason: 'WON', winnerId: a.id, wonWord: WORD, wonElapsedMs: 3200, passCount: 0,
  });

  const { rows } = await query(
    `SELECT round_no, attempt_no, end_reason, winner_id, won_word, won_elapsed_ms, hint
       FROM rounds WHERE game_id = $1`,
    [dbGameId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].end_reason, 'WON');
  assert.equal(Number(rows[0].winner_id), a.id);
  assert.equal(rows[0].won_word, WORD);
  assert.equal(rows[0].won_elapsed_ms, 3200);
  assert.deepEqual(rows[0].hint, hint, '힌트가 jsonb로 그대로 보존돼야 한다');
});

test('유찰은 같은 라운드 번호에 attempt만 올려 쌓인다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const a = await makeUser('유찰');
  const gameId = `g-${process.pid}-${++seq}`;
  const dbGameId = await store.createGame({
    gameId, category: 'CHO', totalRounds: 10, players: [{ userId: a.id }],
  });

  const hint = [{ type: 'CHO', value: 'ㄱ' }];

  // 1차: 시간 초과
  await store.startRound({ gameId, roundNo: 3, attemptNo: 1, word: WORD, hintType: 'CHO', hint });
  await store.endRound({ gameId, roundNo: 3, attemptNo: 1, endReason: 'TIMEOUT', passCount: 0 });

  // 2차: 전원 패스
  await store.startRound({ gameId, roundNo: 3, attemptNo: 2, word: WORD, hintType: 'CHO', hint });
  await store.endRound({ gameId, roundNo: 3, attemptNo: 2, endReason: 'ALL_PASSED', passCount: 2 });

  const { rows } = await query(
    `SELECT attempt_no, end_reason, winner_id, pass_count FROM rounds
      WHERE game_id = $1 AND round_no = 3 ORDER BY attempt_no`,
    [dbGameId],
  );
  assert.equal(rows.length, 2, '유찰마다 행이 하나씩 쌓여야 한다');
  assert.deepEqual(rows.map((r) => r.end_reason), ['TIMEOUT', 'ALL_PASSED']);
  assert.ok(rows.every((r) => r.winner_id === null), '유찰에는 승자가 없어야 한다');
  assert.equal(rows[1].pass_count, 2);
});

test('거절된 제출도 전부 남는다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const a = await makeUser('제출');
  const gameId = `g-${process.pid}-${++seq}`;
  const dbGameId = await store.createGame({
    gameId, category: 'CHO', totalRounds: 10, players: [{ userId: a.id }],
  });
  await store.startRound({
    gameId, roundNo: 1, attemptNo: 1, word: WORD, hintType: 'CHO',
    hint: [{ type: 'CHO', value: 'ㄱ' }],
  });

  const entries = [
    ['하늘', 'REJECTED_PATTERN_MISMATCH', 900],
    ['가지', 'REJECTED_NOT_IN_DICT', 1500],
    [WORD, 'WON', 2100],
    [WORD, 'LATE', 2200],
  ];
  for (const [word, result, elapsedMs] of entries) {
    await store.recordSubmission({
      gameId, roundNo: 1, attemptNo: 1, userId: a.id, word, result, elapsedMs,
    });
  }

  const { rows } = await query(
    `SELECT s.word, s.result FROM submissions s
       JOIN rounds r ON r.id = s.round_id
      WHERE r.game_id = $1 ORDER BY s.id`,
    [dbGameId],
  );
  assert.equal(rows.length, 4, '거절 로그가 빠졌다 — 사전 보강의 근거가 사라진다');
  assert.deepEqual(rows.map((r) => r.result), entries.map((e) => e[1]));
});

test('게임을 닫으면 인별 결과가 확정된다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const a = await makeUser('일등');
  const b = await makeUser('꼴찌');
  const gameId = `g-${process.pid}-${++seq}`;
  const dbGameId = await store.createGame({
    gameId, category: 'ALL', totalRounds: 10, players: [{ userId: a.id }, { userId: b.id }],
  });

  await store.endGame({
    gameId,
    ranks: [
      { userId: a.id, roundWins: 6, avgAnswerMs: 4200, rank: 1, leftEarly: false },
      { userId: b.id, roundWins: 4, avgAnswerMs: 5800, rank: 2, leftEarly: true },
    ],
  });

  const { rows } = await query(
    `SELECT user_id, round_wins, avg_answer_ms, final_rank, left_early
       FROM game_players WHERE game_id = $1 ORDER BY final_rank`,
    [dbGameId],
  );
  assert.equal(rows[0].round_wins, 6);
  assert.equal(rows[0].avg_answer_ms, 4200);
  assert.equal(rows[0].left_early, false);
  assert.equal(rows[1].final_rank, 2);
  assert.equal(rows[1].left_early, true);

  const { rows: gameRows } = await query(`SELECT ended_at FROM games WHERE id = $1`, [dbGameId]);
  assert.ok(gameRows[0].ended_at, 'ended_at이 채워지지 않았다');
});

test('전적은 끝난 판만 센다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const a = await makeUser('전적');

  const finished = `g-${process.pid}-${++seq}`;
  await store.createGame({ gameId: finished, category: 'ALL', totalRounds: 10, players: [{ userId: a.id }] });
  await store.endGame({
    gameId: finished,
    ranks: [{ userId: a.id, roundWins: 7, avgAnswerMs: 3000, rank: 1, leftEarly: false }],
  });

  // 아직 진행 중인 판은 집계에 들어가면 안 된다
  const running = `g-${process.pid}-${++seq}`;
  await store.createGame({ gameId: running, category: 'ALL', totalRounds: 10, players: [{ userId: a.id }] });

  const stats = await store.getUserStats(a.id);
  assert.equal(stats.games, 1, '진행 중인 판이 전적에 섞였다');
  assert.equal(stats.wins, 1);
  assert.equal(stats.roundWins, 7);
  assert.equal(stats.winRate, 1);
});

test('기록에 실패해도 예외를 던지지 않는다', async (t) => {
  if (!available) return t.skip('DB 없음');

  // 없는 게임에 라운드를 기록하려 해도 게임 루프가 깨지면 안 된다
  const result = await store.startRound({
    gameId: 'nonexistent', roundNo: 1, attemptNo: 1, word: WORD, hintType: 'CHO', hint: [],
  });
  assert.equal(result, null);

  // 사전에 없는 단어도 마찬가지
  const gameId = `g-${process.pid}-${++seq}`;
  const a = await makeUser('실패');
  await store.createGame({ gameId, category: 'CHO', totalRounds: 10, players: [{ userId: a.id }] });
  assert.equal(
    await store.startRound({
      gameId, roundNo: 1, attemptNo: 1, word: '없는단어', hintType: 'CHO', hint: [],
    }),
    null,
  );
});

test('프로필을 바꾸면 이름과 캐릭터가 함께 남는다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const me = await makeUser('바꾸기전');
  const look = { base: 'CAT', hanbok: 'SAGE', head: 'FLOWER', face: 'WINK', bg: 'MINT' };
  const updated = await store.updateProfile({ userId: me.id, nickname: '바꾼뒤', appearance: look });

  assert.equal(updated.nickname, '바꾼뒤');
  assert.deepEqual(updated.appearance, look);

  const { rows } = await query(`SELECT nickname, appearance FROM users WHERE id = $1`, [me.id]);
  assert.equal(rows[0].nickname, '바꾼뒤');
  assert.deepEqual(rows[0].appearance, look);
});

test('새 계정은 기본 캐릭터를 입고 나온다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const me = await makeUser('새내기');
  assert.deepEqual(me.appearance, DEFAULT_APPEARANCE);
});

test('다시 접속해도 저장한 캐릭터가 따라온다', async (t) => {
  if (!available) return t.skip('DB 없음');

  // 접속 때 클라이언트가 캐릭터를 보내지 않으므로, upsert가 덮어쓰면 안 된다
  const tossId = `test-${process.pid}-relogin`;
  const first = await store.upsertUser({ tossUserId: tossId, nickname: '재접속' });
  createdUsers.push(first.id);

  const look = { base: 'BEAR', hanbok: 'PLUM', head: 'BEADS', face: 'PROUD', bg: 'PEACH' };
  await store.updateProfile({ userId: first.id, nickname: '재접속', appearance: look });

  const again = await store.upsertUser({ tossUserId: tossId, nickname: '재접속' });
  assert.deepEqual(again.appearance, look, '재접속이 캐릭터를 기본값으로 되돌렸다');
});

test('해금 진행도는 라운드 승·판 수·연습 최고 연속을 함께 센다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const me = await makeUser('진행도');

  // 아무것도 안 한 계정은 전부 0이다 (해금 파츠가 열리면 안 된다)
  assert.deepEqual(await store.getUnlockProgress(me.id), {
    roundWins: 0, games: 0, practiceStreak: 0,
  });

  for (const wins of [4, 9]) {
    const gameId = `g-${process.pid}-${++seq}`;
    await store.createGame({ gameId, category: 'ALL', totalRounds: 10, players: [{ userId: me.id }] });
    await store.endGame({
      gameId,
      ranks: [{ userId: me.id, roundWins: wins, avgAnswerMs: 3000, rank: 1, leftEarly: false }],
    });
  }
  await store.savePracticeRecord({ userId: me.id, tier: 'T8S', category: 'CHO', streak: 6 });
  await store.savePracticeRecord({ userId: me.id, tier: 'FREE', category: 'ALL', streak: 11 });

  assert.deepEqual(await store.getUnlockProgress(me.id), {
    roundWins: 13, games: 2, practiceStreak: 11,
  });
});

test('최근 전적은 끝난 판만 최신 순으로 준다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const me = await makeUser('최근');
  const mate = await makeUser('동료');

  const first = `g-${process.pid}-${++seq}`;
  await store.createGame({
    gameId: first, category: 'CHO', totalRounds: 10, players: [{ userId: me.id }, { userId: mate.id }],
  });
  await store.endGame({
    gameId: first,
    ranks: [
      { userId: me.id, roundWins: 3, avgAnswerMs: 5000, rank: 2, leftEarly: false },
      { userId: mate.id, roundWins: 7, avgAnswerMs: 4000, rank: 1, leftEarly: false },
    ],
  });

  const second = `g-${process.pid}-${++seq}`;
  await store.createGame({
    gameId: second, mode: 'SOLO', category: 'ALL', totalRounds: 5, players: [{ userId: me.id }],
  });
  await store.endGame({
    gameId: second,
    ranks: [{ userId: me.id, roundWins: 5, avgAnswerMs: 3000, rank: 1, leftEarly: false }],
  });

  // 아직 안 끝난 판은 목록에 끼면 안 된다
  const running = `g-${process.pid}-${++seq}`;
  await store.createGame({ gameId: running, category: 'ALL', totalRounds: 10, players: [{ userId: me.id }] });

  const games = await store.getRecentGames(me.id);
  assert.equal(games.length, 2, '진행 중인 판이 최근 전적에 섞였다');

  assert.equal(games[0].mode, 'SOLO', '최신 판이 앞에 오지 않았다');
  assert.equal(games[0].players, 1);
  assert.equal(games[0].finalRank, 1);
  assert.equal(games[0].roundWins, 5);

  assert.equal(games[1].mode, 'QUICK');
  assert.equal(games[1].players, 2, '같이 한 사람 수를 세지 못했다');
  assert.equal(games[1].finalRank, 2);
  assert.ok(games[1].endedAt, '끝난 시각이 비어 있다');
});

test('최근 전적은 요청한 개수까지만 준다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const me = await makeUser('많이한');
  for (let i = 0; i < 3; i += 1) {
    const gameId = `g-${process.pid}-${++seq}`;
    await store.createGame({ gameId, category: 'ALL', totalRounds: 10, players: [{ userId: me.id }] });
    await store.endGame({
      gameId,
      ranks: [{ userId: me.id, roundWins: i, avgAnswerMs: 3000, rank: 1, leftEarly: false }],
    });
  }

  assert.equal((await store.getRecentGames(me.id, 2)).length, 2);
});

test('주차별 랭킹 이력은 최신 주부터 준다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const me = await makeUser('이력');
  await query(
    `INSERT INTO weekly_rankings (week, user_id, round_wins, avg_answer_ms, games_counted, rank)
     VALUES ($1, $3, 30, 4000, 5, 2), ($2, $3, 12, 5200, 3, 9)`,
    ['2026-W20', '2026-W19', me.id],
  );

  const history = await store.getRankHistory(me.id);
  assert.deepEqual(history.map((h) => h.week), ['2026-W20', '2026-W19']);
  assert.equal(history[0].rank, 2);
  assert.equal(history[0].roundWins, 30);
  assert.equal(history[1].gamesCounted, 3);
});
