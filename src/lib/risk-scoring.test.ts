import { describe, expect, it } from 'vitest';
import {
  MINIMUM_GRADED_ACTIVITIES_FOR_CONFIDENT_RISK,
  RISK_WEIGHTS,
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

  it('keeps the official 50/20/30 weights', () => {
    expect(RISK_WEIGHTS).toEqual({ academic: 0.5, attendance: 0.2, exams: 0.3 });
    expect(MINIMUM_GRADED_ACTIVITIES_FOR_CONFIDENT_RISK).toBe(3);
  });

  const poorGrade = {
    activityAverage: 20,
    quizAverage: null,
    projectScore: null,
    attendancePercent: null,
    laboratoryExamAverage: null,
    midtermExamAverage: null,
    finalExamAverage: null,
  };

  it('A. does not fabricate a score when there are no grades', () => {
    const result = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      gradedActivityCount: 0,
    });
    expect(result.academic_performance).toBeNull();
    expect(result.risk_score).toBeNull();
    expect(result.risk_level).toBe('stable');
  });

  it('B. does not mark one very poor grade as Crucial', () => {
    const result = computeRiskClassification({ ...poorGrade, gradedActivityCount: 1 });
    expect(result.risk_score).toBe(20);
    expect(result.risk_level).toBe('at_risk');
  });

  it('C. stays conservative with two very poor grades', () => {
    const result = computeRiskClassification({ ...poorGrade, activityAverage: 15, gradedActivityCount: 2 });
    expect(result.risk_score).toBe(15);
    expect(result.risk_level).toBe('at_risk');
  });

  it('D. applies the existing classification once three poor grades exist', () => {
    const result = computeRiskClassification({ ...poorGrade, gradedActivityCount: 3 });
    expect(result.risk_score).toBe(20);
    expect(result.risk_level).toBe('critical');
  });

  it('E. does not turn three good grades into Crucial', () => {
    const result = computeRiskClassification({
      activityAverage: 95,
      quizAverage: 95,
      projectScore: 95,
      attendancePercent: 95,
      laboratoryExamAverage: 95,
      midtermExamAverage: 95,
      finalExamAverage: 95,
      gradedActivityCount: 3,
    });
    expect(result.risk_level).toBe('excelling');
    expect(result.risk_score).toBe(95);
  });

  it('F. updates classification when another grade supplies enough evidence', () => {
    const before = computeRiskClassification({ ...poorGrade, gradedActivityCount: 2 });
    const after = computeRiskClassification({ ...poorGrade, gradedActivityCount: 3 });
    expect(before.risk_level).toBe('at_risk');
    expect(after.risk_level).toBe('critical');
    expect(after.risk_score).toBe(before.risk_score);
  });

  it('G. still treats independently Crucial attendance as valid evidence', () => {
    const sparseGrades = computeRiskClassification({
      ...poorGrade,
      attendancePercent: 40,
      gradedActivityCount: 1,
    });
    expect(sparseGrades.risk_level).toBe('critical');

    const noGrades = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: 40,
      gradedActivityCount: 0,
    });
    expect(noGrades.academic_performance).toBeNull();
    expect(noGrades.risk_score).toBe(40);
    expect(noGrades.risk_level).toBe('critical');

    const strongAttendance = computeRiskClassification({
      ...poorGrade,
      attendancePercent: 98,
      gradedActivityCount: 1,
    });
    expect(strongAttendance.risk_level).not.toBe('critical');
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
