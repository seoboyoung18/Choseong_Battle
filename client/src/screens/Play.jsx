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
import { Avatar } from '../avatar/Avatar.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { REACTIONS } from '../constants.js';
import { HangulComposer, isComplete } from '../hangul/automata.js';
import { jamoFromEvent } from '../hangul/keyboard.js';
import { isSoundOn, play, setSoundOn } from '../sound.js';
import { useCountdown } from '../useGame.js';
import './Play.css';

export function Play({ state, user, actions }) {
  const { round, room, scores, pass, lastWin, suddenDeath } = state;

  const composerRef = useRef(new HangulComposer());
  const [text, setText] = useState('');
  const [shift, setShift] = useState(false);
  // 물리 Shift는 따로 센다 — 화면 시프트는 한 글자 쓰고 풀리지만 물리는 뗄 때까지 눌린 채다
  const [heldShift, setHeldShift] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [sound, setSound] = useState(isSoundOn);
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
      // key가 아니라 code로 본다 — 한글 입력기가 켜져 있으면 key는 'Process'다
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        submit();
        return;
      }
      if (e.code === 'Backspace') {
        e.preventDefault();
        backspace();
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setHeldShift(true);
        return;
      }
      const jamo = jamoFromEvent(e);
      if (jamo) {
        e.preventDefault();
        composerRef.current.insert(jamo);
        sync();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') setHeldShift(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
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

  // 마지막 3초는 초마다 짧게 울린다. useCountdown이 같은 값으로는 다시 렌더하지
  // 않으므로 초가 바뀔 때 한 번씩만 난다.
  useEffect(() => {
    if (secondsLeft > 0 && secondsLeft <= 3) play('tick');
  }, [secondsLeft]);

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
            <span className="play__nick">
              <Avatar appearance={p.appearance} size={18} />
              {p.nickname}
            </span>
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
        {/* 소리 끄기·나가기 — 검수 요건상 모든 화면에 탈출 경로가 있어야 한다 */}
        <button
          type="button"
          className="play__icon"
          aria-label={sound ? '소리 끄기' : '소리 켜기'}
          aria-pressed={sound}
          onClick={() => setSound(setSoundOn(!sound))}
        >
          {sound ? '🔊' : '🔇'}
        </button>
        <button
          type="button"
          className="play__icon"
          aria-label="나가기"
          onClick={() => setLeaving(true)}
        >
          ✕
        </button>
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

      {leaving && (
        <ConfirmDialog
          title="게임을 나갈까요?"
          body="지금 나가면 이번 판 점수는 여기서 멈춰요. 30초 안에 돌아오면 이어서 할 수 있어요."
          onConfirm={actions.leaveRoom}
          onCancel={() => setLeaving(false)}
        />
      )}

      <Keyboard
        onJamo={insert}
        onBackspace={backspace}
        onSubmit={submit}
        shift={shift || heldShift}
        onShift={() => setShift((s) => !s)}
        disabled={!round}
      />
    </div>
  );
}
