/**
 * 혼자 연습 — 단계 선택과 도전 화면.
 *
 * 게임 화면과 같은 힌트·키보드를 쓴다. 판정도 서버의 같은 엔진이라
 * 여기서 되던 단어는 실전에서도 된다 (FR-P4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { UnlockBanner } from '../avatar/UnlockBanner.jsx';
import { ReportWord } from '../components/ReportWord.jsx';
import { Hint } from '../components/Hint.jsx';
import { KEY_BACKSPACE, KEY_SUBMIT, Keyboard, useKeyFlash } from '../components/Keyboard.jsx';
import { CATEGORY_LABEL, CATEGORY_ORDER, PRACTICE_TIERS, PRACTICE_TIER_ORDER } from '../constants.js';
import { HangulComposer, isComplete } from '../hangul/automata.js';
import { jamoFromEvent } from '../hangul/keyboard.js';
import { useCountdown } from '../useGame.js';
import './Practice.css';

/** 단계별 아이콘 — 목업의 카드 리스트를 따른다 */
const TIER_ICON = { FREE: '🌊', T12S: '🌱', T8S: '⚡', T5S: '🔥', T3S: '💎' };

/** 단계·카테고리 고르기 */
function Setup({ records, onStart, onClose }) {
  const [category, setCategory] = useState('ALL');

  const bestOf = (tier) =>
    records?.find((r) => r.tier === tier && r.category === category)?.bestStreak ?? 0;

  return (
    <div className="screen">
      <div className="row">
        <h1 className="title">혼자 연습 🎯</h1>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>닫기</button>
      </div>

      <div className="chips">
        {CATEGORY_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip ${category === key ? 'is-on' : ''}`}
            onClick={() => setCategory(key)}
          >
            {CATEGORY_LABEL[key]}
          </button>
        ))}
      </div>

      <ul className="practice__tiers">
        {PRACTICE_TIER_ORDER.map((tier) => {
          const { label, limitMs } = PRACTICE_TIERS[tier];
          const best = bestOf(tier);
          return (
            <li key={tier}>
              <button type="button" className="practice__tier" onClick={() => onStart({ tier, category })}>
                <span className="practice__tier-icon">{TIER_ICON[tier]}</span>
                <span style={{ textAlign: 'left' }}>
                  <span className="practice__tier-name">{label}</span>
                  <span className="practice__tier-limit">
                    {limitMs === null ? '제한 없음' : `${limitMs / 1000}초 제한`}
                  </span>
                </span>
                <div className="spacer" />
                <span className={`practice__best ${best > 0 ? '' : 'is-none'}`}>
                  {best > 0 ? `최고 ${best}연속` : '도전 전'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        자유 단계는 시간 제한도 없고 끝나지도 않아요. 나머지는 한 번 틀리거나
        시간이 지나면 그 자리에서 끝납니다.
      </p>
    </div>
  );
}

/** 도전 진행 */
function Run({ state, report, actions }) {
  const { question, streak, notice } = state;
  const composerRef = useRef(new HangulComposer());
  const [text, setText] = useState('');
  const [shift, setShift] = useState(false);
  // 물리 Shift는 따로 센다 — 화면 시프트는 한 글자 쓰고 풀리지만 물리는 뗄 때까지 눌린 채다
  const [heldShift, setHeldShift] = useState(false);
  const [localNotice, setLocalNotice] = useState(null);
  // 물리 키 입력을 화면 키보드에 되비춘다
  const [keyFlash, flashKey] = useKeyFlash();
  const secondsLeft = useCountdown(question?.deadlineTs);

  const shown = (localNotice?.seq ?? 0) > (notice?.seq ?? 0) ? localNotice : notice;
  const sync = useCallback(() => setText(composerRef.current.value), []);

  useEffect(() => {
    composerRef.current.clear();
    setText('');
    setShift(false);
    setLocalNotice(null);
  }, [question?.startedAt, question?.hint]);

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
    if (!isComplete(word)) {
      setLocalNotice({ text: '아직 완성되지 않은 글자가 있어요', seq: Date.now() });
      return;
    }
    actions.practiceSubmit(word);
    composerRef.current.clear();
    sync();
  }, [actions, sync]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // key가 아니라 code로 본다 — 한글 입력기가 켜져 있으면 key는 'Process'다
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        flashKey(KEY_SUBMIT);
        submit();
        return;
      }
      if (e.code === 'Backspace') {
        e.preventDefault();
        flashKey(KEY_BACKSPACE);
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
        flashKey(jamo);
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
  }, [submit, backspace, sync, flashKey]);

  const timed = question?.deadlineTs !== null && question?.deadlineTs !== undefined;
  const canPass = PRACTICE_TIERS[question?.tier]?.canPass;

  // 남은 시간 게이지 — 단계 제한시간 대비 비율
  const limitSec = (PRACTICE_TIERS[question?.tier]?.limitMs ?? 0) / 1000;
  const timeTone = secondsLeft <= 3 ? 'is-urgent' : secondsLeft <= limitSec / 2 ? 'is-warn' : '';
  const timeFraction = limitSec > 0 ? Math.max(0, Math.min(1, secondsLeft / limitSec)) : 1;

  return (
    <div className="screen play practice">
      <div className="row">
        <span className="muted">
          {PRACTICE_TIERS[question?.tier]?.label} · {CATEGORY_LABEL[question?.category]}
        </span>
        <div className="spacer" />
        <span className="practice__streak"><em>{streak}</em> 연속</span>
        {timed && (
          <span className={`play__timer ${timeTone}`}>{secondsLeft}초</span>
        )}
      </div>

      {timed && (
        <div className="play__track">
          <div className={`play__fill ${timeTone}`} style={{ width: `${timeFraction * 100}%` }} />
        </div>
      )}

      <div className={`play__stage ${shown?.shake ? 'shake' : ''}`} key={shown?.seq}>
        <Hint hint={question?.hint} />
      </div>

      <div className="play__input">
        {text || <span className="play__placeholder">단어를 입력하세요</span>}
      </div>

      <div className="play__notice" key={`n-${shown?.seq}`}>{shown?.text ?? ''}</div>

      <ReportWord report={report} onReport={(w) => actions.reportWord(w, '연습')} />

      <div className="spacer" />

      <div className="row">
        {canPass && (
          <button type="button" className="btn btn--mustard" onClick={actions.practicePass}>
            패스
          </button>
        )}
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={actions.practiceQuit}>
          그만하기
        </button>
      </div>

      <Keyboard
        onJamo={insert}
        onBackspace={backspace}
        onSubmit={submit}
        shift={shift || heldShift}
        onShift={() => setShift((s) => !s)}
        disabled={!question}
        flash={keyFlash}
      />
    </div>
  );
}

/** 도전 결과 */
function Ended({ result, user, actions, onClose }) {
  const reasonText = {
    TIMEOUT: '시간 초과! ⏰',
    WRONG: '아쉬워요 😢',
    QUIT: '수고했어요 👏',
  }[result.reason] ?? '끝';

  return (
    <div className="screen">
      <div className="practice__hero">
        <h1 className={`practice__hero-title ${result.reason === 'QUIT' ? 'is-quit' : ''}`}>
          {reasonText}
        </h1>
      </div>

      <div className="card" style={{ textAlign: 'center', padding: '28px 18px' }}>
        <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>이번 기록</div>
        <div className="practice__result-streak">{result.streak}</div>
        <div className="muted" style={{ fontWeight: 700 }}>연속 정답</div>
        {result.isNewRecord ? (
          <div className="practice__record-badge">🏅 최고 기록 경신!</div>
        ) : (
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
            최고 기록 {result.bestStreak ?? 0}연속
          </p>
        )}
      </div>

      {result.answer && (
        <div className="card practice__answer">
          <div className="muted" style={{ fontSize: 12, fontWeight: 700 }}>정답은</div>
          <div className="word">{result.answer}</div>
        </div>
      )}

      <UnlockBanner parts={result.unlocked} appearance={user?.appearance} />

      <div className="spacer" />
      <div className="row">
        <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>
          단계 고르기
        </button>
        <button
          type="button"
          className="btn"
          style={{ flex: 2 }}
          onClick={() => actions.practiceStart({ tier: result.tier, category: result.category })}
        >
          다시 도전 🔄
        </button>
      </div>
    </div>
  );
}

export function Practice({ practice, user, report, actions, onClose }) {
  if (practice.result) {
    return (
      <Ended result={practice.result} user={user} actions={actions} onClose={actions.practiceReset} />
    );
  }
  if (practice.question) {
    return <Run state={practice} report={report} actions={actions} />;
  }
  return <Setup records={practice.records} onStart={actions.practiceStart} onClose={onClose} />;
}
