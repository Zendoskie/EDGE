/**
 * Time-spent periods shared by the student and parent views.
 *
 * The database computes the buckets in the Asia/Manila reporting day (see
 * get_student_time_spent), so these labels and helpers only present the values.
 */

export type TimeSpentPeriod = 'today' | 'yesterday' | 'week' | 'month';

export type TimeSpentPeriodOption = {
  value: TimeSpentPeriod;
  label: string;
  /** Key used on the RPC response. */
  field: 'today_seconds' | 'yesterday_seconds' | 'week_seconds' | 'month_seconds';
};

export const TIME_SPENT_PERIODS: readonly TimeSpentPeriodOption[] = [
  { value: 'today', label: 'Today', field: 'today_seconds' },
  { value: 'yesterday', label: 'Yesterday', field: 'yesterday_seconds' },
  { value: 'week', label: 'This week', field: 'week_seconds' },
  { value: 'month', label: 'This month', field: 'month_seconds' },
] as const;

export const DEFAULT_TIME_SPENT_PERIOD: TimeSpentPeriod = 'today';

/** Reporting time zone used by the database buckets. */
export const REPORT_TIME_ZONE = 'Asia/Manila';

export type StudentTimeSpent = {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  total: number;
};

export const EMPTY_STUDENT_TIME_SPENT: StudentTimeSpent = {
  today: 0,
  yesterday: 0,
  week: 0,
  month: 0,
  total: 0,
};

function toSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.floor(seconds);
}

/** Normalizes the get_student_time_spent RPC row (array or object) for the UI. */
export function normalizeStudentTimeSpent(row: unknown): StudentTimeSpent {
  if (!row || typeof row !== 'object') return { ...EMPTY_STUDENT_TIME_SPENT };
  const record = row as Record<string, unknown>;
  return {
    today: toSeconds(record.today_seconds),
    yesterday: toSeconds(record.yesterday_seconds),
    week: toSeconds(record.week_seconds),
    month: toSeconds(record.month_seconds),
    total: toSeconds(record.total_seconds),
  };
}

export function timeSpentForPeriod(
  timeSpent: StudentTimeSpent | null | undefined,
  period: TimeSpentPeriod,
): number {
  if (!timeSpent) return 0;
  return timeSpent[period];
}

export function timeSpentPeriodLabel(period: TimeSpentPeriod): string {
  return TIME_SPENT_PERIODS.find((option) => option.value === period)?.label ?? 'Today';
}

export function isTimeSpentPeriod(value: unknown): value is TimeSpentPeriod {
  return TIME_SPENT_PERIODS.some((option) => option.value === value);
}

/**
 * Adds locally observed active seconds on top of the last server values.
 *
 * This is display-only: the heartbeat pushes the authoritative total every
 * minute, and a refetch replaces the local delta. The delta is capped at the
 * server's own 90-second credit per beat (with a small allowance) so a failed
 * heartbeat cannot make the number run away.
 */
export function applyLiveDelta(
  timeSpent: StudentTimeSpent,
  deltaSeconds: number,
): StudentTimeSpent {
  const delta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.floor(deltaSeconds)) : 0;
  if (delta === 0) return timeSpent;

  return {
    today: timeSpent.today + delta,
    yesterday: timeSpent.yesterday,
    week: timeSpent.week + delta,
    month: timeSpent.month + delta,
    total: timeSpent.total + delta,
  };
}
