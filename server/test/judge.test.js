import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY,
  HINT_TYPE,
  buildHint,
  formatHint,
  matchHint,
  resolveHintType,
} from '../src/judge/hint.js';
import { REJECT_REASON, judgeByDict, judgeSubmission } from '../src/judge/index.js';

/** 미리 정한 값을 순서대로 뱉는 난수원 — 힌트 생성 검증용 */
function seededRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('CHO 힌트는 전 글자의 초성을 공개한다', () => {
  assert.deepEqual(buildHint('감자', HINT_TYPE.CHO), [
    { type: 'CHO', value: 'ㄱ' },
    { type: 'CHO', value: 'ㅈ' },
  ]);
});

test('JUNG 힌트는 전 글자의 중성을 공개한다', () => {
  assert.deepEqual(buildHint('사전', HINT_TYPE.JUNG), [
    { type: 'JUNG', value: 'ㅏ' },
    { type: 'JUNG', value: 'ㅓ' },
  ]);
});

test('MIX 힌트는 글자마다 초성 또는 중성을 공개한다', () => {
  // rng < 0.5 → CHO, 그 외 → JUNG
  assert.deepEqual(buildHint('라테', HINT_TYPE.MIX, seededRng([0.1, 0.9])), [
    { type: 'CHO', value: 'ㄹ' },
    { type: 'JUNG', value: 'ㅔ' },
  ]);
});

test('MIX가 한쪽으로 쏠리면 한 자리를 반대로 뒤집는다', () => {
  // 전부 CHO로 뽑히지만(0.1, 0.1) 보정이 들어가 JUNG이 최소 1개 생긴다
  const hint = buildHint('감자', HINT_TYPE.MIX, seededRng([0.1, 0.1, 0]));
  const types = hint.map((s) => s.type);
  assert.ok(types.includes('CHO') && types.includes('JUNG'), `쏠림 보정 실패: ${types}`);
});

test('OPEN 힌트는 한 글자만 통째로 공개하고 나머지는 빈칸이다', () => {
  const hint = buildHint('화장품', HINT_TYPE.OPEN, seededRng([0.4])); // idx 1
  assert.deepEqual(hint, [{ type: 'BLANK' }, { type: 'OPEN', value: '장' }, { type: 'BLANK' }]);
  assert.equal(formatHint(hint), '⬜ 장 ⬜');
});

test('힌트에는 겹받침이 절대 등장하지 않는다', () => {
  for (const type of [HINT_TYPE.CHO, HINT_TYPE.JUNG, HINT_TYPE.MIX]) {
    for (const word of ['값싼', '닭갈비', '삶은']) {
      for (const slot of buildHint(word, type)) {
        assert.ok(!'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'.includes(slot.value), `${word}/${type}: ${slot.value}`);
      }
    }
  }
});

test('ALL 카테고리는 힌트 타입 4종 중 하나로 확정된다', () => {
  assert.equal(resolveHintType(CATEGORY.ALL, seededRng([0])), HINT_TYPE.CHO);
  assert.equal(resolveHintType(CATEGORY.ALL, seededRng([0.99])), HINT_TYPE.OPEN);
  assert.equal(resolveHintType(CATEGORY.CHO), HINT_TYPE.CHO, '단일 카테고리는 그대로');
  assert.throws(() => resolveHintType('NOPE'), TypeError);
});

test('패턴 대조는 글자 수와 자모를 본다', () => {
  const hint = buildHint('감자', HINT_TYPE.CHO); // ㄱㅈ

  assert.deepEqual(matchHint('간장', hint), { ok: true }, '같은 초성이면 다른 단어도 통과');
  assert.deepEqual(matchHint('과자', hint), { ok: true });
  assert.deepEqual(matchHint('사과', hint), { ok: false, reason: 'PATTERN_MISMATCH' });
  assert.deepEqual(matchHint('강', hint), { ok: false, reason: 'LENGTH_MISMATCH' });
  assert.deepEqual(matchHint('감자탕', hint), { ok: false, reason: 'LENGTH_MISMATCH' });
});

test('OPEN 패턴은 공개된 글자 자리만 강제하고 빈칸은 자유다', () => {
  const hint = [{ type: 'BLANK' }, { type: 'OPEN', value: '장' }, { type: 'BLANK' }];
  assert.deepEqual(matchHint('화장품', hint), { ok: true });
  assert.deepEqual(matchHint('소장품', hint), { ok: true });
  assert.deepEqual(matchHint('화학품', hint), { ok: false, reason: 'PATTERN_MISMATCH' });
});

test('쌍자음 초성은 홑자음과 구분된다', () => {
  const hint = buildHint('꽃', HINT_TYPE.CHO); // ㄲ
  assert.deepEqual(matchHint('꽃', hint), { ok: true });
  assert.deepEqual(matchHint('곳', hint), { ok: false, reason: 'PATTERN_MISMATCH' });
});

// --- 통합 판정 -------------------------------------------------------------

const dictionary = new Set(['감자', '간장', '과자', '기적', '화장품', '라테']);
const hintGaJa = [
  { type: 'CHO', value: 'ㄱ' },
  { type: 'CHO', value: 'ㅈ' },
];

test('패턴이 맞고 사전에 있으면 정답이다', () => {
  assert.deepEqual(judgeByDict({ word: '감자', hint: hintGaJa, dictionary }), {
    ok: true,
    word: '감자',
  });
  assert.deepEqual(judgeByDict({ word: '과자', hint: hintGaJa, dictionary }), {
    ok: true,
    word: '과자',
  });
});

test('앞뒤 공백은 다듬어 받아준다', () => {
  assert.deepEqual(judgeByDict({ word: '  감자 ', hint: hintGaJa, dictionary }), {
    ok: true,
    word: '감자',
  });
});

test('거절 사유는 앞 관문부터 순서대로 판정된다', () => {
  const cases = [
    ['gamja', REJECT_REASON.NOT_HANGUL],
    ['감자1', REJECT_REASON.NOT_HANGUL],
    ['ㄱㅈ', REJECT_REASON.NOT_HANGUL],
    ['', REJECT_REASON.NOT_HANGUL],
    ['강', REJECT_REASON.LENGTH_MISMATCH],
    ['사과', REJECT_REASON.PATTERN_MISMATCH],
    ['가지', REJECT_REASON.NOT_IN_DICT], // 패턴은 맞지만 미등재
  ];
  for (const [word, reason] of cases) {
    assert.deepEqual(
      judgeByDict({ word, hint: hintGaJa, dictionary }),
      { ok: false, reason },
      `입력 ${JSON.stringify(word)}`,
    );
  }
});

test('사전에 있어도 패턴이 다르면 거절한다', () => {
  assert.deepEqual(judgeByDict({ word: '화장품', hint: hintGaJa, dictionary }), {
    ok: false,
    reason: REJECT_REASON.LENGTH_MISMATCH,
  });
});

test('judgeType FIXED는 지정 정답만 인정한다', () => {
  const params = { judgeType: 'FIXED', answers: ['대한민국', '한국'] };
  assert.deepEqual(judgeSubmission({ word: '한국', ...params }), { ok: true, word: '한국' });
  assert.deepEqual(judgeSubmission({ word: '일본', ...params }), {
    ok: false,
    reason: REJECT_REASON.NOT_IN_DICT,
  });
});

test('judgeType 기본값은 DICT다', () => {
  assert.deepEqual(judgeSubmission({ word: '감자', hint: hintGaJa, dictionary }), {
    ok: true,
    word: '감자',
  });
});

test('생성한 힌트는 원본 단어를 반드시 통과시킨다 (전 타입 왕복 검증)', () => {
  const words = ['감자', '사전', '라테', '화장품', '무지개', '꽃병', '값어치'];
  for (const word of words) {
    for (const type of Object.values(HINT_TYPE)) {
      if (type === HINT_TYPE.OPEN && word.length < 3) continue;
      for (let i = 0; i < 20; i += 1) {
        const hint = buildHint(word, type);
        assert.deepEqual(matchHint(word, hint), { ok: true }, `${word} / ${type} / ${formatHint(hint)}`);
      }
    }
  }
});
