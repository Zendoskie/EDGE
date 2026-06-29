import { describe, expect, it } from 'vitest';
import {
  classifyEngagementScore,
  computeEngagementScore,
  computeLoginFrequencyScore,
  computeParticipationScore,
  isEngagementDrop,
} from '@/lib/engagement-scoring';

describe('engagement-scoring', () => {
  it('scores login frequency against weekly target', () => {
    expect(computeLoginFrequencyScore(5, 7)).toBe(100);
    expect(computeLoginFrequencyScore(0, 30)).toBe(0);
  });

  it('scores participation against target', () => {
    expect(computeParticipationScore(20)).toBe(100);
    expect(computeParticipationScore(10)).toBe(50);
  });

  it('computes weighted engagement score', () => {
    const score = computeEngagementScore({
      loginCount: 5,
      participationCount: 20,
      materialViewCount: 15,
      totalSubmissions: 4,
      timelySubmissions: 4,
      windowDays: 7,
    });
    expect(score).toBeGreaterThanOrEqual(90);
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
