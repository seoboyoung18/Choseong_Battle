/** 카테고리 표시명 — 서버 enum과 1:1 대응 */
export const CATEGORY_LABEL = {
  CHO: '자음',
  JUNG: '모음',
  MIX: '자음+모음',
  OPEN: '한 글자 공개',
  ALL: '종합',
};

/** 화면에 늘어놓는 순서 — 종합이 기본값이라 맨 앞 */
export const CATEGORY_ORDER = ['ALL', 'CHO', 'JUNG', 'MIX', 'OPEN'];

/** 빠른 대전에서 고를 수 있는 인원수 — 서버 RULES.MATCH_SIZES와 맞춰야 한다 */
export const MATCH_SIZES = [2, 3, 4];

/** 혼자 연습 5단계 — 서버 PRACTICE_TIERS와 맞춰야 한다 */
export const PRACTICE_TIERS = {
  FREE: { label: '자유', limitMs: null, canPass: true },
  T12S: { label: '초보', limitMs: 12000, canPass: false },
  T8S: { label: '중수', limitMs: 8000, canPass: false },
  T5S: { label: '고수', limitMs: 5000, canPass: false },
  T3S: { label: '초고수', limitMs: 3000, canPass: false },
};

export const PRACTICE_TIER_ORDER = ['FREE', 'T12S', 'T8S', 'T5S', 'T3S'];

/** 이모지 리액션 4종 (FR-G8) */
export const REACTIONS = ['👍', '😂', '😱', '🔥'];

/** 게임 모드 표시명 — 서버 game_mode enum과 1:1 대응 */
export const MODE_LABEL = {
  QUICK: '빠른 대전',
  FRIEND: '친구 방',
  SOLO: '혼자',
};
