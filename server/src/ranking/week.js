/**
 * 주차 계산.
 *
 * 주간 랭킹은 매주 월요일 00:00 KST에 리셋된다. 서버가 어느 시간대에 떠 있든
 * 같은 경계를 써야 하므로, UTC 기준으로 KST 자정을 직접 계산한다.
 * (서버 로컬 시간대에 기대면 배포 환경이 UTC일 때 9시간이 밀린다.)
 *
 * 주차 표기는 ISO 8601 주차다: 2026-W33
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * ISO 주차 번호. 그 주 목요일이 속한 해의 몇 번째 주인지로 정한다.
 * @param {Date} mondayUtc KST 월요일 자정을 UTC로 옮긴 시각
 * @returns {{ year: number, week: number }}
 */
function isoWeekNumber(mondayUtc) {
  // KST 달력 날짜로 다루기 위해 9시간을 더해 UTC 필드로 읽는다
  const kst = new Date(mondayUtc.getTime() + KST_OFFSET_MS);
  const thursday = new Date(kst.getTime() + 3 * DAY_MS);

  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / WEEK_MS) + 1;

  return { year, week };
}

/**
 * 주어진 시각이 속한 주(월요일 00:00 KST ~ 다음 월요일 00:00 KST)를 구한다.
 *
 * @param {Date} [at] 기준 시각 (기본: 지금)
 * @returns {{ week: string, start: Date, end: Date }} start는 포함, end는 미포함
 */
export function weekOf(at = new Date()) {
  // KST 달력 날짜를 UTC 필드로 읽기 위해 9시간을 더한다
  const kst = new Date(at.getTime() + KST_OFFSET_MS);

  const dayOfWeek = kst.getUTCDay(); // 0=일요일
  const sinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const kstMidnight = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() - sinceMonday,
  );

  // 다시 실제 UTC 시각으로 되돌린다
  const start = new Date(kstMidnight - KST_OFFSET_MS);
  const end = new Date(start.getTime() + WEEK_MS);

  const { year, week } = isoWeekNumber(start);
  return { week: `${year}-W${String(week).padStart(2, '0')}`, start, end };
}

/**
 * 주차 표기가 올바른 형식인지 본다. 클라이언트가 보낸 값을 그대로 쿼리에
 * 넣지 않기 위한 검사다.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidWeek(value) {
  return typeof value === 'string' && /^\d{4}-W\d{2}$/.test(value);
}

/**
 * 주차 표기로 기간을 되돌린다.
 * @param {string} week 예: '2026-W33'
 * @returns {{ week: string, start: Date, end: Date } | null}
 */
export function rangeOfWeek(week) {
  if (!isValidWeek(week)) return null;

  const [yearPart, weekPart] = week.split('-W');
  const year = Number(yearPart);
  const number = Number(weekPart);

  // 해당 연도 1월 4일은 항상 ISO 1주차에 속한다 — 거기서 되짚어 올라간다
  const jan4 = new Date(Date.UTC(year, 0, 4) - KST_OFFSET_MS);
  const firstMonday = weekOf(jan4).start;
  const target = new Date(firstMonday.getTime() + (number - 1) * WEEK_MS);

  return weekOf(new Date(target.getTime() + DAY_MS));
}
