/** 결과 — 최종 스코어와 순위. */

import { CATEGORY_LABEL } from '../constants.js';

const MEDAL = ['🥇', '🥈', '🥉'];

export function Result({ result, user, actions }) {
  const { ranks, summary } = result;

  return (
    <div className="screen">
      <h1 className="title" style={{ textAlign: 'center' }}>
        {summary?.suddenDeath ? '서든데스 끝!' : '게임 끝!'}
      </h1>

      <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
        {CATEGORY_LABEL[summary?.category] ?? summary?.category} · {summary?.totalRounds}라운드
      </p>

      <section className="card" style={{ flex: 1 }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {ranks.map((r) => (
            <li
              key={r.userId}
              className="row"
              style={{
                padding: '14px 0',
                borderBottom: '1px solid var(--sand)',
                fontWeight: String(r.userId) === String(user.userId) ? 700 : 400,
              }}
            >
              <span style={{ width: 32, fontSize: 20 }}>{MEDAL[r.rank - 1] ?? r.rank}</span>
              <span>{r.nickname}</span>
              {r.leftEarly && <span className="muted">이탈</span>}
              <div className="spacer" />
              <span className="muted">
                {r.avgAnswerMs === null ? '—' : `평균 ${(r.avgAnswerMs / 1000).toFixed(1)}초`}
              </span>
              <strong style={{ width: 44, textAlign: 'right', fontSize: 18 }}>{r.roundWins}승</strong>
            </li>
          ))}
        </ul>
      </section>

      {/* 광고는 이 시점에 1회만 노출한다 — 매칭 대기·라운드 전환은 "일시적 화면"이라 불가 */}

      <button type="button" className="btn" onClick={actions.backToRoom}>
        대기방으로
      </button>
      <button type="button" className="btn btn--ghost" onClick={actions.leaveRoom}>
        나가기
      </button>
    </div>
  );
}
