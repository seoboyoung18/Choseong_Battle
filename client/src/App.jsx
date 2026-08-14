/**
 * 화면 전환. 어떤 화면을 보여줄지는 서버가 보낸 상태(phase)가 정한다 —
 * 클라이언트가 임의로 넘기면 서버와 어긋난다.
 */

import { useState } from 'react';

import { Lobby } from './screens/Lobby.jsx';
import { Play } from './screens/Play.jsx';
import { Result } from './screens/Result.jsx';
import { Room } from './screens/Room.jsx';
import { useGame } from './useGame.js';

export default function App() {
  const { state, signIn, actions } = useGame();
  const [user, setUser] = useState(null);

  const handleSignIn = (nickname) => {
    // TODO: 토스 로그인으로 교체. 지금은 브라우저마다 다른 임시 id를 만든다.
    const next = { userId: `dev-${Math.random().toString(36).slice(2, 8)}`, nickname, avatarId: 1 };
    setUser(next);
    signIn(next);
  };

  if (!user) {
    return <Lobby user={null} onSignIn={handleSignIn} actions={actions} />;
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
