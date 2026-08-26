/** 결과 — 최종 스코어와 순위. */

import { Avatar } from '../avatar/Avatar.jsx';
import { UnlockBanner } from '../avatar/UnlockBanner.jsx';
import { CATEGORY_LABEL } from '../constants.js';
import './Result.css';

const MEDAL_CLASS = ['is-gold', 'is-silver', 'is-bronze'];

export function Result({ result, user, unlocked, actions }) {
  const { ranks, summary } = result;

  return (
    <div className="screen">
      <div className="result__hero">
        <h1 className="result__h2">{summary?.suddenDeath ? '서든데스 끝! 🎉' : '게임 끝! 🎉'}</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          수고하셨어요 · {CATEGORY_LABEL[summary?.category] ?? summary?.category} · {summary?.totalRounds}라운드
        </p>
      </div>

      <UnlockBanner parts={unlocked} appearance={user.appearance} />

      <div className="result__list">
        {ranks.map((r) => (
          <div
            key={r.userId}
            className={`result__item ${r.rank === 1 ? 'is-first' : ''} ${String(r.userId) === String(user.userId) ? 'is-me' : ''}`}
          >
            <span className={`result__medal ${MEDAL_CLASS[r.rank - 1] ?? ''}`}>
              {r.rank <= 3 ? r.rank : `${r.rank}위`}
            </span>
            <Avatar appearance={r.appearance} size={36} />
            <div className="result__info">
              <div className="result__nn">
                {r.nickname}
                {r.leftEarly && <span className="badge" style={{ marginLeft: 6 }}>이탈</span>}
              </div>
              <div className="result__sp">
                {r.avgAnswerMs === null ? '기록 없음' : `평균 ${(r.avgAnswerMs / 1000).toFixed(1)}초`}
              </div>
            </div>
            <strong className="result__w">{r.roundWins}승</strong>
          </div>
        ))}
      </div>

      <div className="spacer" />

      {/* 광고는 이 시점에 1회만 노출한다 — 매칭 대기·라운드 전환은 "일시적 화면"이라 불가 */}

      <div className="row">
        <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={actions.leaveRoom}>
          나가기
        </button>
        <button type="button" className="btn" style={{ flex: 2 }} onClick={actions.backToRoom}>
          대기방으로
        </button>
      </div>
    </div>
  );
}
