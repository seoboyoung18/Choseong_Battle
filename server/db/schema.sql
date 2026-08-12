-- 초성배틀 스키마 (PostgreSQL 18)
-- 기준: 노션 「ERD & 데이터 모델」 v1.0
-- 변경점: rounds.end_reason 추가 — 유찰 사유를 시간초과와 전원 패스로 구분한다.

BEGIN;

-- ── 열거 타입 ────────────────────────────────────────────────────────────────
-- 유저가 고르는 카테고리 5종. ALL(종합)은 라운드마다 힌트 타입을 뽑는다.
CREATE TYPE category AS ENUM ('CHO', 'JUNG', 'MIX', 'OPEN', 'ALL');

-- 라운드 단위로 확정되는 힌트 타입 4종. ALL은 여기 들어오지 않는다.
CREATE TYPE hint_type AS ENUM ('CHO', 'JUNG', 'MIX', 'OPEN');

-- 라운드 종료 사유. WON 외 둘은 라운드 번호를 유지한 채 문제만 교체한다.
CREATE TYPE round_end_reason AS ENUM ('WON', 'TIMEOUT', 'ALL_PASSED');

CREATE TYPE room_status AS ENUM ('WAITING', 'PLAYING', 'CLOSED');
CREATE TYPE word_source AS ENUM ('STD', 'OPEN_DICT', 'WHITELIST', 'REPORT');
CREATE TYPE word_status AS ENUM ('ACTIVE', 'BANNED', 'PENDING');
CREATE TYPE report_action AS ENUM ('ADD', 'REMOVE');
CREATE TYPE report_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE practice_tier AS ENUM ('FREE', 'T12S', 'T8S', 'T5S', 'T3S');
CREATE TYPE judge_type AS ENUM ('DICT', 'FIXED');

-- 제출 결과. 거절 사유는 API submit.rejected의 reason과 1:1 대응한다.
CREATE TYPE submission_result AS ENUM (
  'WON',
  'REJECTED_NOT_HANGUL',
  'REJECTED_LENGTH_MISMATCH',
  'REJECTED_PATTERN_MISMATCH',
  'REJECTED_NOT_IN_DICT',
  'REJECTED_ROUND_CLOSED',
  'LATE'
);

-- ── 유저 ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  toss_user_id  text        NOT NULL UNIQUE,
  nickname      text        NOT NULL,
  avatar_id     smallint    NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS '토스 계정 연동 유저. 개인정보는 닉네임만 보유(최소 수집)';

-- ── 방 ──────────────────────────────────────────────────────────────────────
-- 친구 방과 빠른 매칭 임시 방이 같은 테이블을 쓴다.
CREATE TABLE rooms (
  id            bigserial   PRIMARY KEY,
  code          char(6)     NOT NULL UNIQUE,
  name          text,
  host_id       bigint      REFERENCES users(id) ON DELETE SET NULL,
  category      category    NOT NULL,
  total_rounds  smallint    NOT NULL DEFAULT 10 CHECK (total_rounds BETWEEN 5 AND 20),
  password_hash text,
  is_public     boolean     NOT NULL DEFAULT true,
  status        room_status NOT NULL DEFAULT 'WAITING',
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN rooms.code IS '초대 코드(영문+숫자 6자). 코드 입장은 비밀번호를 우회한다 (FR-R3)';

CREATE INDEX rooms_public_waiting_idx ON rooms (status, created_at DESC) WHERE is_public;

CREATE TABLE room_members (
  room_id   bigint      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_ready  boolean     NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

COMMENT ON TABLE room_members IS '대기방 멤버십. 실시간 소스는 Redis, 여기는 종료 후 정리용';

-- ── 게임 ────────────────────────────────────────────────────────────────────
CREATE TABLE games (
  id           bigserial   PRIMARY KEY,
  room_id      bigint      REFERENCES rooms(id) ON DELETE SET NULL,
  category     category    NOT NULL,
  total_rounds smallint    NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);

CREATE INDEX games_ended_at_idx ON games (ended_at DESC) WHERE ended_at IS NOT NULL;

CREATE TABLE game_players (
  game_id       bigint   NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id       bigint   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_wins    smallint NOT NULL DEFAULT 0,
  avg_answer_ms integer,
  final_rank    smallint,
  left_early    boolean  NOT NULL DEFAULT false,
  PRIMARY KEY (game_id, user_id)
);

COMMENT ON TABLE game_players IS '인별 결과. 전적·주간 랭킹 집계의 원천';

CREATE INDEX game_players_user_idx ON game_players (user_id);

-- ── 단어 ────────────────────────────────────────────────────────────────────
CREATE TABLE words (
  id         bigserial   PRIMARY KEY,
  text       text        NOT NULL UNIQUE,
  length     smallint    NOT NULL CHECK (length BETWEEN 2 AND 4),
  cho        text        NOT NULL,
  jung       text        NOT NULL,
  is_curated boolean     NOT NULL DEFAULT false,
  difficulty smallint    NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  source     word_source NOT NULL DEFAULT 'STD',
  status     word_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN words.cho  IS '초성열, 예: 감자 → ㄱㅈ. 출제 시 패턴 역인덱스로 쓴다';
COMMENT ON COLUMN words.jung IS '중성열, 예: 감자 → ㅏㅏ';
COMMENT ON COLUMN words.is_curated IS 'true인 부분집합만 실제 출제된다. false는 판정 전용';

-- 출제 풀 조회: 길이·큐레이션·상태로 좁힌다
CREATE INDEX words_pool_idx ON words (length, is_curated, status);
-- 패턴별 후보 조회 (유찰 교체·운영 분석용). MIX/OPEN은 앱 레벨에서 필터링한다
CREATE INDEX words_cho_idx  ON words (cho)  WHERE status = 'ACTIVE';
CREATE INDEX words_jung_idx ON words (jung) WHERE status = 'ACTIVE';

-- ── 라운드 ──────────────────────────────────────────────────────────────────
-- 유찰(시간초과 또는 전원 패스) 시 같은 round_no로 attempt_no를 올려 새 행을 만든다.
-- "라운드는 유지하고 문제만 교체" 규칙을 그대로 모델링한 것.
CREATE TABLE rounds (
  id             bigserial        PRIMARY KEY,
  game_id        bigint           NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_no       smallint         NOT NULL,
  attempt_no     smallint         NOT NULL DEFAULT 1,
  word_id        bigint           NOT NULL REFERENCES words(id),
  judge_kind     judge_type       NOT NULL DEFAULT 'DICT',
  hint_kind      hint_type        NOT NULL,
  hint           jsonb            NOT NULL,
  end_reason     round_end_reason,
  winner_id      bigint           REFERENCES users(id) ON DELETE SET NULL,
  won_word       text,
  won_elapsed_ms integer,
  pass_count     smallint         NOT NULL DEFAULT 0,
  started_at     timestamptz      NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (game_id, round_no, attempt_no),

  -- 승리로 끝난 라운드는 승자 정보가 반드시 있고, 유찰은 반드시 없다.
  CONSTRAINT rounds_winner_consistent CHECK (
    (end_reason = 'WON'  AND winner_id IS NOT NULL AND won_word IS NOT NULL)
    OR (end_reason <> 'WON' AND winner_id IS NULL AND won_word IS NULL)
    OR end_reason IS NULL
  )
);

COMMENT ON COLUMN rounds.hint       IS '위치별 힌트 배열. 분쟁·재현 대응을 위해 그대로 보존한다';
COMMENT ON COLUMN rounds.end_reason IS 'WON=승자 확정 / TIMEOUT=제한시간 초과 / ALL_PASSED=전원 패스. 뒤 둘은 round_no 유지 후 교체';
COMMENT ON COLUMN rounds.pass_count IS '이 출제에서 패스를 누른 인원 수 — 문제 난이도 보정 신호';

CREATE INDEX rounds_game_idx ON rounds (game_id, round_no, attempt_no);
CREATE INDEX rounds_word_idx ON rounds (word_id);

-- ── 제출 ────────────────────────────────────────────────────────────────────
-- 거절 제출까지 전부 남긴다. 사전 보강(NOT_IN_DICT 검수)·난이도 보정·어뷰징 분석의 원천.
CREATE TABLE submissions (
  id         bigserial         PRIMARY KEY,
  round_id   bigint            NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id    bigint            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word       text              NOT NULL,
  result     submission_result NOT NULL,
  elapsed_ms integer           NOT NULL,
  created_at timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX submissions_round_idx ON submissions (round_id);
-- 주 1회 사전 보강 배치가 훑는 경로
CREATE INDEX submissions_not_in_dict_idx ON submissions (created_at)
  WHERE result = 'REJECTED_NOT_IN_DICT';
-- 어뷰징 탐지: 문제 공개 후 500ms 미만 정답
CREATE INDEX submissions_suspicious_idx ON submissions (user_id, created_at)
  WHERE elapsed_ms < 500;

-- ── 단어 신고 ───────────────────────────────────────────────────────────────
CREATE TABLE word_reports (
  id         bigserial     PRIMARY KEY,
  user_id    bigint        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       text          NOT NULL,
  action     report_action NOT NULL,
  context    text,
  status     report_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX word_reports_pending_idx ON word_reports (created_at) WHERE status = 'PENDING';

-- ── 혼자 연습 ───────────────────────────────────────────────────────────────
CREATE TABLE practice_records (
  user_id     bigint        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier        practice_tier NOT NULL,
  category    category      NOT NULL,
  best_streak smallint      NOT NULL DEFAULT 0,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tier, category)
);

-- ── 주간 랭킹 ───────────────────────────────────────────────────────────────
-- 배치로 갱신하는 집계 테이블. 조회 부하를 games/game_players와 분리한다.
CREATE TABLE weekly_rankings (
  week       text        NOT NULL,
  user_id    bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_wins integer     NOT NULL DEFAULT 0,
  avg_answer_ms integer,
  games_counted smallint NOT NULL DEFAULT 0,
  rank       integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week, user_id)
);

COMMENT ON COLUMN weekly_rankings.week          IS 'ISO 주차 표기, 예: 2026-W33. 매주 월요일 00:00 KST 리셋';
COMMENT ON COLUMN weekly_rankings.games_counted IS '집계에 반영된 판 수. 주간 상위 20판 상한 (담합·갈아넣기 방지)';
COMMENT ON COLUMN weekly_rankings.avg_answer_ms IS '동점 시 타이브레이커 — 빠른 쪽이 상위';

CREATE INDEX weekly_rankings_leaderboard_idx ON weekly_rankings (week, rank);

COMMIT;
