/** 대기방 — 멤버가 모이고 방장이 시작한다. */

import { CATEGORY_LABEL, avatarOf } from '../constants.js';

export function Room({ room, user, actions }) {
  const me = room.players.find((p) => String(p.userId) === String(user.userId));
  const isHost = Boolean(me?.isHost);
  const everyoneReady = room.players
    .filter((p) => !p.isHost)
    .every((p) => p.isReady);
  const canStart = isHost && room.players.length >= 2 && everyoneReady;
  // 혼자하기는 방에 나만 있을 때만. 남이 있는데 혼자 시작하면 그 사람은 영문도 모르고 튕긴다.
  const canStartSolo = isHost && room.players.length === 1;

  return (
    <div className="screen">
      <div className="row">
        <h1 className="title">{room.name}</h1>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={actions.leaveRoom}>
          나가기
        </button>
      </div>

      <section className="card">
        <div className="row">
          <strong style={{ fontSize: 24, letterSpacing: 4 }}>{room.code}</strong>
          <div className="spacer" />
          <span className="muted">초대 코드</span>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {CATEGORY_LABEL[room.settings.category]} · {room.settings.totalRounds}문제
        </p>
      </section>

      <section className="card" style={{ flex: 1 }}>
        <strong>참가자 {room.players.length}/4</strong>
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {room.players.map((p) => (
            <li
              key={p.userId}
              className="row"
              style={{ padding: '10px 0', borderBottom: '1px solid var(--sand)' }}
            >
              <span aria-hidden="true">{avatarOf(p.avatarId).emoji}</span>
              <span style={{ fontWeight: 600 }}>{p.nickname}</span>
              {p.isHost && <span className="muted">방장</span>}
              <div className="spacer" />
              {!p.connected && <span className="muted">연결 끊김</span>}
              {p.isHost ? null : (
                <span style={{ color: p.isReady ? 'var(--sage)' : 'var(--ink-dim)', fontWeight: 600 }}>
                  {p.isReady ? '준비 완료' : '대기 중'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <>
          <div className="row">
            <button
              type="button"
              className="btn"
              style={{ flex: 2 }}
              disabled={!canStart}
              onClick={actions.startGame}
            >
              게임 시작
            </button>
            {/* 상대를 기다리지 않고 바로 연습하고 싶을 때. 방에 나 혼자일 때만 켜진다 */}
            <button
              type="button"
              className="btn btn--mustard"
              style={{ flex: 1 }}
              disabled={!canStartSolo}
              onClick={actions.startSolo}
            >
              혼자하기
            </button>
          </div>
          {!canStart && (
            <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
              {room.players.length < 2
                ? '2명 이상 모여야 시작할 수 있어요 — 혼자 해보려면 오른쪽 버튼을 누르세요'
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
