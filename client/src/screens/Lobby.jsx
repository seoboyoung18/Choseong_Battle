/** 홈 — 닉네임을 정하고 방을 만들거나, 목록·코드로 남의 방에 들어간다. */

import { useEffect, useState } from 'react';

import { Avatar } from '../avatar/Avatar.jsx';
import { CATEGORY_LABEL, CATEGORY_ORDER, MATCH_SIZES } from '../constants.js';
import './Lobby.css';

/** 친구 방 문제 수 선택지 — 5~20 범위(FR-R1) 안에서 고르기 쉬운 값만 */
const ROUND_CHOICES = [5, 10, 15, 20];

/**
 * 공개 방 한 줄.
 *
 * 잠긴 방은 한 번에 들어갈 수 없다 — 누르면 비밀번호 칸이 그 자리에서 열린다.
 * 모달을 띄우지 않는 건, 틀렸을 때 다시 목록으로 돌아가는 왕복을 없애기 위해서다.
 */
function RoomRow({ room, onJoin }) {
  const [password, setPassword] = useState('');
  const [asking, setAsking] = useState(false);

  const enter = () => {
    if (room.locked && !asking) return setAsking(true);
    onJoin(room.code, room.locked ? password : null);
  };

  return (
    <div className="rooms__item">
      <button type="button" className="rooms__row" onClick={enter}>
        <span className="rooms__main">
          <span className="rooms__name">
            {room.locked && <span aria-label="비밀번호 방">🔒 </span>}
            {room.name}
          </span>
          <span className="rooms__meta">
            {CATEGORY_LABEL[room.category] ?? room.category} · {room.totalRounds}문제
          </span>
        </span>
        <span className="rooms__count">
          {room.players}
          <span className="rooms__max">/{room.maxPlayers}</span>
        </span>
      </button>

      {asking && (
        <div className="row rooms__pw">
          <input
            className="input"
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enter()}
            autoFocus
          />
          <button type="button" className="btn btn--sm" onClick={enter}>
            입장
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 공개 방 목록.
 *
 * 빈 목록과 실패를 다른 문구로 보여준다 — "방이 없다"와 "못 불러왔다"는
 * 사용자가 할 일이 다르다(만들기 / 새로고침).
 */
function RoomList({ rooms, onJoin, onRefresh }) {
  const { list, loading, error } = rooms;

  return (
    <>
      <div className="rooms__head">
        <span className="home__cat-title">공개 방</span>
        <button type="button" className="rooms__refresh" onClick={onRefresh} disabled={loading}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {error ? (
        <p className="rooms__empty">목록을 불러오지 못했어요. 새로고침해 보세요</p>
      ) : list === null ? (
        <p className="rooms__empty">불러오는 중…</p>
      ) : list.length === 0 ? (
        <p className="rooms__empty">아직 열린 방이 없어요. 직접 만들어 보세요</p>
      ) : (
        <div className="rooms">
          {list.map((room) => (
            <RoomRow key={room.code} room={room} onJoin={onJoin} />
          ))}
        </div>
      )}
    </>
  );
}

/** 홈 상단 전적 칸 하나. accent면 테라코타 숫자 (승률·주간 순위) */
function Stat({ label, value, accent }) {
  return (
    <div className="stat">
      <div className={`stat__num ${accent ? 'is-accent' : ''}`}>{value}</div>
      <div className="stat__lbl">{label}</div>
    </div>
  );
}

export function Lobby({
  user,
  defaultNickname = '',
  onSignIn,
  actions,
  matching,
  connected,
  connecting,
  rooms = { list: null, loading: false, error: false },
  notice = null,
}) {
  const [nickname, setNickname] = useState(user?.nickname ?? defaultNickname);
  const [category, setCategory] = useState('ALL');
  const [size, setSize] = useState(4);
  const [code, setCode] = useState('');
  const [rounds, setRounds] = useState(10);
  // 방 비밀번호는 선택이다. 서버가 숫자 4자리를 전제로 해시하므로 여기서도 4자리로 받는다.
  const [usePassword, setUsePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // 방 만들기·입장 실패는 서버가 error.notice로 알려주는데, 로비에는 그걸 띄울
  // 자리가 없었다. 그래서 비밀번호를 틀리거나 이미 방에 있어도 아무 일도
  // 일어나지 않은 것처럼 보였다. 잠깐 보여주고 지운다 — 다음 시도를 가리지 않게.
  const [failure, setFailure] = useState(null);
  useEffect(() => {
    if (!notice?.text) return undefined;
    setFailure(notice.text);
    const timer = setTimeout(() => setFailure(null), 4000);
    return () => clearTimeout(timer);
  }, [notice?.seq, notice?.text]);

  // 홈에 들어오면 방 목록을 한 번 받는다. 그 뒤로는 새로고침 버튼으로만 갱신한다 —
  // 방 목록은 폴링할 만큼 급한 정보가 아니고, 계속 새로 그리면 누르려던 줄이 밀린다.
  const { loadRooms } = actions;
  useEffect(() => {
    if (connected) loadRooms();
  }, [connected, loadRooms]);

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
        <div className="home__cat-title" style={{ marginTop: 12 }}>비밀번호</div>
        <div className="chips">
          <button
            type="button"
            className={`chip ${usePassword ? '' : 'is-on'}`}
            onClick={() => {
              setUsePassword(false);
              // 끄면 지운다 — 껐다 켠 뒤 예전 숫자가 남아 있으면 안 된다
              setNewPassword('');
            }}
          >
            없음
          </button>
          <button
            type="button"
            className={`chip ${usePassword ? 'is-on' : ''}`}
            onClick={() => setUsePassword(true)}
          >
            🔒 걸기
          </button>
        </div>

        {usePassword && (
          <input
            className="input"
            style={{ marginTop: 8 }}
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="숫자 4자리"
            value={newPassword}
            // 붙여넣기·한글 입력기까지 감안해 숫자만 남긴다
            onChange={(e) => setNewPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        )}

        <button
          type="button"
          className="btn btn--sage"
          style={{ width: '100%', marginTop: 12 }}
          disabled={usePassword && newPassword.length !== 4}
          onClick={() =>
            actions.createRoom({
              category,
              totalRounds: rounds,
              name: `${user.nickname}의 방`,
              password: usePassword ? newPassword : null,
            })
          }
        >
          방 만들기
        </button>

        <RoomList rooms={rooms} onJoin={actions.joinRoom} onRefresh={loadRooms} />

        {failure && (
          <p className="rooms__fail" role="status">
            {failure}
          </p>
        )}

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
