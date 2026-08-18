/**
 * 마이페이지 — 내 프로필과 남은 기록을 한 화면에 모은다 (FR-A3, FR-A4).
 *
 * 홈의 전적 칸은 숫자 네 개짜리 요약이고, 여기는 그 숫자가 어디서 나왔는지
 * 볼 수 있는 곳이다: 최근 판, 주차별 랭킹, 연습 단계별 최고 기록.
 */

import { useEffect, useState } from 'react';

import {
  AVATARS,
  CATEGORY_LABEL,
  MODE_LABEL,
  PRACTICE_TIERS,
  PRACTICE_TIER_ORDER,
  avatarOf,
} from '../constants.js';
import './MyPage.css';

function seconds(ms) {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}초`;
}

/** 2026-08-18T… → 8/18 */
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

function Stat({ label, value }) {
  return (
    <div className="mypage__stat">
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  );
}

/** 닉네임·아바타 편집 패널 */
function ProfileEditor({ user, actions, onDone }) {
  const [nickname, setNickname] = useState(user.nickname);
  const [avatarId, setAvatarId] = useState(user.avatarId ?? 1);
  const [saving, setSaving] = useState(false);

  // 서버가 저장을 확정하면(session.ready로 새 값이 내려오면) 편집을 닫는다.
  // 먼저 닫아버리면 저장에 실패했을 때 바뀐 것처럼 보인다.
  useEffect(() => {
    if (saving) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.nickname, user.avatarId]);

  const save = () => {
    const name = nickname.trim();
    // 바뀐 게 없으면 서버가 새 값을 내려보낼 일도 없다 — 그냥 닫는다
    if (name === user.nickname && avatarId === user.avatarId) return onDone();
    setSaving(true);
    return actions.updateProfile({ nickname: name, avatarId });
  };

  return (
    <div className="mypage__editor">
      <input
        className="input"
        placeholder="닉네임"
        maxLength={12}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
      />

      <div className="mypage__avatars">
        {AVATARS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`mypage__avatar ${a.id === avatarId ? 'is-picked' : ''}`}
            aria-label={a.label}
            onClick={() => setAvatarId(a.id)}
          >
            {a.emoji}
          </button>
        ))}
      </div>

      <div className="row">
        <button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onDone}>
          취소
        </button>
        <button
          type="button"
          className="btn"
          style={{ flex: 1 }}
          disabled={nickname.trim().length < 1 || saving}
          onClick={save}
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

export function MyPage({ user, profile, actions, onClose }) {
  const [editing, setEditing] = useState(false);

  const stats = profile?.stats ?? user.stats;
  const rank = profile?.weeklyRank ?? user.weeklyRank;
  const games = profile?.recentGames ?? [];
  const history = profile?.rankHistory ?? [];
  const records = profile?.practiceRecords ?? [];

  /** 단계별 최고 기록 — 카테고리가 여럿이면 가장 잘한 것 하나만 */
  const bestByTier = PRACTICE_TIER_ORDER.map((tier) => {
    const mine = records.filter((r) => r.tier === tier);
    const best = mine.reduce((a, b) => (b.bestStreak > (a?.bestStreak ?? -1) ? b : a), null);
    return { tier, best };
  });

  return (
    <div className="screen mypage">
      <div className="row">
        <h1 className="title">마이페이지</h1>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="mypage__scroll">
        {/* 프로필 */}
        <section className="card">
          <div className="row">
            <span className="mypage__face">{avatarOf(user.avatarId).emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong className="mypage__nick">{user.nickname}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {rank ? `이번 주 ${rank.rank}위 · ${rank.roundWins}승` : '이번 주 랭킹 미등재'}
              </div>
            </div>
            {!editing && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
                수정
              </button>
            )}
          </div>

          {editing && <ProfileEditor user={user} actions={actions} onDone={() => setEditing(false)} />}
        </section>

        {/* 전적 요약 */}
        <section className="card">
          <div className="row">
            <Stat label="판" value={stats?.games ?? 0} />
            <Stat label="우승" value={stats?.wins ?? 0} />
            <Stat label="승률" value={`${Math.round((stats?.winRate ?? 0) * 100)}%`} />
            <Stat label="라운드 승" value={stats?.roundWins ?? 0} />
          </div>
        </section>

        {/* 연습 기록 */}
        <section className="card">
          <strong>혼자 연습 최고 기록</strong>
          <ul className="mypage__list">
            {bestByTier.map(({ tier, best }) => (
              <li key={tier} className="mypage__row">
                <span className="mypage__row-main">{PRACTICE_TIERS[tier].label}</span>
                {best ? (
                  <>
                    <span className="muted mypage__row-sub">{CATEGORY_LABEL[best.category]}</span>
                    <strong>{best.bestStreak}연속</strong>
                  </>
                ) : (
                  <span className="muted mypage__row-sub">아직 기록 없음</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* 주차별 랭킹 */}
        <section className="card">
          <strong>주간 랭킹 기록</strong>
          {history.length === 0 ? (
            <p className="muted" style={{ margin: '10px 0 0' }}>
              아직 등재된 주가 없어요. 빠른 대전을 세 판 채우면 올라갑니다.
            </p>
          ) : (
            <ul className="mypage__list">
              {history.map((h) => (
                <li key={h.week} className="mypage__row">
                  <span className="mypage__row-main">{h.week}</span>
                  <span className="muted mypage__row-sub">
                    {h.roundWins}승 · {seconds(h.avgAnswerMs)}
                  </span>
                  <strong>{h.rank ? `${h.rank}위` : '—'}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 최근 전적 */}
        <section className="card">
          <strong>최근 전적</strong>
          {games.length === 0 ? (
            <p className="muted" style={{ margin: '10px 0 0' }}>아직 끝낸 판이 없어요</p>
          ) : (
            <ul className="mypage__list">
              {games.map((g) => (
                <li key={g.gameId} className="mypage__row">
                  <span className={`mypage__badge ${g.finalRank === 1 ? 'is-win' : ''}`}>
                    {g.finalRank ? `${g.finalRank}위` : '—'}
                  </span>
                  <span className="mypage__row-main">
                    {MODE_LABEL[g.mode] ?? g.mode}
                    <span className="muted"> · {CATEGORY_LABEL[g.category]}</span>
                  </span>
                  <span className="muted mypage__row-sub">
                    {g.players}명 · {shortDate(g.endedAt)}
                  </span>
                  <strong>{g.roundWins}승</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
