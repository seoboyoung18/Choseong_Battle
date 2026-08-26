/**
 * 2벌식 화면 키보드.
 *
 * 브라우저 IME를 쓰지 않는다. 자모 하나하나를 오토마타로 넘겨 조합하므로
 * 한글 외 문자가 애초에 들어올 수 없다 (FR-J3).
 *
 * PC에서 물리 키보드로 치면 `flash`로 해당 키가 눌린 것처럼 반짝인다 —
 * 입력이 어디로 들어가는지 보여주는 피드백이다.
 */

import { useCallback, useEffect, useState } from 'react';

import { LAYOUT, SHIFT_MAP } from '../hangul/keyboard.js';
import './Keyboard.css';

/** flash에 쓰는 특수 키 토큰 (자모와 겹치지 않는 값) */
export const KEY_BACKSPACE = 'BS';
export const KEY_SUBMIT = 'ENTER';

/**
 * 물리 키 입력을 화면 키보드에 되비추는 훅.
 * @returns {[{ value: string, seq: number } | null, (value: string) => void]}
 */
export function useKeyFlash() {
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    if (!flash) return undefined;
    // 잠깐 눌렸다 떼는 느낌 — 같은 키 연타는 타이머만 늘어나 눌린 채로 이어진다
    const timer = setTimeout(() => setFlash(null), 140);
    return () => clearTimeout(timer);
  }, [flash]);

  const trigger = useCallback((value) => setFlash({ value, seq: Date.now() }), []);
  return [flash, trigger];
}

export function Keyboard({ onJamo, onBackspace, onSubmit, shift, onShift, disabled, flash }) {
  const press = (jamo) => {
    onJamo(shift ? (SHIFT_MAP.get(jamo) ?? jamo) : jamo);
  };

  // 물리로 ㄲ을 쳤으면 ㄱ 자리 키가 반짝여야 한다 — 시프트 변형까지 대조한다
  const flashed = (jamo) =>
    flash && (flash.value === jamo || flash.value === SHIFT_MAP.get(jamo));

  return (
    <div className="kb" aria-label="한글 키보드">
      {LAYOUT.map((row, i) => (
        <div className="kb__row" key={i}>
          {/* 마지막 줄 왼쪽에 시프트, 오른쪽에 지우기를 둔다 */}
          {i === 2 && (
            <button
              type="button"
              className={`kb__key kb__key--fn ${shift ? 'is-on' : ''}`}
              onClick={onShift}
              disabled={disabled}
              aria-pressed={shift}
            >
              쌍자음
            </button>
          )}

          {row.map((jamo) => {
            const label = shift ? (SHIFT_MAP.get(jamo) ?? jamo) : jamo;
            return (
              <button
                type="button"
                key={jamo}
                className={`kb__key ${flashed(jamo) ? 'is-flash' : ''}`}
                onClick={() => press(jamo)}
                disabled={disabled}
              >
                {label}
              </button>
            );
          })}

          {i === 2 && (
            <button
              type="button"
              className={`kb__key kb__key--fn ${flash?.value === KEY_BACKSPACE ? 'is-flash' : ''}`}
              onClick={onBackspace}
              disabled={disabled}
              aria-label="지우기"
            >
              ⌫
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        className={`kb__submit ${flash?.value === KEY_SUBMIT ? 'is-flash' : ''}`}
        onClick={onSubmit}
        disabled={disabled}
      >
        입력
      </button>
    </div>
  );
}
