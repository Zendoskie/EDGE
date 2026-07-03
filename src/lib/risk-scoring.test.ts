import { describe, expect, it } from 'vitest';
import {
  classifyRiskScore,
  computeAcademicPerformance,
  computeExamAverage,
  computeRiskClassification,
  computeRiskScore,
} from '@/lib/risk-scoring';

describe('risk-scoring', () => {
  it('computes academic performance as average of activity, quiz, and project', () => {
    expect(
      computeAcademicPerformance({ activityAverage: 80, quizAverage: 90, projectScore: 70 }),
    ).toBe(80);
  });

  it('computes exam average from laboratory, midterm, and final', () => {
    expect(
      computeExamAverage({ laboratoryExamAverage: 60, midtermExamAverage: 80, finalExamAverage: 70 }),
    ).toBe(70);
  });

  it('applies 50/20/30 weighted formula when all components present', () => {
    const score = computeRiskScore({
      activityAverage: 80,
      quizAverage: 80,
      projectScore: 80,
      attendancePercent: 90,
      laboratoryExamAverage: 70,
      midtermExamAverage: 70,
      finalExamAverage: 70,
    });
    // academic=80, attendance=90, exams=70 => 0.5*80 + 0.2*90 + 0.3*70 = 79
    expect(score).toBe(79);
  });

  it('uses the requested sample calculation and returns Excelling', () => {
    const result = computeRiskClassification({
      activityAverage: 95,
      quizAverage: 90,
      projectScore: 94,
      attendancePercent: 98,
      laboratoryExamAverage: 91,
      midtermExamAverage: 89,
      finalExamAverage: 93,
    });

    expect(result.academic_performance).toBe(93);
    expect(result.exam_average).toBe(91);
    expect(result.risk_score).toBe(93.4);
    expect(result.risk_level).toBe('excelling');
  });

  it('excludes missing assessment types from academic and exam averages', () => {
    expect(
      computeAcademicPerformance({ activityAverage: 95, quizAverage: 90, projectScore: null }),
    ).toBe(92.5);
    expect(
      computeExamAverage({ laboratoryExamAverage: 91, midtermExamAverage: null, finalExamAverage: 93 }),
    ).toBe(92);
  });

  it('classifies scores into four levels', () => {
    expect(classifyRiskScore(95)).toBe('excelling');
    expect(classifyRiskScore(82)).toBe('stable');
    expect(classifyRiskScore(68)).toBe('at_risk');
    expect(classifyRiskScore(55)).toBe('critical');
    expect(classifyRiskScore(90)).toBe('excelling');
    expect(classifyRiskScore(89.99)).toBe('stable');
    expect(classifyRiskScore(80)).toBe('stable');
    expect(classifyRiskScore(75)).toBe('stable');
    expect(classifyRiskScore(74.99)).toBe('at_risk');
    expect(classifyRiskScore(65)).toBe('at_risk');
    expect(classifyRiskScore(60)).toBe('at_risk');
    expect(classifyRiskScore(59.99)).toBe('critical');
    expect(classifyRiskScore(59)).toBe('critical');
  });

  it('returns full classification result', () => {
    const result = computeRiskClassification({
      activityAverage: 95,
      quizAverage: 95,
      projectScore: 95,
      attendancePercent: 95,
      laboratoryExamAverage: 95,
      midtermExamAverage: 95,
      finalExamAverage: 95,
    });
    expect(result.risk_level).toBe('excelling');
    expect(result.risk_score).toBe(95);
    expect(result.confidence).toBe(0.95);
  });
});
