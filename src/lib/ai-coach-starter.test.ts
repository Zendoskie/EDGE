import { describe, expect, it } from 'vitest';
import { buildContextualStarter } from '@/lib/ai-coach-starter';

describe('buildContextualStarter', () => {
  it('includes band explanation and study-plan prep for at-risk students', () => {
    const msgs = buildContextualStarter(
      'at_risk',
      {
        subjectId: 's1',
        subjectCode: 'CS101',
        subjectName: 'Intro',
        riskClassification: 'at_risk',
        riskScore: 76,
        riskEvidence: null,
        attendancePercent: 70,
        activityScorePercent: 65,
        quizScorePercent: null,
        laboratoryExamPercent: null,
        comprehensionRating: null,
        systemRecommendation: 'Review quizzes',
        createdAt: null,
      },
      'CS101',
      [],
    );
    expect(msgs[0].content).toMatch(/Vulnerable/);
    expect(msgs[0].content).toMatch(/7-day study plan/);
    expect(msgs[0].content).toMatch(/Crucial: below 75%/);
  });
});
