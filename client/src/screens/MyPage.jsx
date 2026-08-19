/**
 * 마이페이지 — 내 캐릭터와 남은 기록을 한 화면에 모은다 (FR-A3, FR-A4).
 *
 * 홈의 전적 칸은 숫자 네 개짜리 요약이고, 여기는 그 숫자가 어디서 나왔는지 볼 수
 * 있는 곳이다: 최근 판, 주차별 랭킹, 연습 단계별 최고 기록. 그리고 그 숫자가
 * 파츠 해금으로 이어지는 곳이기도 하다.
 */

import { useEffect, useState } from 'react';

import {
  AVATAR_PARTS,
  AVATAR_SLOTS,
  isUnlocked,
  normalizeAppearance,
  unlockLabel,
  unlockRemaining,
} from '../../../shared/avatar.js';
import { Avatar } from '../avatar/Avatar.jsx';
import { CATEGORY_LABEL, MODE_LABEL, PRACTICE_TIERS, PRACTICE_TIER_ORDER } from '../constants.js';
import { isSoundOn, setSoundOn } from '../sound.js';
import './MyPage.css';

/** 파츠 전체 수 — 해금 진행률에 쓴다 */
const TOTAL_PARTS = Object.values(AVATAR_PARTS).reduce((n, list) => n + list.length, 0);

function seconds(ms) {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}초`;
}

/** 2026-08-18T… → 8/18 */
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

function sameLook(a, b) {
  return AVATAR_SLOTS.every(({ slot }) => a[slot] === b[slot]);
}

function countUnlocked(progress) {
  return Object.values(AVATAR_PARTS)
    .flat()
    .filter((part) => isUnlocked(part, progress)).length;
}

function Stat({ label, value }) {
  return (
    <div className="mypage__stat">
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  );
}

/* ── 캐릭터 편집 ─────────────────────────────────────────────────────────── */

function CharacterEditor({ user, progress, notice, actions, onDone }) {
  const [nickname, setNickname] = useState(user.nickname);
  const [draft, setDraft] = useState(() => normalizeAppearance(user.appearance));
  const [slot, setSlot] = useState('base');
  const [saving, setSaving] = useState(false);

  // 서버가 저장을 확정하면(session.ready로 새 값이 내려오면) 편집을 닫는다.
  // 먼저 닫아버리면 저장에 실패했을 때 바뀐 것처럼 보인다.
  useEffect(() => {
    if (saving) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.nickname, user.appearance]);

  // 거절당하면(잠긴 파츠 등) 저장 중 상태를 풀어 다시 시도할 수 있게 둔다
  useEffect(() => {
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.seq]);

  const save = () => {
    const name = nickname.trim();
    if (name === user.nickname && sameLook(draft, normalizeAppearance(user.appearance))) {
      return onDone(); // 바뀐 게 없으면 서버가 새 값을 내려보낼 일도 없다
    }
    setSaving(true);
    return actions.updateProfile({ nickname: name, appearance: draft });
  };

  return (
    <div className="mypage__editor">
      <div className="mypage__preview">
        <Avatar appearance={draft} size={132} shape="square" />
      </div>

      <input
        className="input"
        placeholder="닉네임"
        maxLength={12}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
      />

      <div className="mypage__tabs">
        {AVATAR_SLOTS.map((tab) => (
          <button
            key={tab.slot}
            type="button"
            className={`mypage__tab ${slot === tab.slot ? 'is-on' : ''}`}
            onClick={() => setSlot(tab.slot)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 파츠마다 그 파츠만 바꾼 캐릭터를 그린다 — 이름만 봐서는 뭐가 바뀌는지 모른다 */}
      <div className="mypage__parts">
        {AVATAR_PARTS[slot].map((part) => {
          const open = isUnlocked(part, progress);
          return (
            <button
              key={part.id}
              type="button"
              className={`mypage__part ${draft[slot] === part.id ? 'is-picked' : ''} ${open ? '' : 'is-locked'}`}
              disabled={!open}
              onClick={() => setDraft((prev) => ({ ...prev, [slot]: part.id }))}
            >
              <Avatar appearance={{ ...draft, [slot]: part.id }} size={54} shape="square" />
              <span className="mypage__part-name">{part.label}</span>
              {!open && (
                <>
                  <span className="mypage__part-lock">
                    {unlockLabel(part)}
                    <br />
                    {unlockRemaining(part, progress)} 남음
                  </span>
                  <span className="mypage__lock-badge" aria-hidden="true">🔒</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {notice && <p className="mypage__notice">{notice.text}</p>}

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

/* ── 마이페이지 ──────────────────────────────────────────────────────────── */

export function MyPage({ user, profile, notice, actions, onClose }) {
  const [editing, setEditing] = useState(false);
  const [sound, setSound] = useState(isSoundOn);

  const stats = profile?.stats ?? user.stats;
  const rank = profile?.weeklyRank ?? user.weeklyRank;
  const progress = profile?.progress ?? { roundWins: 0, games: 0, practiceStreak: 0 };
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
        {/* 캐릭터 */}
        <section className="card">
          {!editing && (
          <div className="mypage__profile">
            <Avatar appearance={user.appearance} size={112} shape="square" />
            <div className="mypage__profile-info">
              <strong className="mypage__nick">{user.nickname}</strong>
              <span className="muted">
                {rank ? `이번 주 ${rank.rank}위 · ${rank.roundWins}승` : '이번 주 랭킹 미등재'}
              </span>
              <span className="muted">
                파츠 {countUnlocked(progress)}/{TOTAL_PARTS} 해금
              </span>
              <button
                type="button"
                className="btn btn--sage btn--sm"
                style={{ marginTop: 8, alignSelf: 'flex-start' }}
                onClick={() => setEditing(true)}
              >
                캐릭터 꾸미기
              </button>
            </div>
          </div>
          )}

          {editing && (
            <CharacterEditor
              user={user}
              progress={progress}
              notice={notice}
              actions={actions}
              onDone={() => setEditing(false)}
            />
          )}
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

        {/* 설정 — 앱인토스 검수: 사운드 On/Off 제공 필수 */}
        <section className="card">
          <div className="row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>효과음</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                정답·라운드 승리·해금에 짧게 울려요
              </div>
            </div>
            <button
              type="button"
              className={`btn btn--sm ${sound ? 'btn--sage' : 'btn--ghost'}`}
              aria-pressed={sound}
              onClick={() => setSound(setSoundOn(!sound))}
            >
              {sound ? '켜짐' : '꺼짐'}
            </button>
          </div>
        </section>

        {/* 사전 출처 표기 — CC BY-SA 2.0 KR의 저작자 표시 의무 (NFR-7).
            편집 패널 안이 아니라 화면 맨 아래에 둔다 — 꾸미기를 열어야만 보이면
            표시했다고 하기 어렵다 */}
        <p className="mypage__credit muted">
          낱말 출처: 국립국어원 한국어기초사전
          <br />
          CC BY-SA 2.0 KR
        </p>
      </div>
    </div>
  );
}
