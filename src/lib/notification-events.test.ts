import { describe, expect, it } from 'vitest';
import {
  instructorAtRiskNotification,
  studentPredictionNotifications,
  unseenCoachingRecommendation,
} from '@/lib/notification-events';
import {
  planPredictionWrites,
  type ExistingPrediction,
  type PredictionValues,
} from '../../supabase/functions/_shared/risk-scoring';

type StoredRow = ExistingPrediction & { previous_risk_level?: string | null; previous_attendance_rate?: number | null };

const values = (over: Partial<PredictionValues> = {}): PredictionValues => ({
  student_id: 's1',
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

/** Runs one predict-risk write for a single student and returns the rows it wrote. */
function recalculate(table: StoredRow[], computed: PredictionValues, now: string): StoredRow[] {
  const plan = planPredictionWrites(table, [computed], { now, newId: () => 'p1' });
  for (const write of plan.upserts) {
    const i = table.findIndex((r) => r.id === write.id);
    if (i >= 0) table[i] = write;
    else table.push(write);
  }
  return plan.upserts;
}

/** Inbox semantics: an item is added once per dedupeKey. */
function inbox() {
  const keys = new Set<string>();
  return {
    keys,
    receive(rows: StoredRow[]) {
      const added: string[] = [];
      for (const row of rows) {
        const payloads = [
          ...studentPredictionNotifications(row, 'CS101'),
          instructorAtRiskNotification(row, { studentName: 'Ana', subjectCode: 'CS101' }),
        ].filter((n): n is NonNullable<typeof n> => n != null);
        for (const n of payloads) {
          if (keys.has(n.dedupeKey)) continue;
          keys.add(n.dedupeKey);
          added.push(n.title);
        }
      }
      return added;
    },
  };
}

describe('prediction notifications with stable ids', () => {
  it('an unchanged recalculation writes nothing and notifies nothing', () => {
    const table: StoredRow[] = [];
    const box = inbox();
    box.receive(recalculate(table, values(), '2026-10-01T00:00:00Z'));

    const written = recalculate(table, values(), '2026-10-02T00:00:00Z');
    expect(written).toEqual([]);
    // A poll re-reading the unchanged row adds nothing either.
    expect(box.receive(table)).toEqual([]);
  });

  it('a genuine Stable to Vulnerable transition notifies student and instructor once', () => {
    const table: StoredRow[] = [];
    const box = inbox();
    box.receive(recalculate(table, values(), '2026-10-01T00:00:00Z'));

    const written = recalculate(table, values({ risk_level: 'at_risk', risk_score: 77 }), '2026-10-02T00:00:00Z');
    expect(written[0].id).toBe('p1');
    expect(box.receive(written)).toEqual(['Risk classification changed', 'Student now Vulnerable']);
    // Realtime and poll both delivering the same write do not duplicate it.
    expect(box.receive(written)).toEqual([]);
  });

  it('Vulnerable, Stable, then Vulnerable again notifies each transition', () => {
    const table: StoredRow[] = [];
    const box = inbox();
    box.receive(recalculate(table, values({ risk_level: 'at_risk', risk_score: 77 }), '2026-10-01T00:00:00Z'));

    const toStable = recalculate(table, values(), '2026-10-02T00:00:00Z');
    expect(box.receive(toStable)).toEqual(['Risk classification changed']);

    const backToVulnerable = recalculate(
      table,
      values({ risk_level: 'at_risk', risk_score: 76 }),
      '2026-10-03T00:00:00Z',
    );
    expect(box.receive(backToVulnerable)).toEqual(['Risk classification changed', 'Student now Vulnerable']);
  });

  it('a score change within the same level does not notify a risk change', () => {
    const table: StoredRow[] = [];
    const box = inbox();
    box.receive(recalculate(table, values(), '2026-10-01T00:00:00Z'));
    const written = recalculate(table, values({ risk_score: 85 }), '2026-10-02T00:00:00Z');
    expect(written).toHaveLength(1);
    expect(box.receive(written)).toEqual([]);
  });

  it('attendance notifies when it crosses below the threshold, not on every later write', () => {
    const table: StoredRow[] = [];
    const box = inbox();
    box.receive(recalculate(table, values(), '2026-10-01T00:00:00Z'));

    const below = recalculate(table, values({ attendance_rate: 0.6 }), '2026-10-02T00:00:00Z');
    expect(box.receive(below)).toEqual(['Attendance below threshold']);

    const stillBelow = recalculate(table, values({ attendance_rate: 0.5 }), '2026-10-03T00:00:00Z');
    expect(box.receive(stillBelow)).toEqual([]);
  });

  it('a new student row gets one insight notice', () => {
    const box = inbox();
    expect(box.receive(recalculate([], values(), '2026-10-01T00:00:00Z'))).toEqual(['Academic insight updated']);
  });
});

describe('coaching recommendation notices', () => {
  it('fires once per new text for a stable prediction id', () => {
    const seen: Record<string, string> = {};
    const row = { id: 'p1', recommendation: 'Review chapter 3.' };
    expect(unseenCoachingRecommendation(row, 'CS101', seen)).not.toBeNull();
    expect(unseenCoachingRecommendation(row, 'CS101', seen)).toBeNull();
    expect(unseenCoachingRecommendation({ ...row, recommendation: '  Review chapter 3.  ' }, 'CS101', seen)).toBeNull();
    expect(unseenCoachingRecommendation({ ...row, recommendation: 'Attend lab.' }, 'CS101', seen)).not.toBeNull();
    expect(seen).toEqual({ p1: 'Attend lab.' });
  });

  it('ignores empty recommendations', () => {
    const seen: Record<string, string> = {};
    expect(unseenCoachingRecommendation({ id: 'p1', recommendation: '  ' }, null, seen)).toBeNull();
    expect(seen).toEqual({});
  });
});
