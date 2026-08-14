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
   * @param {{ tossUserId: string, nickname: string, avatarId?: number }} params
   * @returns {Promise<{ id: number, nickname: string, avatarId: number } | null>}
   */
  async upsertUser({ tossUserId, nickname, avatarId = 1 }) {
    return this.#safe('유저 등록', async () => {
      const { rows } = await this.db.query(
        `INSERT INTO users (toss_user_id, nickname, avatar_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (toss_user_id) DO UPDATE
           SET nickname = EXCLUDED.nickname, avatar_id = EXCLUDED.avatar_id
         RETURNING id, nickname, avatar_id`,
        [tossUserId, nickname, avatarId],
      );
      const row = rows[0];
      return { id: Number(row.id), nickname: row.nickname, avatarId: row.avatar_id };
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
  async createGame({ gameId, category, totalRounds, players }) {
    return this.#safe('게임 생성', async () => {
      // room_id는 지금 비워둔다. 방은 Redis에만 사는 휘발성 상태라
      // rooms 테이블에 올리는 건 별도 작업이다.
      const { rows } = await this.db.query(
        `INSERT INTO games (category, total_rounds) VALUES ($1, $2) RETURNING id`,
        [category, totalRounds],
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
    return result;
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
}
