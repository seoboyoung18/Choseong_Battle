/**
 * 영속화 계층 — 게임 진행을 PostgreSQL에 남긴다.
 *
 * 라운드 루프(Game)는 이 객체의 훅을 부를 뿐 DB를 알지 못한다. 기록이 실패해도
 * 게임은 멈추지 않는다 — 전적이 한 줄 빠지는 것보다 진행 중인 판이 깨지는 쪽이
 * 훨씬 나쁘다. 그래서 모든 훅은 실패를 삼키고 로그만 남긴다.
 *
 * 남기는 것
 *   games          판 단위 기록 (전적·랭킹의 원천)
 *   game_players   인별 결과 (승수·평균 속도·순위·이탈)
 *   rounds         출제 기록. 유찰 교체는 같은 round_no에 attempt_no를 올려 새 행
 *   submissions    거절 포함 모든 제출 — 사전 보강·난이도 보정·어뷰징 분석용
 */

import { weekOf } from '../ranking/week.js';

/** 주간 랭킹 집계 규칙 (README 「랭킹」) */
export const RANKING = Object.freeze({
  /** 한 유저가 한 주에 반영할 수 있는 최대 판 수 — 갈아넣기 완화 */
  GAME_CAP: 20,
  /** 등재에 필요한 최소 판 수 */
  MIN_GAMES: 3,
  /** 리스트에 내려보낼 상위 인원 */
  TOP_N: 100,
});

/** 랭킹 행을 클라이언트가 쓰는 모양으로 바꾼다 */
function toRankRow(row) {
  return {
    rank: row.rank,
    userId: Number(row.user_id),
    nickname: row.nickname,
    appearance: row.appearance,
    roundWins: row.round_wins,
    avgAnswerMs: row.avg_answer_ms,
    gamesCounted: row.games_counted,
  };
}

/** 인메모리 게임 id → DB에서 쓸 식별자들 */
class GameRefs {
  constructor(dbGameId) {
    this.dbGameId = dbGameId;
    /** @type {Map<string, number>} `${roundNo}:${attemptNo}` → rounds.id */
    this.rounds = new Map();
  }
}

export class PostgresStore {
  /**
   * @param {object} deps
   * @param {{ query: Function }} deps.db
   * @param {{ idOf: (text: string) => number | undefined }} deps.dictionary
   */
  constructor({ db, dictionary }) {
    this.db = db;
    this.dictionary = dictionary;
    /** @type {Map<string, GameRefs>} */
    this.games = new Map();
  }

  /** 기록 실패가 게임을 멈추지 않도록 감싼다 */
  async #safe(label, fn) {
    try {
      return await fn();
    } catch (err) {
      console.error(`[store] ${label} 실패:`, err.message);
      return null;
    }
  }

  /**
   * 토스 계정(개발 중에는 임시 id)으로 유저를 찾거나 만든다.
   *
   * 닉네임은 재접속할 때마다 갱신한다 — 유저가 바꾼 이름이 반영되어야 한다.
   *
   * 캐릭터(appearance)는 일부러 받지 않는다 — 접속할 때 클라이언트가 보내는 값을
   * 그대로 믿으면 잠긴 파츠를 입고 들어올 수 있다. 캐릭터는 me.update 한 곳에서만
   * 바뀌고, 그래서 다시 접속해도 DB에 있던 캐릭터가 그대로 따라온다.
   *
   * @param {{ tossUserId: string, nickname: string }} params
   * @returns {Promise<{ id: number, nickname: string, appearance: object } | null>}
   */
  async upsertUser({ tossUserId, nickname }) {
    return this.#safe('유저 등록', async () => {
      const { rows } = await this.db.query(
        `INSERT INTO users (toss_user_id, nickname)
         VALUES ($1, $2)
         ON CONFLICT (toss_user_id) DO UPDATE
           SET nickname = EXCLUDED.nickname
         RETURNING id, nickname, appearance`,
        [tossUserId, nickname],
      );
      const row = rows[0];
      return { id: Number(row.id), nickname: row.nickname, appearance: row.appearance };
    });
  }

  /**
   * 판을 연다. 라운드를 기록하려면 games 행이 먼저 있어야 한다.
   *
   * @param {object} params
   * @param {string} params.gameId 인메모리 게임 id
   * @param {string} params.category
   * @param {number} params.totalRounds
   * @param {Array<{ userId: number }>} params.players
   * @returns {Promise<number | null>} games.id
   */
  async createGame({ gameId, category, totalRounds, players, mode = 'QUICK' }) {
    return this.#safe('게임 생성', async () => {
      // room_id는 지금 비워둔다. 방은 Redis에만 사는 휘발성 상태라
      // rooms 테이블에 올리는 건 별도 작업이다.
      const { rows } = await this.db.query(
        `INSERT INTO games (category, total_rounds, mode) VALUES ($1, $2, $3) RETURNING id`,
        [category, totalRounds, mode],
      );
      const dbGameId = Number(rows[0].id);

      await this.db.query(
        `INSERT INTO game_players (game_id, user_id)
         SELECT $1, UNNEST($2::bigint[])`,
        [dbGameId, players.map((p) => Number(p.userId))],
      );

      this.games.set(gameId, new GameRefs(dbGameId));
      return dbGameId;
    });
  }

  /** 출제를 기록한다. 유찰 교체마다 attempt_no가 오른 새 행이 생긴다. */
  async startRound({ gameId, roundNo, attemptNo, word, hintType, hint }) {
    const refs = this.games.get(gameId);
    if (!refs) return null;

    const wordId = this.dictionary.idOf(word);
    if (wordId === undefined) {
      // 사전에 없는 단어가 출제됐다는 뜻이라 그냥 넘기면 안 된다.
      console.error(`[store] words.id를 찾을 수 없음: ${word}`);
      return null;
    }

    return this.#safe('라운드 시작 기록', async () => {
      const { rows } = await this.db.query(
        `INSERT INTO rounds (game_id, round_no, attempt_no, word_id, hint_kind, hint)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [refs.dbGameId, roundNo, attemptNo, wordId, hintType, JSON.stringify(hint)],
      );
      const roundId = Number(rows[0].id);
      refs.rounds.set(`${roundNo}:${attemptNo}`, roundId);
      return roundId;
    });
  }

  /** 라운드가 끝났다 — 승리·시간초과·전원 패스 중 하나. */
  async endRound({ gameId, roundNo, attemptNo, endReason, winnerId, wonWord, wonElapsedMs, passCount }) {
    const refs = this.games.get(gameId);
    const roundId = refs?.rounds.get(`${roundNo}:${attemptNo}`);
    if (!roundId) return null;

    return this.#safe('라운드 종료 기록', () =>
      this.db.query(
        `UPDATE rounds
            SET end_reason = $2, winner_id = $3, won_word = $4,
                won_elapsed_ms = $5, pass_count = $6, ended_at = now()
          WHERE id = $1`,
        [roundId, endReason, winnerId ?? null, wonWord ?? null, wonElapsedMs ?? null, passCount ?? 0],
      ),
    );
  }

  /**
   * 제출을 남긴다. 거절된 것도 전부 남긴다 —
   * NOT_IN_DICT 로그가 사전을 넓히는 유일한 근거다.
   */
  async recordSubmission({ gameId, roundNo, attemptNo, userId, word, result, elapsedMs }) {
    const refs = this.games.get(gameId);
    const roundId = refs?.rounds.get(`${roundNo}:${attemptNo}`);
    if (!roundId) return null;

    return this.#safe('제출 기록', () =>
      this.db.query(
        `INSERT INTO submissions (round_id, user_id, word, result, elapsed_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [roundId, Number(userId), word, result, Math.max(0, Math.round(elapsedMs))],
      ),
    );
  }

  /** 판을 닫고 인별 결과를 확정한다. */
  async endGame({ gameId, ranks }) {
    const refs = this.games.get(gameId);
    if (!refs) return null;

    const result = await this.#safe('게임 종료 기록', async () => {
      await this.db.query(`UPDATE games SET ended_at = now() WHERE id = $1`, [refs.dbGameId]);

      await this.db.query(
        `UPDATE game_players AS gp
            SET round_wins = v.round_wins,
                avg_answer_ms = v.avg_answer_ms,
                final_rank = v.final_rank,
                left_early = v.left_early
           FROM (
             SELECT * FROM UNNEST(
               $2::bigint[], $3::smallint[], $4::integer[], $5::smallint[], $6::boolean[]
             ) AS t(user_id, round_wins, avg_answer_ms, final_rank, left_early)
           ) AS v
          WHERE gp.game_id = $1 AND gp.user_id = v.user_id`,
        [
          refs.dbGameId,
          ranks.map((r) => Number(r.userId)),
          ranks.map((r) => r.roundWins),
          ranks.map((r) => r.avgAnswerMs),
          ranks.map((r) => r.rank),
          ranks.map((r) => Boolean(r.leftEarly)),
        ],
      );
      return refs.dbGameId;
    });

    // 끝난 판의 라운드 id 맵은 더 들고 있을 이유가 없다 (프로세스가 오래 뜬다)
    this.games.delete(gameId);

    // 랭킹 갱신은 게임 종료를 막지 않는다 — 결과 화면이 이걸 기다릴 이유가 없다
    this.refreshWeeklyRanking().catch(() => {});

    return result;
  }

  /**
   * 주간 랭킹을 다시 집계한다.
   *
   * 규칙 (README 「랭킹」)
   *   - 빠른 대전만 센다. 친구 방은 둘이 짜고 승수를 무한정 만들 수 있다
   *   - 한 유저당 승수가 높은 상위 20판까지만 — 단순 합산은 실력이 아니라
   *     플레이 시간을 재는 지표가 된다
   *   - 주 3판 이상 해야 등재된다
   *   - 동점은 평균 정답 속도가 빠른 쪽이 위
   *
   * 지금은 게임이 끝날 때마다 해당 주를 통째로 다시 계산한다. 판 수가 적을
   * 때는 이게 가장 단순하고 항상 정확하다. 규모가 커지면 주기적 배치로
   * 옮겨야 한다.
   *
   * @param {{ week: string, start: Date, end: Date }} [range]
   * @returns {Promise<number|null>} 등재된 인원 수
   */
  async refreshWeeklyRanking(range = weekOf()) {
    return this.#safe('주간 랭킹 집계', async () => {
      const { week, start, end } = range;

      // 통째로 지우고 다시 넣는다. 상한·등재 조건 때문에 순위에서 빠지는
      // 사람이 생기는데, 갱신만 하면 그 사람이 남아버린다.
      await this.db.query(`DELETE FROM weekly_rankings WHERE week = $1`, [week]);

      const { rowCount } = await this.db.query(
        `WITH played AS (
           SELECT gp.user_id, gp.round_wins, gp.avg_answer_ms,
                  row_number() OVER (
                    PARTITION BY gp.user_id
                    ORDER BY gp.round_wins DESC, gp.avg_answer_ms ASC NULLS LAST
                  ) AS nth
             FROM game_players gp
             JOIN games g ON g.id = gp.game_id
            WHERE g.mode = 'QUICK'
              AND g.ended_at IS NOT NULL
              AND g.ended_at >= $2 AND g.ended_at < $3
         ),
         capped AS (
           SELECT user_id,
                  sum(round_wins)::int      AS round_wins,
                  avg(avg_answer_ms)::int   AS avg_answer_ms,
                  count(*)::int             AS games_counted
             FROM played
            WHERE nth <= $4
            GROUP BY user_id
           HAVING count(*) >= $5
         )
         INSERT INTO weekly_rankings (week, user_id, round_wins, avg_answer_ms, games_counted, rank)
         SELECT $1, user_id, round_wins, avg_answer_ms, games_counted,
                rank() OVER (ORDER BY round_wins DESC, avg_answer_ms ASC NULLS LAST)
           FROM capped`,
        [week, start, end, RANKING.GAME_CAP, RANKING.MIN_GAMES],
      );

      return rowCount;
    });
  }

  /**
   * 주간 랭킹 조회 — 상위 100명과 내 순위.
   *
   * 내가 상위 100에 없어도 내 줄은 따로 내려보낸다. 화면 하단에 내 순위를
   * 고정으로 붙이기 위해서다 (FR-K2).
   *
   * @param {object} params
   * @param {string} [params.week] 기본: 이번 주
   * @param {number} [params.userId]
   */
  async getWeeklyRanking({ week = weekOf().week, userId } = {}) {
    return this.#safe('주간 랭킹 조회', async () => {
      const { rows: top } = await this.db.query(
        `SELECT wr.rank, wr.round_wins, wr.avg_answer_ms, wr.games_counted,
                u.id AS user_id, u.nickname, u.appearance
           FROM weekly_rankings wr
           JOIN users u ON u.id = wr.user_id
          WHERE wr.week = $1
          ORDER BY wr.rank
          LIMIT $2`,
        [week, RANKING.TOP_N],
      );

      let me = null;
      if (userId) {
        const { rows } = await this.db.query(
          `SELECT wr.rank, wr.round_wins, wr.avg_answer_ms, wr.games_counted,
                  u.id AS user_id, u.nickname, u.appearance
             FROM weekly_rankings wr
             JOIN users u ON u.id = wr.user_id
            WHERE wr.week = $1 AND wr.user_id = $2`,
          [week, userId],
        );
        me = rows[0] ? toRankRow(rows[0]) : null;
      }

      return { week, top: top.map(toRankRow), me, minGames: RANKING.MIN_GAMES };
    });
  }

  /**
   * 혼자 연습 기록을 남긴다. 최고 기록만 갱신한다 (FR-P3).
   *
   * @param {object} params
   * @param {number} params.userId
   * @param {string} params.tier
   * @param {string} params.category
   * @param {number} params.streak 이번 도전의 연속 정답 수
   * @returns {Promise<{ bestStreak: number, isNewRecord: boolean } | null>}
   */
  async savePracticeRecord({ userId, tier, category, streak }) {
    return this.#safe('연습 기록 저장', async () => {
      const { rows } = await this.db.query(
        `INSERT INTO practice_records (user_id, tier, category, best_streak)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, tier, category) DO UPDATE
           SET best_streak = GREATEST(practice_records.best_streak, EXCLUDED.best_streak),
               updated_at  = now()
         RETURNING best_streak,
                   (xmax = 0 OR best_streak = $4) AS is_new_record`,
        [userId, tier, category, streak],
      );
      return {
        bestStreak: rows[0].best_streak,
        // 기존 기록과 같은 값이면 경신이 아니다 (0연승을 기록이라 부르지 않는다)
        isNewRecord: rows[0].is_new_record && streak > 0,
      };
    });
  }

  /**
   * 단계·카테고리별 최고 기록 전체.
   * @param {number} userId
   * @returns {Promise<Array<{ tier: string, category: string, bestStreak: number }>>}
   */
  async getPracticeRecords(userId) {
    const rows = await this.#safe('연습 기록 조회', async () => {
      const result = await this.db.query(
        `SELECT tier, category, best_streak FROM practice_records WHERE user_id = $1`,
        [userId],
      );
      return result.rows;
    });
    return (rows ?? []).map((r) => ({
      tier: r.tier,
      category: r.category,
      bestStreak: r.best_streak,
    }));
  }

  /**
   * 홈 화면에 띄울 전적. 게임이 끝날 때마다 집계하지 않고 필요할 때 센다.
   * @param {number} userId
   */
  async getUserStats(userId) {
    return this.#safe('전적 조회', async () => {
      const { rows } = await this.db.query(
        `SELECT count(*)::int AS games,
                count(*) FILTER (WHERE final_rank = 1)::int AS wins,
                coalesce(sum(round_wins), 0)::int AS round_wins
           FROM game_players gp
           JOIN games g ON g.id = gp.game_id
          WHERE gp.user_id = $1 AND g.ended_at IS NOT NULL`,
        [userId],
      );
      const row = rows[0];
      return {
        games: row.games,
        wins: row.wins,
        roundWins: row.round_wins,
        winRate: row.games ? Number((row.wins / row.games).toFixed(2)) : 0,
      };
    });
  }

  /**
   * 단어 신고를 접수한다 (FR-W1).
   *
   * 같은 사람이 같은 낱말을 여러 번 눌러도 한 건만 남긴다 — 검수 목록이
   * 한 사람의 반복으로 부풀면 "몇 명이 억울했는가"를 못 읽는다.
   *
   * @param {{ userId: number, text: string, action?: string, context?: string|null }} params
   * @returns {Promise<{ accepted: boolean } | null>} accepted=false면 이미 접수된 건
   */
  async reportWord({ userId, text, action = 'ADD', context = null }) {
    return this.#safe('단어 신고', async () => {
      const { rows } = await this.db.query(
        `INSERT INTO word_reports (user_id, text, action, context)
         SELECT $1, $2, $3::report_action, $4
          WHERE NOT EXISTS (
                SELECT 1 FROM word_reports
                 WHERE user_id = $1 AND text = $2
                   AND action = $3::report_action AND status = 'PENDING'
          )
      RETURNING id`,
        [userId, text, action, context],
      );
      return { accepted: rows.length > 0 };
    });
  }

  /**
   * 파츠 해금 판정에 쓰는 진행도.
   *
   * 전적과 따로 세는 이유: 해금은 "누적"이 기준이라 연습 최고 연속까지 함께
   * 봐야 하고, 홈 전적은 빠른 대전만 센다.
   *
   * @param {number} userId
   * @returns {Promise<{ roundWins: number, games: number, practiceStreak: number }>}
   */
  async getUnlockProgress(userId) {
    const row = await this.#safe('해금 진행도 조회', async () => {
      const { rows } = await this.db.query(
        `SELECT coalesce(g.round_wins, 0)::int  AS round_wins,
                coalesce(g.games, 0)::int       AS games,
                coalesce(p.best_streak, 0)::int AS practice_streak
           FROM (SELECT sum(gp.round_wins) AS round_wins, count(*) AS games
                   FROM game_players gp
                   JOIN games gm ON gm.id = gp.game_id
                  WHERE gp.user_id = $1 AND gm.ended_at IS NOT NULL) g
           FULL JOIN (SELECT max(best_streak) AS best_streak
                        FROM practice_records WHERE user_id = $1) p ON true`,
        [userId],
      );
      return rows[0];
    });
    return {
      roundWins: row?.round_wins ?? 0,
      games: row?.games ?? 0,
      practiceStreak: row?.practice_streak ?? 0,
    };
  }

  /**
   * 닉네임·캐릭터 변경. 마이페이지에서만 부른다.
   * appearance는 부르는 쪽에서 이미 검사된 값이어야 한다 (shared/avatar.js).
   * @param {{ userId: number, nickname: string, appearance: object }} params
   * @returns {Promise<{ id: number, nickname: string, appearance: object } | null>}
   */
  async updateProfile({ userId, nickname, appearance }) {
    return this.#safe('프로필 수정', async () => {
      const { rows } = await this.db.query(
        `UPDATE users SET nickname = $2, appearance = $3::jsonb
          WHERE id = $1
      RETURNING id, nickname, appearance`,
        [userId, nickname, JSON.stringify(appearance)],
      );
      if (!rows[0]) return null;
      return { id: Number(rows[0].id), nickname: rows[0].nickname, appearance: rows[0].appearance };
    });
  }

  /**
   * 최근 전적. 끝난 판만, 최신 순.
   * @param {number} userId
   * @param {number} [limit]
   */
  async getRecentGames(userId, limit = 10) {
    const rows = await this.#safe('최근 전적 조회', async () => {
      const result = await this.db.query(
        `SELECT g.id, g.mode, g.category, g.total_rounds, g.ended_at,
                gp.round_wins, gp.final_rank, gp.avg_answer_ms,
                (SELECT count(*) FROM game_players x WHERE x.game_id = g.id)::int AS players
           FROM game_players gp
           JOIN games g ON g.id = gp.game_id
          WHERE gp.user_id = $1 AND g.ended_at IS NOT NULL
          ORDER BY g.ended_at DESC
          LIMIT $2`,
        [userId, limit],
      );
      return result.rows;
    });
    return (rows ?? []).map((r) => ({
      gameId: Number(r.id),
      mode: r.mode,
      category: r.category,
      totalRounds: r.total_rounds,
      players: r.players,
      roundWins: r.round_wins,
      finalRank: r.final_rank,
      avgAnswerMs: r.avg_answer_ms,
      endedAt: r.ended_at,
    }));
  }

  /**
   * 지난 주차 랭킹 기록. 이번 주가 비어 있어도 예전 성적은 남아 있어야 한다.
   * @param {number} userId
   * @param {number} [limit]
   */
  async getRankHistory(userId, limit = 8) {
    const rows = await this.#safe('랭킹 이력 조회', async () => {
      const result = await this.db.query(
        `SELECT week, rank, round_wins, avg_answer_ms, games_counted
           FROM weekly_rankings
          WHERE user_id = $1
          ORDER BY week DESC
          LIMIT $2`,
        [userId, limit],
      );
      return result.rows;
    });
    return (rows ?? []).map((r) => ({
      week: r.week,
      rank: r.rank,
      roundWins: r.round_wins,
      avgAnswerMs: r.avg_answer_ms,
      gamesCounted: r.games_counted,
    }));
  }
}
