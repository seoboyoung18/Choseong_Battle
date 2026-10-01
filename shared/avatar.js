/**
 * 캐릭터 파츠 카탈로그 — 서버와 클라이언트가 같은 파일을 본다.
 *
 * 여기 있는 건 "무엇을 고를 수 있는가"(id·이름·색·해금 조건)뿐이고, 그걸 어떻게
 * 그리는지는 클라이언트 렌더러가 안다. 파츠 id는 DB(users.appearance)에 그대로
 * 저장되므로, 나중에 진짜 일러스트로 갈아끼워도 저장된 캐릭터는 그대로 산다.
 *
 * 서버가 이 파일을 갖는 이유: 잠긴 파츠를 입고 오는 요청을 막아야 하기 때문이다.
 * 클라이언트가 갖는 이유: 남의 캐릭터도 id만 받아서 그려야 하기 때문이다.
 */

/** 해금 조건 종류 */
export const UNLOCK = Object.freeze({
  /** 누적 라운드 승수 */
  ROUND_WINS: 'ROUND_WINS',
  /** 끝까지 마친 판 수 */
  GAMES: 'GAMES',
  /** 혼자 연습 최고 연속 정답 */
  PRACTICE: 'PRACTICE',
});

/** 편집기 탭 순서 */
export const AVATAR_SLOTS = Object.freeze([
  { slot: 'base', label: '동물' },
  { slot: 'face', label: '표정' },
  { slot: 'hanbok', label: '한복' },
  { slot: 'head', label: '머리' },
  { slot: 'glasses', label: '안경' },
  { slot: 'neck', label: '목장식' },
  { slot: 'bg', label: '배경' },
]);

/**
 * 파츠 목록.
 *
 * base    ear/mark/nose 는 렌더러가 읽는 모양 코드다 — 색이 아니라 형태를 고른다
 * hanbok  jeogori=저고리, goreum=고름, pattern=저고리 무늬. 깃(동정)은 늘 흰색이라 파츠로 두지 않았다
 * glasses 표정 위에 겹쳐 그린다. 부리가 있는 까치도 쓸 수 있다
 * neck    깃 아래 목선에 얹는다 — 고름과 겹치지 않게 렌더러가 자리를 비켜 준다
 */
export const AVATAR_PARTS = Object.freeze({
  base: Object.freeze([
    { id: 'RABBIT', label: '토끼', ear: 'LONG', mark: 'NONE', nose: 'TINY', muzzle: true, fur: '#f6ece6', inner: '#eab8bc' },
    { id: 'BEAR', label: '곰', ear: 'ROUND', mark: 'NONE', nose: 'ROUND', muzzle: true, fur: '#b08968', inner: '#dcc0a4' },
    { id: 'CAT', label: '고양이', ear: 'POINT', mark: 'NONE', nose: 'TRI', whisker: true, fur: '#efd9b4', inner: '#e8a9a0' },
    { id: 'SQUIRREL', label: '다람쥐', ear: 'TUFT', mark: 'NONE', nose: 'TINY', muzzle: true, fur: '#c9793f', inner: '#f0d3ae' },
    { id: 'RACCOON', label: '너구리', ear: 'ROUND', mark: 'MASK', nose: 'ROUND', muzzle: true, fur: '#a9a29b', inner: '#efe7de' },
    {
      id: 'FOX', label: '여우', ear: 'POINT', mark: 'NONE', nose: 'TRI', muzzle: true, whisker: true,
      fur: '#d97a41', inner: '#fbeadc',
      unlock: { type: UNLOCK.ROUND_WINS, value: 20 },
    },
    {
      id: 'TIGER', label: '호랑이', ear: 'ROUND', mark: 'STRIPE', nose: 'TRI', muzzle: true, whisker: true,
      fur: '#e0913f', inner: '#fbe6cd',
      unlock: { type: UNLOCK.ROUND_WINS, value: 60 },
    },
    {
      id: 'MAGPIE', label: '까치', ear: 'BIRD', mark: 'BIB', nose: 'NONE',
      fur: '#3f3d45', inner: '#fffcf7',
      unlock: { type: UNLOCK.PRACTICE, value: 12 },
    },
  ]),

  hanbok: Object.freeze([
    { id: 'INDIGO', label: '쪽빛', jeogori: '#46648f', goreum: '#c4622d', pattern: 'NONE' },
    { id: 'CRIMSON', label: '다홍', jeogori: '#c2453c', goreum: '#2f4858', pattern: 'NONE' },
    { id: 'IVORY', label: '미색', jeogori: '#f0e2c8', goreum: '#7a9471', pattern: 'NONE' },
    { id: 'SAGE', label: '연둣빛', jeogori: '#7a9471', goreum: '#d9a036', pattern: 'NONE' },
    { id: 'PLUM', label: '자주', jeogori: '#7d4470', goreum: '#f0e2c8', pattern: 'NONE' },
    { id: 'CHARCOAL', label: '먹빛', jeogori: '#4a4442', goreum: '#d9a036', pattern: 'NONE' },
    { id: 'PERSIMMON', label: '감빛', jeogori: '#c4622d', goreum: '#46648f', pattern: 'NONE' },
    { id: 'JADE', label: '옥색', jeogori: '#6b9e8f', goreum: '#c2453c', pattern: 'NONE' },
    { id: 'PEONY', label: '분홍', jeogori: '#e08aa0', goreum: '#7d4470', pattern: 'NONE' },
    { id: 'DOTTED', label: '물방울', jeogori: '#5b7fa6', goreum: '#f0e2c8', pattern: 'DOT' },
    { id: 'STRIPED', label: '줄무늬', jeogori: '#4f6b5a', goreum: '#d9a036', pattern: 'STRIPE' },
    {
      id: 'FLORAL', label: '꽃수', jeogori: '#b2543f', goreum: '#f0e2c8', pattern: 'FLOWER',
      unlock: { type: UNLOCK.GAMES, value: 15 },
    },
    {
      id: 'GOLD', label: '금빛', jeogori: '#d9a036', goreum: '#7d4470', pattern: 'NONE',
      unlock: { type: UNLOCK.GAMES, value: 10 },
    },
    {
      id: 'SKY', label: '하늘', jeogori: '#6fa3b5', goreum: '#f0e2c8', pattern: 'NONE',
      unlock: { type: UNLOCK.ROUND_WINS, value: 30 },
    },
  ]),

  head: Object.freeze([
    { id: 'NONE', label: '없음' },
    { id: 'DAENGGI', label: '댕기', color: '#c2453c' },
    { id: 'FLOWER', label: '꽃', color: '#e08aa0', accent: '#d9a036' },
    { id: 'BEADS', label: '방울', color: '#d9a036', accent: '#c2453c' },
    { id: 'BINYEO', label: '비녀', color: '#d9a036', accent: '#7d4470' },
    { id: 'RIBBON', label: '리본', color: '#e08aa0', accent: '#fffcf7' },
    { id: 'BOKGEON', label: '복건', color: '#3b4a6b', accent: '#d9a036' },
    { id: 'LEAF', label: '나뭇잎', color: '#7a9471', accent: '#4f6b5a' },
    {
      id: 'JOKDURI', label: '족두리', color: '#7d4470', accent: '#d9a036',
      unlock: { type: UNLOCK.GAMES, value: 5 },
    },
    {
      id: 'HWAGWAN', label: '화관', color: '#e08aa0', accent: '#d9a036',
      unlock: { type: UNLOCK.GAMES, value: 25 },
    },
    {
      id: 'GAT', label: '갓', color: '#3b3a3f', accent: '#6e5b4c',
      unlock: { type: UNLOCK.ROUND_WINS, value: 40 },
    },
  ]),

  glasses: Object.freeze([
    { id: 'NONE', label: '없음' },
    { id: 'ROUND', label: '동글', frame: '#6e5b4c' },
    { id: 'SQUARE', label: '각테', frame: '#3b3a3f' },
    { id: 'HALF', label: '반달', frame: '#d9a036' },
    {
      id: 'SUN', label: '선글', frame: '#3b3a3f', lens: '#2f3d4a',
      unlock: { type: UNLOCK.ROUND_WINS, value: 15 },
    },
    {
      id: 'GOGGLE', label: '물안경', frame: '#46648f', lens: '#9fd0dd',
      unlock: { type: UNLOCK.PRACTICE, value: 15 },
    },
  ]),

  neck: Object.freeze([
    { id: 'NONE', label: '없음' },
    { id: 'SCARF', label: '목도리', color: '#c2453c', accent: '#f0e2c8' },
    { id: 'NORIGAE', label: '노리개', color: '#7d4470', accent: '#d9a036' },
    { id: 'BEADS', label: '구슬', color: '#6b9e8f', accent: '#f0e2c8' },
    { id: 'BELL', label: '방울', color: '#d9a036', accent: '#c2453c' },
    {
      id: 'CAPE', label: '배자', color: '#4a4442', accent: '#d9a036',
      unlock: { type: UNLOCK.GAMES, value: 12 },
    },
  ]),

  face: Object.freeze([
    { id: 'SMILE', label: '방긋' },
    { id: 'WINK', label: '윙크' },
    { id: 'PROUD', label: '뿌듯' },
    { id: 'SURPRISE', label: '놀람' },
    { id: 'SLEEPY', label: '졸음' },
    {
      id: 'COOL', label: '새침',
      unlock: { type: UNLOCK.PRACTICE, value: 8 },
    },
    {
      id: 'HEART', label: '하트눈',
      unlock: { type: UNLOCK.PRACTICE, value: 20 },
    },
  ]),

  bg: Object.freeze([
    { id: 'SAND', label: '모래', color: '#f3e9dc' },
    { id: 'MINT', label: '민트', color: '#d7e6dd' },
    { id: 'PEACH', label: '살구', color: '#f6ded0' },
    { id: 'SKY', label: '하늘', color: '#d6e4ef' },
    { id: 'LILAC', label: '라일락', color: '#e6dcec' },
    { id: 'MOSS', label: '쑥빛', color: '#dde3cf' },
    { id: 'SUNSET', label: '노을', color: '#f7d9c4' },
    { id: 'PAPER', label: '한지', color: '#ece3d2' },
    {
      id: 'NIGHT', label: '밤', color: '#3f3d45',
      unlock: { type: UNLOCK.GAMES, value: 20 },
    },
  ]),
});

/** 처음 만든 계정이 입고 나오는 조합 — 전부 해금 조건이 없는 파츠여야 한다 */
export const DEFAULT_APPEARANCE = Object.freeze({
  base: 'RABBIT',
  hanbok: 'INDIGO',
  head: 'NONE',
  glasses: 'NONE',
  neck: 'NONE',
  face: 'SMILE',
  bg: 'SAND',
});

const SLOT_NAMES = AVATAR_SLOTS.map((s) => s.slot);

/**
 * @param {string} slot
 * @param {string} id
 * @returns {object | undefined}
 */
export function findPart(slot, id) {
  return AVATAR_PARTS[slot]?.find((p) => p.id === id);
}

/**
 * 해금 여부.
 * @param {{ unlock?: { type: string, value: number } }} part
 * @param {{ roundWins?: number, games?: number, practiceStreak?: number }} [progress]
 */
export function isUnlocked(part, progress = {}) {
  if (!part?.unlock) return true;
  const { type, value } = part.unlock;
  if (type === UNLOCK.ROUND_WINS) return (progress.roundWins ?? 0) >= value;
  if (type === UNLOCK.GAMES) return (progress.games ?? 0) >= value;
  if (type === UNLOCK.PRACTICE) return (progress.practiceStreak ?? 0) >= value;
  return false; // 모르는 조건은 잠긴 것으로 본다
}

/** '라운드 20승' 같은 해금 조건 문구 */
export function unlockLabel(part) {
  if (!part?.unlock) return '';
  const { type, value } = part.unlock;
  if (type === UNLOCK.ROUND_WINS) return `라운드 ${value}승`;
  if (type === UNLOCK.GAMES) return `${value}판 완주`;
  if (type === UNLOCK.PRACTICE) return `연습 ${value}연속`;
  return '';
}

/** 해금까지 남은 양. 이미 열렸으면 0 */
export function unlockRemaining(part, progress = {}) {
  if (!part?.unlock) return 0;
  const { type, value } = part.unlock;
  const have = type === UNLOCK.ROUND_WINS
    ? progress.roundWins ?? 0
    : type === UNLOCK.GAMES
      ? progress.games ?? 0
      : progress.practiceStreak ?? 0;
  return Math.max(0, value - have);
}

/**
 * 이번에 새로 열린 파츠.
 *
 * 해금은 기록에서 계산되므로 "언제 열렸는지"를 저장하는 곳이 없다. 그래서 판이
 * 끝나기 전후의 진행도를 비교해 그 순간 넘어선 파츠를 찾는다.
 *
 * @param {{ roundWins?: number, games?: number, practiceStreak?: number }} before
 * @param {{ roundWins?: number, games?: number, practiceStreak?: number }} after
 * @returns {Array<{ slot: string, id: string, label: string }>}
 */
export function newlyUnlocked(before, after) {
  return AVATAR_SLOTS.flatMap(({ slot }) =>
    AVATAR_PARTS[slot]
      .filter((part) => part.unlock && !isUnlocked(part, before) && isUnlocked(part, after))
      .map((part) => ({ slot, id: part.id, label: part.label })),
  );
}

/**
 * 남의 캐릭터를 그릴 때 쓴다 — 없는 id는 기본값으로 떨어뜨리기만 하고 해금은
 * 따지지 않는다. 남이 무엇을 열었는지는 이쪽에서 알 수 없다.
 * @param {object | null | undefined} input
 */
export function normalizeAppearance(input) {
  const out = { ...DEFAULT_APPEARANCE };
  if (!input || typeof input !== 'object') return out;
  for (const slot of SLOT_NAMES) {
    if (findPart(slot, input[slot])) out[slot] = input[slot];
  }
  return out;
}

/**
 * 내가 저장하려는 캐릭터를 검사한다. 없는 파츠나 아직 잠긴 파츠는 거절한다 —
 * 클라이언트를 고쳐 잠긴 옷을 입고 오는 걸 막는 유일한 지점이다.
 *
 * @param {object} input
 * @param {{ roundWins?: number, games?: number, practiceStreak?: number }} progress
 * @returns {{ ok: true, appearance: object } | { ok: false, slot: string, reason: 'UNKNOWN' | 'LOCKED' }}
 */
export function validateAppearance(input, progress = {}) {
  const appearance = { ...DEFAULT_APPEARANCE };
  if (!input || typeof input !== 'object') return { ok: false, slot: 'base', reason: 'UNKNOWN' };

  for (const slot of SLOT_NAMES) {
    const id = input[slot];
    if (id === undefined) continue; // 안 보낸 칸은 기본값을 쓴다
    const part = findPart(slot, id);
    if (!part) return { ok: false, slot, reason: 'UNKNOWN' };
    if (!isUnlocked(part, progress)) return { ok: false, slot, reason: 'LOCKED' };
    appearance[slot] = id;
  }
  return { ok: true, appearance };
}
