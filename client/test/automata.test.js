import test from 'node:test';
import assert from 'node:assert/strict';

import { HangulComposer, compose, isConsonant, isVowel } from '../src/hangul/automata.js';

/** 자모 배열을 순서대로 입력한 결과 */
const type = (...jamos) => compose(jamos);

test('자음·모음을 구분한다', () => {
  assert.ok(isConsonant('ㄱ') && isConsonant('ㄲ') && isConsonant('ㅎ'));
  assert.ok(!isConsonant('ㅏ') && !isConsonant('a'));
  assert.ok(isVowel('ㅏ') && isVowel('ㅢ'));
  assert.ok(!isVowel('ㄱ'));
  assert.ok(!isConsonant('ㄳ'), '겹받침은 키보드로 직접 치는 자모가 아니다');
});

test('기본 조합', () => {
  assert.equal(type('ㄱ'), 'ㄱ');
  assert.equal(type('ㄱ', 'ㅏ'), '가');
  assert.equal(type('ㄱ', 'ㅏ', 'ㅁ'), '감');
  assert.equal(type('ㄱ', 'ㅏ', 'ㅁ', 'ㅈ', 'ㅏ'), '감자');
});

test('모음만 입력해도 보인다', () => {
  assert.equal(type('ㅏ'), 'ㅏ');
  assert.equal(type('ㅏ', 'ㅣ'), 'ㅏㅣ', '복합모음이 아니면 따로 선다');
});

test('복합모음을 만든다', () => {
  assert.equal(type('ㄱ', 'ㅗ', 'ㅏ'), '과');
  assert.equal(type('ㄱ', 'ㅗ', 'ㅐ'), '괘');
  assert.equal(type('ㅇ', 'ㅗ', 'ㅣ'), '외');
  assert.equal(type('ㅇ', 'ㅜ', 'ㅓ'), '워');
  assert.equal(type('ㅇ', 'ㅜ', 'ㅔ'), '웨');
  assert.equal(type('ㅇ', 'ㅜ', 'ㅣ'), '위');
  assert.equal(type('ㅇ', 'ㅡ', 'ㅣ'), '의');
  assert.equal(type('ㅎ', 'ㅘ', 'ㅈ', 'ㅏ', 'ㅇ', 'ㅍ', 'ㅜ', 'ㅁ'), '화장품');
});

test('조합되지 않는 모음 연속은 새 글자가 된다', () => {
  assert.equal(type('ㄱ', 'ㅏ', 'ㅏ'), '가ㅏ');
  assert.equal(type('ㄱ', 'ㅗ', 'ㅓ'), '고ㅓ', 'ㅗ+ㅓ는 복합모음이 아니다');
});

test('겹받침을 만든다', () => {
  assert.equal(type('ㄱ', 'ㅏ', 'ㅂ', 'ㅅ'), '값');
  assert.equal(type('ㄷ', 'ㅏ', 'ㄹ', 'ㄱ'), '닭');
  assert.equal(type('ㅅ', 'ㅏ', 'ㄹ', 'ㅁ'), '삶');
  assert.equal(type('ㅇ', 'ㅓ', 'ㅄ'), '어', '겹받침 낱글자는 입력으로 취급하지 않는다');
});

test('겹받침이 안 되는 조합은 다음 글자로 넘어간다', () => {
  assert.equal(type('ㄱ', 'ㅏ', 'ㅁ', 'ㅈ'), '감ㅈ');
  assert.equal(type('ㄱ', 'ㅏ', 'ㄴ', 'ㄱ'), '간ㄱ', 'ㄴ+ㄱ은 겹받침이 아니다');
});

test('받침이 될 수 없는 자음은 새 글자를 연다', () => {
  assert.equal(type('ㄱ', 'ㅏ', 'ㄸ'), '가ㄸ', 'ㄸ은 종성이 될 수 없다');
  assert.equal(type('ㄱ', 'ㅏ', 'ㅃ'), '가ㅃ');
});

test('자음이 연달아 오면 앞 자음이 확정된다', () => {
  assert.equal(type('ㄱ', 'ㄴ'), 'ㄱㄴ');
  assert.equal(type('ㄱ', 'ㄱ'), 'ㄱㄱ', '쌍자음은 별도 키라 여기서 합쳐지지 않는다');
});

// ── 도깨비불 ────────────────────────────────────────────────────────────────

test('홑받침은 통째로 다음 글자 초성이 된다', () => {
  assert.equal(type('ㄱ', 'ㅏ', 'ㄱ', 'ㅏ'), '가가');
  assert.equal(type('ㅁ', 'ㅓ', 'ㄱ', 'ㅓ'), '머거');
  assert.equal(type('ㅎ', 'ㅏ', 'ㄴ', 'ㅡ', 'ㄹ'), '하늘');
});

test('겹받침은 뒤쪽만 넘어간다', () => {
  assert.equal(type('ㄱ', 'ㅏ', 'ㅂ', 'ㅅ', 'ㅣ'), '갑시');
  assert.equal(type('ㄷ', 'ㅏ', 'ㄹ', 'ㄱ', 'ㅡ'), '달그');
  assert.equal(type('ㅇ', 'ㅏ', 'ㄴ', 'ㅈ', 'ㅏ'), '안자');
});

test('실제 단어를 친 것처럼 이어진다', () => {
  assert.equal(type('ㅇ', 'ㅏ', 'ㄴ', 'ㄴ', 'ㅕ', 'ㅇ'), '안녕');
  assert.equal(type('ㄱ', 'ㅗ', 'ㅁ', 'ㅏ', 'ㅂ', 'ㅅ', 'ㅡ', 'ㅂ', 'ㄴ', 'ㅣ', 'ㄷ', 'ㅏ'), '고맙습니다');
  assert.equal(type('ㅊ', 'ㅗ', 'ㅅ', 'ㅓ', 'ㅇ'), '초성');
});

// ── 백스페이스 ──────────────────────────────────────────────────────────────

test('백스페이스는 자모 하나씩 지운다', () => {
  const c = new HangulComposer();
  for (const j of ['ㄱ', 'ㅏ', 'ㅁ']) c.insert(j);
  assert.equal(c.value, '감');

  c.backspace();
  assert.equal(c.value, '가');
  c.backspace();
  assert.equal(c.value, 'ㄱ');
  c.backspace();
  assert.equal(c.value, '');
  c.backspace();
  assert.equal(c.value, '', '빈 상태에서 더 지워도 안전하다');
});

test('겹받침·복합모음은 한 겹씩 벗겨진다', () => {
  const c = new HangulComposer();
  for (const j of ['ㄱ', 'ㅏ', 'ㅂ', 'ㅅ']) c.insert(j);
  assert.equal(c.value, '값');
  c.backspace();
  assert.equal(c.value, '갑');

  const d = new HangulComposer();
  for (const j of ['ㄱ', 'ㅗ', 'ㅏ']) d.insert(j);
  assert.equal(d.value, '과');
  d.backspace();
  assert.equal(d.value, '고');
});

test('확정된 앞 글자도 자모 단위로 풀린다', () => {
  const c = new HangulComposer();
  for (const j of ['ㄱ', 'ㅏ', 'ㅁ', 'ㅈ', 'ㅏ']) c.insert(j);
  assert.equal(c.value, '감자');

  c.backspace();
  assert.equal(c.value, '감ㅈ');
  c.backspace();
  assert.equal(c.value, '감');
  c.backspace();
  assert.equal(c.value, '가');
});

test('지운 뒤 다시 이어서 칠 수 있다', () => {
  const c = new HangulComposer();
  for (const j of ['ㄱ', 'ㅏ', 'ㅁ']) c.insert(j);
  c.backspace();
  c.insert('ㅈ');
  c.insert('ㅏ');
  assert.equal(c.value, '가자');
});

test('한글이 아닌 입력은 무시한다', () => {
  const c = new HangulComposer();
  for (const j of ['ㄱ', 'a', '1', '!', 'ㅏ']) c.insert(j);
  assert.equal(c.value, '가');
});

test('글자 수를 센다', () => {
  const c = new HangulComposer();
  assert.equal(c.length, 0);
  c.insert('ㄱ');
  assert.equal(c.length, 1, '조합 중인 글자도 한 글자로 센다');
  c.insert('ㅏ');
  c.insert('ㅁ');
  c.insert('ㅈ');
  c.insert('ㅏ');
  assert.equal(c.length, 2);
});

test('비우면 처음 상태로 돌아간다', () => {
  const c = new HangulComposer();
  for (const j of ['ㄱ', 'ㅏ', 'ㅁ', 'ㅈ', 'ㅏ']) c.insert(j);
  c.clear();
  assert.equal(c.value, '');
  c.insert('ㄴ');
  assert.equal(c.value, 'ㄴ');
});
