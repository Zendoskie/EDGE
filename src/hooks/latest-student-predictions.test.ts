import { describe, expect, it, vi } from 'vitest';
import { PREDICTION_EVIDENCE_COLUMNS, riskDisplayStatus } from '@/lib/risk-scoring';
import { buildStudentCoachingContext, coachingRiskLabel } from '@/lib/coaching-context';

const calls: Array<{ op: string; args: unknown[] }> = [];
let rows: unknown[] = [];

vi.mock('@/integrations/supabase/client', () => {
  const builder: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'not', 'order']) {
    builder[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return {
    supabase: {
      from: (table: string) => {
        calls.push({ op: 'from', args: [table] });
        return builder;
      },
      rpc: (...args: unknown[]) => {
        calls.push({ op: 'rpc', args });
        return Promise.resolve({ data: [], error: null });
      },
    },
  };
});

const { fetchLatestStudentPredictions, latestPredictionsBySubject } = await import('@/hooks/useStudentAcademicSnapshot');

const SAVED = { activity_weight: 40, project_weight: 0, attendance_weight: 20, exam_weight: 40 };
const evidence = {
  activity_average: 70,
  quiz_average: null,
  project_score: 65,
  attendance_rate: 0.9,
  laboratory_exam_average: null,
  midterm_exam_average: 60,
  final_exam_average: null,
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    subject_id: 's1',
    risk_level: 'critical',
    risk_score: 62.5,
    recommendation: null,
    created_at: '2026-10-01T00:00:00Z',
    confidence: null,
    activity_completion_rate: null,
    comprehension_rating: null,
    ...evidence,
    subjects: { code: 'CS1', name: 'Intro', subject_grading_systems: null },
    ...over,
  };
}

describe('latest student predictions carry the stored risk evidence', () => {
  it('reads predictions directly in one request, with the evidence columns and embedded weights', async () => {
    calls.length = 0;
    rows = [row()];
    const out = await fetchLatestStudentPredictions('student-1');
    expect(calls.filter((c) => c.op === 'from' || c.op === 'rpc')).toEqual([{ op: 'from', args: ['predictions'] }]);
    const select = String(calls.find((c) => c.op === 'select')!.args[0]);
    expect(select).toContain(PREDICTION_EVIDENCE_COLUMNS);
    expect(select).toContain('subjects(code, name, subject_grading_systems(activity_weight, project_weight, attendance_weight, exam_weight))');
    expect(calls).toContainEqual({ op: 'eq', args: ['student_id', 'student-1'] });
    expect(calls).toContainEqual({ op: 'order', args: ['created_at', { ascending: false }] });
    expect(out[0]).toMatchObject({ ...evidence, subjects: { code: 'CS1', name: 'Intro' }, grading_weights: null });
  });

  it('keeps the latest row per subject, like the RPC', () => {
    const out = latestPredictionsBySubject([
      row({ id: 'new', created_at: '2026-10-02T00:00:00Z' }),
      row({ id: 'old', created_at: '2026-09-01T00:00:00Z' }),
      row({ id: 'other', subject_id: 's2' }),
    ] as never);
    expect(out.map((r) => r.id)).toEqual(['new', 'other']);
  });

  it('separates saved weights, defaults and unknown weights', () => {
    const [saved] = latestPredictionsBySubject([row({ subjects: { code: 'A', name: null, subject_grading_systems: SAVED } })] as never);
    const [asArray] = latestPredictionsBySubject([row({ subjects: { code: 'A', name: null, subject_grading_systems: [SAVED] } })] as never);
    const [defaults] = latestPredictionsBySubject([row()] as never);
    const [noSubject] = latestPredictionsBySubject([row({ subjects: null })] as never);
    expect(saved.grading_weights).toEqual(SAVED);
    expect(asArray.grading_weights).toEqual(SAVED);
    expect(defaults.grading_weights).toBeNull();
    expect(noSubject.grading_weights).toBeUndefined();
  });

  it('confirms a fully evidenced stored result instead of calling it unverified', () => {
    const [r] = latestPredictionsBySubject([row()] as never);
    const status = riskDisplayStatus({ level: r.risk_level, evidence: r, weights: r.grading_weights });
    expect(status.state).toBe('confirmed');
    expect(status.label).toBe('Crucial (62.50)');
  });

  it('marks missing weighted evidence provisional and ignores categories weighted 0', () => {
    const [noProjectDefaults] = latestPredictionsBySubject([row({ project_score: null })] as never);
    expect(riskDisplayStatus({ level: 'critical', evidence: noProjectDefaults, weights: noProjectDefaults.grading_weights })).toMatchObject({
      state: 'provisional',
      missing: ['project'],
    });
    const [noProjectZeroWeight] = latestPredictionsBySubject([
      row({ project_score: null, subjects: { code: 'A', name: null, subject_grading_systems: SAVED } }),
    ] as never);
    expect(
      riskDisplayStatus({ level: 'critical', evidence: noProjectZeroWeight, weights: noProjectZeroWeight.grading_weights }).state,
    ).toBe('confirmed');
  });

  it('stays unverified when weights are unknown and evidence is incomplete', () => {
    const [r] = latestPredictionsBySubject([row({ project_score: null, subjects: null })] as never);
    expect(riskDisplayStatus({ level: 'critical', evidence: r, weights: r.grading_weights }).state).toBe('unverified');
  });

  it('flows into the AI Coach popup label without changing the stored level', () => {
    const coaching = buildStudentCoachingContext(
      latestPredictionsBySubject([row(), row({ subject_id: 's2', risk_level: 'stable', risk_score: 85, project_score: null })] as never),
    );
    const bySubject = Object.fromEntries(coaching.subjects.map((m) => [m.subjectId, m]));
    expect(bySubject.s1.riskClassification).toBe('critical');
    expect(coachingRiskLabel(bySubject.s1)).toBe('Crucial (62.50)');
    expect(bySubject.s2.riskClassification).toBe('stable');
    expect(coachingRiskLabel(bySubject.s2)).toBe('Stable — Provisional (incomplete data)');
  });
});
