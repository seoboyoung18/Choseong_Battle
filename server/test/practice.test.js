/**
 * 혼자 연습 테스트. DB도 Redis도 쓰지 않는다 — 순수 상태 기계라
 * 시계만 주입하면 3초 단계도 즉시 검증할 수 있다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRACTICE_TIERS } from '../src/config.js';
import { PracticeSession } from '../src/game/practice.js';
import { Dictionary } from '../src/words/dictionary.js';

/** 가상 시계 — 주입한 now/timers가 이 시계를 본다 */
function createClock(start = 1_700_000_000_000) {
  let now = start;
  let seq = 0;
  const tasks = new Map();

  return {
    now: () => now,
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++seq;
        tasks.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimeout: (id) => tasks.delete(id),
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...tasks.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, task] = due[0];
        tasks.delete(id);
        now = Math.max(now, task.at);
        task.fn();
      }
      now = target;
    },
  };
}

function createEmit() {
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });
  emit.events = events;
  emit.last = (event) => [...events].reverse().find((e) => e.event === event)?.payload;
  emit.count = (event) => events.filter((e) => e.event === event).length;
  return emit;
}

const WORDS = ['감자', '간장', '과자', '기적', '사과', '학교', '친구', '바다', '하늘', '구름'];
const createDictionary = () =>
  new Dictionary(WORDS.map((text) => ({ text, is_curated: true })));

function createSession({ tier = 'T8S', category = 'CHO', clock = createClock(), emit = createEmit() } = {}) {
  const session = new PracticeSession({
    userId: 1,
    category,
    tier,
    dictionary: createDictionary(),
    emit,
    now: clock.now,
    timers: clock.timers,
  });
  return { session, clock, emit };
}

test('알 수 없는 단계는 거부한다', () => {
  assert.throws(
    () => new PracticeSession({ userId: 1, category: 'CHO', tier: 'NOPE', dictionary: createDictionary(), emit: () => {} }),
    TypeError,
  );
});

test('시작하면 첫 문제가 나가고 마감 시각이 붙는다', () => {
  const { session, emit } = createSession({ tier: 'T8S' });
  session.start();

  const q = emit.last('practice.question');
  assert.ok(Array.isArray(q.hint) && q.hint.length >= 2);
  assert.equal(q.streak, 0);
  assert.equal(q.deadlineTs, session.question.startedAt + PRACTICE_TIERS.T8S.limitMs);
  assert.ok(!('word' in q), '정답이 문제에 실려 나갔다');
});

test('자유 단계에는 제한시간이 없다', () => {
  const { session, clock, emit } = createSession({ tier: 'FREE' });
  session.start();

  assert.equal(emit.last('practice.question').deadlineTs, null);

  // 한참 지나도 끝나지 않아야 한다
  clock.advance(60_000);
  assert.equal(emit.count('practice.ended'), 0);
  assert.equal(session.ended, false);
});

test('정답을 맞히면 연속 기록이 오르고 다음 문제가 나간다', () => {
  const { session, emit } = createSession();
  session.start();

  session.submit(session.question.word);
  assert.equal(emit.last('practice.correct').streak, 1);
  assert.equal(emit.count('practice.question'), 2);

  session.submit(session.question.word);
  assert.equal(emit.last('practice.correct').streak, 2);
  assert.equal(session.streak, 2);
});

test('같은 문제가 다시 나오지 않는다', () => {
  const { session, emit } = createSession({ tier: 'FREE' });
  session.start();

  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    seen.add(session.question.word);
    session.submit(session.question.word);
  }
  assert.equal(seen.size, 5, '같은 단어가 반복 출제됐다');
  assert.equal(emit.count('practice.correct'), 5);
});

test('시간제 단계는 오답 하나로 끝난다', () => {
  const { session, emit } = createSession({ tier: 'T5S' });
  session.start();
  session.submit(session.question.word); // 1연속

  session.submit('없는단어');

  // 어떤 사유로 걸리든(길이·패턴·미등재) 시간제 단계에서는 그대로 끝이다
  assert.ok(emit.last('practice.rejected').reason);
  const ended = emit.last('practice.ended');
  assert.equal(ended.reason, 'WRONG');
  assert.equal(ended.streak, 1);
  assert.ok(ended.answer, '못 맞힌 문제의 답을 알려줘야 한다');
});

test('자유 단계는 틀려도 이어진다', () => {
  const { session, emit } = createSession({ tier: 'FREE' });
  session.start();
  const word = session.question.word;

  session.submit('없는단어');
  assert.equal(emit.count('practice.ended'), 0, '자유 단계가 오답으로 끝났다');
  assert.equal(session.question.word, word, '문제가 바뀌면 안 된다');

  session.submit(word);
  assert.equal(session.streak, 1);
});

test('시간이 지나면 끝난다', () => {
  const { session, clock, emit } = createSession({ tier: 'T3S' });
  session.start();
  session.submit(session.question.word); // 1연속

  clock.advance(PRACTICE_TIERS.T3S.limitMs);

  const ended = emit.last('practice.ended');
  assert.equal(ended.reason, 'TIMEOUT');
  assert.equal(ended.streak, 1);
});

test('정답을 맞히면 타이머가 새로 시작된다', () => {
  const { session, clock, emit } = createSession({ tier: 'T5S' });
  session.start();

  clock.advance(4_000); // 아직 안 끝남
  session.submit(session.question.word);
  clock.advance(4_000); // 새 문제 기준으로는 아직 여유

  assert.equal(emit.count('practice.ended'), 0, '이전 문제의 타이머가 남아 있다');
  assert.equal(session.streak, 1);
});

test('패스는 자유 단계에서만 동작한다', () => {
  const free = createSession({ tier: 'FREE' });
  free.session.start();
  const before = free.session.question.word;
  free.session.pass();
  assert.notEqual(free.session.question.word, before, '패스로 문제가 바뀌지 않았다');
  assert.equal(free.session.streak, 0, '패스는 연속 기록을 올리지 않는다');

  const timed = createSession({ tier: 'T8S' });
  timed.session.start();
  const timedWord = timed.session.question.word;
  timed.session.pass();
  assert.equal(timed.session.question.word, timedWord, '시간제 단계에서 패스가 먹혔다');
});

test('그만두면 답을 알려주지 않는다', () => {
  const { session, emit } = createSession({ tier: 'T8S' });
  session.start();
  session.quit();

  const ended = emit.last('practice.ended');
  assert.equal(ended.reason, 'QUIT');
  assert.equal(ended.answer, null, '포기했는데 답을 알려주면 답 훔쳐보기가 된다');
});

test('끝난 세션은 더 반응하지 않는다', () => {
  const { session, clock, emit } = createSession({ tier: 'T5S' });
  session.start();
  session.quit();

  const endedCount = emit.count('practice.ended');
  session.submit(session.question.word);
  clock.advance(10_000);

  assert.equal(emit.count('practice.ended'), endedCount, '종료가 두 번 발생했다');
  assert.equal(session.streak, 0);
});

test('낼 문제가 떨어지면 실패가 아니라 정상 종료다', () => {
  const emit = createEmit();
  const clock = createClock();
  const session = new PracticeSession({
    userId: 1,
    category: 'CHO',
    tier: 'T8S',
    dictionary: new Dictionary([{ text: '감자', is_curated: true }]),
    emit,
    now: clock.now,
    timers: clock.timers,
  });

  session.start();
  session.submit('감자');

  const ended = emit.last('practice.ended');
  assert.equal(ended.reason, 'QUIT', '단어가 떨어진 걸 실패로 처리했다');
  assert.equal(ended.streak, 1, '맞힌 기록은 남아야 한다');
});

test('판정은 멀티플레이와 같은 규칙을 쓴다', () => {
  const { session, emit } = createSession({ tier: 'FREE', category: 'CHO' });
  session.start();

  // 힌트 패턴은 맞지만 사전에 없는 단어
  session.submit('없는말');
  assert.ok(['NOT_IN_DICT', 'PATTERN_MISMATCH', 'LENGTH_MISMATCH'].includes(emit.last('practice.rejected').reason));

  // 한글이 아닌 입력
  session.submit('abc');
  assert.equal(emit.last('practice.rejected').reason, 'NOT_HANGUL');
});
