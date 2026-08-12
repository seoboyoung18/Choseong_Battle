/**
 * 정답 판정 엔진.
 *
 * 판정은 세 관문을 순서대로 통과해야 한다. 앞 단계에서 걸리면 뒤는 보지 않는다.
 *
 *   1. 한글 검사   — 완성형 한글만 (NOT_HANGUL)
 *   2. 패턴 대조   — 글자 수 + 힌트 일치 (LENGTH_MISMATCH / PATTERN_MISMATCH)
 *   3. 사전 조회   — 판정용 사전 등재 여부, 메모리 해시셋 O(1) (NOT_IN_DICT)
 *
 * 선착 락(ROUND_CLOSED)은 여기서 다루지 않는다. 판정을 통과한 제출만
 * 라운드 루프가 Redis 락에 태운다 — 판정 실패는 경합에 끼어들 자격이 없다.
 */

import { isHangulWord } from './hangul.js';
import { matchHint } from './hint.js';

/** 제출 거절 사유 — API 명세 submit.rejected의 reason 열거값과 일치 */
export const REJECT_REASON = Object.freeze({
  NOT_HANGUL: 'NOT_HANGUL',
  LENGTH_MISMATCH: 'LENGTH_MISMATCH',
  PATTERN_MISMATCH: 'PATTERN_MISMATCH',
  NOT_IN_DICT: 'NOT_IN_DICT',
  ROUND_CLOSED: 'ROUND_CLOSED',
});

/** 판정 엔진 종류 — 향후 상식·국기 퀴즈(지정 정답)를 같은 라운드 루프에 얹기 위한 분기 */
export const JUDGE_TYPE = Object.freeze({
  DICT: 'DICT',
  FIXED: 'FIXED',
});

/**
 * 제출 단어를 정규화한다. 앞뒤 공백만 제거하며, 내부 공백은 남겨
 * 한글 검사에서 걸리게 한다 (조용히 붙이지 않는다).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSubmission(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 패턴 + 사전 판정 (judgeType: DICT).
 * @param {object} params
 * @param {string} params.word 제출 단어 (정규화 전 원문도 허용)
 * @param {Array<{ type: string, value?: string }>} params.hint 라운드 힌트
 * @param {{ has: (word: string) => boolean }} params.dictionary 판정용 사전 (Set 호환)
 * @returns {{ ok: true, word: string } | { ok: false, reason: string }}
 */
export function judgeByDict({ word, hint, dictionary }) {
  const text = normalizeSubmission(word);

  if (!isHangulWord(text)) return { ok: false, reason: REJECT_REASON.NOT_HANGUL };

  const matched = matchHint(text, hint);
  if (!matched.ok) return { ok: false, reason: matched.reason };

  if (!dictionary.has(text)) return { ok: false, reason: REJECT_REASON.NOT_IN_DICT };

  return { ok: true, word: text };
}

/**
 * 지정 정답 판정 (judgeType: FIXED). 상식·국기 퀴즈용으로 미리 뚫어둔 경로다.
 * 현재 MVP에서는 호출되지 않는다.
 * @param {object} params
 * @param {string} params.word 제출 단어
 * @param {string[]} params.answers 인정 정답 목록
 * @returns {{ ok: true, word: string } | { ok: false, reason: string }}
 */
export function judgeByFixed({ word, answers }) {
  const text = normalizeSubmission(word);
  if (!isHangulWord(text)) return { ok: false, reason: REJECT_REASON.NOT_HANGUL };
  if (!answers.includes(text)) return { ok: false, reason: REJECT_REASON.NOT_IN_DICT };
  return { ok: true, word: text };
}

/**
 * 라운드의 judgeType에 맞는 판정기로 위임한다.
 * @param {object} params
 * @param {string} params.word
 * @param {string} [params.judgeType] 기본값 DICT
 * @param {Array<{ type: string, value?: string }>} [params.hint] DICT일 때 필수
 * @param {{ has: (word: string) => boolean }} [params.dictionary] DICT일 때 필수
 * @param {string[]} [params.answers] FIXED일 때 필수
 * @returns {{ ok: true, word: string } | { ok: false, reason: string }}
 */
export function judgeSubmission({ word, judgeType = JUDGE_TYPE.DICT, hint, dictionary, answers }) {
  if (judgeType === JUDGE_TYPE.FIXED) return judgeByFixed({ word, answers });
  return judgeByDict({ word, hint, dictionary });
}

export { REJECT_REASON as REASON };
