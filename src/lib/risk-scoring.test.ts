import { describe, expect, it } from 'vitest';
import {
  MINIMUM_ATTENDANCE_SESSIONS_FOR_INDEPENDENT_RISK,
  MINIMUM_GRADED_ACTIVITIES_FOR_CONFIDENT_RISK,
  RISK_WEIGHTS,
  classifyRiskScore,
  computeAcademicPerformance,
  computeExamAverage,
  computeRiskClassification,
  computeRiskScore,
  formatOfficialRiskLabel,
  type RiskScoreInputs,
} from '@/lib/risk-scoring';
import { computeRiskClassification as computeEdgeRiskClassification } from '../../supabase/functions/_shared/risk-scoring';

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
    expect(MINIMUM_ATTENDANCE_SESSIONS_FOR_INDEPENDENT_RISK).toBe(3);
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
    expect(result.risk_level).toBe('stable');
  });

  it('C. stays Stable with two very poor grades', () => {
    const result = computeRiskClassification({ ...poorGrade, activityAverage: 15, gradedActivityCount: 2 });
    expect(result.risk_score).toBe(15);
    expect(result.risk_level).toBe('stable');
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
    expect(before.risk_level).toBe('stable');
    expect(after.risk_level).toBe('critical');
    expect(after.risk_score).toBe(before.risk_score);
  });

  it('G. uses attendance bands only after three recorded sessions', () => {
    const oneAbsence = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: 0,
      attendanceSessionCount: 1,
      gradedActivityCount: 0,
    });
    expect(oneAbsence.risk_score).toBe(0);
    expect(oneAbsence.risk_level).toBe('stable');

    const onePresence = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: 100,
      attendanceSessionCount: 1,
      gradedActivityCount: 0,
    });
    expect(onePresence.risk_score).toBe(100);
    expect(onePresence.risk_level).toBe('stable');

    const twoOfFive = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: (2 / 5) * 100,
      attendanceSessionCount: 5,
      gradedActivityCount: 0,
    });
    expect(twoOfFive.academic_performance).toBeNull();
    expect(twoOfFive.risk_score).toBe(40);
    expect(twoOfFive.risk_level).toBe('critical');

    const twoOfThree = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: (2 / 3) * 100,
      attendanceSessionCount: 3,
      gradedActivityCount: 0,
    });
    expect(twoOfThree.risk_score).toBe(66.7);
    expect(twoOfThree.risk_level).toBe('at_risk');

    const threeOfThree = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: 100,
      attendanceSessionCount: 3,
      gradedActivityCount: 0,
    });
    expect(threeOfThree.risk_score).toBe(100);
    expect(threeOfThree.risk_level).toBe('stable');
  });

  it('does not let one low grade or one absence become Crucial', () => {
    const oneLowGrade = computeRiskClassification({ ...poorGrade, gradedActivityCount: 1 });
    expect(oneLowGrade.risk_score).toBe(20);
    expect(oneLowGrade.risk_level).toBe('stable');

    const lowGradeAndOneAbsence = computeRiskClassification({
      ...poorGrade,
      attendancePercent: 0,
      attendanceSessionCount: 1,
      gradedActivityCount: 1,
    });
    expect(lowGradeAndOneAbsence.risk_level).toBe('stable');
  });

  it('does not let a high grade hide supported attendance risk', () => {
    const hidden = computeRiskClassification({
      ...poorGrade,
      activityAverage: 100,
      attendancePercent: (2 / 5) * 100,
      attendanceSessionCount: 5,
      gradedActivityCount: 1,
    });
    expect(hidden.risk_level).toBe('critical');

    const lowWithSupportedAbsence = computeRiskClassification({
      ...poorGrade,
      attendancePercent: (2 / 5) * 100,
      attendanceSessionCount: 5,
      gradedActivityCount: 1,
    });
    expect(lowWithSupportedAbsence.risk_level).toBe('critical');

    const lowWithFullAttendance = computeRiskClassification({
      ...poorGrade,
      attendancePercent: 100,
      attendanceSessionCount: 3,
      gradedActivityCount: 1,
    });
    expect(lowWithFullAttendance.risk_level).toBe('stable');
  });

  it('keeps one high sparse grade Excelling and follows bands once three scores exist', () => {
    const oneHigh = computeRiskClassification({
      ...poorGrade,
      activityAverage: 95,
      gradedActivityCount: 1,
    });
    expect(oneHigh.risk_level).toBe('excelling');

    const sparseMix = computeRiskClassification({
      ...poorGrade,
      activityAverage: 65,
      gradedActivityCount: 2,
    });
    const enoughMix = computeRiskClassification({
      ...poorGrade,
      activityAverage: 65,
      gradedActivityCount: 3,
    });
    expect(sparseMix.risk_level).toBe('stable');
    expect(enoughMix.risk_level).toBe('at_risk');
    expect(enoughMix.risk_score).toBe(sparseMix.risk_score);
  });

  it('does not let omitted attendance sessions override a sparse-grade hold', () => {
    const result = computeRiskClassification({
      ...poorGrade,
      activityAverage: null,
      attendancePercent: 40,
      gradedActivityCount: 0,
    });
    expect(result.risk_score).toBe(40);
    expect(result.risk_level).toBe('stable');
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

  it('shows the formula score only when it matches the official label', () => {
    expect(formatOfficialRiskLabel('stable', 20)).toBe('Stable');
    expect(formatOfficialRiskLabel('critical', 20)).toBe('Crucial (20)');
    expect(formatOfficialRiskLabel('critical', 79)).toBe('Crucial');
    expect(formatOfficialRiskLabel('at_risk', 66.7)).toBe('Vulnerable (66.7)');
    expect(classifyRiskScore(20)).toBe('critical');
    expect(classifyRiskScore(79)).toBe('stable');
    expect(classifyRiskScore(66.7)).toBe('at_risk');
  });

  it('keeps the Edge Function classification identical to the app copy', () => {
    const cases: RiskScoreInputs[] = [
      {
        ...poorGrade,
        activityAverage: null,
        gradedActivityCount: 0,
      },
      {
        ...poorGrade,
        activityAverage: null,
        attendancePercent: 0,
        attendanceSessionCount: 1,
        gradedActivityCount: 0,
      },
      {
        ...poorGrade,
        activityAverage: null,
        attendancePercent: 100,
        attendanceSessionCount: 1,
        gradedActivityCount: 0,
      },
      {
        ...poorGrade,
        activityAverage: null,
        attendancePercent: (2 / 5) * 100,
        attendanceSessionCount: 5,
        gradedActivityCount: 0,
      },
      {
        ...poorGrade,
        activityAverage: null,
        attendancePercent: (2 / 3) * 100,
        attendanceSessionCount: 3,
        gradedActivityCount: 0,
      },
      {
        ...poorGrade,
        activityAverage: null,
        attendancePercent: 100,
        attendanceSessionCount: 3,
        gradedActivityCount: 0,
      },
      { ...poorGrade, gradedActivityCount: 1 },
      { ...poorGrade, activityAverage: 15, gradedActivityCount: 2 },
      {
        ...poorGrade,
        attendancePercent: 0,
        attendanceSessionCount: 1,
        gradedActivityCount: 1,
      },
      {
        ...poorGrade,
        activityAverage: 100,
        attendancePercent: (2 / 5) * 100,
        attendanceSessionCount: 5,
        gradedActivityCount: 1,
      },
      {
        ...poorGrade,
        attendancePercent: 100,
        attendanceSessionCount: 3,
        gradedActivityCount: 1,
      },
      { ...poorGrade, gradedActivityCount: 3 },
      {
        activityAverage: 95,
        quizAverage: 90,
        projectScore: 94,
        attendancePercent: 98,
        laboratoryExamAverage: 91,
        midtermExamAverage: 89,
        finalExamAverage: 93,
        gradedActivityCount: 3,
        attendanceSessionCount: 12,
      },
      {
        ...poorGrade,
        activityAverage: null,
        attendancePercent: 40,
        gradedActivityCount: 0,
      },
    ];

    for (const inputs of cases) {
      const app = computeRiskClassification(inputs);
      const edge = computeEdgeRiskClassification(inputs);
      expect(edge.risk_level).toBe(app.risk_level);
      expect(edge.risk_score).toBe(app.risk_score);
    }
  });
});
