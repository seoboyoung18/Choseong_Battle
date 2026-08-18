/**
 * 주간 랭킹 — 포디엄(1~3위) + 리스트 + 하단 내 순위 고정 (FR-K2).
 *
 * 내가 100위 밖이어도 내 줄은 하단에 항상 붙는다. 내 위치를 못 찾는 랭킹은
 * 동기부여가 되지 않는다.
 */

import { avatarOf } from '../constants.js';
import './Ranking.css';

const MEDAL = ['🥇', '🥈', '🥉'];

function seconds(ms) {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}초`;
}

function Row({ entry, isMe }) {
  return (
    <li className={`rank__row ${isMe ? 'is-me' : ''}`}>
      <span className="rank__no">{MEDAL[entry.rank - 1] ?? entry.rank}</span>
      <span className="rank__nick">{avatarOf(entry.avatarId).emoji} {entry.nickname}</span>
      <span className="rank__speed muted">{seconds(entry.avgAnswerMs)}</span>
      <strong className="rank__wins">{entry.roundWins}승</strong>
    </li>
  );
}

export function Ranking({ ranking, user, onClose }) {
  if (!ranking) {
    return (
      <div className="screen">
        <h1 className="title">주간 랭킹</h1>
        <p className="muted">불러오는 중…</p>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={onClose}>닫기</button>
      </div>
    );
  }

  const { week, top, me, minGames } = ranking;
  const podium = top.slice(0, 3);
  const rest = top.slice(3);

  return (
    <div className="screen rank">
      <div className="row">
        <h1 className="title">주간 랭킹</h1>
        <div className="spacer" />
        <span className="muted">{week}</span>
      </div>

      <p className="muted" style={{ margin: 0 }}>
        빠른 대전 라운드 승수 합산 · 매주 월요일 00:00 리셋
      </p>

      {top.length === 0 ? (
        <div className="card" style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
          <p className="muted" style={{ textAlign: 'center' }}>
            아직 이번 주 랭킹이 없어요.
            <br />
            빠른 대전을 {minGames}판 하면 이름이 올라갑니다.
          </p>
        </div>
      ) : (
        <>
          <div className="rank__podium">
            {podium.map((entry) => (
              <div key={entry.userId} className={`rank__podium-item rank__podium-item--${entry.rank}`}>
                <span className="rank__medal">{MEDAL[entry.rank - 1]}</span>
                <span className="rank__nick">{entry.nickname}</span>
                <strong>{entry.roundWins}승</strong>
              </div>
            ))}
          </div>

          <ul className="card rank__list">
            {rest.map((entry) => (
              <Row key={entry.userId} entry={entry} isMe={entry.userId === user.userId} />
            ))}
            {rest.length === 0 && <p className="muted" style={{ margin: 0 }}>4위부터는 아직 비어 있어요</p>}
          </ul>
        </>
      )}

      {/* 하단 고정 — 내가 목록에 없어도 여기엔 항상 뜬다 */}
      <div className="rank__me card">
        {me ? (
          <Row entry={me} isMe />
        ) : (
          <p className="muted" style={{ margin: 0, textAlign: 'center' }}>
            빠른 대전 {minGames}판을 채우면 랭킹에 올라가요
          </p>
        )}
      </div>

      <button type="button" className="btn btn--ghost" onClick={onClose}>닫기</button>
    </div>
  );
}
