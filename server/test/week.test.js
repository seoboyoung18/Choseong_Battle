import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidWeek, rangeOfWeek, weekOf } from '../src/ranking/week.js';

/** KST 시각을 UTC Date로 만든다 (KST = UTC+9) */
const kst = (iso) => new Date(`${iso}+09:00`);

test('주는 월요일 00:00 KST에 시작한다', () => {
  // 2026-08-14는 금요일 → 그 주 월요일은 08-10
  const { start, end } = weekOf(kst('2026-08-14T13:00:00'));
  assert.equal(start.toISOString(), kst('2026-08-10T00:00:00').toISOString());
  assert.equal(end.toISOString(), kst('2026-08-17T00:00:00').toISOString());
});

test('일요일은 지난 월요일에 속한다 (주의 마지막 날)', () => {
  const { start } = weekOf(kst('2026-08-16T23:59:59'));
  assert.equal(start.toISOString(), kst('2026-08-10T00:00:00').toISOString());
});

test('월요일 자정을 넘기면 다음 주가 된다', () => {
  const before = weekOf(kst('2026-08-16T23:59:59'));
  const after = weekOf(kst('2026-08-17T00:00:00'));
  assert.notEqual(before.week, after.week, '리셋 경계가 동작하지 않는다');
  assert.equal(after.start.toISOString(), kst('2026-08-17T00:00:00').toISOString());
});

test('경계는 KST 기준이다 — 서버가 UTC로 떠 있어도 같아야 한다', () => {
  // UTC로는 아직 일요일 16:00이지만 KST로는 이미 월요일 01:00 → 새 주
  const utcSunday = new Date('2026-08-16T16:00:00Z');
  const { start } = weekOf(utcSunday);
  assert.equal(
    start.toISOString(),
    kst('2026-08-17T00:00:00').toISOString(),
    'UTC 기준으로 주가 갈렸다 — KST 자정이 경계여야 한다',
  );
});

test('주차 표기는 ISO 형식이다', () => {
  assert.match(weekOf(kst('2026-08-14T13:00:00')).week, /^\d{4}-W\d{2}$/);
  assert.equal(weekOf(kst('2026-01-05T00:00:00')).week, '2026-W02');
});

test('연속한 주는 번호가 1씩 오른다', () => {
  const a = weekOf(kst('2026-08-10T00:00:00')).week;
  const b = weekOf(kst('2026-08-17T00:00:00')).week;
  const c = weekOf(kst('2026-08-24T00:00:00')).week;
  const num = (w) => Number(w.split('-W')[1]);
  assert.equal(num(b) - num(a), 1);
  assert.equal(num(c) - num(b), 1);
});

test('주차 표기 검사', () => {
  assert.ok(isValidWeek('2026-W33'));
  assert.ok(!isValidWeek('2026-W3'), '두 자리로 채워야 한다');
  assert.ok(!isValidWeek('2026W33'));
  assert.ok(!isValidWeek("2026-W33'; DROP TABLE users;--"));
  assert.ok(!isValidWeek(null));
});

test('주차 표기로 기간을 되돌린다', () => {
  const original = weekOf(kst('2026-08-14T13:00:00'));
  const restored = rangeOfWeek(original.week);

  assert.equal(restored.week, original.week);
  assert.equal(restored.start.toISOString(), original.start.toISOString());
  assert.equal(restored.end.toISOString(), original.end.toISOString());
});

test('여러 주를 왕복해도 어긋나지 않는다', () => {
  for (let i = 0; i < 60; i += 1) {
    const at = kst('2026-01-01T12:00:00');
    at.setUTCDate(at.getUTCDate() + i * 7);
    const original = weekOf(at);
    const restored = rangeOfWeek(original.week);
    assert.equal(restored.start.toISOString(), original.start.toISOString(), `주차 ${original.week}`);
  }
});

test('잘못된 주차 표기는 null이다', () => {
  assert.equal(rangeOfWeek('nope'), null);
  assert.equal(rangeOfWeek(''), null);
});
