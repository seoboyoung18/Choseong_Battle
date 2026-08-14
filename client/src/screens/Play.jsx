/**
 * 게임 화면.
 *
 * 입력은 자체 키보드로만 받는다 — 오토마타가 자모를 조합하므로 한글이
 * 아닌 문자는 애초에 들어올 수 없다. 남은 시간은 서버가 준 deadlineTs로
 * 계산하며, 로컬 타이머를 따로 굴리지 않는다 (서버 권위).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Hint } from '../components/Hint.jsx';
import { Keyboard } from '../components/Keyboard.jsx';
import { REACTIONS } from '../constants.js';
import { HangulComposer, isComplete } from '../hangul/automata.js';
import { keyToJamo } from '../hangul/keyboard.js';
import { useCountdown } from '../useGame.js';
import './Play.css';

export function Play({ state, user, actions }) {
  const { round, room, scores, pass, lastWin, suddenDeath } = state;

  const composerRef = useRef(new HangulComposer());
  const [text, setText] = useState('');
  const [shift, setShift] = useState(false);
  const [passed, setPassed] = useState(false);
  const [localNotice, setLocalNotice] = useState(null);
  const secondsLeft = useCountdown(round?.deadlineTs);

  // 서버 안내와 로컬 안내 중 나중 것을 보여준다
  const notice = (localNotice?.seq ?? 0) > (state.notice?.seq ?? 0) ? localNotice : state.notice;

  const sync = useCallback(() => setText(composerRef.current.value), []);

  // 문제가 바뀌면 입력과 패스 상태를 비운다
  useEffect(() => {
    composerRef.current.clear();
    setText('');
    setShift(false);
    setPassed(false);
    setLocalNotice(null);
  }, [round?.roundNo, round?.deadlineTs]);

  const insert = useCallback((jamo) => {
    composerRef.current.insert(jamo);
    setShift(false);
    sync();
  }, [sync]);

  const backspace = useCallback(() => {
    composerRef.current.backspace();
    sync();
  }, [sync]);

  const submit = useCallback(() => {
    const word = composerRef.current.value;
    if (!word) return;

    // 조합이 덜 끝난 글자는 서버까지 보내지 않는다. 어차피 거절될 왕복이고,
    // 선착순 게임에서 그 시간은 그대로 손해다.
    if (!isComplete(word)) {
      setLocalNotice({ text: '아직 완성되지 않은 글자가 있어요', seq: Date.now(), shake: true });
      return;
    }

    actions.submit(word);
    composerRef.current.clear();
    sync();
  }, [actions, sync]);

  // PC 물리 키보드 지원
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
        return;
      }
      const jamo = keyToJamo(e.key);
      if (jamo) {
        e.preventDefault();
        composerRef.current.insert(jamo);
        sync();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [submit, backspace, sync]);

  const togglePass = () => {
    const next = !passed;
    setPassed(next);
    actions.pass(next);
  };

  const players = room?.players ?? [];
  const ranked = useMemo(
    () => [...players].sort((a, b) => (scores[String(b.userId)] ?? 0) - (scores[String(a.userId)] ?? 0)),
    [players, scores],
  );

  const urgent = secondsLeft <= 5;

  return (
    <div className="screen play">
      {/* 스코어보드 */}
      <div className="play__scores">
        {ranked.map((p) => (
          <div
            key={p.userId}
            className={`play__score ${String(p.userId) === String(user.userId) ? 'is-me' : ''} ${p.connected ? '' : 'is-out'}`}
          >
            <span className="play__nick">{p.nickname}</span>
            <strong>{scores[String(p.userId)] ?? 0}</strong>
          </div>
        ))}
      </div>

      {/* 라운드 · 타이머 */}
      <div className="row">
        <span className="muted">
          {suddenDeath ? '서든데스' : `${round?.roundNo ?? 1} / ${round?.totalRounds ?? '-'} 라운드`}
        </span>
        <div className="spacer" />
        <span className={`play__timer ${urgent ? 'is-urgent' : ''}`}>{secondsLeft}</span>
      </div>

      {/* 문제 */}
      <div className={`play__stage ${notice?.shake ? 'shake' : ''}`} key={notice?.seq}>
        <Hint hint={round?.hint} />
      </div>

      {/* 입력 중인 글자 */}
      <div className="play__input">
        {text || <span className="play__placeholder">단어를 입력하세요</span>}
      </div>

      {/* 안내 문구 — 거절 피드백, 문제 교체 알림 */}
      <div className="play__notice" key={`n-${notice?.seq}`}>
        {notice?.text ?? ''}
      </div>

      <div className="spacer" />

      {/* 패스 · 리액션 */}
      <div className="row">
        <button
          type="button"
          className={`btn ${passed ? 'btn--mustard' : 'btn--ghost'}`}
          onClick={togglePass}
        >
          {passed ? '패스 취소' : '패스'}
          {pass && pass.passed > 0 && ` ${pass.passed}/${pass.total}`}
        </button>
        <div className="spacer" />
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="play__reaction"
            onClick={() => actions.react(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* 지난 라운드 정답 바 (FR-G7) */}
      {lastWin && (
        <p className="muted play__last">
          지난 라운드 정답: <strong>{lastWin.word}</strong> — {lastWin.nickname} 님이 맞혔어요
        </p>
      )}

      <Keyboard
        onJamo={insert}
        onBackspace={backspace}
        onSubmit={submit}
        shift={shift}
        onShift={() => setShift((s) => !s)}
        disabled={!round}
      />
    </div>
  );
}
