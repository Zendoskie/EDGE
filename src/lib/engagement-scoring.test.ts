import { describe, expect, it } from 'vitest';
import {
  classifyEngagementScore,
  computeEngagementScore,
  computeLoginFrequencyScore,
  computeTimeSpentScore,
  computeAssignmentActivityScore,
  computeAiFeedbackScore,
  isEngagementDrop,
} from '@/lib/engagement-scoring';

describe('engagement-scoring', () => {
  it('scores login frequency against weekly target', () => {
    expect(computeLoginFrequencyScore(5, 7)).toBe(100);
    expect(computeLoginFrequencyScore(0, 30)).toBe(0);
  });

  it('scores time spent against weekly hour target', () => {
    expect(computeTimeSpentScore(5 * 3600, 7)).toBe(100);
    expect(computeTimeSpentScore(0, 30)).toBe(0);
  });

  it('scores assignment and AI/feedback participation', () => {
    expect(computeAssignmentActivityScore(10)).toBe(100);
    expect(computeAssignmentActivityScore(5)).toBe(50);
    expect(computeAiFeedbackScore(5)).toBe(100);
    expect(computeAiFeedbackScore(1)).toBe(20);
  });

  it('computes weighted engagement score (40/30/20/10)', () => {
    const score = computeEngagementScore({
      loginCount: 5,
      timeSpentSeconds: 5 * 3600,
      assignmentActivityCount: 10,
      aiFeedbackCount: 5,
      windowDays: 7,
    });
    expect(score).toBe(100);
  });

  it('classifies scores into four levels', () => {
    expect(classifyEngagementScore(85)).toBe('very_high');
    expect(classifyEngagementScore(70)).toBe('high');
    expect(classifyEngagementScore(50)).toBe('moderate');
    expect(classifyEngagementScore(30)).toBe('low');
  });

  it('detects engagement drops', () => {
    expect(isEngagementDrop('high', 'moderate')).toBe(true);
    expect(isEngagementDrop('high', 'low')).toBe(true);
    expect(isEngagementDrop('moderate', 'high')).toBe(false);
  });
});
