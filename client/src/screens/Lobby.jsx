/** 홈 — 닉네임을 정하고 방을 만들거나 코드로 들어간다. */

import { useState } from 'react';

import { CATEGORY_LABEL, CATEGORY_ORDER, MATCH_SIZES } from '../constants.js';

export function Lobby({ user, onSignIn, actions, matching, connected, connecting }) {
  const [nickname, setNickname] = useState(user?.nickname ?? '');
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
        <span className="muted">{connected ? user.nickname : '연결 중…'}</span>
      </div>

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

      <button type="button" className="btn" onClick={() => actions.joinMatching(category, size)}>
        빠른 대전
      </button>

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
