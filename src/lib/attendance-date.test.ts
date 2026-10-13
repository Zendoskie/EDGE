import { describe, expect, it } from 'vitest';
import { clampAttendanceDate, manilaToday } from '@/lib/attendance-date';

describe('manilaToday', () => {
  it('rolls over at Manila midnight (UTC+8), not UTC midnight', () => {
    expect(manilaToday(new Date('2026-10-13T15:59:59Z'))).toBe('2026-10-13');
    expect(manilaToday(new Date('2026-10-13T16:00:00Z'))).toBe('2026-10-14');
  });

  it('differs from the old UTC default in the early Manila morning', () => {
    const at = new Date('2026-10-13T23:30:00Z'); // 07:30 on Oct 14 in Manila
    expect(at.toISOString().split('T')[0]).toBe('2026-10-13');
    expect(manilaToday(at)).toBe('2026-10-14');
  });

  it('handles month and year boundaries', () => {
    expect(manilaToday(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
    expect(manilaToday(new Date('2026-02-28T16:30:00Z'))).toBe('2026-03-01');
  });

  it('returns YYYY-MM-DD', () => {
    expect(manilaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('clampAttendanceDate', () => {
  it('replaces a future date with today', () => {
    expect(clampAttendanceDate('2026-10-15', '2026-10-14')).toBe('2026-10-14');
    expect(clampAttendanceDate('2027-01-01', '2026-12-31')).toBe('2026-12-31');
  });

  it('keeps today and past dates', () => {
    expect(clampAttendanceDate('2026-10-14', '2026-10-14')).toBe('2026-10-14');
    expect(clampAttendanceDate('2026-09-01', '2026-10-14')).toBe('2026-09-01');
  });

  it('keeps a cleared input empty', () => {
    expect(clampAttendanceDate('', '2026-10-14')).toBe('');
  });
});
