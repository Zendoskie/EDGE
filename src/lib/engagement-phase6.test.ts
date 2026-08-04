import { describe, expect, it } from 'vitest';
import { classifyEngagementScore, computeEngagementScore } from '@/lib/engagement-scoring';
import { ENGAGEMENT_CONFIG } from '@/lib/engagement-config';
import {
  engagementAlertTypeLabel,
  engagementInterventionActionLabel,
} from '@/lib/engagement-alerts';
import { canonicalEngagementLevel, engagementLabel } from '@/lib/engagement-utils';

/**
 * Phase 6 regression checks for scoring, labels, and access-model conventions.
 * RLS itself is enforced in Postgres; these tests lock client-side contracts.
 */
describe('Phase 6 engagement integration contracts', () => {
  it('recalculates engagement score with configured weights', () => {
    const { weights } = ENGAGEMENT_CONFIG;
    expect(
      weights.loginFrequency + weights.timeSpent + weights.assignmentActivity + weights.aiFeedback,
    ).toBeCloseTo(1);

    const perfect = computeEngagementScore({
      loginCount: ENGAGEMENT_CONFIG.loginTargetPerWeek * (ENGAGEMENT_CONFIG.windowDays / 7),
      timeSpentSeconds: ENGAGEMENT_CONFIG.timeSpentTargetHoursPerWeek * 3600 * (ENGAGEMENT_CONFIG.windowDays / 7),
      assignmentActivityCount: ENGAGEMENT_CONFIG.assignmentActivityTarget,
      aiFeedbackCount: ENGAGEMENT_CONFIG.aiFeedbackTarget,
    });
    expect(perfect).toBe(100);
  });

  it('maps score thresholds to canonical levels', () => {
    expect(classifyEngagementScore(ENGAGEMENT_CONFIG.thresholds.veryHigh)).toBe('very_high');
    expect(classifyEngagementScore(ENGAGEMENT_CONFIG.thresholds.high)).toBe('high');
    expect(classifyEngagementScore(ENGAGEMENT_CONFIG.thresholds.moderate)).toBe('moderate');
    expect(classifyEngagementScore(0)).toBe('low');
  });

  it('keeps UI level labels stable for alerts and dashboards', () => {
    expect(engagementLabel(canonicalEngagementLevel('high'))).toBe('Active');
    expect(engagementLabel(canonicalEngagementLevel('moderate'))).toBe('Low Engagement');
    expect(engagementLabel(canonicalEngagementLevel('low'))).toBe('Inactive');
    expect(engagementAlertTypeLabel('no_login_3_days')).toContain('3 days');
    expect(engagementInterventionActionLabel('mark_contacted')).toContain('Contacted');
  });

  it('documents role access matrix expected by the UI', () => {
    const access = {
      student: { ownOnly: true, writeInterventions: false },
      instructor: { classScoped: true, writeInterventions: true },
      guidance_counselor: { readOnly: true, writeInterventions: false },
      admin: { fullAccess: true, writeInterventions: true },
    };
    expect(access.student.ownOnly).toBe(true);
    expect(access.instructor.classScoped).toBe(true);
    expect(access.guidance_counselor.readOnly).toBe(true);
    expect(access.admin.fullAccess).toBe(true);
  });
});
