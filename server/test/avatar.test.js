/**
 * 캐릭터 파츠 카탈로그 — 해금 검사가 유일한 방어선이라 여기서 확실히 잡는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AVATAR_PARTS,
  AVATAR_SLOTS,
  DEFAULT_APPEARANCE,
  findPart,
  isUnlocked,
  normalizeAppearance,
  unlockLabel,
  unlockRemaining,
  validateAppearance,
} from '../../shared/avatar.js';

const NOTHING = { roundWins: 0, games: 0, practiceStreak: 0 };
const EVERYTHING = { roundWins: 999, games: 999, practiceStreak: 999 };

test('기본 캐릭터는 해금 조건이 없는 파츠로만 이뤄진다', () => {
  // 새 계정이 잠긴 옷을 입고 나오면 저장할 때마다 거절당한다
  for (const { slot } of AVATAR_SLOTS) {
    const part = findPart(slot, DEFAULT_APPEARANCE[slot]);
    assert.ok(part, `${slot} 기본 파츠가 카탈로그에 없다`);
    assert.ok(isUnlocked(part, NOTHING), `${slot} 기본 파츠가 잠겨 있다`);
  }
});

test('칸마다 파츠가 있고 id는 겹치지 않는다', () => {
  for (const { slot } of AVATAR_SLOTS) {
    const list = AVATAR_PARTS[slot];
    assert.ok(list?.length > 0, `${slot}에 파츠가 없다`);
    assert.equal(new Set(list.map((p) => p.id)).size, list.length, `${slot} id가 겹친다`);
  }
});

test('잠긴 파츠도 조건을 채우면 열린다', () => {
  const locked = Object.values(AVATAR_PARTS).flat().filter((p) => p.unlock);
  assert.ok(locked.length > 0, '해금 파츠가 하나도 없다');

  for (const part of locked) {
    assert.equal(isUnlocked(part, NOTHING), false, `${part.id}가 조건 없이 열려 있다`);
    assert.equal(isUnlocked(part, EVERYTHING), true, `${part.id}가 조건을 채워도 안 열린다`);
    assert.ok(unlockLabel(part).length > 0, `${part.id} 해금 문구가 비었다`);
  }
});

test('남은 양은 진행도만큼 줄고 0에서 멈춘다', () => {
  const fox = findPart('base', 'FOX'); // 라운드 20승
  assert.equal(unlockRemaining(fox, NOTHING), 20);
  assert.equal(unlockRemaining(fox, { roundWins: 7 }), 13);
  assert.equal(unlockRemaining(fox, { roundWins: 20 }), 0);
  assert.equal(unlockRemaining(fox, { roundWins: 50 }), 0);
  assert.equal(unlockRemaining(findPart('base', 'RABBIT'), NOTHING), 0, '조건 없는 파츠는 0이어야 한다');
});

test('모르는 해금 조건은 잠긴 것으로 본다', () => {
  // 조건 종류를 새로 만들고 판정을 빠뜨렸을 때 열리는 쪽으로 새면 안 된다
  assert.equal(isUnlocked({ unlock: { type: 'SOMETHING_NEW', value: 1 } }, EVERYTHING), false);
});

test('남의 캐릭터는 없는 파츠만 기본값으로 떨어뜨린다', () => {
  const out = normalizeAppearance({ base: 'CAT', hanbok: '없는색', head: 'GAT' });
  assert.equal(out.base, 'CAT');
  assert.equal(out.hanbok, DEFAULT_APPEARANCE.hanbok);
  assert.equal(out.head, 'GAT', '남의 해금 파츠까지 지우면 안 된다');
  assert.equal(out.face, DEFAULT_APPEARANCE.face, '안 보낸 칸은 기본값이어야 한다');
});

test('아무것도 없는 값도 기본 캐릭터로 떨어진다', () => {
  for (const bad of [null, undefined, 'CAT', 42, []]) {
    assert.deepEqual(normalizeAppearance(bad), { ...DEFAULT_APPEARANCE });
  }
});

test('내 캐릭터 저장은 잠긴 파츠를 거절한다', () => {
  const locked = validateAppearance({ base: 'TIGER' }, NOTHING);
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, 'LOCKED');
  assert.equal(locked.slot, 'base');

  const opened = validateAppearance({ base: 'TIGER' }, { roundWins: 60 });
  assert.equal(opened.ok, true);
  assert.equal(opened.appearance.base, 'TIGER');
});

test('없는 파츠는 조용히 기본값으로 바꾸지 않고 거절한다', () => {
  // 오타를 조용히 삼키면 유저는 저장됐다고 믿고 다른 캐릭터를 보게 된다
  const result = validateAppearance({ head: 'CROWN' }, EVERYTHING);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'UNKNOWN');
  assert.equal(result.slot, 'head');
});

test('안 보낸 칸은 기본값으로 채운다', () => {
  const result = validateAppearance({ base: 'BEAR' }, NOTHING);
  assert.equal(result.ok, true);
  assert.deepEqual(result.appearance, { ...DEFAULT_APPEARANCE, base: 'BEAR' });
});

test('알 수 없는 칸은 무시한다 — 저장 대상은 정해진 다섯 칸뿐이다', () => {
  const result = validateAppearance({ base: 'BEAR', wings: 'DRAGON' }, NOTHING);
  assert.equal(result.ok, true);
  assert.equal(result.appearance.wings, undefined);
});
