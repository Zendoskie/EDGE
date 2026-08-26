import { describe, expect, it } from 'vitest';
import { buildEngagementNextSteps } from '@/lib/engagement-next-steps';
import { pickAttentionStudents } from '@/components/EngagementRiskAttentionPanel';

describe('buildEngagementNextSteps', () => {
  it('returns actionable tips for inactive students', () => {
    const tips = buildEngagementNextSteps('low', 20);
    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0].title.toLowerCase()).toMatch(/log in|login/);
  });
});

describe('pickAttentionStudents', () => {
  it('prioritizes both low engagement and high risk', () => {
    const rows = [
      {
        studentId: 'a',
        fullName: 'Active Safe',
        engagementLevel: 'high' as const,
        engagementScore: 80,
        riskLevel: 'stable' as const,
        riskScore: 20,
      },
      {
        studentId: 'b',
        fullName: 'Both Signals',
        engagementLevel: 'low' as const,
        engagementScore: 15,
        riskLevel: 'critical' as const,
        riskScore: 90,
      },
      {
        studentId: 'c',
        fullName: 'Low Only',
        engagementLevel: 'moderate' as const,
        engagementScore: 45,
        riskLevel: 'excelling' as const,
        riskScore: 10,
      },
    ];
    const picked = pickAttentionStudents(rows, 5);
    expect(picked[0]?.studentId).toBe('b');
    expect(picked.some((p) => p.studentId === 'a')).toBe(false);
  });
});
