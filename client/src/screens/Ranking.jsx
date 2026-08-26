/**
 * 주간 랭킹 — 포디엄(1~3위) + 리스트 + 하단 내 순위 고정 (FR-K2).
 *
 * 내가 100위 밖이어도 내 줄은 하단에 항상 붙는다. 내 위치를 못 찾는 랭킹은
 * 동기부여가 되지 않는다.
 */

import { Avatar } from '../avatar/Avatar.jsx';
import './Ranking.css';

function seconds(ms) {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}초`;
}

function Row({ entry, isMe }) {
  return (
    <li className={`rank__row ${isMe ? 'is-me' : ''}`}>
      <span className="rank__no">{entry.rank}</span>
      <Avatar appearance={entry.appearance} size={32} />
      <span className="rank__nick">
        {entry.nickname}
        {isMe && ' (나)'}
      </span>
      <span className="rank__speed muted">{seconds(entry.avgAnswerMs)}</span>
      <strong className="rank__wins">{entry.roundWins}승</strong>
    </li>
  );
}

/** 포디엄 기둥 — 1위 금, 2위 은, 3위 동. 순서는 2·1·3으로 배치한다 */
function PodiumCol({ entry, tone }) {
  if (!entry) return <div />;
  return (
    <div className="rank__col">
      <Avatar appearance={entry.appearance} size={tone === 'gold' ? 56 : 44} />
      <span className="rank__col-nn">{entry.nickname}</span>
      <span className="rank__col-wc">{entry.roundWins}승</span>
      <div className={`rank__stand is-${tone}`}>{entry.rank}위</div>
    </div>
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
  const byRank = (n) => top.find((entry) => entry.rank === n);
  const rest = top.filter((entry) => entry.rank > 3);

  return (
    <div className="screen rank">
      <div className="row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>‹ 뒤로</button>
        <div className="spacer" />
        <span className="muted">매주 월요일 00:00 리셋</span>
      </div>

      <div className="rank__head">
        <div className="muted" style={{ fontSize: 12 }}>주간 랭킹</div>
        <h1 className="title">{week}</h1>
      </div>

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
          {/* 포디엄 — 가운데가 1위 */}
          <div className="rank__podium">
            <PodiumCol entry={byRank(2)} tone="silver" />
            <PodiumCol entry={byRank(1)} tone="gold" />
            <PodiumCol entry={byRank(3)} tone="bronze" />
          </div>

          <ul className="card rank__list">
            {rest.map((entry) => (
              <Row key={entry.userId} entry={entry} isMe={entry.userId === user.userId} />
            ))}
            {rest.length === 0 && (
              <p className="muted" style={{ margin: 0, textAlign: 'center' }}>4위부터는 아직 비어 있어요</p>
            )}
          </ul>
        </>
      )}

      {/* 하단 고정 — 내가 목록에 없어도 여기엔 항상 뜬다 */}
      <div className="rank__me">
        {me ? (
          <>
            <span className="rank__me-r">{me.rank}위</span>
            <Avatar appearance={me.appearance ?? user.appearance} size={32} />
            <span className="rank__nick">{me.nickname} (나)</span>
            <div className="spacer" />
            <strong className="rank__wins">{me.roundWins}승</strong>
          </>
        ) : (
          <p className="muted" style={{ margin: 0, textAlign: 'center', width: '100%' }}>
            빠른 대전 {minGames}판을 채우면 랭킹에 올라가요
          </p>
        )}
      </div>
    </div>
  );
}
