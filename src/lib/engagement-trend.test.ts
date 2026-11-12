import { describe, expect, it } from 'vitest';
import { buildEngagementTrendSeries, sessionSecondsAt } from '@/lib/engagement-trend';

describe('engagement-trend', () => {
  it('uses measured active seconds instead of wall-clock time', () => {
    const asOf = Date.parse('2026-08-04T12:00:00.000Z');

    // A four minute visit that left the tab open would previously become 3 hours.
    expect(
      sessionSecondsAt(
        {
          login_time: '2026-08-04T09:00:00.000Z',
          session_duration: 3 * 3600,
          active_seconds: 240,
          logout_time: null,
        },
        asOf,
      ),
    ).toBe(240);

    // An open session with no measured time contributes nothing.
    expect(sessionSecondsAt({ login_time: '2026-08-04T09:00:00.000Z' }, asOf)).toBe(0);

    // A session that straddles the as-of point is capped to the elapsed window.
    expect(
      sessionSecondsAt(
        { login_time: '2026-08-04T11:55:00.000Z', active_seconds: 600 },
        asOf,
      ),
    ).toBe(300);
  });

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
