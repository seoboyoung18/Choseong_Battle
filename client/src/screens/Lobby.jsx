/** 홈 — 닉네임을 정하고 방을 만들거나 코드로 들어간다. */

import { useState } from 'react';

import { Avatar } from '../avatar/Avatar.jsx';
import { CATEGORY_LABEL, CATEGORY_ORDER, MATCH_SIZES } from '../constants.js';
import './Lobby.css';

/** 친구 방 문제 수 선택지 — 5~20 범위(FR-R1) 안에서 고르기 쉬운 값만 */
const ROUND_CHOICES = [5, 10, 15, 20];

/** 홈 상단 전적 칸 하나. accent면 파랑 숫자 (승률·주간 순위) */
function Stat({ label, value, accent }) {
  return (
    <div className="stat">
      <div className={`stat__num ${accent ? 'is-accent' : ''}`}>{value}</div>
      <div className="stat__lbl">{label}</div>
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
      <div className="screen onboard">
        <span className="onboard__badge">MINI APP</span>
        <h1 className="onboard__title">초성배틀</h1>
        <p className="onboard__sub">초성만 보고 단어 맞추는 실시간 퀴즈</p>

        <div className="onboard__art">
          <div className="onboard__halo">
            <Avatar appearance={null} size={150} />
          </div>
        </div>

        <label className="onboard__label" htmlFor="nickname">닉네임을 입력하세요</label>
        <input
          id="nickname"
          className="onboard__input"
          placeholder="닉네임"
          maxLength={12}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button
          type="button"
          className="btn onboard__start"
          disabled={nickname.trim().length < 1 || connecting}
          onClick={() => onSignIn(nickname.trim())}
        >
          {connecting ? '연결 중…' : '시작하기'}
        </button>
        <p className="onboard__note">
          지금은 개발용 로그인이에요. 출시 때는 토스 계정으로 연결됩니다.
        </p>
      </div>
    );
  }

  if (matching) {
    return (
      <div className="screen">
        <div className="spacer" />
        <div className="match__spinner-wrap">
          <div className="match__spinner" />
        </div>
        <h2 className="title" style={{ textAlign: 'center' }}>상대를 찾는 중…</h2>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="chip is-on">{CATEGORY_LABEL[category]}</span>
          <span className="chip is-on">{size}명</span>
        </div>

        {/* 자리 현황 — 나 + 빈 슬롯 */}
        <div className="match__slots" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
          <div className="match__slot is-filled">
            <Avatar appearance={user.appearance} size={44} />
            <span>나</span>
          </div>
          {Array.from({ length: size - 1 }, (_, i) => (
            <div key={i} className="match__slot">?</div>
          ))}
        </div>

        <div className="info-banner">
          ⏰ 15초 안에 다 못 모이면 모인 인원으로 시작해요
        </div>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={actions.cancelMatching}>
          취소
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      {/* 프로필 줄 — 설정(마이페이지)은 오른쪽 톱니로 */}
      <div className="row home__top">
        <Avatar appearance={user.appearance} size={44} />
        <div style={{ minWidth: 0 }}>
          <div className="home__nick">{connected ? user.nickname : '연결 중…'}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {user.weeklyRank ? `이번 주 ${user.weeklyRank.rank}위` : '이번 주 랭킹 미등재'}
          </div>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="home__settings"
          aria-label="마이페이지"
          onClick={actions.openMyPage}
          disabled={!connected}
        >
          ⚙️
        </button>
      </div>

      {/* 전적 · 주간 랭크 (FR-A4) */}
      <section className="card">
        <div className="row">
          <Stat label="전" value={user.stats?.games ?? 0} />
          <Stat label="승" value={user.stats?.wins ?? 0} />
          <Stat label="승률" value={`${Math.round((user.stats?.winRate ?? 0) * 100)}%`} accent />
          <Stat
            label="주간"
            value={user.weeklyRank ? `${user.weeklyRank.rank}위` : '—'}
            accent
          />
        </div>
      </section>
      <button type="button" className="home__mini-link" onClick={actions.openRanking}>
        주간 랭킹 보기 ›
      </button>

      <div>
        <div className="home__cat-title">카테고리</div>
        <div className="chips">
          {CATEGORY_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={`chip ${category === key ? 'is-on' : ''}`}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="home__cat-title">인원</div>
        <div className="chips">
          {MATCH_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className={`chip ${size === n ? 'is-on' : ''}`}
              onClick={() => setSize(n)}
            >
              {n}명
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="btn" onClick={() => actions.joinMatching(category, size)}>
        ⚡ 빠른 대전
      </button>
      <button type="button" className="btn btn--ghost" onClick={actions.openPractice}>
        🎯 혼자 연습
      </button>

      <section className="card">
        <strong>친구와 하기</strong>
        <div className="home__cat-title" style={{ marginTop: 12 }}>문제 수</div>
        <div className="chips">
          {ROUND_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              className={`chip ${rounds === n ? 'is-on' : ''}`}
              onClick={() => setRounds(n)}
            >
              {n}문제
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn--sage"
          style={{ width: '100%', marginTop: 12 }}
          onClick={() => actions.createRoom({ category, totalRounds: rounds, name: `${user.nickname}의 방` })}
        >
          방 만들기
        </button>

        <div className="row" style={{ marginTop: 12 }}>
          <input
            className="input"
            placeholder="초대코드 6자리"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="btn btn--ghost"
            style={{ color: 'var(--primary)', fontWeight: 700 }}
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
