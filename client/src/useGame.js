/**
 * 서버 이벤트를 화면이 쓰기 좋은 하나의 상태로 모은다.
 *
 * 화면 전환은 여기서 결정한다: 로비 → 대기방 → 게임 → 결과.
 * 어떤 화면인지는 서버가 보낸 마지막 이벤트가 정한다 — 클라이언트가
 * 임의로 화면을 바꾸면 서버 상태와 어긋난다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { REJECT_MESSAGE, connect } from './socket/client.js';

const initialState = {
  phase: 'LOBBY', // LOBBY | ROOM | PLAYING | RESULT
  room: null,
  round: null, // { roundNo, totalRounds, hint, deadlineTs, suddenDeath }
  scores: {},
  pass: null, // { passed, total }
  lastWin: null, // 지난 라운드 정답 바 (FR-G7)
  notice: null, // { text, seq } — 흔들림 피드백용
  result: null,
  matching: false,
  suddenDeath: false,
  connected: false,
};

export function useGame() {
  const [state, setState] = useState(initialState);
  const socketRef = useRef(null);

  const patch = useCallback((next) => setState((prev) => ({ ...prev, ...next })), []);

  /** 서버에 접속한다. 닉네임을 정하면 호출된다. */
  const signIn = useCallback((user) => {
    if (socketRef.current) return;
    const socket = connect(user);
    socketRef.current = socket;

    socket.on('connect', () => patch({ connected: true }));
    socket.on('disconnect', () => patch({ connected: false }));

    socket.on('room.state', (room) => {
      setState((prev) => ({
        ...prev,
        room,
        // 게임 중이 아닐 때만 대기방으로 되돌린다 (게임 끝난 뒤 결과를 덮지 않도록)
        phase: prev.phase === 'PLAYING' || prev.phase === 'RESULT' ? prev.phase : 'ROOM',
        matching: false,
      }));
    });

    socket.on('matching.matched', () => patch({ matching: false }));
    socket.on('matching.timeout', () =>
      patch({ matching: false, notice: { text: '상대를 찾지 못했어요', seq: Date.now() } }),
    );

    socket.on('round.start', (round) => {
      setState((prev) => ({
        ...prev,
        phase: 'PLAYING',
        round,
        pass: null,
        suddenDeath: Boolean(round.suddenDeath),
        result: null,
      }));
    });

    socket.on('round.replaced', (round) => {
      setState((prev) => ({
        ...prev,
        round: { ...prev.round, ...round },
        pass: null,
        notice: {
          text: round.reason === 'ALL_PASSED' ? '모두 패스! 문제 교체' : '시간 초과! 문제 교체',
          seq: Date.now(),
        },
      }));
    });

    socket.on('round.passState', (pass) => patch({ pass }));

    socket.on('round.won', (win) => {
      setState((prev) => ({
        ...prev,
        scores: win.scores,
        lastWin: { word: win.word, nickname: win.winner.nickname, elapsedMs: win.elapsedMs },
        pass: null,
      }));
    });

    socket.on('game.suddenDeath', () =>
      patch({ suddenDeath: true, notice: { text: '동점! 서든데스', seq: Date.now() } }),
    );

    socket.on('game.ended', (result) => patch({ phase: 'RESULT', result, round: null }));

    socket.on('submit.rejected', ({ reason }) => {
      const text = REJECT_MESSAGE[reason];
      if (text) patch({ notice: { text, seq: Date.now(), shake: true } });
    });

    socket.on('error.notice', ({ message }) => patch({ notice: { text: message, seq: Date.now() } }));
  }, [patch]);

  useEffect(() => () => socketRef.current?.close(), []);

  const emit = useCallback((event, payload = {}) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const actions = {
    createRoom: (settings) => emit('room.create', settings),
    joinRoom: (code) => emit('room.join', { code }),
    leaveRoom: () => {
      emit('room.leave');
      setState((prev) => ({ ...initialState, connected: prev.connected }));
    },
    setReady: (isReady) => emit('room.ready', { isReady }),
    startGame: () => emit('game.start'),
    submit: (word) => emit('round.submit', { word }),
    pass: (passed) => emit('round.pass', { passed }),
    react: (emoji) => emit('reaction.send', { emoji }),
    joinMatching: (category) => {
      patch({ matching: true });
      emit('matching.join', { category });
    },
    cancelMatching: () => {
      patch({ matching: false });
      emit('matching.cancel');
    },
    backToRoom: () => patch({ phase: 'ROOM', result: null, scores: {}, lastWin: null }),
  };

  return { state, signIn, actions, socket: socketRef };
}

/**
 * 서버가 준 마감 시각까지 남은 초를 센다.
 * @param {number | null} deadlineTs
 * @returns {number} 남은 초 (0 이상)
 */
export function useCountdown(deadlineTs) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!deadlineTs) {
      setLeft(0);
      return undefined;
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((deadlineTs - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [deadlineTs]);

  return left;
}
