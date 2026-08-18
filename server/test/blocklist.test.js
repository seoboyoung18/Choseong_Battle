/**
 * 사전 필터 — 여기가 새면 부적절한 낱말이 문제로 나가고,
 * 여기가 과하면 멀쩡한 낱말이 "없는 단어"가 된다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isHangulWord } from '../src/judge/hangul.js';
import {
  BLOCKED,
  DEROGATORY_MARKERS,
  NOT_SERVED,
  applyBlocklist,
  isDerogatory,
} from '../src/words/blocklist.js';

test('낮춤말 표시를 뜻풀이에서 잡는다', () => {
  assert.equal(isDerogatory('사람을 낮잡아 이르는 말.'), true);
  assert.equal(isDerogatory('아주 비속하게 이르는 말.'), true);
  assert.equal(isDerogatory('어리석은 사람을 속되게 이르는 말.'), true);
});

test('평범한 뜻풀이는 잡지 않는다', () => {
  assert.equal(isDerogatory('실내의 온도를 낮추어 주는 기계.'), false, "'낮추어'는 표시가 아니다");
  assert.equal(isDerogatory('감자를 튀겨 만든 과자.'), false);
  assert.equal(isDerogatory(''), false);
  assert.equal(isDerogatory(undefined), false);
});

test('표시 목록에 낮추어는 없다', () => {
  // 한 번 넣었다가 냉방기·묵찌빠가 걸려서 뺐다. 다시 들어오면 여기서 걸린다.
  assert.equal(DEROGATORY_MARKERS.includes('낮추어'), false);
});

test('목록의 낱말은 사전에 있을 법한 모양이다', () => {
  // 오타나 한 글자짜리가 섞이면 그 줄은 아무것도 막지 못한 채 목록에만 남는다
  for (const word of [...BLOCKED, ...NOT_SERVED]) {
    assert.ok(isHangulWord(word), `'${word}'가 완성형 한글이 아니다`);
    assert.ok(word.length >= 2 && word.length <= 4, `'${word}'는 2~4글자가 아니다 (판정 대상 밖)`);
  }
});

test('목록 안에도, 목록끼리도 겹치지 않는다', () => {
  assert.equal(new Set(BLOCKED).size, BLOCKED.length);
  assert.equal(new Set(NOT_SERVED).size, NOT_SERVED.length);
  const both = BLOCKED.filter((w) => NOT_SERVED.includes(w));
  assert.deepEqual(both, [], '완전 차단과 출제 금지에 같은 낱말이 있다');
});

test('완전 차단은 노골적 욕설에만 쓴다', () => {
  // 판정에서 인정하면 그 낱말이 정답 바에 실려 방 전체에 뜬다. 그 통로를 막는
  // 게 전부이므로, 목록이 길어졌다면 기준이 흐트러진 것이다.
  assert.ok(BLOCKED.length <= 40, `완전 차단이 ${BLOCKED.length}개로 늘었다 — 기준을 다시 볼 것`);
  for (const word of ['병신', '씨발', '개새끼']) {
    assert.ok(BLOCKED.includes(word), `'${word}'가 완전 차단에 없다`);
  }
});

test('평범한 뜻이 있는 낱말은 판정에서 막지 않는다', () => {
  // 걸레는 닦는 천이고 새끼는 동물의 아기다. 사전에 있는 말을 쳤는데
  // "없는 단어"라고 답하면 그건 거짓말이다.
  for (const word of ['걸레', '새끼', '호구', '기생', '내기', '정사', '폭탄']) {
    assert.equal(BLOCKED.includes(word), false, `'${word}'를 판정에서 막고 있다`);
    assert.equal(NOT_SERVED.includes(word), false, `'${word}'를 목록에 적을 이유가 없다`);
  }
});

test('무거운 주제는 출제만 막고 판정은 인정한다', () => {
  // 자살도 마약도 뉴스와 교과서에 나오는 낱말이다. 문제로 내지 않을 뿐이다.
  for (const word of ['자살', '마약', '살인', '강간', '도박']) {
    assert.ok(NOT_SERVED.includes(word), `'${word}'가 출제 금지 목록에 없다`);
    assert.equal(BLOCKED.includes(word), false, `'${word}'를 판정에서까지 막고 있다`);
  }
});

test('사전이 이미 표시한 차별어는 손 목록에 없다', () => {
  // 귀머거리·장님·바보는 뜻풀이의 '낮잡아' 표시로 자동으로 걸러진다.
  // 손으로 또 적으면 두 곳을 따로 고쳐야 하고 결국 어긋난다.
  for (const word of ['귀머거리', '장님', '바보', '촌놈', '가난뱅이']) {
    assert.equal(NOT_SERVED.includes(word), false, `'${word}'는 사전 표시로 이미 걸러진다`);
    assert.equal(BLOCKED.includes(word), false);
  }
});

test('적용은 되살리기 → 차단 → 출제 금지 순서로 돈다', async () => {
  const calls = [];
  const db = {
    query: (sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve({ rowCount: calls.length });
    },
  };

  const result = await applyBlocklist(db);
  assert.deepEqual(result, { restored: 1, banned: 2, unserved: 3 });
  assert.equal(calls.length, 3);

  // 1) 기준에서 빠진 낱말 되살리기 — 신고로 막은 것은 건드리지 않는다
  assert.match(calls[0].sql, /SET status = 'ACTIVE'/);
  assert.match(calls[0].sql, /source <> 'REPORT'/);
  assert.deepEqual(calls[0].params[0], [...BLOCKED]);

  // 2) 완전 차단 — 차단하면서 출제 풀에서도 뺀다
  assert.match(calls[1].sql, /SET status = 'BANNED', is_curated = false/);
  assert.deepEqual(calls[1].params[0], [...BLOCKED]);

  // 3) 출제 금지 — status는 건드리지 않는다 (판정은 인정)
  assert.match(calls[2].sql, /SET is_curated = false/);
  assert.doesNotMatch(calls[2].sql, /status/, '출제만 막아야 하는데 판정까지 끄고 있다');
  assert.deepEqual(calls[2].params[0], [...NOT_SERVED]);
});
