/**
 * 혼자 연습.
 *
 * 판정은 멀티플레이와 똑같은 서버 사전 판정을 그대로 쓴다 (FR-P4) — 연습에서
 * 되던 단어가 실전에서 안 되면 연습의 의미가 없다.
 *
 * 멀티와 다른 점은 경쟁이 없다는 것뿐이라, 선착 락도 Redis도 필요 없다.
 * 상태는 이 객체 하나에 담기고 소켓이 끊기면 같이 사라진다.
 *
 * 단계 (FR-P1, FR-P2)
 *   자유    제한시간 없음 · 패스 가능 · 끝나지 않는다
 *   시간제  연속 도전 — 시간 초과나 오답 하나로 그 자리에서 끝난다
 */

import { PRACTICE_TIERS } from '../config.js';
import { CATEGORY_LENGTH_RANGE, buildHint, resolveHintType } from '../judge/hint.js';
import { judgeSubmission } from '../judge/index.js';

/** 연습이 끝나는 이유 */
export const PRACTICE_END = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  WRONG: 'WRONG',
  QUIT: 'QUIT',
});

export class PracticeSession {
  /**
   * @param {object} params
   * @param {number|string} params.userId
   * @param {string} params.category CATEGORY 값
   * @param {string} params.tier PRACTICE_TIERS 키
   * @param {{ has: Function, pickWord: Function }} params.dictionary
   * @param {(event: string, payload: object) => void} params.emit
   * @param {() => number} [params.now]
   * @param {() => number} [params.rng]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [params.timers]
   */
  constructor({
    userId,
    category,
    tier,
    dictionary,
    emit,
    now = Date.now,
    rng = Math.random,
    timers = { setTimeout, clearTimeout },
  }) {
    const config = PRACTICE_TIERS[tier];
    if (!config) throw new TypeError(`알 수 없는 연습 단계: ${JSON.stringify(tier)}`);

    this.userId = userId;
    this.category = category;
    this.tier = tier;
    this.config = config;
    this.dictionary = dictionary;
    this.emit = emit;
    this.now = now;
    this.rng = rng;
    this.timers = timers;

    this.streak = 0;
    this.question = null;
    this.timer = null;
    this.ended = false;

    /** 방금 세션에서 이미 나온 단어 — 같은 문제가 연달아 나오면 연습이 안 된다 */
    this.used = new Set();
  }

  /** 첫 문제를 낸다. */
  start() {
    this.#serve();
    return this;
  }

  /**
   * 정답 제출.
   *
   * 시간제 단계에서는 거절도 실패로 친다 (README 「혼자 연습」). 멀티에서는
   * 미인정 단어가 무효 제출로 끝나지만, 여기서는 그게 곧 도전 종료다.
   *
   * @param {string} word
   */
  submit(word) {
    if (this.ended || !this.question) return;

    const verdict = judgeSubmission({
      word,
      hint: this.question.hint,
      dictionary: this.dictionary,
    });

    if (!verdict.ok) {
      this.emit('practice.rejected', { reason: verdict.reason, word });
      // 자유 단계는 몇 번을 틀려도 계속 간다
      if (this.config.limitMs !== null) this.#end(PRACTICE_END.WRONG);
      return;
    }

    this.streak += 1;
    this.emit('practice.correct', {
      word: verdict.word,
      streak: this.streak,
      elapsedMs: this.now() - this.question.startedAt,
    });
    this.#serve();
  }

  /** 패스 — 자유 단계 전용. 합의 없이 즉시 다음 문제로 넘어간다. */
  pass() {
    if (this.ended || !this.config.canPass) return;
    this.#serve();
  }

  /** 유저가 그만뒀다. */
  quit() {
    this.#end(PRACTICE_END.QUIT);
  }

  /** 타이머만 정리한다 (연결이 끊겨 기록을 남길 수 없을 때). */
  dispose() {
    this.#clearTimer();
    this.ended = true;
  }

  // ── 내부 ───────────────────────────────────────────────────────────────────

  #clearTimer() {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  #serve() {
    const hintType = resolveHintType(this.category, this.rng);
    const range = CATEGORY_LENGTH_RANGE[hintType] ?? CATEGORY_LENGTH_RANGE[this.category];
    const word = this.dictionary.pickWord({ lengthRange: range, exclude: this.used, rng: this.rng });

    if (!word) {
      // 낼 문제가 떨어졌다. 실패가 아니라 정상 종료로 처리한다.
      this.#end(PRACTICE_END.QUIT);
      return;
    }

    this.used.add(word);
    const startedAt = this.now();
    const deadlineTs = this.config.limitMs === null ? null : startedAt + this.config.limitMs;

    this.question = { word, hintType, hint: buildHint(word, hintType, this.rng), startedAt, deadlineTs };

    this.emit('practice.question', {
      tier: this.tier,
      category: this.category,
      hint: this.question.hint,
      deadlineTs,
      streak: this.streak,
    });

    this.#clearTimer();
    if (this.config.limitMs !== null) {
      this.timer = this.timers.setTimeout(() => this.#end(PRACTICE_END.TIMEOUT), this.config.limitMs);
    }
  }

  #end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.#clearTimer();

    this.emit('practice.ended', {
      reason,
      tier: this.tier,
      category: this.category,
      streak: this.streak,
      // 시간 초과·오답으로 끝났으면 못 맞힌 문제의 답을 알려준다 — 그게 연습이다
      answer: reason === PRACTICE_END.QUIT ? null : this.question?.word ?? null,
    });
  }
}
