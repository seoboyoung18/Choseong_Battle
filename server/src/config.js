/**
 * 환경 설정. 게임 규칙 상수는 여기 한 곳에만 둔다 —
 * 라운드 루프·매칭·판정이 같은 숫자를 봐야 하기 때문이다.
 */

import 'dotenv/config';

const num = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  postgres: {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: num(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE ?? 'choseong_battle',
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'ssafy',
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: num(process.env.REDIS_PORT, 6379),
  },

  /** 앱인토스 SDK 3.x CORS 허용 목록 — 실서비스 · QR 테스트 도메인 */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/** 게임 규칙 상수 */
export const RULES = Object.freeze({
  /** 멀티플레이 라운드 제한시간 (FR-G2) */
  ROUND_TIME_MS: 20_000,

  /** 게임 시작 카운트다운 */
  COUNTDOWN_SEC: 3,

  /** 라운드 승자 확정 후 다음 라운드까지의 연출 시간 */
  ROUND_INTERVAL_MS: 3_000,

  /** 유찰·전원 패스로 문제를 교체할 때의 연출 시간 */
  REPLACE_INTERVAL_MS: 1_500,

  /** 방 정원 */
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 4,

  /** 빠른 대전에서 고를 수 있는 인원수 */
  MATCH_SIZES: [2, 3, 4],

  /** 라운드 수 (친구 방은 5~20에서 설정, 빠른 대전은 기본값 고정) */
  DEFAULT_ROUNDS: 10,
  MIN_ROUNDS: 5,
  MAX_ROUNDS: 20,

  /** 빠른 매칭: 정원이 차면 즉시, 아니면 이 시간 뒤 2인 이상으로 시작 (FR-M3) */
  MATCH_WAIT_MS: 15_000,
  /** 이 시간까지 못 채우면 혼자 연습을 제안한다 (FR-M4) */
  MATCH_TIMEOUT_MS: 60_000,

  /** 이탈 후 이 시간 안에 돌아오면 진행 중 게임에 복귀 (FR-R6) */
  REJOIN_GRACE_MS: 30_000,

  /** 문제 공개 후 이 시간보다 빠른 정답은 어뷰징으로 로깅한다 (NFR-5) */
  SUSPICIOUS_ANSWER_MS: 500,

  /** 한 게임 안에서 재출제를 막을 최근 단어 수 */
  RECENT_WORDS_LIMIT: 200,
});

/**
 * 혼자 연습 5단계 (FR-P1).
 *
 * 자유는 제한시간이 없고 패스할 수 있으며 끝나지 않는다. 나머지는 연속 도전이라
 * 한 번 실패하면 그 자리에서 끝난다.
 *
 * 키는 DB practice_tier enum과 같아야 한다.
 */
export const PRACTICE_TIERS = Object.freeze({
  FREE: { label: '자유', limitMs: null, canPass: true },
  T12S: { label: '초보', limitMs: 12_000, canPass: false },
  T8S: { label: '중수', limitMs: 8_000, canPass: false },
  T5S: { label: '고수', limitMs: 5_000, canPass: false },
  T3S: { label: '초고수', limitMs: 3_000, canPass: false },
});

export const PRACTICE_TIER_ORDER = Object.freeze(['FREE', 'T12S', 'T8S', 'T5S', 'T3S']);

/**
 * 고를 수 있는 아바타 수 (FR-A2). 실제 그림은 아직 없어 클라이언트가 이모지로
 * 대신 그리지만, 저장되는 값은 1..N 번호라 그림이 붙어도 데이터는 그대로다.
 */
export const AVATAR_COUNT = 8;
