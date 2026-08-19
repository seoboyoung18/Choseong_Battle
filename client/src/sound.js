/**
 * 효과음 — 파일 없이 Web Audio로 합성한다 (앱인토스 검수: 사운드 On/Off 필수).
 *
 * 음원 파일을 두지 않는 이유는 캐릭터를 SVG로 그린 것과 같다. 필요한 소리가
 * 짧은 신호음 몇 개뿐이라 파일을 받아올 이유가 없고, 초기 로딩 10초 제한에도
 * 유리하다.
 *
 * 검수 요건 세 가지를 여기서 지킨다.
 *   1. 유저가 끌 수 있다 — 설정은 localStorage에 남아 다음에도 유지된다
 *   2. 백그라운드로 가면 즉시 멈춘다 — visibilitychange에서 컨텍스트를 재운다
 *   3. 첫 사용자 조작 전에는 소리를 내지 않는다 — 브라우저 자동재생 정책
 *
 * 한계: 웹에서는 iOS 무음 스위치 상태를 알 수 없다. 무음으로 두고도 소리가 나면
 * 앱 안의 토글로 꺼야 한다.
 */

const STORAGE_KEY = 'cb.sound';

/** [주파수(Hz), 시작 오프셋(초), 길이(초)] */
const SOUNDS = {
  /** 정답 — 짧게 올라가는 두 음 */
  correct: [[880, 0, 0.08], [1320, 0.07, 0.12]],
  /** 거절 — 낮고 뭉툭하게 한 번 */
  wrong: [[180, 0, 0.16]],
  /** 내가 라운드를 땄다 */
  win: [[660, 0, 0.09], [880, 0.08, 0.09], [1320, 0.16, 0.2]],
  /** 남이 먼저 땄다 — 승리보다 확실히 낮게 */
  lose: [[420, 0, 0.1], [330, 0.09, 0.16]],
  /** 마지막 3초 */
  tick: [[1200, 0, 0.05]],
  /** 파츠 해금 */
  unlock: [[523, 0, 0.1], [659, 0.09, 0.1], [784, 0.18, 0.1], [1047, 0.27, 0.26]],
};

/** @type {AudioContext | null} 첫 사용자 조작 때 만든다 */
let ctx = null;

let enabled = read();

function read() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // 저장소를 못 쓰는 환경에서도 소리는 나야 한다
  }
}

/** 소리가 켜져 있는지 */
export function isSoundOn() {
  return enabled;
}

/**
 * 소리를 켜거나 끈다. 끄면 울리던 소리도 바로 멈춘다.
 * @param {boolean} on
 */
export function setSoundOn(on) {
  enabled = Boolean(on);
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // 저장에 실패해도 이번 세션 동안은 유지된다
  }
  if (!enabled) ctx?.suspend();
  else ctx?.resume();
  return enabled;
}

/**
 * 오디오 컨텍스트를 깨운다. **사용자 조작 안에서 불러야 한다** —
 * 브라우저가 자동재생을 막기 때문에 클릭 밖에서 만들면 계속 잠긴 채로 남는다.
 */
export function initSound() {
  if (ctx) {
    if (enabled) ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return; // 지원하지 않는 브라우저 — 조용히 넘어간다
  ctx = new Ctor();
  if (!enabled) ctx.suspend();
}

/**
 * 효과음 하나를 낸다. 꺼져 있거나 아직 깨우지 않았으면 아무 일도 없다.
 * @param {keyof SOUNDS} name
 */
export function play(name) {
  const notes = SOUNDS[name];
  if (!enabled || !ctx || !notes) return;
  if (ctx.state === 'suspended') return; // 백그라운드 — 밀린 소리가 나중에 터지면 안 된다

  const now = ctx.currentTime;
  for (const [freq, offset, duration] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle'; // 사인보다 또렷하고 사각파보다 덜 거슬린다
    osc.frequency.value = freq;

    // 딱딱 끊기면 클릭 잡음이 나므로 짧게 올렸다 부드럽게 내린다
    const start = now + offset;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }
}

/**
 * 화면이 가려지면 소리를 멈추고, 돌아오면 되살린다 (검수 요건).
 * @returns {() => void} 해제 함수
 */
export function watchVisibility() {
  const onChange = () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (enabled) ctx.resume();
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
