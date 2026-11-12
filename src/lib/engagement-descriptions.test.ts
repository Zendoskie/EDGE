import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_CONFIG } from '@/lib/engagement-config';
import { PARENT_ENGAGEMENT_CONFIG } from '@/lib/parent-engagement';
import {
  parentEngagementExplanation,
  studentEngagementExplanation,
} from '@/lib/engagement-descriptions';

describe('engagement-descriptions', () => {
  it('describes the student score with the same weights as the computation', () => {
    const explanation = studentEngagementExplanation();
    const totalWeight = explanation.pillars.reduce((sum, pillar) => sum + pillar.weightPercent, 0);

    expect(totalWeight).toBe(100);
    expect(explanation.pillars.map((pillar) => pillar.weightPercent)).toEqual([40, 30, 20, 10]);
    expect(explanation.windowDays).toBe(ENGAGEMENT_CONFIG.windowDays);
    expect(explanation.summary).toMatch(/not an academic grade/i);
  });

  it('states the time target and that idle time is excluded', () => {
    const explanation = studentEngagementExplanation();
    const timePillar = explanation.pillars.find((pillar) => pillar.key === 'timeSpent');

    expect(timePillar?.target).toContain(`${ENGAGEMENT_CONFIG.timeSpentTargetHoursPerWeek} hours`);
    expect(timePillar?.detail).toMatch(/idle|hidden/i);
  });

  it('describes the four level bands', () => {
    const explanation = studentEngagementExplanation();
    expect(explanation.levels.map((level) => level.minimum)).toEqual([
      ENGAGEMENT_CONFIG.thresholds.veryHigh,
      ENGAGEMENT_CONFIG.thresholds.high,
      ENGAGEMENT_CONFIG.thresholds.moderate,
      0,
    ]);
  });

  it('describes parent check-in engagement separately from the student score', () => {
    const explanation = parentEngagementExplanation();

    expect(explanation.pillars).toHaveLength(1);
    expect(explanation.pillars[0].weightPercent).toBe(100);
    expect(explanation.pillars[0].detail).toContain(
      `${PARENT_ENGAGEMENT_CONFIG.dedupeMinutes} minutes`,
    );
    expect(explanation.windowDays).toBe(PARENT_ENGAGEMENT_CONFIG.windowDays);
    expect(explanation.summary).toMatch(/separate from the student engagement score/i);
  });
});
