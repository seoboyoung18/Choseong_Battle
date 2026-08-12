import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHO_LIST,
  JUNG_LIST,
  JONG_LIST,
  choSequence,
  composeChar,
  decomposeChar,
  decomposeWord,
  isCompleteHangul,
  isHangulWord,
  jungSequence,
} from '../src/judge/hangul.js';

test('자모 목록 길이는 유니코드 분해식과 맞는다', () => {
  assert.equal(CHO_LIST.length, 19);
  assert.equal(JUNG_LIST.length, 21);
  assert.equal(JONG_LIST.length, 28);
});

test('완성형 한글만 통과한다', () => {
  assert.ok(isCompleteHangul('가'));
  assert.ok(isCompleteHangul('힣'));
  assert.ok(!isCompleteHangul('ㄱ'), '자모 낱글자는 완성형이 아니다');
  assert.ok(!isCompleteHangul('ㅏ'));
  assert.ok(!isCompleteHangul('a'));
  assert.ok(!isCompleteHangul('1'));
  assert.ok(!isCompleteHangul(''));
});

test('단어 단위 한글 검사는 이물질을 걸러낸다', () => {
  assert.ok(isHangulWord('감자'));
  assert.ok(!isHangulWord('감자1'));
  assert.ok(!isHangulWord('감 자'), '공백도 불허 — 붙여쓰기 단어만 인정');
  assert.ok(!isHangulWord('nice'));
  assert.ok(!isHangulWord(''));
  assert.ok(!isHangulWord(null));
});

test('받침 없는 글자 · 홑받침 · 겹받침을 모두 분해한다', () => {
  assert.deepEqual(decomposeChar('가'), { cho: 'ㄱ', jung: 'ㅏ', jong: '' });
  assert.deepEqual(decomposeChar('감'), { cho: 'ㄱ', jung: 'ㅏ', jong: 'ㅁ' });
  assert.deepEqual(decomposeChar('값'), { cho: 'ㄱ', jung: 'ㅏ', jong: 'ㅄ' });
  assert.deepEqual(decomposeChar('닭'), { cho: 'ㄷ', jung: 'ㅏ', jong: 'ㄺ' });
  assert.deepEqual(decomposeChar('꽃'), { cho: 'ㄲ', jung: 'ㅗ', jong: 'ㅊ' });
  assert.deepEqual(decomposeChar('왜'), { cho: 'ㅇ', jung: 'ㅙ', jong: '' });
  assert.deepEqual(decomposeChar('힣'), { cho: 'ㅎ', jung: 'ㅣ', jong: 'ㅎ' });
});

test('완성형이 아니면 분해는 예외를 던진다', () => {
  assert.throws(() => decomposeChar('ㄱ'), TypeError);
  assert.throws(() => decomposeChar('a'), TypeError);
});

test('분해 → 조합은 원래 글자로 돌아온다 (전 음절 왕복 검증)', () => {
  for (let code = 0xac00; code <= 0xd7a3; code += 1) {
    const ch = String.fromCharCode(code);
    const { cho, jung, jong } = decomposeChar(ch);
    assert.equal(composeChar(cho, jung, jong), ch);
  }
});

test('조합은 알 수 없는 자모를 거부한다', () => {
  assert.throws(() => composeChar('ㅏ', 'ㅏ'), TypeError, '초성 자리에 모음');
  assert.throws(() => composeChar('ㄱ', 'ㄱ'), TypeError, '중성 자리에 자음');
  assert.throws(() => composeChar('ㄱ', 'ㅏ', 'ㄸ'), TypeError, 'ㄸ은 종성이 될 수 없다');
});

test('초성열·중성열을 뽑는다', () => {
  assert.equal(choSequence('감자'), 'ㄱㅈ');
  assert.equal(jungSequence('감자'), 'ㅏㅏ');
  assert.equal(choSequence('화장품'), 'ㅎㅈㅍ');
  assert.equal(jungSequence('화장품'), 'ㅘㅏㅜ');
  assert.equal(choSequence('꽃'), 'ㄲ', '쌍자음은 그대로 노출한다');
});

test('단어 분해는 글자 수만큼 나온다', () => {
  assert.equal(decomposeWord('화장품').length, 3);
});
