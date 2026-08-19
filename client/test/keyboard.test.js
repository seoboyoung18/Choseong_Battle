/**
 * 물리 키보드 매핑.
 *
 * 여기가 새면 PC에서 한글이 안 쳐진다. 특히 유저의 OS 입력기는 한글 모드일
 * 텐데(한글 단어 게임이니까) 그때 브라우저가 주는 값이 평소와 다르다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAYOUT, SHIFT_MAP, jamoFromEvent, rowOf } from '../src/hangul/keyboard.js';

/** KeyboardEvent 흉내 — 실제로 쓰는 필드만 */
const ev = (code, { key = '', shiftKey = false } = {}) => ({ code, key, shiftKey });

test('물리 자리를 자모로 바꾼다', () => {
  assert.equal(jamoFromEvent(ev('KeyR')), 'ㄱ');
  assert.equal(jamoFromEvent(ev('KeyK')), 'ㅏ');
  assert.equal(jamoFromEvent(ev('KeyM')), 'ㅡ');
});

test('시프트를 누른 채면 쌍자음이 된다', () => {
  // 눌렀다 떼고 치는 게 아니라 동시에 눌러야 한다 — 실제 타이핑 순서
  assert.equal(jamoFromEvent(ev('KeyR', { shiftKey: true })), 'ㄲ');
  assert.equal(jamoFromEvent(ev('KeyQ', { shiftKey: true })), 'ㅃ');
  assert.equal(jamoFromEvent(ev('KeyW', { shiftKey: true })), 'ㅉ');
  assert.equal(jamoFromEvent(ev('KeyE', { shiftKey: true })), 'ㄸ');
  assert.equal(jamoFromEvent(ev('KeyT', { shiftKey: true })), 'ㅆ');
  assert.equal(jamoFromEvent(ev('KeyO', { shiftKey: true })), 'ㅒ');
  assert.equal(jamoFromEvent(ev('KeyP', { shiftKey: true })), 'ㅖ');
});

test('쌍자음이 없는 자리는 시프트를 눌러도 그대로다', () => {
  assert.equal(jamoFromEvent(ev('KeyA', { shiftKey: true })), 'ㅁ');
  assert.equal(jamoFromEvent(ev('KeyK', { shiftKey: true })), 'ㅏ');
});

test('한글 입력기가 켜져 있어도 친 대로 들어간다', () => {
  // OS 입력기가 한글이면 브라우저는 key로 'Process'를 준다. key만 보면
  // 아무것도 못 받아서 영문 모드로 바꿔야 하는데, 한글 단어 게임에서 그건 말이 안 된다.
  assert.equal(jamoFromEvent(ev('KeyR', { key: 'Process' })), 'ㄱ');
  assert.equal(jamoFromEvent(ev('KeyR', { key: 'Process', shiftKey: true })), 'ㄲ');
  // 입력기가 낱자를 조합해 보내주는 경우도 있다
  assert.equal(jamoFromEvent(ev('KeyR', { key: 'ㄱ' })), 'ㄱ');
});

test('code가 없으면 문자로라도 받는다', () => {
  // 일부 가상 키보드는 code를 비워 보낸다
  assert.equal(jamoFromEvent(ev('', { key: 'ㅎ' })), 'ㅎ');
  assert.equal(jamoFromEvent(ev(undefined, { key: 'ㅘ' })), 'ㅘ');
});

test('한글이 아닌 입력은 받지 않는다 (FR-J3)', () => {
  for (const bad of [ev('Digit1', { key: '1' }), ev('Space', { key: ' ' }), ev('Minus', { key: '-' })]) {
    assert.equal(jamoFromEvent(bad), null);
  }
  assert.equal(jamoFromEvent(ev('Enter', { key: 'Enter' })), null, '엔터는 제출이지 자모가 아니다');
  assert.equal(jamoFromEvent(ev('ShiftLeft', { key: 'Shift' })), null);
});

test('화면 배열의 모든 자모가 물리 자리에도 있다', () => {
  // 한쪽에만 있는 자모가 생기면 입력 수단에 따라 칠 수 있는 글자가 달라진다
  const fromCodes = new Set();
  for (const c of 'QWERTYUIOPASDFGHJKLZXCVBNM') {
    fromCodes.add(jamoFromEvent(ev(`Key${c}`)));
    const shifted = jamoFromEvent(ev(`Key${c}`, { shiftKey: true }));
    if (shifted) fromCodes.add(shifted);
  }
  for (const jamo of LAYOUT.flat()) {
    assert.ok(fromCodes.has(jamo), `'${jamo}'를 물리 키보드로 칠 수 없다`);
  }
  for (const shifted of SHIFT_MAP.values()) {
    assert.ok(fromCodes.has(shifted), `'${shifted}'를 물리 키보드로 칠 수 없다`);
  }
});

test('자모가 어느 줄에 있는지 찾는다', () => {
  assert.equal(rowOf('ㅂ'), 0);
  assert.equal(rowOf('ㅁ'), 1);
  assert.equal(rowOf('ㅋ'), 2);
  assert.equal(rowOf('ㄲ'), -1, '쌍자음은 시프트로만 나오므로 배열에 없다');
});
