import { describe, expect, it } from 'vitest';
import {
  PARENT_ENGAGEMENT_CONFIG,
  classifyParentEngagementScore,
  computeParentEngagementScore,
  countCheckInsInWindow,
  latestCheckIn,
  summarizeParentEngagement,
  summarizeParentEngagementByParent,
} from '@/lib/parent-engagement';

describe('parent-engagement', () => {
  it('scores check-ins against the weekly target', () => {
    expect(computeParentEngagementScore(0, 7)).toBe(0);
    expect(computeParentEngagementScore(1, 7)).toBe(50);
    expect(computeParentEngagementScore(2, 7)).toBe(100);
    expect(computeParentEngagementScore(50, 7)).toBe(100);
    expect(computeParentEngagementScore(0, PARENT_ENGAGEMENT_CONFIG.windowDays)).toBe(0);
  });

  it('classifies the score into the same four bands', () => {
    expect(classifyParentEngagementScore(90)).toBe('very_high');
    expect(classifyParentEngagementScore(65)).toBe('high');
    expect(classifyParentEngagementScore(45)).toBe('moderate');
    expect(classifyParentEngagementScore(10)).toBe('low');
    expect(classifyParentEngagementScore(null)).toBe('moderate');
  });

  it('counts only check-ins inside the rolling window', () => {
    const now = new Date('2026-11-10T12:00:00.000Z');
    const timestamps = [
      '2026-11-10T09:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
      '2026-09-01T09:00:00.000Z',
      '2026-11-11T09:00:00.000Z',
      null,
      'not-a-date',
    ];
    expect(countCheckInsInWindow(timestamps, now, 30)).toBe(2);
    expect(latestCheckIn(timestamps)).toBe('2026-11-11T09:00:00.000Z');
  });

  it('summarizes the parent score, level, and last check-in', () => {
    const now = new Date('2026-11-10T12:00:00.000Z');
    const summary = summarizeParentEngagement(
      [
        '2026-11-10T09:00:00.000Z',
        '2026-11-08T09:00:00.000Z',
        '2026-11-05T09:00:00.000Z',
        '2026-11-03T09:00:00.000Z',
        '2026-10-30T09:00:00.000Z',
      ],
      now,
    );

    expect(summary.checkInCount).toBe(5);
    // Five check-ins across 30 days is about 1.2 per week against a 2/week target.
    expect(summary.score).toBe(58.3);
    expect(summary.level).toBe('moderate');
    expect(summary.lastCheckInAt).toBe('2026-11-10T09:00:00.000Z');
  });

  it('reports the most active linked parent for instructors', () => {
    const now = new Date('2026-11-10T12:00:00.000Z');
    const summary = summarizeParentEngagementByParent(
      [
        { parent_user_id: 'parent-a', viewed_at: '2026-11-09T09:00:00.000Z' },
        { parent_user_id: 'parent-a', viewed_at: '2026-11-02T09:00:00.000Z' },
        { parent_user_id: 'parent-b', viewed_at: '2026-11-10T09:00:00.000Z' },
      ],
      now,
    );

    expect(summary.parentCount).toBe(2);
    expect(summary.best.checkInCount).toBe(2);
    expect(summary.best.score).toBe(computeParentEngagementScore(2, 30));
  });

  it('returns an empty summary when no parent has checked in', () => {
    const summary = summarizeParentEngagementByParent([], new Date('2026-11-10T12:00:00.000Z'));
    expect(summary.parentCount).toBe(0);
    expect(summary.best.score).toBe(0);
  });
});
