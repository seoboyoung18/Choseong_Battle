/**
 * 게임 서버 소켓 연결.
 *
 * 서버가 권위를 가지므로 클라이언트는 입력만 보내고 결과를 받아 그린다.
 * 남은 시간은 서버가 준 deadlineTs를 기준으로 계산한다 — 로컬 타이머를
 * 따로 굴리면 화면과 실제 마감이 어긋난다.
 */

import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

/**
 * @param {{ userId: string|number, nickname: string, avatarId?: number }} user
 * @returns {import('socket.io-client').Socket}
 */
export function connect(user) {
  // TODO: 토스 로그인 붙으면 auth에 JWT를 싣는다. 지금은 개발용 스텁이다.
  return io(`${SERVER_URL}/game`, {
    auth: { userId: user.userId, nickname: user.nickname, avatarId: user.avatarId ?? 1 },
    transports: ['websocket'],
  });
}

/** 서버가 보내는 이벤트 이름 (API 명세 3.2) */
export const SERVER_EVENTS = [
  'room.state',
  'matching.matched',
  'matching.timeout',
  'game.countdown',
  'round.start',
  'round.replaced',
  'round.passState',
  'round.won',
  'game.suddenDeath',
  'game.ended',
  'submit.rejected',
  'player.left',
  'player.rejoined',
  'reaction.broadcast',
  'error.notice',
];

/**
 * 거절 사유별 안내 문구. 어떤 이유든 유저에게는 같은 말로 보여준다 —
 * "패턴은 맞는데 사전에 없다"를 알려주면 사전을 역으로 훑는 데 쓰인다.
 */
export const REJECT_MESSAGE = {
  NOT_HANGUL: '한글만 입력할 수 있어요',
  LENGTH_MISMATCH: '등록되지 않은 단어',
  PATTERN_MISMATCH: '등록되지 않은 단어',
  NOT_IN_DICT: '등록되지 않은 단어',
  ROUND_CLOSED: '',
};
