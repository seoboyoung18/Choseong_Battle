/**
 * 종단 스모크 테스트 — 실제 소켓 두 개를 붙여 한 판을 끝까지 굴린다.
 *
 * 서버가 떠 있어야 한다.
 *   터미널 1: npm start
 *   터미널 2: node scripts/smoke.js
 *
 * 정답 단어를 클라이언트가 알 수 없으므로, 사전에서 힌트에 맞는 후보를 직접
 * 찾아 제출한다. 실제 플레이어가 하는 일과 같다.
 */

import { io } from 'socket.io-client';

import { ALL_WORDS } from '../db/seed-words.js';
import { RULES } from '../src/config.js';
import { matchHint } from '../src/judge/hint.js';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000/game';

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✔' : '✖'} ${label}`);
  if (!ok) failures += 1;
};

/** 힌트에 맞는 단어를 사전에서 찾는다 — 플레이어가 머리로 하는 일 */
const solve = (hint) => ALL_WORDS.find((w) => matchHint(w, hint).ok) ?? null;

const connect = (userId, nickname) =>
  new Promise((resolve, reject) => {
    const socket = io(URL, { auth: { userId, nickname }, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

const waitFor = (socket, event, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} 대기 시간 초과`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

async function main() {
  console.log(`[smoke] ${URL} 접속`);
  const host = await connect(1001, '호스트감자');
  const guest = await connect(1002, '게스트과자');
  check('소켓 2개 접속', host.connected && guest.connected);

  // ── 방 만들기 · 입장 ───────────────────────────────────────────────────────
  const hostRoom = waitFor(host, 'room.state');
  // 일부러 범위를 벗어난 값을 보낸다 — 서버가 5~20으로 보정해야 한다 (FR-R1)
  host.emit('room.create', { name: '스모크 방', category: 'CHO', totalRounds: 2 });
  const created = await hostRoom;
  check('방 생성', created.players.length === 1 && created.players[0].isHost);
  check(
    `범위 밖 라운드 수 보정 (2 → ${created.settings.totalRounds})`,
    created.settings.totalRounds === RULES.MIN_ROUNDS,
  );

  const totalRounds = created.settings.totalRounds;

  const joined = waitFor(host, 'room.state');
  guest.emit('room.join', { code: created.code });
  check('코드로 입장', (await joined).players.length === 2);

  guest.emit('room.ready', { isReady: true });
  await waitFor(host, 'room.state');

  // ── 1라운드: 오답 → 정답 ───────────────────────────────────────────────────
  const firstRound = waitFor(guest, 'round.start');
  host.emit('game.start');
  const round1 = await firstRound;
  check('1라운드 시작', round1.roundNo === 1 && Array.isArray(round1.hint));
  check('정답이 힌트에 실려 나가지 않음', !('word' in round1));
  console.log(`  힌트: ${round1.hint.map((s) => s.value ?? '⬜').join(' ')}`);

  const rejected = waitFor(guest, 'submit.rejected');
  guest.emit('round.submit', { word: '없는말' });
  check(`오답 거절 (${(await rejected).reason})`, true);

  const answer = solve(round1.hint);
  check(`힌트에 맞는 단어 찾음 (${answer})`, answer !== null);

  const won = waitFor(host, 'round.won');
  guest.emit('round.submit', { word: answer });
  const win = await won;
  check('선착 승리 브로드캐스트', win.winner.userId === 1002 && win.word === answer);
  check('점수 반영', win.scores['1002'] === 1);

  // ── 2라운드: 전원 패스 → 라운드 유지, 문제 교체 ────────────────────────────
  const round2 = await waitFor(guest, 'round.start');
  check('2라운드 시작', round2.roundNo === 2);

  const passState = waitFor(host, 'round.passState');
  host.emit('round.pass', {});
  const passed = await passState;
  check(`일부 패스는 인원수만 알림 (${passed.passed}/${passed.total})`, passed.passed === 1 && passed.total === 2);

  const replaced = waitFor(guest, 'round.replaced');
  guest.emit('round.pass', {});
  const replacedPayload = await replaced;
  check('전원 패스로 문제 교체', replacedPayload.reason === 'ALL_PASSED');
  check('라운드 번호 유지', replacedPayload.roundNo === 2);
  // 단어가 실제로 바뀌는지는 서버 단 유닛 테스트가 본다.
  // 여기서 힌트끼리 비교하면 안 된다 — 다른 단어도 같은 힌트를 낼 수 있다 (감자·과자 → ㄱㅈ).
  check(
    '교체된 문제도 정상 힌트',
    Array.isArray(replacedPayload.hint) && replacedPayload.hint.every((s) => s.type),
  );

  // ── 나머지 라운드는 게스트가 전부 가져가 끝낸다 ────────────────────────────
  // (호스트가 이기면 동점이 생겨 서든데스로 들어갈 수 있다 — FR-G5)
  const autoAnswer = (payload) => {
    const word = solve(payload.hint);
    if (word) guest.emit('round.submit', { word });
  };
  guest.on('round.start', autoAnswer);
  guest.on('round.replaced', autoAnswer);

  const ended = waitFor(host, 'game.ended', 30_000);
  autoAnswer(replacedPayload);
  const result = await ended;

  check('게임 종료', Array.isArray(result.ranks) && result.ranks.length === 2);
  check(
    `게스트가 전 라운드 승리 (${result.ranks[0].roundWins}/${totalRounds}승)`,
    result.ranks[0].userId === 1002 && result.ranks[0].roundWins === totalRounds,
  );
  check('패자는 평균 속도가 없음', result.ranks[1].avgAnswerMs === null);
  console.log(`  최종: ${result.ranks.map((r) => `${r.rank}위 ${r.nickname} ${r.roundWins}승`).join(' · ')}`);

  host.close();
  guest.close();
}

main()
  .then(() => {
    console.log(failures === 0 ? '\n[smoke] 전부 통과' : `\n[smoke] 실패 ${failures}건`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\n[smoke] 오류:', err.message);
    process.exit(1);
  });
