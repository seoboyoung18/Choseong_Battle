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

/** 이모지 리액션 4종 (FR-G8) */
export const REACTIONS = ['👍', '😂', '😱', '🔥'];
