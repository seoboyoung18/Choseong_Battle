/** 홈 — 닉네임을 정하고 방을 만들거나 코드로 들어간다. */

import { useState } from 'react';

import { CATEGORY_LABEL, CATEGORY_ORDER, MATCH_SIZES, avatarOf } from '../constants.js';

/** 홈 상단 전적 칸 하나 */
function Stat({ label, value }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-title), var(--font-ui)', fontSize: 22 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

export function Lobby({ user, defaultNickname = '', onSignIn, actions, matching, connected, connecting }) {
  const [nickname, setNickname] = useState(user?.nickname ?? defaultNickname);
  const [category, setCategory] = useState('ALL');
  const [size, setSize] = useState(4);
  const [code, setCode] = useState('');
  const [rounds, setRounds] = useState(10);

  if (!user) {
    return (
      <div className="screen">
        <h1 className="title">초성배틀</h1>
        <p className="muted">먼저 외치면 이기는 한글 초성 퀴즈</p>
        <div className="spacer" />
        <input
          className="input"
          placeholder="닉네임"
          maxLength={12}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={nickname.trim().length < 1 || connecting}
          onClick={() => onSignIn(nickname.trim())}
        >
          {connecting ? '연결 중…' : '시작하기'}
        </button>
        <p className="muted">
          지금은 개발용 로그인이에요. 출시 때는 토스 계정으로 연결됩니다.
        </p>
      </div>
    );
  }

  if (matching) {
    return (
      <div className="screen">
        <div className="spacer" />
        <h2 className="title" style={{ textAlign: 'center' }}>상대를 찾는 중…</h2>
        <p className="muted" style={{ textAlign: 'center' }}>
          {CATEGORY_LABEL[category]} · {size}명
        </p>
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          {size}명이 모이면 바로 시작해요.
          <br />
          15초 안에 다 못 모이면 모인 인원으로 시작합니다.
        </p>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={actions.cancelMatching}>
          취소
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="row">
        <h1 className="title">초성배틀</h1>
        <div className="spacer" />
        {/* 내 이름을 누르면 마이페이지 — 홈에 따로 메뉴를 두지 않는다 */}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={actions.openMyPage}
          disabled={!connected}
        >
          {avatarOf(user.avatarId).emoji} {connected ? user.nickname : '연결 중…'}
        </button>
      </div>

      {/* 전적 · 주간 랭크 (FR-A4) */}
      <section className="card">
        <div className="row">
          <Stat label="전" value={user.stats?.games ?? 0} />
          <Stat label="승" value={user.stats?.wins ?? 0} />
          <Stat label="승률" value={`${Math.round((user.stats?.winRate ?? 0) * 100)}%`} />
          <Stat
            label="주간"
            value={user.weeklyRank ? `${user.weeklyRank.rank}위` : '—'}
          />
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ width: '100%', marginTop: 6 }}
          onClick={actions.openRanking}
        >
          주간 랭킹 보기
          {user.weeklyRank ? ` · 내 ${user.weeklyRank.roundWins}승` : ''}
        </button>
      </section>

      <section className="card">
        <strong>카테고리</strong>
        <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {CATEGORY_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={`btn ${category === key ? '' : 'btn--ghost'}`}
              style={{ flex: '1 0 30%', padding: '10px 8px', fontSize: 15 }}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_LABEL[key]}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <strong>인원</strong>
        <div className="row" style={{ marginTop: 10 }}>
          {MATCH_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn ${size === n ? 'btn--sage' : 'btn--ghost'}`}
              style={{ flex: 1, padding: '10px 8px', fontSize: 15 }}
              onClick={() => setSize(n)}
            >
              {n}명
            </button>
          ))}
        </div>
      </section>

      <div className="row">
        <button
          type="button"
          className="btn"
          style={{ flex: 2 }}
          onClick={() => actions.joinMatching(category, size)}
        >
          빠른 대전
        </button>
        <button type="button" className="btn btn--sage" style={{ flex: 1 }} onClick={actions.openPractice}>
          혼자 연습
        </button>
      </div>

      <section className="card">
        <strong>친구 방</strong>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="muted" htmlFor="rounds">문제 수</label>
          <input
            id="rounds"
            className="input"
            type="number"
            min={5}
            max={20}
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            style={{ width: 88 }}
          />
        </div>
        <button
          type="button"
          className="btn btn--sage"
          style={{ width: '100%', marginTop: 10 }}
          onClick={() => actions.createRoom({ category, totalRounds: rounds, name: `${user.nickname}의 방` })}
        >
          방 만들기
        </button>

        <div className="row" style={{ marginTop: 14 }}>
          <input
            className="input"
            placeholder="초대 코드"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="btn btn--mustard"
            disabled={code.length !== 6}
            onClick={() => actions.joinRoom(code)}
          >
            입장
          </button>
        </div>
      </section>
    </div>
  );
}
