/**
 * 혼자 연습 — 단계 선택과 도전 화면.
 *
 * 게임 화면과 같은 힌트·키보드를 쓴다. 판정도 서버의 같은 엔진이라
 * 여기서 되던 단어는 실전에서도 된다 (FR-P4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Hint } from '../components/Hint.jsx';
import { Keyboard } from '../components/Keyboard.jsx';
import { CATEGORY_LABEL, CATEGORY_ORDER, PRACTICE_TIERS, PRACTICE_TIER_ORDER } from '../constants.js';
import { HangulComposer, isComplete } from '../hangul/automata.js';
import { keyToJamo } from '../hangul/keyboard.js';
import { useCountdown } from '../useGame.js';
import './Practice.css';

/** 단계·카테고리 고르기 */
function Setup({ records, onStart, onClose }) {
  const [category, setCategory] = useState('ALL');

  const bestOf = (tier) =>
    records?.find((r) => r.tier === tier && r.category === category)?.bestStreak ?? 0;

  return (
    <div className="screen">
      <div className="row">
        <h1 className="title">혼자 연습</h1>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>닫기</button>
      </div>

      <section className="card">
        <strong>카테고리</strong>
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {CATEGORY_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={`btn ${category === key ? '' : 'btn--ghost'}`}
              style={{ flex: '1 0 30%', padding: '10px 8px', fontSize: 15 }}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_LABEL[key]}
            </button>
          ))}
        </div>
      </section>

      <ul className="practice__tiers">
        {PRACTICE_TIER_ORDER.map((tier) => {
          const { label, limitMs } = PRACTICE_TIERS[tier];
          const best = bestOf(tier);
          return (
            <li key={tier}>
              <button type="button" className="practice__tier" onClick={() => onStart({ tier, category })}>
                <span className="practice__tier-name">{label}</span>
                <span className="muted">{limitMs === null ? '제한 없음' : `${limitMs / 1000}초`}</span>
                <div className="spacer" />
                <span className="practice__best">{best > 0 ? `최고 ${best}연속` : '기록 없음'}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="muted" style={{ margin: 0 }}>
        자유 단계는 시간 제한도 없고 끝나지도 않아요. 나머지는 한 번 틀리거나
        시간이 지나면 그 자리에서 끝납니다.
      </p>
    </div>
  );
}

/** 도전 진행 */
function Run({ state, actions }) {
  const { question, streak, notice } = state;
  const composerRef = useRef(new HangulComposer());
  const [text, setText] = useState('');
  const [shift, setShift] = useState(false);
  const [localNotice, setLocalNotice] = useState(null);
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
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
      const jamo = keyToJamo(e.key);
      if (jamo) { e.preventDefault(); composerRef.current.insert(jamo); sync(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [submit, backspace, sync]);

  const timed = question?.deadlineTs !== null && question?.deadlineTs !== undefined;
  const canPass = PRACTICE_TIERS[question?.tier]?.canPass;

  return (
    <div className="screen play practice">
      <div className="row">
        <span className="muted">
          {PRACTICE_TIERS[question?.tier]?.label} · {CATEGORY_LABEL[question?.category]}
        </span>
        <div className="spacer" />
        <span className="practice__streak">{streak}연속</span>
        {timed && (
          <span className={`play__timer ${secondsLeft <= 3 ? 'is-urgent' : ''}`}>{secondsLeft}</span>
        )}
      </div>

      <div className={`play__stage ${shown?.shake ? 'shake' : ''}`} key={shown?.seq}>
        <Hint hint={question?.hint} />
      </div>

      <div className="play__input">
        {text || <span className="play__placeholder">단어를 입력하세요</span>}
      </div>

      <div className="play__notice" key={`n-${shown?.seq}`}>{shown?.text ?? ''}</div>

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
        shift={shift}
        onShift={() => setShift((s) => !s)}
        disabled={!question}
      />
    </div>
  );
}

/** 도전 결과 */
function Ended({ result, actions, onClose }) {
  const reasonText = {
    TIMEOUT: '시간 초과!',
    WRONG: '아쉬워요',
    QUIT: '수고했어요',
  }[result.reason] ?? '끝';

  return (
    <div className="screen">
      <div className="spacer" />
      <h1 className="title" style={{ textAlign: 'center' }}>{reasonText}</h1>

      <div className="card" style={{ textAlign: 'center' }}>
        <div className="practice__result-streak">{result.streak}연속</div>
        {result.isNewRecord ? (
          <p style={{ color: 'var(--sage)', fontWeight: 700, margin: '4px 0 0' }}>최고 기록 경신!</p>
        ) : (
          <p className="muted" style={{ margin: '4px 0 0' }}>
            최고 기록 {result.bestStreak ?? 0}연속
          </p>
        )}
        {result.answer && (
          <p className="muted" style={{ marginBottom: 0 }}>
            정답은 <strong>{result.answer}</strong> 였어요
          </p>
        )}
      </div>

      <div className="spacer" />
      <button
        type="button"
        className="btn"
        onClick={() => actions.practiceStart({ tier: result.tier, category: result.category })}
      >
        다시 도전
      </button>
      <button type="button" className="btn btn--ghost" onClick={onClose}>
        단계 고르기
      </button>
    </div>
  );
}

export function Practice({ practice, actions, onClose }) {
  if (practice.result) {
    return <Ended result={practice.result} actions={actions} onClose={actions.practiceReset} />;
  }
  if (practice.question) {
    return <Run state={practice} actions={actions} />;
  }
  return <Setup records={practice.records} onStart={actions.practiceStart} onClose={onClose} />;
}
