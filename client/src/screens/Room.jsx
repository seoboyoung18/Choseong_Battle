/** 대기방 — 멤버가 모이고 방장이 시작한다. */

import { CATEGORY_LABEL } from '../constants.js';

export function Room({ room, user, actions }) {
  const me = room.players.find((p) => String(p.userId) === String(user.userId));
  const isHost = Boolean(me?.isHost);
  const everyoneReady = room.players
    .filter((p) => !p.isHost)
    .every((p) => p.isReady);
  const canStart = isHost && room.players.length >= 2 && everyoneReady;

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
          <button type="button" className="btn" disabled={!canStart} onClick={actions.startGame}>
            게임 시작
          </button>
          {!canStart && (
            <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
              {room.players.length < 2 ? '2명 이상 모여야 시작할 수 있어요' : '전원이 준비해야 시작할 수 있어요'}
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
