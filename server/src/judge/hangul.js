/**
 * 한글 자모 분해 · 조합.
 *
 * 완성형 한글(가~힣, U+AC00~U+D7A3)은 초성 19 × 중성 21 × 종성 28로
 * 규칙적으로 배열되어 있어 산술만으로 분해된다.
 *
 *   코드포인트 = 0xAC00 + (초성 × 21 + 중성) × 28 + 종성
 *
 * 이 파일은 문제 출제와 무관한 순수 계산 유틸이다. 힌트로 노출되는 자모는
 * CHO_LIST(초성 19자)와 JUNG_LIST(중성 21자)뿐이며, JONG_LIST의 겹받침은
 * "값"·"닭" 같은 단어를 정확히 분해하기 위한 상수일 뿐 출제되지 않는다.
 */

export const HANGUL_BASE = 0xac00;
export const HANGUL_LAST = 0xd7a3;

/** 초성 19자 — 인덱스가 곧 분해식의 초성 번호. 겹자음은 없고 쌍자음만 있다 */
export const CHO_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 중성 21자 — 복합모음(ㅘ ㅙ ㅚ ㅝ ㅞ ㅟ ㅢ) 포함 */
export const JUNG_LIST = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ',
  'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];

/** 종성 28자 — 0번은 받침 없음. 겹받침 포함, 분해 전용이며 힌트에는 쓰이지 않는다 */
export const JONG_LIST = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ',
  'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const JUNG_COUNT = JUNG_LIST.length; // 21
const JONG_COUNT = JONG_LIST.length; // 28

/**
 * 완성형 한글 한 글자인지 판별한다.
 * 자모 낱글자(ㄱ, ㅏ)와 옛한글은 false — 제출 단어는 완성형만 인정한다.
 * @param {string} ch 한 글자
 * @returns {boolean}
 */
export function isCompleteHangul(ch) {
  if (typeof ch !== 'string' || ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return code >= HANGUL_BASE && code <= HANGUL_LAST;
}

/**
 * 문자열 전체가 완성형 한글로만 이루어졌는지 판별한다.
 * 공백·알파벳·숫자·자모 낱글자가 하나라도 섞이면 false. (API: NOT_HANGUL)
 * @param {string} text
 * @returns {boolean}
 */
export function isHangulWord(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  for (const ch of text) {
    if (!isCompleteHangul(ch)) return false;
  }
  return true;
}

/**
 * 한 글자를 초성·중성·종성으로 분해한다.
 * @param {string} ch 완성형 한글 한 글자
 * @returns {{ cho: string, jung: string, jong: string }} 종성이 없으면 jong은 빈 문자열
 * @throws {TypeError} 완성형 한글이 아닌 경우
 */
export function decomposeChar(ch) {
  if (!isCompleteHangul(ch)) {
    throw new TypeError(`완성형 한글이 아닙니다: ${JSON.stringify(ch)}`);
  }
  const offset = ch.charCodeAt(0) - HANGUL_BASE;
  const jong = offset % JONG_COUNT;
  const jung = Math.floor(offset / JONG_COUNT) % JUNG_COUNT;
  const cho = Math.floor(offset / (JONG_COUNT * JUNG_COUNT));
  return { cho: CHO_LIST[cho], jung: JUNG_LIST[jung], jong: JONG_LIST[jong] };
}

/**
 * 단어를 글자별 자모로 분해한다.
 * @param {string} word 완성형 한글 단어
 * @returns {Array<{ cho: string, jung: string, jong: string }>}
 */
export function decomposeWord(word) {
  return [...word].map(decomposeChar);
}

/**
 * 초성·중성·종성을 완성형 한 글자로 조합한다.
 * @param {string} cho 초성 (예: 'ㄱ')
 * @param {string} jung 중성 (예: 'ㅏ')
 * @param {string} [jong] 종성, 없으면 생략
 * @returns {string} 완성형 한글 한 글자
 * @throws {TypeError} 자모가 목록에 없는 경우
 */
export function composeChar(cho, jung, jong = '') {
  const choIdx = CHO_LIST.indexOf(cho);
  const jungIdx = JUNG_LIST.indexOf(jung);
  const jongIdx = JONG_LIST.indexOf(jong);
  if (choIdx < 0) throw new TypeError(`알 수 없는 초성: ${JSON.stringify(cho)}`);
  if (jungIdx < 0) throw new TypeError(`알 수 없는 중성: ${JSON.stringify(jung)}`);
  if (jongIdx < 0) throw new TypeError(`알 수 없는 종성: ${JSON.stringify(jong)}`);
  const code = HANGUL_BASE + (choIdx * JUNG_COUNT + jungIdx) * JONG_COUNT + jongIdx;
  return String.fromCharCode(code);
}

/**
 * 단어의 초성열을 뽑는다. words 테이블 cho 컬럼에 미리 계산해 저장하는 값.
 * @param {string} word 예: '감자'
 * @returns {string} 예: 'ㄱㅈ'
 */
export function choSequence(word) {
  return decomposeWord(word).map((c) => c.cho).join('');
}

/**
 * 단어의 중성열을 뽑는다. words 테이블 jung 컬럼에 미리 계산해 저장하는 값.
 * @param {string} word 예: '감자'
 * @returns {string} 예: 'ㅏㅏ'
 */
export function jungSequence(word) {
  return decomposeWord(word).map((c) => c.jung).join('');
}
