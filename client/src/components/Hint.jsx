/**
 * 문제 힌트 표시.
 *
 * 색 의미 체계를 지킨다 — 자음=테라코타, 모음=머스타드, 공개 글자=잉크,
 * 빈칸=모래. 어느 화면에서든 같은 자모 유형은 같은 색이다.
 */

import './Hint.css';

const SLOT_CLASS = {
  CHO: 'hint__slot--cho',
  JUNG: 'hint__slot--jung',
  OPEN: 'hint__slot--open',
  BLANK: 'hint__slot--blank',
};

export function Hint({ hint }) {
  if (!hint?.length) return null;

  return (
    <div className="hint" aria-label={`${hint.length}글자 문제`}>
      {hint.map((slot, i) => (
        <span key={i} className={`hint__slot ${SLOT_CLASS[slot.type] ?? ''}`}>
          {slot.type === 'BLANK' ? '' : slot.value}
        </span>
      ))}
    </div>
  );
}
