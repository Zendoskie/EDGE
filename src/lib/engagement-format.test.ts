import { describe, expect, it } from 'vitest';
import {
  formatTimeSpent,
  formatTimeSpentDetailed,
  formatLastLogin,
  formatFeedbackStatus,
} from '@/lib/engagement-format';

describe('engagement-format', () => {
  it('formats time spent in human-readable units', () => {
    expect(formatTimeSpent(0)).toBe('0 Seconds');
    expect(formatTimeSpent(90)).toBe('1 Minute');
    expect(formatTimeSpent(150 * 60)).toBe('2 Hours 30 Minutes');
    expect(formatTimeSpent(2 * 3600)).toBe('2 Hours');
  });

  it('keeps seconds for the live time-spent display', () => {
    expect(formatTimeSpentDetailed(0)).toBe('0 Seconds');
    expect(formatTimeSpentDetailed(43)).toBe('43 Seconds');
    expect(formatTimeSpentDetailed(103)).toBe('1 Minute 43 Seconds');
    expect(formatTimeSpentDetailed(2 * 3600 + 5 * 60)).toBe('2 Hours 5 Minutes');
  });

  it('formats feedback status labels', () => {
    expect(formatFeedbackStatus('submitted')).toBe('Submitted');
    expect(formatFeedbackStatus('reviewed')).toBe('Reviewed');
  });

  it('returns dash for missing last login', () => {
    expect(formatLastLogin(null)).toBe('—');
  });
});
