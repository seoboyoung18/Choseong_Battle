/** 대기방 — 멤버가 모이고 방장이 시작한다. */

import { Avatar } from '../avatar/Avatar.jsx';
import { CATEGORY_LABEL } from '../constants.js';
import './Room.css';

export function Room({ room, user, actions }) {
  const me = room.players.find((p) => String(p.userId) === String(user.userId));
  const isHost = Boolean(me?.isHost);
  const everyoneReady = room.players
    .filter((p) => !p.isHost)
    .every((p) => p.isReady);
  const canStart = isHost && room.players.length >= 2 && everyoneReady;
  // 혼자하기는 방에 나만 있을 때만. 남이 있는데 혼자 시작하면 그 사람은 영문도 모르고 튕긴다.
  const canStartSolo = isHost && room.players.length === 1;

  const emptySlots = Math.max(0, 4 - room.players.length);

  return (
    <div className="screen">
      <div className="row">
        <div>
          <div className="muted" style={{ fontSize: 12 }}>대기방</div>
          <h1 className="title">{room.name}</h1>
        </div>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={actions.leaveRoom}>
          나가기
        </button>
      </div>

      {/* 초대 코드 — 파랑 연한 배경 카드 */}
      <div className="room__invite">
        <span className="muted" style={{ fontWeight: 700 }}>초대코드</span>
        <strong className="room__code">{room.code}</strong>
        <button
          type="button"
          className="room__copy"
          aria-label="초대 코드 복사"
          onClick={() => navigator.clipboard?.writeText(room.code).catch(() => {})}
        >
          📋
        </button>
      </div>

      <p className="muted" style={{ margin: '-4px 2px 0' }}>
        {CATEGORY_LABEL[room.settings.category]} · {room.settings.totalRounds}문제 · {room.players.length}/4
      </p>

      {/* 참가자 2×2 카드 */}
      <div className="room__grid">
        {room.players.map((p) => (
          <div key={p.userId} className={`room__player ${p.connected ? '' : 'is-out'}`}>
            <Avatar appearance={p.appearance} size={56} />
            <span className="room__nn">
              {p.nickname}
              {p.isHost && <span className="badge" style={{ marginLeft: 4 }}>방장</span>}
            </span>
            {!p.connected ? (
              <span className="room__st">연결 끊김</span>
            ) : p.isHost ? (
              <span className="room__st is-ready">준비 완료 ✓</span>
            ) : (
              <span className={`room__st ${p.isReady ? 'is-ready' : ''}`}>
                {p.isReady ? '준비 완료 ✓' : '대기 중'}
              </span>
            )}
          </div>
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <div key={`empty-${i}`} className="room__player is-empty">+</div>
        ))}
      </div>

      <div className="spacer" />

      {isHost ? (
        <>
          <div className="row">
            <button
              type="button"
              className="btn btn--ghost"
              style={{ flex: 1 }}
              disabled={!canStartSolo}
              onClick={actions.startSolo}
            >
              혼자하기
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 2 }}
              disabled={!canStart}
              onClick={actions.startGame}
            >
              게임 시작 ▶
            </button>
          </div>
          {!canStart && (
            <p className="muted" style={{ textAlign: 'center', margin: 0, fontSize: 13 }}>
              {room.players.length < 2
                ? '2명 이상 모여야 시작할 수 있어요 — 혼자 해보려면 혼자하기를 누르세요'
                : '전원이 준비해야 시작할 수 있어요'}
            </p>
          )}
        </>
      ) : (
        <button
          type="button"
          className={`btn ${me?.isReady ? 'btn--ghost' : 'btn--sage'}`}
          onClick={() => actions.setReady(!me?.isReady)}
        >
          {me?.isReady ? '준비 취소' : '준비 완료'}
        </button>
      )}
    </div>
  );
}
