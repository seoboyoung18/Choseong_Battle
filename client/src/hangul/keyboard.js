/**
 * 2벌식 키보드 배열.
 *
 * 모바일에서는 이 배열을 화면 키보드로 그리고, PC에서는 물리 키보드를 같은
 * 자모로 매핑한다. 두 입력이 같은 오토마타로 들어가므로 동작이 갈리지 않는다.
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

/**
 * 물리 키 **위치** → 자모 [기본, 시프트].
 *
 * `event.key`가 아니라 `event.code`를 쓴다. 한글 단어 게임이라 유저의 OS 입력기는
 * 당연히 한글 모드인데, 그때 브라우저는 `key`로 'Process'를 주거나 조합 이벤트로
 * 삼켜버려서 아무것도 못 받는다. 반대로 `code`는 입력기 상태와 무관하게 물리
 * 자리를 그대로 알려준다 — 영문 모드로 바꾸지 않아도 쳐진다.
 *
 * 2벌식 자체가 QWERTY 자리로 정의된 배열이라 자리 기준이 원래 맞기도 하다.
 */
const CODE_MAP = {
  KeyQ: ['ㅂ', 'ㅃ'], KeyW: ['ㅈ', 'ㅉ'], KeyE: ['ㄷ', 'ㄸ'],
  KeyR: ['ㄱ', 'ㄲ'], KeyT: ['ㅅ', 'ㅆ'],
  KeyY: ['ㅛ'], KeyU: ['ㅕ'], KeyI: ['ㅑ'],
  KeyO: ['ㅐ', 'ㅒ'], KeyP: ['ㅔ', 'ㅖ'],
  KeyA: ['ㅁ'], KeyS: ['ㄴ'], KeyD: ['ㅇ'], KeyF: ['ㄹ'], KeyG: ['ㅎ'],
  KeyH: ['ㅗ'], KeyJ: ['ㅓ'], KeyK: ['ㅏ'], KeyL: ['ㅣ'],
  KeyZ: ['ㅋ'], KeyX: ['ㅌ'], KeyC: ['ㅊ'], KeyV: ['ㅍ'],
  KeyB: ['ㅠ'], KeyN: ['ㅜ'], KeyM: ['ㅡ'],
};

/** 자모 낱자 영역 (ㄱ~ㅣ) */
const isJamoChar = (ch) => {
  const code = ch.charCodeAt(0);
  return code >= 0x3131 && code <= 0x3163;
};

/**
 * 키 입력 하나를 자모로 바꾼다.
 *
 * @param {KeyboardEvent} event
 * @returns {string | null} 자모, 매핑이 없으면 null
 */
export function jamoFromEvent(event) {
  const mapped = CODE_MAP[event.code];
  if (mapped) return (event.shiftKey && mapped[1]) || mapped[0];

  // code가 비는 경우(일부 가상 키보드·입력기)에는 문자로라도 받는다.
  // 이미 자모면 그대로 통과 — OS가 조합해 보내준 낱자다.
  if (event.key?.length === 1 && isJamoChar(event.key)) return event.key;
  return null;
}

/** 자모가 화면 키보드의 어느 줄에 있는지 — 스타일링용 */
export function rowOf(jamo) {
  return LAYOUT.findIndex((row) => row.includes(jamo));
}
