/**
 * 사전 필터 — 여기가 새면 부적절한 낱말이 문제로 나간다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isHangulWord } from '../src/judge/hangul.js';
import { BLOCKED, DEROGATORY_MARKERS, applyBlocklist, isDerogatory } from '../src/words/blocklist.js';

test('낮춤말 표시를 뜻풀이에서 잡는다', () => {
  assert.equal(isDerogatory('사람을 낮잡아 이르는 말.'), true);
  assert.equal(isDerogatory('아주 비속하게 이르는 말.'), true);
  assert.equal(isDerogatory('어리석은 사람을 속되게 이르는 말.'), true);
});

test('평범한 뜻풀이는 잡지 않는다', () => {
  assert.equal(isDerogatory('실내의 온도를 낮추어 주는 기계.'), false, "'낮추어'는 표시가 아니다");
  assert.equal(isDerogatory('말하는 이가 듣는 이에게 말을 낮추어 하는 방식.'), false);
  assert.equal(isDerogatory('감자를 튀겨 만든 과자.'), false);
  assert.equal(isDerogatory(''), false);
  assert.equal(isDerogatory(undefined), false);
});

test('표시 목록에 낮추어는 없다', () => {
  // 한 번 넣었다가 냉방기·묵찌빠가 걸려서 뺐다. 다시 들어오면 여기서 걸린다.
  assert.equal(DEROGATORY_MARKERS.includes('낮추어'), false);
});

test('차단 목록은 사전에 실제로 있을 법한 모양이다', () => {
  // 오타나 한자가 섞이면 그 줄은 아무것도 막지 못한 채 목록에만 남는다
  for (const word of BLOCKED) {
    assert.ok(isHangulWord(word), `'${word}'가 완성형 한글이 아니다`);
    assert.ok(word.length >= 2 && word.length <= 4, `'${word}'는 2~4글자가 아니다 (출제 대상 밖)`);
  }
});

test('차단 목록에 중복이 없다', () => {
  assert.equal(new Set(BLOCKED).size, BLOCKED.length);
});

test('막아야 할 낱말이 목록에 있다', () => {
  for (const word of ['자살', '마약', '강간', '병신', '새끼', '걸레']) {
    assert.ok(BLOCKED.includes(word), `'${word}'가 차단 목록에 없다`);
  }
});

test('평범한 동음이의어는 막지 않는다', () => {
  // 기생(寄生)·내기·정사(政事)처럼 다른 뜻으로 훨씬 자주 쓰는 말까지 지우면
  // 멀쩡한 낱말이 사전에서 사라진다
  for (const word of ['기생', '내기', '정사', '축구', '봉사']) {
    assert.equal(BLOCKED.includes(word), false, `'${word}'는 막을 낱말이 아니다`);
  }
});

test('차단은 출제와 판정을 함께 끈다', async () => {
  const calls = [];
  const db = {
    query: (sql, params) => {
      calls.push({ sql, params });
      return Promise.resolve({ rowCount: 3 });
    },
  };

  const result = await applyBlocklist(db);
  assert.equal(result.banned, 3);

  const { sql, params } = calls[0];
  assert.match(sql, /status = 'BANNED'/);
  assert.match(sql, /is_curated = false/, '차단하면서 출제 풀에서도 빼야 한다');
  assert.deepEqual(params[0], [...BLOCKED]);
});
