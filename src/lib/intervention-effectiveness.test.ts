import { describe, expect, it } from 'vitest';
import { computeInterventionEffectiveness } from '@/hooks/useAdminEngagementAnalytics';

describe('computeInterventionEffectiveness', () => {
  it('calculates due, completion, improvement, and delta metrics', () => {
    const result = computeInterventionEffectiveness(
      [
        {
          action_type: 'send_reminder',
          status: 'completed',
          follow_up_due_at: '2026-08-25T00:00:00.000Z',
          created_at: '2026-08-20T00:00:00.000Z',
          completed_at: '2026-08-25T00:00:00.000Z',
          outcome_rating: 'improved',
          engagement_score_delta: 10,
        },
        {
          action_type: 'send_reminder',
          status: 'completed',
          follow_up_due_at: '2026-08-26T00:00:00.000Z',
          created_at: '2026-08-20T00:00:00.000Z',
          completed_at: '2026-08-26T00:00:00.000Z',
          outcome_rating: 'no_change',
          engagement_score_delta: 2,
        },
        {
          action_type: 'guidance_counseling',
          status: 'open',
          follow_up_due_at: '2026-08-29T00:00:00.000Z',
          created_at: '2026-08-22T00:00:00.000Z',
          completed_at: null,
          outcome_rating: null,
          engagement_score_delta: null,
        },
      ],
      new Date('2026-08-30T00:00:00.000Z'),
    );

    expect(result.total).toBe(3);
    expect(result.open).toBe(1);
    expect(result.due).toBe(1);
    expect(result.completed).toBe(2);
    expect(result.improved).toBe(1);
    expect(result.completionRate).toBe(66.7);
    expect(result.averageEngagementDelta).toBe(6);
    expect(result.averageDaysToOutcome).toBe(5.5);
    expect(result.byAction[0]).toMatchObject({
      actionType: 'send_reminder',
      total: 2,
      completed: 2,
      improved: 1,
    });
  });

  it('returns neutral values for an empty data set', () => {
    expect(computeInterventionEffectiveness([])).toMatchObject({
      total: 0,
      open: 0,
      due: 0,
      completed: 0,
      completionRate: 0,
      averageEngagementDelta: null,
      averageDaysToOutcome: null,
    });
  });
});
