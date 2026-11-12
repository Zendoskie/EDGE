import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_SPENT_PERIOD,
  EMPTY_STUDENT_TIME_SPENT,
  TIME_SPENT_PERIODS,
  applyLiveDelta,
  isTimeSpentPeriod,
  normalizeStudentTimeSpent,
  timeSpentForPeriod,
  timeSpentPeriodLabel,
} from '@/lib/engagement-periods';

describe('engagement-periods', () => {
  it('exposes the four adviser periods', () => {
    expect(TIME_SPENT_PERIODS.map((option) => option.label)).toEqual([
      'Today',
      'Yesterday',
      'This week',
      'This month',
    ]);
    expect(DEFAULT_TIME_SPENT_PERIOD).toBe('today');
  });

  it('normalizes the RPC row', () => {
    expect(
      normalizeStudentTimeSpent({
        today_seconds: 240,
        yesterday_seconds: 600,
        week_seconds: 1200,
        month_seconds: 3600,
        total_seconds: 9000,
      }),
    ).toEqual({ today: 240, yesterday: 600, week: 1200, month: 3600, total: 9000 });
  });

  it('treats missing, negative, or invalid values as zero', () => {
    expect(normalizeStudentTimeSpent(null)).toEqual(EMPTY_STUDENT_TIME_SPENT);
    expect(normalizeStudentTimeSpent({ today_seconds: -5, week_seconds: 'oops' })).toEqual(
      EMPTY_STUDENT_TIME_SPENT,
    );
    expect(normalizeStudentTimeSpent([{ today_seconds: 12 }])).toEqual(EMPTY_STUDENT_TIME_SPENT);
  });

  it('reads the requested period', () => {
    const value = { today: 60, yesterday: 120, week: 300, month: 900, total: 1800 };
    expect(timeSpentForPeriod(value, 'today')).toBe(60);
    expect(timeSpentForPeriod(value, 'yesterday')).toBe(120);
    expect(timeSpentForPeriod(value, 'week')).toBe(300);
    expect(timeSpentForPeriod(value, 'month')).toBe(900);
    expect(timeSpentForPeriod(null, 'month')).toBe(0);
  });

  it('labels periods and validates input', () => {
    expect(timeSpentPeriodLabel('week')).toBe('This week');
    expect(isTimeSpentPeriod('yesterday')).toBe(true);
    expect(isTimeSpentPeriod('last-year')).toBe(false);
  });

  it('adds live seconds to the periods that contain today', () => {
    const base = { today: 60, yesterday: 30, week: 300, month: 900, total: 1800 };
    expect(applyLiveDelta(base, 12)).toEqual({
      today: 72,
      yesterday: 30,
      week: 312,
      month: 912,
      total: 1812,
    });
    expect(applyLiveDelta(base, 0)).toBe(base);
    expect(applyLiveDelta(base, -5)).toBe(base);
  });
});
