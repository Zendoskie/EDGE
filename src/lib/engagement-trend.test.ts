import { describe, expect, it } from 'vitest';
import { buildEngagementTrendSeries } from '@/lib/engagement-trend';

describe('engagement-trend', () => {
  it('builds weekly points from login history', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const points = buildEngagementTrendSeries({
      now,
      granularity: 'week',
      logins: [
        {
          login_time: '2026-07-20T10:00:00.000Z',
          logout_time: '2026-07-20T12:00:00.000Z',
          session_duration: 7200,
          counts_as_login: true,
        },
        {
          login_time: '2026-07-27T10:00:00.000Z',
          logout_time: '2026-07-27T11:00:00.000Z',
          session_duration: 3600,
          counts_as_login: true,
        },
      ],
      activities: [
        { created_at: '2026-07-27T10:30:00.000Z', activity_type: 'assignment_view' },
        { created_at: '2026-07-28T10:30:00.000Z', activity_type: 'ai_session' },
      ],
      feedback: [],
      risks: [
        { created_at: '2026-07-21T00:00:00.000Z', risk_score: 40 },
        { created_at: '2026-07-28T00:00:00.000Z', risk_score: 55 },
      ],
    });

    expect(points.length).toBeGreaterThan(1);
    expect(points.every((p) => typeof p.engagementScore === 'number')).toBe(true);
    expect(points[points.length - 1]?.riskScore).toBe(55);
  });

  it('supports monthly granularity', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    const points = buildEngagementTrendSeries({
      now,
      granularity: 'month',
      logins: [
        {
          login_time: '2026-06-15T10:00:00.000Z',
          logout_time: '2026-06-15T11:00:00.000Z',
          session_duration: 3600,
          counts_as_login: true,
        },
      ],
      activities: [],
      feedback: [],
      risks: [],
    });

    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0]?.label.toLowerCase()).toContain('jun');
  });
});
