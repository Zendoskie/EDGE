import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_SUBJECT_GRADING_WEIGHTS,
  assessmentPercent,
  computeExamAverage,
  computeSubjectWeightedGrade,
  computeWeightedGrade,
  formatGradePercent,
  gradeItemPercent,
  linearAssessmentPercent,
  roundGrade2,
  sameGradingWeights,
  transmutedAssessmentPercent,
  usesTransmutation,
} from './weighted-grading';
import { GRADE_CASES, attendancePercentOf } from './weighted-grading.fixtures';

describe('weighted grading', () => {
  it('default weights total 100', () => {
    const w = DEFAULT_SUBJECT_GRADING_WEIGHTS;
    expect(w.activity_weight + w.project_weight + w.attendance_weight + w.exam_weight).toBe(100);
  });

  it('uses the default weights when the subject has no saved row', () => {
    const args = { activityAverage: 80, projectAverage: 90, attendancePercent: 100, examAverage: 70 };
    expect(computeWeightedGrade({ ...args, weights: null })).toBeCloseTo(82, 10);
    expect(computeWeightedGrade({ ...args, weights: null })).toBe(
      computeWeightedGrade({ ...args, weights: DEFAULT_SUBJECT_GRADING_WEIGHTS }),
    );
  });

  for (const c of GRADE_CASES) {
    it(c.name, () => {
      const { weightedAverage } = computeSubjectWeightedGrade({
        items: c.items,
        attendancePercent: attendancePercentOf(c.attendance),
        weights: c.weights,
      });
      if (c.expected == null) expect(weightedAverage).toBeNull();
      else expect(weightedAverage).toBeCloseTo(c.expected, 10);
    });
  }

  it('keeps each Activity contribution within its equal share', () => {
    const percents = [90, 80, 70];
    const share = DEFAULT_SUBJECT_GRADING_WEIGHTS.activity_weight / percents.length;
    const contributions = percents.map((p) => (share * p) / 100);
    for (const c of contributions) expect(c).toBeLessThanOrEqual(share);
    expect(contributions.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 10);
    expect(share).toBeCloseTo(8.3333, 4);
  });

  it('normalizes linear scores and treats zero as a grade, never dividing by zero', () => {
    expect(linearAssessmentPercent(45, 50)).toBe(90);
    expect(linearAssessmentPercent(0, 50)).toBe(0);
    expect(assessmentPercent(null, 50)).toBeNull();
    expect(assessmentPercent(undefined, 50)).toBeNull();
    expect(assessmentPercent(10, 0)).toBeNull();
    expect(assessmentPercent(10, -5)).toBeNull();
    expect(assessmentPercent(10, null)).toBeNull();
    expect(assessmentPercent(Number.NaN, 50)).toBeNull();
    expect(assessmentPercent(10, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('applies base-50 transmutation for activity, project, and exams', () => {
    expect(transmutedAssessmentPercent(0, 50)).toBe(50);
    expect(transmutedAssessmentPercent(50, 50)).toBe(100);
    expect(transmutedAssessmentPercent(45, 50)).toBe(95);
    expect(usesTransmutation('activity')).toBe(true);
    expect(usesTransmutation('project')).toBe(true);
    expect(usesTransmutation('midterm_exam')).toBe(true);
    expect(usesTransmutation('quiz')).toBe(false);
    expect(
      gradeItemPercent({ type: 'quiz', score: 0, maxScore: 50 }),
    ).toBe(0);
    expect(
      gradeItemPercent({ type: 'activity', score: 0, maxScore: 50 }),
    ).toBe(50);
  });

  it('splits the Exam category only once a Final score exists', () => {
    expect(computeExamAverage([80], [])).toBe(80);
    expect(computeExamAverage([80], [null])).toBe(80);
    expect(computeExamAverage([80], [60])).toBe(70);
    expect(computeExamAverage([80], [0])).toBe(40);
    expect(computeExamAverage([], [60])).toBe(60);
    expect(computeExamAverage([], [])).toBeNull();
  });

  it('MyScores and ParentPerformance use the shared grade helper', () => {
    for (const file of ['../pages/dashboard/MyScores.tsx', '../pages/dashboard/ParentPerformance.tsx']) {
      const src = readFileSync(resolve(__dirname, file), 'utf8');
      expect(src).toContain('computeSubjectWeightedGrade(');
      expect(src).not.toMatch(/computeWeightedGrade\(|isExamAssessmentType|averageOf\(/);
      // Whole-number rounding would show 89.60 as 90% beside a Stable label; FinalGradeBadge formats it.
      expect(src).toMatch(/<FinalGradeBadge[\s\S]*?provisionalGrade=\{(s\.)?weightedAverage\}/);
      expect(src).not.toMatch(/Math\.round\((s\.)?weightedAverage\)/);
    }
    expect(readFileSync(resolve(__dirname, '../components/FinalGradeBadge.tsx'), 'utf8')).toContain('formatGradePercent(');
  });

  it('formats grades with two decimals and no band-crossing rounding', () => {
    expect(formatGradePercent(89.6)).toBe('89.60%');
    expect(formatGradePercent(89.995)).toBe('90.00%');
    expect(formatGradePercent(82)).toBe('82.00%');
    expect(formatGradePercent(null)).toBe('—');
    expect(roundGrade2(Number.NaN)).toBeNull();
  });

  it('compares effective grading weights, with no saved row meaning the defaults', () => {
    expect(sameGradingWeights(null, DEFAULT_SUBJECT_GRADING_WEIGHTS)).toBe(true);
    expect(sameGradingWeights(null, null)).toBe(true);
    const custom = { activity_weight: 40, project_weight: 0, attendance_weight: 10, exam_weight: 50 };
    expect(sameGradingWeights(custom, { ...custom })).toBe(true);
    expect(sameGradingWeights(null, custom)).toBe(false);
    expect(sameGradingWeights(custom, { ...custom, project_weight: 5, exam_weight: 45 })).toBe(false);
    expect(
      sameGradingWeights(custom, { ...custom, activity_weight: '40' as unknown as number }),
    ).toBe(true);
  });
});
