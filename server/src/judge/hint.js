/**
 * 힌트 생성 · 패턴 대조.
 *
 * 힌트는 글자 위치별 배열이다 (API `round.start`의 `hint[]`).
 *
 *   "라테" MIX  →  [{ type: 'CHO', value: 'ㄹ' }, { type: 'JUNG', value: 'ㅔ' }]
 *   "화장품" OPEN →  [{ type: 'BLANK' }, { type: 'OPEN', value: '장' }, { type: 'BLANK' }]
 */

import { decomposeWord } from './hangul.js';

/** 유저가 고르는 카테고리 5종. ALL(종합)은 라운드마다 힌트 타입 4종 중 하나를 뽑는다 */
export const CATEGORY = Object.freeze({
  CHO: 'CHO',
  JUNG: 'JUNG',
  MIX: 'MIX',
  OPEN: 'OPEN',
  ALL: 'ALL',
});

/** 라운드 단위로 확정되는 힌트 타입 4종. ERD rounds.hint_type과 일치 */
export const HINT_TYPE = Object.freeze({
  CHO: 'CHO',
  JUNG: 'JUNG',
  MIX: 'MIX',
  OPEN: 'OPEN',
});

/** 힌트 배열의 원소 타입 4종 */
export const HINT_SLOT = Object.freeze({
  CHO: 'CHO',
  JUNG: 'JUNG',
  OPEN: 'OPEN',
  BLANK: 'BLANK',
});

/** ALL(종합)이 뽑을 수 있는 힌트 타입 후보 */
const HINT_TYPES = Object.freeze([HINT_TYPE.CHO, HINT_TYPE.JUNG, HINT_TYPE.MIX, HINT_TYPE.OPEN]);

/**
 * 힌트 타입별 출제 가능 글자 수 (min·max 포함).
 * 한 글자 공개는 힌트가 너무 헐거워지지 않도록 3~4자로 제한한다.
 */
export const LENGTH_RANGE = Object.freeze({
  CHO: { min: 2, max: 3 },
  JUNG: { min: 2, max: 3 },
  MIX: { min: 2, max: 3 },
  OPEN: { min: 3, max: 4 },
});

/** 카테고리 기준 출제 가능 글자 수 — ALL은 네 타입의 합집합이라 2~4 */
export const CATEGORY_LENGTH_RANGE = Object.freeze({
  ...LENGTH_RANGE,
  ALL: { min: 2, max: 4 },
});

/** 기본 난수원. 테스트에서는 결정적 함수를 주입한다 */
const defaultRng = Math.random;

/** [0, n) 정수 */
function randomInt(n, rng) {
  return Math.floor(rng() * n);
}

/**
 * 카테고리에서 이번 라운드의 힌트 타입을 정한다.
 * ALL(종합)이면 4종 중 무작위, 그 외에는 카테고리가 곧 힌트 타입이다.
 * @param {string} category CATEGORY 값
 * @param {() => number} [rng] 0 이상 1 미만 난수 생성기
 * @returns {string} HINT_TYPE 값
 * @throws {TypeError} 알 수 없는 카테고리
 */
export function resolveHintType(category, rng = defaultRng) {
  if (category === CATEGORY.ALL) return HINT_TYPES[randomInt(HINT_TYPES.length, rng)];
  if (HINT_TYPE[category]) return category;
  throw new TypeError(`알 수 없는 카테고리: ${JSON.stringify(category)}`);
}

/**
 * 단어에서 힌트 배열을 만든다.
 *
 * - CHO  : 전 글자 초성 공개
 * - JUNG : 전 글자 중성 공개
 * - MIX  : 글자마다 초성 또는 중성 중 하나를 무작위로 공개 (두 종류가 모두 최소 1개씩 나오도록 보정)
 * - OPEN : 한 글자만 통째로 공개, 나머지는 빈칸
 *
 * @param {string} word 완성형 한글 단어
 * @param {string} hintType HINT_TYPE 값
 * @param {() => number} [rng] 0 이상 1 미만 난수 생성기
 * @returns {Array<{ type: string, value?: string }>} BLANK 원소에는 value가 없다
 * @throws {TypeError} 알 수 없는 힌트 타입
 */
export function buildHint(word, hintType, rng = defaultRng) {
  const chars = decomposeWord(word);

  switch (hintType) {
    case HINT_TYPE.CHO:
      return chars.map((c) => ({ type: HINT_SLOT.CHO, value: c.cho }));

    case HINT_TYPE.JUNG:
      return chars.map((c) => ({ type: HINT_SLOT.JUNG, value: c.jung }));

    case HINT_TYPE.MIX: {
      // 전부 초성으로 쏠리면 자음 문제와 구분이 없어지므로 두 종류를 모두 보장한다.
      const picks = chars.map(() => (rng() < 0.5 ? HINT_SLOT.CHO : HINT_SLOT.JUNG));
      if (chars.length >= 2 && picks.every((p) => p === picks[0])) {
        picks[randomInt(picks.length, rng)] = picks[0] === HINT_SLOT.CHO ? HINT_SLOT.JUNG : HINT_SLOT.CHO;
      }
      return chars.map((c, i) => ({
        type: picks[i],
        value: picks[i] === HINT_SLOT.CHO ? c.cho : c.jung,
      }));
    }

    case HINT_TYPE.OPEN: {
      const openIdx = randomInt(word.length, rng);
      return [...word].map((ch, i) =>
        i === openIdx ? { type: HINT_SLOT.OPEN, value: ch } : { type: HINT_SLOT.BLANK },
      );
    }

    default:
      throw new TypeError(`알 수 없는 힌트 타입: ${JSON.stringify(hintType)}`);
  }
}

/**
 * 제출 단어가 힌트 패턴에 맞는지 대조한다. 사전 등재 여부는 보지 않는다.
 * @param {string} word 완성형 한글로 검증이 끝난 단어
 * @param {Array<{ type: string, value?: string }>} hint 힌트 배열
 * @returns {{ ok: true } | { ok: false, reason: 'LENGTH_MISMATCH' | 'PATTERN_MISMATCH' }}
 */
export function matchHint(word, hint) {
  const chars = [...word];
  if (chars.length !== hint.length) return { ok: false, reason: 'LENGTH_MISMATCH' };

  const decomposed = decomposeWord(word);
  for (let i = 0; i < hint.length; i += 1) {
    const slot = hint[i];
    switch (slot.type) {
      case HINT_SLOT.BLANK:
        break;
      case HINT_SLOT.CHO:
        if (decomposed[i].cho !== slot.value) return { ok: false, reason: 'PATTERN_MISMATCH' };
        break;
      case HINT_SLOT.JUNG:
        if (decomposed[i].jung !== slot.value) return { ok: false, reason: 'PATTERN_MISMATCH' };
        break;
      case HINT_SLOT.OPEN:
        if (chars[i] !== slot.value) return { ok: false, reason: 'PATTERN_MISMATCH' };
        break;
      default:
        throw new TypeError(`알 수 없는 힌트 원소 타입: ${JSON.stringify(slot.type)}`);
    }
  }
  return { ok: true };
}

/**
 * 힌트를 사람이 읽는 한 줄로 만든다. 로그·결과 연출용.
 * @param {Array<{ type: string, value?: string }>} hint
 * @returns {string} 예: 'ㄹ ㅔ', '⬜ 장 ⬜'
 */
export function formatHint(hint) {
  return hint.map((slot) => (slot.type === HINT_SLOT.BLANK ? '⬜' : slot.value)).join(' ');
}
