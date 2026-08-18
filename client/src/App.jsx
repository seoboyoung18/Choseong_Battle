/**
 * 화면 전환. 어떤 화면을 보여줄지는 서버가 보낸 상태(phase)가 정한다 —
 * 클라이언트가 임의로 넘기면 서버와 어긋난다.
 *
 * "나"의 신원도 서버가 정한다(state.me). 로그인 화면에서 만든 임시 계정 id는
 * 접속에만 쓰이고, 방·스코어보드에서 나를 찾는 데는 서버가 준 userId를 쓴다.
 */

import { useEffect, useState } from 'react';

import { Lobby } from './screens/Lobby.jsx';
import { MyPage } from './screens/MyPage.jsx';
import { Play } from './screens/Play.jsx';
import { Practice } from './screens/Practice.jsx';
import { Ranking } from './screens/Ranking.jsx';
import { Result } from './screens/Result.jsx';
import { Room } from './screens/Room.jsx';
import { useGame } from './useGame.js';

/**
 * 개발용 임시 계정. sessionStorage라 새로고침해도 같은 전적으로 돌아오면서,
 * 탭을 새로 열면 다른 사람이 된다 — 혼자서 2~4인 플레이를 테스트하기 위해서다.
 *
 * TODO: 토스 로그인으로 교체하면 이 함수는 통째로 사라진다.
 */
function loadAccount() {
  const saved = sessionStorage.getItem('cb.accountId');
  if (saved) return saved;
  const id = `dev-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem('cb.accountId', id);
  return id;
}

/**
 * 로그인 화면에 지난번 닉네임을 채워둔다. 캐릭터는 서버(DB)가 들고 있어서
 * 여기서 기억할 게 없다 — 닉네임만 개발용 로그인 화면이 다시 물어보기 때문이다.
 *
 * TODO: 토스 로그인이 붙으면 이 저장도 사라진다.
 */
function loadNickname() {
  return sessionStorage.getItem('cb.nickname') ?? '';
}

export default function App() {
  const { state, signIn, actions } = useGame();
  const [signedIn, setSignedIn] = useState(false);
  const [savedNickname] = useState(loadNickname);

  const handleSignIn = (nickname) => {
    setSignedIn(true);
    signIn({ userId: loadAccount(), nickname });
  };

  const myNick = state.me?.nickname;
  useEffect(() => {
    if (myNick) sessionStorage.setItem('cb.nickname', myNick);
  }, [myNick]);

  // 서버가 신원을 확정해줄 때까지는 로그인 화면을 유지한다
  if (!signedIn || !state.me) {
    return (
      <Lobby
        user={null}
        defaultNickname={savedNickname}
        onSignIn={handleSignIn}
        actions={actions}
        connecting={signedIn}
      />
    );
  }

  const user = state.me;

  // 랭킹·연습·마이페이지는 어느 화면에서 열든 그 위에 덮인다
  if (state.showMyPage) {
    return (
      <MyPage
        user={user}
        profile={state.profile}
        notice={state.notice}
        actions={actions}
        onClose={actions.closeMyPage}
      />
    );
  }

  if (state.showRanking) {
    return <Ranking ranking={state.ranking} user={user} onClose={actions.closeRanking} />;
  }

  if (state.showPractice) {
    return <Practice practice={state.practice} actions={actions} onClose={actions.closePractice} />;
  }

  if (state.phase === 'RESULT' && state.result) {
    return <Result result={state.result} user={user} actions={actions} />;
  }

  if (state.phase === 'PLAYING') {
    return <Play state={state} user={user} actions={actions} />;
  }

  if (state.phase === 'ROOM' && state.room) {
    return <Room room={state.room} user={user} actions={actions} />;
  }

  return (
    <Lobby
      user={user}
      onSignIn={handleSignIn}
      actions={actions}
      matching={state.matching}
      connected={state.connected}
    />
  );
}
