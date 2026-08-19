/**
 * 확인 모달 (앱인토스 검수: 미니앱 종료 시 확인 모달 노출).
 *
 * 게임을 나가는 것처럼 되돌릴 수 없는 조작 앞에 한 번 묻는다. 실수로 나가면
 * 진행 중인 판의 점수가 동결되고 남은 사람들의 판도 흔들린다(FR-R6).
 */

import './ConfirmDialog.css';

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.body]
 * @param {string} [props.confirmLabel]
 * @param {string} [props.cancelLabel]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = '나가기',
  cancelLabel = '계속하기',
  onConfirm,
  onCancel,
}) {
  return (
    // 바깥을 눌러도 닫힌다 — 모달에 갇히면 안 된다 (검수: 모든 화면에 나갈 방법)
    <div className="confirm" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="confirm__box" onClick={(e) => e.stopPropagation()}>
        <strong className="confirm__title">{title}</strong>
        {body && <p className="confirm__body muted">{body}</p>}

        <div className="row" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
