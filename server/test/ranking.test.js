/**
 * 주간 랭킹 집계 테스트 — 실제 PostgreSQL에 붙어 돈다.
 *
 * 규칙이 하나라도 어긋나면 랭킹이 통째로 불공정해지므로, 집계 조건을
 * 하나씩 따로 확인한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresStore, RANKING } from '../src/db/store.js';
import { pool, query } from '../src/db/pool.js';
import { weekOf } from '../src/ranking/week.js';

let available = false;
let store;
let wordId;

const createdUsers = [];
/** 이번 테스트만의 주차 — 실제 플레이 데이터와 섞이지 않게 미래 주를 쓴다 */
const RANGE = weekOf(new Date('2030-03-06T12:00:00+09:00'));

test.before(async () => {
  try {
    const { rows } = await query(`SELECT id FROM words WHERE text = '감자'`);
    if (rows.length === 0) {
      console.warn('[test] 시드 단어가 없어 랭킹 테스트를 건너뜁니다 — npm run db:seed');
      return;
    }
    wordId = Number(rows[0].id);
    available = true;
    store = new PostgresStore({ db: { query }, dictionary: { idOf: () => wordId } });
  } catch (err) {
    console.warn(`[test] PostgreSQL에 붙지 못해 랭킹 테스트를 건너뜁니다 — ${err.message}`);
  }
});

test.after(async () => {
  if (available) {
    await query(`DELETE FROM weekly_rankings WHERE week = $1`, [RANGE.week]);
    if (createdUsers.length) {
      await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUsers]);
    }
  }
  await pool.end();
});

let seq = 0;

async function makeUser(nickname) {
  const user = await store.upsertUser({
    tossUserId: `rank-${process.pid}-${++seq}`,
    nickname,
  });
  createdUsers.push(user.id);
  return user;
}

/**
 * 끝난 판을 하나 만든다. 집계 대상 주(RANGE) 안에서 끝난 것으로 만든다.
 * @returns {Promise<number>} games.id
 */
async function playGame({ users, mode = 'QUICK', endedAt = new Date(RANGE.start.getTime() + 3600_000) }) {
  const { rows } = await query(
    `INSERT INTO games (category, total_rounds, mode, started_at, ended_at)
     VALUES ('ALL', 10, $1, $2, $2) RETURNING id`,
    [mode, endedAt],
  );
  const gameId = Number(rows[0].id);

  for (const { user, roundWins, avgAnswerMs = 5000, rank = 1 } of users) {
    await query(
      `INSERT INTO game_players (game_id, user_id, round_wins, avg_answer_ms, final_rank)
       VALUES ($1, $2, $3, $4, $5)`,
      [gameId, user.id, roundWins, avgAnswerMs, rank],
    );
  }
  return gameId;
}

const refresh = () => store.refreshWeeklyRanking(RANGE);
const read = (userId) => store.getWeeklyRanking({ week: RANGE.week, userId });

test('3판 미만은 등재되지 않는다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const rookie = await makeUser('두판만');
  await playGame({ users: [{ user: rookie, roundWins: 9 }] });
  await playGame({ users: [{ user: rookie, roundWins: 9 }] });

  await refresh();
  let board = await read(rookie.id);
  assert.equal(board.me, null, '2판인데 등재됐다');
  assert.equal(board.top.find((r) => r.userId === rookie.id), undefined);

  // 한 판 더 하면 들어온다
  await playGame({ users: [{ user: rookie, roundWins: 9 }] });
  await refresh();
  board = await read(rookie.id);
  assert.ok(board.me, '3판을 채웠는데 등재되지 않았다');
  assert.equal(board.me.roundWins, 27);
  assert.equal(board.me.gamesCounted, 3);
});

test('친구 방과 혼자하기는 집계에서 빠진다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const cheater = await makeUser('친구방장인');
  // 친구 방 10판을 몰아쳐도 랭킹에는 잡히지 않아야 한다
  for (let i = 0; i < 10; i += 1) {
    await playGame({ users: [{ user: cheater, roundWins: 10 }], mode: 'FRIEND' });
  }
  await playGame({ users: [{ user: cheater, roundWins: 10 }], mode: 'SOLO' });

  await refresh();
  const board = await read(cheater.id);
  assert.equal(board.me, null, '친구 방·혼자하기 승수가 랭킹에 들어갔다 — 담합이 뚫린다');
});

test('주간 상위 20판까지만 센다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const grinder = await makeUser('갈아넣기');
  // 25판: 승수 1인 판 20개 + 승수 10인 판 5개
  for (let i = 0; i < 20; i += 1) {
    await playGame({ users: [{ user: grinder, roundWins: 1 }] });
  }
  for (let i = 0; i < 5; i += 1) {
    await playGame({ users: [{ user: grinder, roundWins: 10 }] });
  }

  await refresh();
  const board = await read(grinder.id);

  assert.equal(board.me.gamesCounted, RANKING.GAME_CAP, '20판 상한이 걸리지 않았다');
  // 승수가 높은 판부터 담으므로 10승 5판 + 1승 15판 = 65
  assert.equal(board.me.roundWins, 65, '상한이 걸릴 때 승수가 높은 판부터 담아야 한다');
});

test('다른 주의 판은 섞이지 않는다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const user = await makeUser('지난주');
  for (let i = 0; i < 3; i += 1) {
    await playGame({ users: [{ user, roundWins: 5 }] });
  }
  // 집계 주가 끝난 직후의 판 — 다음 주에 속한다
  await playGame({ users: [{ user, roundWins: 99 }], endedAt: RANGE.end });
  // 집계 주 시작 직전의 판 — 지난주에 속한다
  await playGame({
    users: [{ user, roundWins: 99 }],
    endedAt: new Date(RANGE.start.getTime() - 1000),
  });

  await refresh();
  const board = await read(user.id);
  assert.equal(board.me.roundWins, 15, '이번 주 밖의 판이 집계에 섞였다');
  assert.equal(board.me.gamesCounted, 3);
});

test('진행 중인 판은 세지 않는다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const user = await makeUser('진행중');
  for (let i = 0; i < 3; i += 1) {
    await playGame({ users: [{ user, roundWins: 4 }] });
  }
  const { rows } = await query(
    `INSERT INTO games (category, total_rounds, mode, started_at) VALUES ('ALL', 10, 'QUICK', $1) RETURNING id`,
    [RANGE.start],
  );
  await query(
    `INSERT INTO game_players (game_id, user_id, round_wins) VALUES ($1, $2, 99)`,
    [Number(rows[0].id), user.id],
  );

  await refresh();
  const board = await read(user.id);
  assert.equal(board.me.roundWins, 12, '아직 안 끝난 판이 집계됐다');
});

test('동점이면 평균 정답 속도가 빠른 쪽이 위다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const fast = await makeUser('빠른손');
  const slow = await makeUser('느린손');
  for (let i = 0; i < 3; i += 1) {
    await playGame({
      users: [
        { user: fast, roundWins: 5, avgAnswerMs: 3000 },
        { user: slow, roundWins: 5, avgAnswerMs: 8000 },
      ],
    });
  }

  await refresh();
  const fastRow = (await read(fast.id)).me;
  const slowRow = (await read(slow.id)).me;

  assert.equal(fastRow.roundWins, slowRow.roundWins, '동점 상황을 만들지 못했다');
  assert.ok(fastRow.rank < slowRow.rank, '평균 속도가 빠른 쪽이 위여야 한다');
});

test('순위에서 빠진 사람은 다시 집계할 때 사라진다', async (t) => {
  if (!available) return t.skip('DB 없음');

  const user = await makeUser('사라질사람');
  const games = [];
  for (let i = 0; i < 3; i += 1) {
    games.push(await playGame({ users: [{ user, roundWins: 5 }] }));
  }
  await refresh();
  assert.ok((await read(user.id)).me, '등재 상태를 만들지 못했다');

  // 판이 지워져 등재 조건에 못 미치게 되면 랭킹에서도 빠져야 한다
  await query(`DELETE FROM games WHERE id = ANY($1::bigint[])`, [games.slice(0, 2)]);
  await refresh();

  assert.equal((await read(user.id)).me, null, '조건을 잃었는데 순위에 남아 있다');
});

test('상위 목록은 순위 순으로 내려온다', async (t) => {
  if (!available) return t.skip('DB 없음');

  await refresh();
  const board = await read();

  assert.ok(board.top.length > 0);
  const ranks = board.top.map((r) => r.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), '순위가 정렬되지 않았다');

  const wins = board.top.map((r) => r.roundWins);
  assert.deepEqual(wins, [...wins].sort((a, b) => b - a), '승수 내림차순이 아니다');
  assert.ok(board.top.length <= RANKING.TOP_N);
});
