/**
 * 라운드 루프 · 선착 판정 · 유찰 처리.
 *
 * 소켓을 직접 알지 못한다. 바깥에서 emit·redis·dictionary를 주입받고,
 * 타이머까지 주입 가능하게 두어 테스트에서 20초를 실제로 기다리지 않게 했다.
 *
 * 라운드 규칙 (README · SRS 3.4)
 *   - 첫 유효 정답자가 라운드 승리, 1점
 *   - 승자가 나오지 않으면 라운드 번호를 유지한 채 문제만 교체한다
 *   - 교체 트리거는 둘: 제한시간 초과(TIMEOUT), 접속자 전원 패스(ALL_PASSED)
 *   - 모든 라운드는 승자가 나와야 넘어간다
 */

import { RULES } from '../config.js';
import { CATEGORY_LENGTH_RANGE, buildHint, resolveHintType } from '../judge/hint.js';
import { REJECT_REASON, judgeSubmission } from '../judge/index.js';
import {
  claimRoundWin,
  getUsedWords,
  markWordUsed,
  togglePass,
} from '../redis/locks.js';

/** 게임 진행 상태 */
export const GAME_STATUS = Object.freeze({
  READY: 'READY',
  PLAYING: 'PLAYING',
  ENDED: 'ENDED',
});

/** 라운드 종료 사유 — DB rounds.end_reason과 같은 값 */
export const END_REASON = Object.freeze({
  WON: 'WON',
  TIMEOUT: 'TIMEOUT',
  ALL_PASSED: 'ALL_PASSED',
});

export class Game {
  /**
   * @param {object} params
   * @param {string} params.gameId
   * @param {Array<{ userId: number|string, nickname: string, appearance?: object }>} params.players
   * @param {string} params.category CATEGORY 값
   * @param {number} [params.totalRounds]
   * @param {{ has: (w: string) => boolean, pickWord: Function }} params.dictionary
   * @param {import('ioredis').Redis} params.redis
   * @param {{ toRoom: Function, toUser: Function }} params.emit
   * @param {object} [params.store] 영속화 훅 (없으면 기록하지 않는다)
   * @param {() => number} [params.now]
   * @param {() => number} [params.rng]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [params.timers]
   */
  constructor({
    gameId,
    players,
    category,
    totalRounds = RULES.DEFAULT_ROUNDS,
    dictionary,
    redis,
    emit,
    store = null,
    now = Date.now,
    rng = Math.random,
    timers = { setTimeout, clearTimeout },
  }) {
    this.gameId = gameId;
    this.category = category;
    this.totalRounds = totalRounds;
    this.dictionary = dictionary;
    this.redis = redis;
    this.emit = emit;
    this.store = store;
    this.now = now;
    this.rng = rng;
    this.timers = timers;

    /** @type {Map<string, { userId: any, nickname: string, appearance: object, connected: boolean }>} */
    this.players = new Map(
      players.map((p) => [
        String(p.userId),
        { ...p, appearance: p.appearance ?? null, connected: true },
      ]),
    );

    /** 라운드 승수 */
    this.scores = new Map([...this.players.keys()].map((id) => [id, 0]));
    /** 정답까지 걸린 시간들 — 동점 타이브레이커(평균 속도)의 원천 */
    this.answerTimes = new Map([...this.players.keys()].map((id) => [id, []]));

    this.status = GAME_STATUS.READY;
    this.roundNo = 0;
    this.attemptNo = 0;
    this.round = null;
    this.timer = null;

    /** 1위 동점을 가리는 서든데스 중인지 (FR-G5) */
    this.suddenDeath = false;
    /** 서든데스에 참여하는 유저 — 이들만 점수를 얻는다 */
    this.suddenDeathPlayers = null;
  }

  /** 접속 중인 인원 수 — 전원 패스 판정의 분모 */
  connectedCount() {
    let count = 0;
    for (const p of this.players.values()) if (p.connected) count += 1;
    return count;
  }

  /** 게임을 시작한다. 카운트다운 후 1라운드로 들어간다. */
  async start() {
    if (this.status !== GAME_STATUS.READY) return;
    this.status = GAME_STATUS.PLAYING;
    this.emit.toRoom('game.countdown', { sec: RULES.COUNTDOWN_SEC });
    await this.#beginRound(1);
  }

  /**
   * 정답 제출. 판정을 통과한 것만 선착 락에 태운다 —
   * 판정 실패는 애초에 경합에 낄 자격이 없다.
   *
   * @param {object} params
   * @param {number|string} params.userId
   * @param {string} params.word
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async submit({ userId, word }) {
    const id = String(userId);
    if (this.status !== GAME_STATUS.PLAYING || !this.round || this.round.closed) {
      return this.#reject(id, REJECT_REASON.ROUND_CLOSED);
    }
    if (!this.players.has(id)) return this.#reject(id, REJECT_REASON.ROUND_CLOSED);

    // 서든데스에서는 동점자만 겨룬다. 나머지 순위는 이미 확정됐다.
    if (this.suddenDeath && !this.suddenDeathPlayers.has(id)) {
      return this.#reject(id, REJECT_REASON.ROUND_CLOSED);
    }

    const elapsedMs = this.now() - this.round.startedAt;

    const verdict = judgeSubmission({
      word,
      hint: this.round.hint,
      dictionary: this.dictionary,
    });

    this.round.submitCount += 1;

    if (!verdict.ok) {
      await this.#record({ userId: id, word, result: `REJECTED_${verdict.reason}`, elapsedMs });
      return this.#reject(id, verdict.reason);
    }

    // 여기서부터가 경합 구간. SET NX가 판정과 기록을 한 명령으로 끝낸다.
    const won = await claimRoundWin(this.redis, {
      gameId: this.gameId,
      roundNo: this.roundNo,
      attemptNo: this.attemptNo,
      userId: id,
    });

    if (!won) {
      await this.#record({ userId: id, word: verdict.word, result: 'LATE', elapsedMs });
      return this.#reject(id, REJECT_REASON.ROUND_CLOSED);
    }

    await this.#record({ userId: id, word: verdict.word, result: 'WON', elapsedMs });
    await this.#winRound({ userId: id, word: verdict.word, elapsedMs });
    return { ok: true };
  }

  /**
   * 패스 토글. 접속 중인 전원이 패스하면 문제를 교체한다.
   *
   * 패스는 "이 문제 바꾸자"는 찬성표일 뿐 제출권 포기가 아니다 — 패스한 뒤에도
   * 정답을 낼 수 있고, 그러면 패스 집계는 그대로 버려진다.
   *
   * @param {object} params
   * @param {number|string} params.userId
   * @param {boolean} [params.passed] false면 패스 취소
   */
  async pass({ userId, passed = true }) {
    const id = String(userId);
    if (this.status !== GAME_STATUS.PLAYING || !this.round || this.round.closed) return;
    if (!this.players.has(id)) return;

    const count = await togglePass(this.redis, {
      gameId: this.gameId,
      roundNo: this.roundNo,
      attemptNo: this.attemptNo,
      userId: id,
      passed,
    });

    const total = this.connectedCount();
    this.round.passCount = count;

    // 누가 눌렀는지는 감춘다 — "쟁는 사람" 낙인과 눈치게임을 만들지 않기 위해서다.
    this.emit.toRoom('round.passState', { roundNo: this.roundNo, passed: count, total });

    if (count >= total && total > 0) {
      await this.#replaceQuestion(END_REASON.ALL_PASSED);
    }
  }

  /** 연결이 끊겼다. 점수는 동결하고 남은 인원으로 계속한다. */
  async disconnect(userId) {
    const id = String(userId);
    const player = this.players.get(id);
    if (!player || !player.connected) return;
    player.connected = false;
    this.emit.toRoom('player.left', { userId: player.userId });

    if (this.status !== GAME_STATUS.PLAYING) return;

    if (this.connectedCount() === 0) {
      await this.#endGame();
      return;
    }
    // 이탈로 분모가 줄어 이미 전원 패스가 성립했을 수 있다.
    await this.#checkAllPassed();
  }

  /** 유예 시간 안에 돌아왔다. */
  reconnect(userId) {
    const id = String(userId);
    const player = this.players.get(id);
    if (!player) return null;
    player.connected = true;
    this.emit.toRoom('player.rejoined', { userId: player.userId });
    return this.snapshot();
  }

  /** 재접속 동기화용 현재 상태 스냅샷 */
  snapshot() {
    return {
      gameId: this.gameId,
      status: this.status,
      roundNo: this.roundNo,
      totalRounds: this.totalRounds,
      category: this.category,
      hint: this.round?.hint ?? null,
      deadlineTs: this.round?.deadlineTs ?? null,
      scores: Object.fromEntries(this.scores),
      suddenDeath: this.suddenDeath,
    };
  }

  /** 진행 중 타이머를 정리한다 (방 해산·서버 종료). */
  stop() {
    this.#clearTimer();
    this.status = GAME_STATUS.ENDED;
  }

  // ── 내부 ───────────────────────────────────────────────────────────────────

  #reject(userId, reason) {
    this.emit.toUser(userId, 'submit.rejected', { roundNo: this.roundNo, reason });
    return { ok: false, reason };
  }

  #clearTimer() {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 출제할 단어와 힌트를 고른다.
   * @returns {Promise<{ word: string, hintType: string, hint: any[] } | null>}
   */
  async #pickQuestion() {
    const used = await getUsedWords(this.redis, this.gameId);
    const hintType = resolveHintType(this.category, this.rng);

    // 힌트 타입이 요구하는 글자 수와 카테고리 허용 범위의 교집합에서 고른다.
    // (예: 종합에서 OPEN이 뽑히면 3~4글자만 후보다)
    const range = CATEGORY_LENGTH_RANGE[hintType] ?? CATEGORY_LENGTH_RANGE[this.category];

    const word = this.dictionary.pickWord({ lengthRange: range, exclude: used, rng: this.rng });
    if (!word) return null;

    return { word, hintType, hint: buildHint(word, hintType, this.rng) };
  }

  /** 새 라운드 번호로 진입한다. */
  async #beginRound(roundNo) {
    this.roundNo = roundNo;
    this.attemptNo = 0;
    await this.#serveQuestion('round.start');
  }

  /**
   * 문제를 출제한다. attemptNo를 올리므로 선착 락 키도 새로 생긴다.
   * @param {'round.start' | 'round.replaced'} event
   * @param {string} [reason] 교체 사유 (round.replaced일 때)
   */
  async #serveQuestion(event, reason) {
    const question = await this.#pickQuestion();
    if (!question) {
      // 출제할 단어가 바닥났다. 게임을 억지로 끌지 않고 여기서 끝낸다.
      console.warn(`[game:${this.gameId}] 출제 가능한 단어가 없어 조기 종료`);
      await this.#endGame();
      return;
    }

    this.attemptNo += 1;
    const startedAt = this.now();
    const deadlineTs = startedAt + RULES.ROUND_TIME_MS;

    this.round = {
      ...question,
      startedAt,
      deadlineTs,
      closed: false,
      submitCount: 0,
      passCount: 0,
    };

    await markWordUsed(this.redis, this.gameId, question.word);
    await this.store?.startRound?.({
      gameId: this.gameId,
      roundNo: this.roundNo,
      attemptNo: this.attemptNo,
      word: question.word,
      hintType: question.hintType,
      hint: question.hint,
    });

    this.emit.toRoom(event, {
      gameId: this.gameId,
      roundNo: this.roundNo,
      totalRounds: this.totalRounds,
      category: this.category,
      hint: question.hint,
      deadlineTs,
      suddenDeath: this.suddenDeath,
      ...(reason ? { reason } : {}),
    });

    this.#clearTimer();
    this.timer = this.timers.setTimeout(() => {
      this.#replaceQuestion(END_REASON.TIMEOUT).catch((err) =>
        console.error(`[game:${this.gameId}] 유찰 처리 실패`, err),
      );
    }, RULES.ROUND_TIME_MS);
  }

  /** 이탈 등으로 분모가 바뀌었을 때 전원 패스가 이미 성립했는지 다시 본다. */
  async #checkAllPassed() {
    if (!this.round || this.round.closed) return;
    const total = this.connectedCount();
    if (total > 0 && this.round.passCount >= total) {
      await this.#replaceQuestion(END_REASON.ALL_PASSED);
    }
  }

  /**
   * 승자 없이 문제만 교체한다. 라운드 번호는 그대로 둔다.
   * @param {'TIMEOUT' | 'ALL_PASSED'} reason
   */
  async #replaceQuestion(reason) {
    if (!this.round || this.round.closed) return;
    this.round.closed = true;
    this.#clearTimer();

    await this.store?.endRound?.({
      gameId: this.gameId,
      roundNo: this.roundNo,
      attemptNo: this.attemptNo,
      endReason: reason,
      passCount: this.round.passCount,
    });

    this.timers.setTimeout(() => {
      this.#serveQuestion('round.replaced', reason).catch((err) =>
        console.error(`[game:${this.gameId}] 문제 교체 실패`, err),
      );
    }, RULES.REPLACE_INTERVAL_MS);
  }

  /** 라운드 승자가 확정됐다. */
  async #winRound({ userId, word, elapsedMs }) {
    this.round.closed = true;
    this.#clearTimer();

    this.scores.set(userId, this.scores.get(userId) + 1);
    this.answerTimes.get(userId).push(elapsedMs);

    if (elapsedMs < RULES.SUSPICIOUS_ANSWER_MS) {
      // 사람이 낼 수 없는 속도다. 차단하지는 않고 남겨서 배치로 본다 (NFR-5).
      console.warn(
        `[abuse] game=${this.gameId} round=${this.roundNo} user=${userId} elapsed=${elapsedMs}ms word=${word}`,
      );
    }

    const winner = this.players.get(userId);
    await this.store?.endRound?.({
      gameId: this.gameId,
      roundNo: this.roundNo,
      attemptNo: this.attemptNo,
      endReason: END_REASON.WON,
      winnerId: winner.userId,
      wonWord: word,
      wonElapsedMs: elapsedMs,
      passCount: this.round.passCount,
    });

    this.emit.toRoom('round.won', {
      roundNo: this.roundNo,
      winner: { userId: winner.userId, nickname: winner.nickname },
      word,
      hint: this.round.hint,
      elapsedMs,
      submitCount: this.round.submitCount,
      scores: Object.fromEntries(this.scores),
    });

    if (this.suddenDeath) {
      await this.#endGame(userId);
      return;
    }

    this.timers.setTimeout(() => {
      this.#advance().catch((err) =>
        console.error(`[game:${this.gameId}] 라운드 진행 실패`, err),
      );
    }, RULES.ROUND_INTERVAL_MS);
  }

  /** 다음 라운드로 넘어가거나 게임을 끝낸다. */
  async #advance() {
    if (this.roundNo >= this.totalRounds) {
      const tied = this.#topTiedPlayers();
      if (tied.length > 1) {
        await this.#beginSuddenDeath(tied);
        return;
      }
      await this.#endGame();
      return;
    }
    await this.#beginRound(this.roundNo + 1);
  }

  /** 최고 승수를 나눠 가진 유저들 */
  #topTiedPlayers() {
    const best = Math.max(...this.scores.values());
    return [...this.scores.entries()].filter(([, s]) => s === best).map(([id]) => id);
  }

  /** 1위 동점자끼리 한 라운드로 가린다 (FR-G5). */
  async #beginSuddenDeath(tiedIds) {
    this.suddenDeath = true;
    this.suddenDeathPlayers = new Set(tiedIds);
    this.emit.toRoom('game.suddenDeath', {
      players: tiedIds.map((id) => {
        const p = this.players.get(id);
        return { userId: p.userId, nickname: p.nickname };
      }),
    });
    await this.#beginRound(this.roundNo + 1);
  }

  /** 평균 정답 속도 (ms). 한 번도 못 맞혔으면 null. */
  #avgAnswerMs(userId) {
    const times = this.answerTimes.get(userId);
    if (!times.length) return null;
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }

  /**
   * 최종 순위. 승수 내림차순, 같으면 평균 정답 속도가 빠른 쪽이 위다.
   * @param {string} [suddenDeathWinner] 서든데스 승자 — 무조건 1위
   */
  #ranks(suddenDeathWinner) {
    const rows = [...this.players.keys()].map((id) => ({
      userId: this.players.get(id).userId,
      nickname: this.players.get(id).nickname,
      roundWins: this.scores.get(id),
      avgAnswerMs: this.#avgAnswerMs(id),
      leftEarly: !this.players.get(id).connected,
      _id: id,
    }));

    rows.sort((a, b) => {
      if (suddenDeathWinner) {
        if (a._id === suddenDeathWinner) return -1;
        if (b._id === suddenDeathWinner) return 1;
      }
      if (b.roundWins !== a.roundWins) return b.roundWins - a.roundWins;
      // 한 번도 못 맞힌 사람은 맨 뒤로
      if (a.avgAnswerMs === null) return b.avgAnswerMs === null ? 0 : 1;
      if (b.avgAnswerMs === null) return -1;
      return a.avgAnswerMs - b.avgAnswerMs;
    });

    return rows.map((row, i) => {
      const { _id, ...rest } = row;
      return { ...rest, rank: i + 1 };
    });
  }

  /** 게임 종료. */
  async #endGame(suddenDeathWinner) {
    if (this.status === GAME_STATUS.ENDED) return;
    this.#clearTimer();
    this.status = GAME_STATUS.ENDED;

    const ranks = this.#ranks(suddenDeathWinner);
    const payload = {
      gameId: this.gameId,
      scores: Object.fromEntries(this.scores),
      ranks,
      summary: {
        totalRounds: this.totalRounds,
        category: this.category,
        suddenDeath: this.suddenDeath,
      },
    };

    await this.store?.endGame?.({ gameId: this.gameId, ranks });
    this.emit.toRoom('game.ended', payload);
  }

  /** 제출 로그 적재 — 실패해도 게임을 멈추지 않는다. */
  async #record(entry) {
    try {
      await this.store?.recordSubmission?.({
        gameId: this.gameId,
        roundNo: this.roundNo,
        attemptNo: this.attemptNo,
        ...entry,
      });
    } catch (err) {
      console.error(`[game:${this.gameId}] 제출 로그 적재 실패`, err);
    }
  }
}
