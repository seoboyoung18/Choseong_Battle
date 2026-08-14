/**
 * 2벌식 키보드 배열.
 *
 * 모바일에서는 이 배열을 화면 키보드로 그리고, PC에서는 물리 키보드 QWERTY를
 * 같은 자모로 매핑한다. 두 입력이 같은 오토마타로 들어가므로 동작이 갈리지 않는다.
 */

/** 화면 키보드 3단 배열 — 왼쪽이 자음, 오른쪽이 모음으로 모이도록 표준 배열을 그대로 쓴다 */
export const LAYOUT = [
  ['ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅐ', 'ㅔ'],
  ['ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅎ', 'ㅗ', 'ㅓ', 'ㅏ', 'ㅣ'],
  ['ㅋ', 'ㅌ', 'ㅊ', 'ㅍ', 'ㅠ', 'ㅜ', 'ㅡ'],
];

/** 시프트를 눌렀을 때 바뀌는 자리만 */
export const SHIFT_MAP = new Map([
  ['ㅂ', 'ㅃ'], ['ㅈ', 'ㅉ'], ['ㄷ', 'ㄸ'], ['ㄱ', 'ㄲ'], ['ㅅ', 'ㅆ'],
  ['ㅐ', 'ㅒ'], ['ㅔ', 'ㅖ'],
]);

/** 물리 키보드 QWERTY → 자모 */
const QWERTY = {
  q: 'ㅂ', w: 'ㅈ', e: 'ㄷ', r: 'ㄱ', t: 'ㅅ',
  y: 'ㅛ', u: 'ㅕ', i: 'ㅑ', o: 'ㅐ', p: 'ㅔ',
  a: 'ㅁ', s: 'ㄴ', d: 'ㅇ', f: 'ㄹ', g: 'ㅎ',
  h: 'ㅗ', j: 'ㅓ', k: 'ㅏ', l: 'ㅣ',
  z: 'ㅋ', x: 'ㅌ', c: 'ㅊ', v: 'ㅍ',
  b: 'ㅠ', n: 'ㅜ', m: 'ㅡ',
  Q: 'ㅃ', W: 'ㅉ', E: 'ㄸ', R: 'ㄲ', T: 'ㅆ',
  O: 'ㅒ', P: 'ㅖ',
};

/**
 * 물리 키 입력을 자모로 바꾼다.
 *
 * 한글 자모가 직접 들어오는 경우(OS 입력기가 한글 모드일 때)도 그대로 통과시킨다.
 *
 * @param {string} key KeyboardEvent.key
 * @returns {string | null} 자모, 매핑이 없으면 null
 */
export function keyToJamo(key) {
  if (key.length !== 1) return null;
  if (QWERTY[key]) return QWERTY[key];
  // 이미 자모면 그대로 (ㄱ~ㅎ, ㅏ~ㅣ)
  const code = key.charCodeAt(0);
  if (code >= 0x3131 && code <= 0x3163) return key;
  return null;
}

/** 자모가 화면 키보드의 어느 줄에 있는지 — 스타일링용 */
export function rowOf(jamo) {
  return LAYOUT.findIndex((row) => row.includes(jamo));
}
