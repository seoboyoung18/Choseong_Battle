/**
 * 2벌식 화면 키보드.
 *
 * 브라우저 IME를 쓰지 않는다. 자모 하나하나를 오토마타로 넘겨 조합하므로
 * 한글 외 문자가 애초에 들어올 수 없다 (FR-J3).
 */

import { LAYOUT, SHIFT_MAP } from '../hangul/keyboard.js';
import './Keyboard.css';

export function Keyboard({ onJamo, onBackspace, onSubmit, shift, onShift, disabled }) {
  const press = (jamo) => {
    onJamo(shift ? (SHIFT_MAP.get(jamo) ?? jamo) : jamo);
  };

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
                className="kb__key"
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
              className="kb__key kb__key--fn"
              onClick={onBackspace}
              disabled={disabled}
              aria-label="지우기"
            >
              ⌫
            </button>
          )}
        </div>
      ))}

      <button type="button" className="kb__submit" onClick={onSubmit} disabled={disabled}>
        입력
      </button>
    </div>
  );
}
