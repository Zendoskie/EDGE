import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RISK_BANDS,
  classifyRiskScore,
  formatOfficialRiskLabel,
  predictionCoverage,
} from '@/lib/risk-scoring';
import {
  computeSubjectWeightedGrade,
  roundGrade2,
  type GradeItem,
  type SubjectGradingWeights,
} from '@/lib/weighted-grading';
import { GRADE_CASES, attendancePercentOf } from '@/lib/weighted-grading.fixtures';
import {
  RISK_BANDS as EDGE_RISK_BANDS,
  classifyRiskScore as edgeClassifyRiskScore,
  classifyStudentRisk,
  isSubjectOwner,
  legacyConfidence,
  planPredictionWrites,
  type ExistingPrediction,
  type PredictionValues,
} from '../../supabase/functions/_shared/risk-scoring';
import { roundGrade2 as edgeRoundGrade2 } from '../../supabase/functions/_shared/weighted-grading';

const item = (type: string, score: number | null, maxScore = 100): GradeItem => ({
  type,
  assessmentType: type,
  score,
  maxScore,
});

const NO_PROJECT_WEIGHTS: SubjectGradingWeights = {
  activity_weight: 35,
  project_weight: 0,
  attendance_weight: 15,
  exam_weight: 50,
};

describe('risk bands', () => {
  it('uses 90 / 80 / 75 on both copies', () => {
    expect(RISK_BANDS).toEqual({ excelling: 90, stable: 80, at_risk: 75 });
    expect(EDGE_RISK_BANDS).toEqual(RISK_BANDS);
  });

  it.each([
    [100, 'excelling'],
    [90, 'excelling'],
    [89.99, 'stable'],
    [80, 'stable'],
    [79.99, 'at_risk'],
    [75, 'at_risk'],
    [74.99, 'critical'],
    [0, 'critical'],
    [null, 'stable'],
  ] as const)('classifies %s as %s', (score, level) => {
    expect(classifyRiskScore(score)).toBe(level);
    expect(edgeClassifyRiskScore(score)).toBe(level);
  });

  it.each([
    [89.995, 90],
    [89.994, 89.99],
    [79.995, 80],
    [74.995, 75],
    [89.6, 89.6],
  ])('rounds %s to %s on both copies', (raw, rounded) => {
    expect(roundGrade2(raw)).toBe(rounded);
    expect(edgeRoundGrade2(raw)).toBe(rounded);
  });
});

describe('classifyStudentRisk', () => {
  const full = (activity: number, project: number, exam: number) => [
    item('activity', activity),
    item('project', project),
    item('midterm_exam', exam),
  ];

  it('classifies a computed 89.995 as Excelling (90.00)', () => {
    // Raw scores on max 100 are transmuted (50 + raw/2); ~80 raw across buckets yields ~89.995 weighted with 90% attendance.
    const r = classifyStudentRisk({ items: full(79.99, 79.99, 79.99), attendancePercent: 90, weights: null });
    expect(r.risk_score).toBe(90);
    expect(r.risk_level).toBe('excelling');
    expect(r.coverage.complete).toBe(true);
  });

  it('stores the same two-decimal value it classifies', () => {
    const items = full(79.06, 79.06, 79.06);
    const expected = roundGrade2(
      computeSubjectWeightedGrade({ items, attendancePercent: 89.6, weights: null }).weightedAverage,
    );
    const r = classifyStudentRisk({ items, attendancePercent: 89.6, weights: null });
    expect(r.risk_score).toBe(expected);
    expect(r.risk_level).toBe('stable');
  });

  it('holds Excelling at Stable while Project has no scores', () => {
    const items = [item('activity', 95), item('midterm_exam', 95)];
    const r = classifyStudentRisk({ items, attendancePercent: 100, weights: null });
    expect(r.band).toBe('excelling');
    expect(r.risk_level).toBe('stable');
    expect(r.coverage.missing).toEqual(['project']);
  });

  it('allows Excelling when the instructor set Project weight to 0', () => {
    const items = [item('activity', 95), item('midterm_exam', 95)];
    const r = classifyStudentRisk({ items, attendancePercent: 100, weights: NO_PROJECT_WEIGHTS });
    expect(r.coverage.required).toEqual(['activity', 'attendance', 'exam']);
    expect(r.risk_level).toBe('excelling');
  });

  it('holds Crucial at Vulnerable without full coverage', () => {
    const r = classifyStudentRisk({ items: [item('activity', 20)], attendancePercent: null, weights: null });
    expect(r.risk_score).toBe(60);
    expect(r.band).toBe('critical');
    expect(r.risk_level).toBe('at_risk');
  });

  it('classifies Crucial with full coverage', () => {
    const r = classifyStudentRisk({ items: full(50, 50, 50), attendancePercent: 50, weights: null });
    expect(r.risk_level).toBe('critical');
  });

  it('attendance alone: 40% is Vulnerable, 100% is Stable', () => {
    const low = classifyStudentRisk({ items: [], attendancePercent: 40, weights: null });
    expect(low.risk_score).toBe(40);
    expect(low.risk_level).toBe('at_risk');
    const high = classifyStudentRisk({ items: [], attendancePercent: 100, weights: null });
    expect(high.risk_level).toBe('stable');
  });

  it('no evidence gives no score and Stable', () => {
    const r = classifyStudentRisk({ items: [], attendancePercent: null, weights: null });
    expect(r.risk_score).toBeNull();
    expect(r.risk_level).toBe('stable');
  });

  it('Vulnerable and Stable bands are not changed by coverage', () => {
    const vulnerable = classifyStudentRisk({ items: [item('activity', 48)], attendancePercent: null, weights: null });
    expect(vulnerable.risk_level).toBe('at_risk');
    const stable = classifyStudentRisk({ items: [item('activity', 60)], attendancePercent: null, weights: null });
    expect(stable.risk_level).toBe('stable');
  });

  it('scores every Phase 1 worked example with the official weighted grade', () => {
    for (const c of GRADE_CASES) {
      const attendancePercent = attendancePercentOf(c.attendance);
      const r = classifyStudentRisk({ items: c.items, attendancePercent, weights: c.weights });
      const app = computeSubjectWeightedGrade({ items: c.items, attendancePercent, weights: c.weights });
      expect(r.risk_score, c.name).toBe(roundGrade2(c.expected));
      expect(r.risk_score, c.name).toBe(roundGrade2(app.weightedAverage));
      expect(r.band, c.name).toBe(classifyRiskScore(roundGrade2(app.weightedAverage)));
    }
  });

  it('client coverage from stored columns matches the Edge coverage', () => {
    const weightSets: Array<SubjectGradingWeights | null> = [null, NO_PROJECT_WEIGHTS];
    for (const c of GRADE_CASES) {
      for (const weights of weightSets) {
        const attendancePercent = attendancePercentOf(c.attendance);
        const r = classifyStudentRisk({ items: c.items, attendancePercent, weights });
        const stored = {
          activity_average: r.grade.activityAverage,
          project_score: r.grade.projectAverage,
          midterm_exam_average: r.grade.examAverage,
          attendance_rate: attendancePercent != null ? attendancePercent / 100 : null,
        };
        expect(predictionCoverage(stored, weights), c.name).toEqual(r.coverage);
      }
    }
  });
});

describe('legacyConfidence', () => {
  it('keeps the existing 0.95 / 0.85 / 0.7 / 0.5 meaning', () => {
    expect(legacyConfidence({ academicPerformance: 80, attendancePercent: 90, examAverage: 70 })).toBe(0.95);
    expect(legacyConfidence({ academicPerformance: 80, attendancePercent: null, examAverage: 70 })).toBe(0.85);
    expect(legacyConfidence({ academicPerformance: null, attendancePercent: 90, examAverage: null })).toBe(0.7);
    expect(legacyConfidence({ academicPerformance: null, attendancePercent: null, examAverage: null })).toBe(0.5);
  });
});

describe('formatOfficialRiskLabel', () => {
  it('shows the two-decimal score only on a matching band', () => {
    expect(formatOfficialRiskLabel('stable', 89.6)).toBe('Stable (89.60)');
    expect(formatOfficialRiskLabel('excelling', 89.995)).toBe('Excelling (90.00)');
    expect(formatOfficialRiskLabel('stable', 92)).toBe('Stable');
    expect(formatOfficialRiskLabel('critical', null)).toBe('Crucial');
  });
});

describe('predict-risk ownership and persistence', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/predict-risk/index.ts'), 'utf8');

  it('rejects non-owners with 403 before any other read, write or email', () => {
    const handler = src.slice(src.indexOf('auth.getUser('));
    const check = handler.indexOf('isSubjectOwner(subject, user.id)');
    expect(check).toBeGreaterThan(0);
    expect(handler.slice(check, check + 400)).toContain('status: 403');
    for (const later of ['.from("enrollments")', '.from("predictions")', 'sendBrevoEmail(', '.from("email_notifications")']) {
      expect(handler.indexOf(later), later).toBeGreaterThan(check);
    }
  });

  it('upserts by primary key and never deletes a whole subject', () => {
    expect(src).toContain('upsert(plan.upserts, { onConflict: "id" })');
    expect(src).not.toMatch(/\.insert\(rows\)/);
    const deletes = src.match(/\.delete\(\)[\s\S]{0,120}/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('.in("id", plan.deleteIds)');
  });
});

describe('isSubjectOwner', () => {
  it('accepts only the owning instructor', () => {
    expect(isSubjectOwner({ instructor_id: 'u1' }, 'u1')).toBe(true);
    expect(isSubjectOwner({ instructor_id: 'u2' }, 'u1')).toBe(false);
    expect(isSubjectOwner({ instructor_id: null }, 'u1')).toBe(false);
    expect(isSubjectOwner(null, 'u1')).toBe(false);
    expect(isSubjectOwner({ instructor_id: '' }, '')).toBe(false);
  });
});

describe('planPredictionWrites', () => {
  const NOW = '2026-10-13T10:00:00.000Z';
  const values = (studentId: string, over: Partial<PredictionValues> = {}): PredictionValues => ({
    student_id: studentId,
    subject_id: 'sub1',
    prediction_type: 'risk_analysis',
    risk_level: 'stable',
    confidence: 0.95,
    risk_score: 82,
    recommendation: 'Keep going.',
    attendance_rate: 0.9,
    quiz_average: null,
    assignment_average: null,
    project_score: 85,
    activity_average: 80,
    laboratory_exam_average: null,
    midterm_exam_average: 80,
    final_exam_average: null,
    exam_average: 80,
    academic_performance: 82.5,
    activity_completion_rate: 1,
    comprehension_rating: 4,
    ...over,
  });
  const stored = (id: string, createdAt: string, v: PredictionValues): ExistingPrediction => ({
    ...v,
    id,
    created_at: createdAt,
  });
  let seq = 0;
  const newId = () => `new-${++seq}`;

  it('skips an unchanged recalculation entirely', () => {
    const existing = [stored('p1', '2026-10-01T00:00:00Z', values('s1'))];
    const plan = planPredictionWrites(existing, [values('s1')], { now: NOW, newId });
    expect(plan).toEqual({ upserts: [], deleteIds: [], unchanged: 1 });
  });

  it('treats numeric strings from the database as equal values', () => {
    const existing = [
      stored('p1', '2026-10-01T00:00:00Z', values('s1', { risk_score: '82.00', confidence: '0.95' })),
    ];
    const plan = planPredictionWrites(existing, [values('s1')], { now: NOW, newId });
    expect(plan.upserts).toEqual([]);
  });

  it('keeps the id on a same-level change and records the previous values', () => {
    const existing = [stored('p1', '2026-10-01T00:00:00Z', values('s1'))];
    const plan = planPredictionWrites(existing, [values('s1', { risk_score: 84, attendance_rate: 0.95 })], {
      now: NOW,
      newId,
    });
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      id: 'p1',
      created_at: NOW,
      risk_score: 84,
      previous_risk_level: 'stable',
      previous_attendance_rate: 0.9,
    });
    expect(plan.deleteIds).toEqual([]);
  });

  it('keeps the id on a level change', () => {
    const existing = [stored('p1', '2026-10-01T00:00:00Z', values('s1'))];
    const plan = planPredictionWrites(existing, [values('s1', { risk_level: 'at_risk', risk_score: 77 })], {
      now: NOW,
      newId,
    });
    expect(plan.upserts[0]).toMatchObject({ id: 'p1', risk_level: 'at_risk', previous_risk_level: 'stable' });
  });

  it('creates an id only for a new student', () => {
    const existing = [stored('p1', '2026-10-01T00:00:00Z', values('s1'))];
    const plan = planPredictionWrites(existing, [values('s1'), values('s2')], { now: NOW, newId: () => 'fresh' });
    expect(plan.upserts).toEqual([
      expect.objectContaining({ id: 'fresh', student_id: 's2', previous_risk_level: null, previous_attendance_rate: null }),
    ]);
    expect(plan.unchanged).toBe(1);
  });

  it('deletes only stale rows and older duplicates, keeping the newest id', () => {
    const existing = [
      stored('old-dup', '2026-09-01T00:00:00Z', values('s1')),
      stored('p1', '2026-10-01T00:00:00Z', values('s1')),
      stored('gone', '2026-10-01T00:00:00Z', values('s9')),
      { id: 'orphan', student_id: null, created_at: null },
    ];
    const plan = planPredictionWrites(existing, [values('s1')], { now: NOW, newId });
    expect(plan.upserts).toEqual([]);
    expect(plan.deleteIds.sort()).toEqual(['gone', 'old-dup']);
  });

  it('never plans a delete when every row belongs to an enrolled student once', () => {
    const existing = [
      stored('p1', '2026-10-01T00:00:00Z', values('s1')),
      stored('p2', '2026-10-01T00:00:00Z', values('s2', { risk_level: 'critical' })),
    ];
    const plan = planPredictionWrites(existing, [values('s1', { risk_score: 90, risk_level: 'excelling' }), values('s2')], {
      now: NOW,
      newId,
    });
    expect(plan.deleteIds).toEqual([]);
    expect(plan.upserts.map((u) => u.id).sort()).toEqual(['p1', 'p2']);
  });
});
