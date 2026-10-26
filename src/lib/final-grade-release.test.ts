import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GRADE_CASES, attendancePercentOf } from '@/lib/weighted-grading.fixtures';
import {
  computeReleaseGrade,
  effectiveWeights,
  evaluateGradeCompleteness,
  PAGE_SIZE,
  planReleaseWrites,
  runRelease,
  type EffectiveWeights,
  type ReleaseActivity,
  type ReleaseSubmission,
} from '../../supabase/functions/_shared/final-grade-release';
import {
  computeSubjectWeightedGrade,
  roundGrade2,
} from '../../supabase/functions/_shared/weighted-grading';

const W: EffectiveWeights = { activity_weight: 25, project_weight: 25, attendance_weight: 15, exam_weight: 35 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ACT = uuid(101);
const PROJ = uuid(102);
const MID = uuid(103);
const FIN = uuid(104);
const ACTIVITIES: ReleaseActivity[] = [
  { id: ACT, title: 'Act 1', type: 'activity', max_score: 50 },
  { id: PROJ, title: 'Project', type: 'project', max_score: 100 },
  { id: MID, title: 'Midterm', type: 'midterm_exam', max_score: 100 },
  { id: FIN, title: 'Final', type: 'final_exam', max_score: 100 },
];

const subs = (student: string, scores: Record<string, number | null>, types: Record<string, string> = {}) =>
  new Map<string, ReleaseSubmission>(
    Object.entries(scores).map(([activity_id, score]) => [
      activity_id,
      {
        student_id: student,
        activity_id,
        score,
        assessment_type: types[activity_id] ?? ACTIVITIES.find((a) => a.id === activity_id)?.type ?? 'activity',
      },
    ]),
  );
const FULL = { [ACT]: 40, [PROJ]: 90, [MID]: 80, [FIN]: 70 };

const evaluate = (
  submissionsByActivity: Map<string, ReleaseSubmission>,
  opts: { activities?: ReleaseActivity[]; attendance?: string[]; weights?: EffectiveWeights } = {},
) =>
  evaluateGradeCompleteness({
    activities: opts.activities ?? ACTIVITIES,
    submissionsByActivity,
    attendanceStatuses: opts.attendance ?? ['present', 'late'],
    weights: opts.weights ?? W,
  });

describe('evaluateGradeCompleteness', () => {
  it('is complete when every weighted category has scored evidence', () => {
    expect(evaluate(subs('s', FULL))).toEqual({ complete: true, missing: [] });
  });

  it('counts a zero score as entered but a blank or missing score as missing', () => {
    expect(evaluate(subs('s', { ...FULL, [FIN]: 0 })).complete).toBe(true);
    expect(evaluate(subs('s', { ...FULL, [FIN]: null })).missing).toEqual([
      { kind: 'assessment_unscored', category: 'exam_final', activity_id: FIN, title: 'Final', type: 'final_exam', reason: 'null_score' },
    ]);
    const { [FIN]: _omit, ...noFinal } = FULL;
    expect(evaluate(subs('s', noFinal)).missing).toEqual([
      { kind: 'assessment_unscored', category: 'exam_final', activity_id: FIN, title: 'Final', type: 'final_exam', reason: 'no_submission' },
    ]);
  });

  it('reports an invalid max score', () => {
    const activities = ACTIVITIES.map((a) => (a.id === ACT ? { ...a, max_score: 0 } : a));
    expect(evaluate(subs('s', FULL), { activities }).missing).toEqual([
      { kind: 'assessment_unscored', category: 'activity', activity_id: ACT, title: 'Act 1', type: 'activity', reason: 'invalid_max_score' },
    ]);
  });

  it('requires at least one assessment in each weighted category, and both Exam sides', () => {
    const only = (ids: string[]) => ACTIVITIES.filter((a) => ids.includes(a.id));
    expect(evaluate(subs('s', FULL), { activities: only([PROJ, MID, FIN]) }).missing).toEqual([
      { kind: 'category_empty', category: 'activity' },
    ]);
    expect(evaluate(subs('s', FULL), { activities: only([ACT, MID, FIN]) }).missing).toEqual([
      { kind: 'category_empty', category: 'project' },
    ]);
    expect(evaluate(subs('s', FULL), { activities: only([ACT, PROJ, MID]) }).missing).toEqual([
      { kind: 'category_empty', category: 'exam_final' },
    ]);
    expect(evaluate(subs('s', FULL), { activities: only([ACT, PROJ, FIN]) }).missing).toEqual([
      { kind: 'category_empty', category: 'exam_midterm' },
    ]);
  });

  it('does not require zero-weight categories', () => {
    const weights = { activity_weight: 50, project_weight: 0, attendance_weight: 0, exam_weight: 50 };
    const activities = ACTIVITIES.filter((a) => a.id !== PROJ);
    expect(evaluate(subs('s', { [ACT]: 40, [MID]: 80, [FIN]: 70 }), { activities, weights, attendance: [] })).toEqual({
      complete: true,
      missing: [],
    });
    // An unscored item in a zero-weight category is not required either.
    expect(evaluate(subs('s', { ...FULL, [PROJ]: null }), { weights }).complete).toBe(true);
  });

  it('handles attendance: none, all excused, partly excused', () => {
    expect(evaluate(subs('s', FULL), { attendance: [] }).missing).toEqual([{ kind: 'attendance_missing' }]);
    expect(evaluate(subs('s', FULL), { attendance: ['excused', 'excused'] }).missing).toEqual([{ kind: 'attendance_all_excused' }]);
    expect(evaluate(subs('s', FULL), { attendance: ['excused', 'absent'] }).complete).toBe(true);
  });

  it('uses the submission assessment type before the activity type, like Phase 1', () => {
    const activities = [...ACTIVITIES, { id: uuid(105), title: 'Extra', type: 'activity', max_score: 100 }];
    // Re-typed as project and blank: it now belongs to Project, which is weighted.
    const r = evaluate(subs('s', { ...FULL, [uuid(105)]: null }, { [uuid(105)]: 'project' }), { activities });
    expect(r.missing).toEqual([
      { kind: 'assessment_unscored', category: 'project', activity_id: uuid(105), title: 'Extra', type: 'project', reason: 'null_score' },
    ]);
  });

  it('maps legacy types as Phase 1 does', () => {
    const activities: ReleaseActivity[] = [
      { id: uuid(1), title: 'Quiz', type: 'quiz', max_score: 10 },
      { id: uuid(2), title: 'Assignment', type: 'assignment', max_score: 10 },
      { id: uuid(3), title: 'Project', type: 'project', max_score: 10 },
      { id: uuid(4), title: 'Lab exam', type: 'laboratory_exam', max_score: 10 },
      { id: uuid(5), title: 'Exam', type: 'exam', max_score: 10 },
      { id: uuid(6), title: 'Final', type: 'final_exam', max_score: 10 },
    ];
    const types = Object.fromEntries(activities.map((a) => [a.id, a.type]));
    const scores = Object.fromEntries(activities.map((a) => [a.id, 5]));
    expect(evaluate(subs('s', scores, types), { activities }).complete).toBe(true);
  });

  it('keeps a late enrollee with no scores incomplete (no due-date exemption)', () => {
    const r = evaluate(new Map(), { attendance: [] });
    expect(r.complete).toBe(false);
    expect(r.missing.filter((m) => m.kind === 'assessment_unscored')).toHaveLength(4);
    expect(r.missing).toContainEqual({ kind: 'attendance_missing' });
  });
});

describe('computeReleaseGrade', () => {
  it('equals roundGrade2(computeSubjectWeightedGrade(...)) for every Phase 1 fixture', () => {
    for (const c of GRADE_CASES) {
      const activities: ReleaseActivity[] = c.items.map((it, i) => ({
        id: uuid(500 + i),
        title: `item ${i}`,
        type: String(it.type),
        max_score: it.maxScore as number,
      }));
      const submissionsByActivity = new Map<string, ReleaseSubmission>(
        c.items.map((it, i) => [
          uuid(500 + i),
          { student_id: 's', activity_id: uuid(500 + i), score: it.score as number | null, assessment_type: it.assessmentType ?? null },
        ]),
      );
      const attendanceStatuses = c.attendance
        ? [...Array(c.attendance.present).fill('present'), ...Array(c.attendance.absent).fill('absent')]
        : [];
      const grade = computeReleaseGrade({ activities, submissionsByActivity, attendanceStatuses, savedWeights: c.weights });
      const official = roundGrade2(
        computeSubjectWeightedGrade({ items: c.items, attendancePercent: attendancePercentOf(c.attendance), weights: c.weights })
          .weightedAverage,
      );
      expect(grade, c.name).toBe(official);
      expect(grade, c.name).toBe(c.expected);
    }
  });

  it('counts late as present and excused in the denominator only', () => {
    const base = { activities: ACTIVITIES, submissionsByActivity: subs('s', { [ACT]: 50, [PROJ]: 100, [MID]: 100, [FIN]: 100 }), savedWeights: null };
    expect(computeReleaseGrade({ ...base, attendanceStatuses: ['present', 'late'] })).toBe(100);
    // 85 points from the full categories plus 15 * 1/2 for attendance.
    expect(computeReleaseGrade({ ...base, attendanceStatuses: ['late', 'excused'] })).toBe(92.5);
  });
});

describe('planReleaseWrites', () => {
  const cand = (student_id: string, final_grade: number, weights = W) => ({ student_id, final_grade, weights });

  it('writes new, needs_review and changed rows and skips equal released rows', () => {
    const plan = planReleaseWrites(
      [
        { student_id: 'same', final_grade: '85.50', weights: { ...W }, status: 'released' },
        { student_id: 'review', final_grade: null, weights: { ...W }, status: 'needs_review' },
        { student_id: 'grade', final_grade: 70, weights: { ...W }, status: 'released' },
        { student_id: 'weights', final_grade: 80, weights: { ...W, activity_weight: 40, project_weight: 10 }, status: 'released' },
      ],
      [cand('same', 85.5), cand('review', 90), cand('grade', 71), cand('weights', 80), cand('new', 60)],
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.writes.map((w) => w.student_id)).toEqual(['review', 'grade', 'weights', 'new']);
  });

  it('effectiveWeights falls back to the Phase 1 defaults', () => {
    expect(effectiveWeights(null)).toEqual(W);
    expect(effectiveWeights({ activity_weight: '40', project_weight: 20, attendance_weight: 10, exam_weight: 30 })).toEqual({
      activity_weight: 40,
      project_weight: 20,
      attendance_weight: 10,
      exam_weight: 30,
    });
  });
});

/* ------------------------------------------------------------ runRelease with a recording fake */

type Call = { table: string; select?: string; filters: Array<[string, string, unknown]>; range?: [number, number] };

function fakeDb(opts: {
  role?: boolean;
  subject?: Record<string, unknown> | null;
  tables?: Record<string, unknown[]>;
  rpc?: (args: Record<string, any>) => { data: unknown; error: unknown };
}) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, any> }> = [];
  const log: string[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      log.push(`from:${table}`);
      const builder: any = {
        select(cols: string) { call.select = cols; return builder; },
        eq(c: string, v: unknown) { call.filters.push(['eq', c, v]); return builder; },
        in(c: string, v: unknown) { call.filters.push(['in', c, v]); return builder; },
        order() { return builder; },
        range(a: number, b: number) { call.range = [a, b]; return builder; },
        maybeSingle() {
          if (table === 'user_roles') return Promise.resolve({ data: opts.role === false ? null : { role: 'instructor' }, error: null });
          return Promise.resolve({ data: opts.subject ?? null, error: null });
        },
        then(resolveFn: (v: unknown) => unknown, rejectFn?: (e: unknown) => unknown) {
          const rows = opts.tables?.[table] ?? [];
          const [a, b] = call.range ?? [0, rows.length - 1];
          return Promise.resolve({ data: rows.slice(a, b + 1), error: null, count: rows.length }).then(resolveFn, rejectFn);
        },
      };
      return builder;
    },
    rpc(fn: string, args: Record<string, any>) {
      rpcCalls.push({ fn, args });
      log.push(`rpc:${fn}`);
      const result = opts.rpc
        ? opts.rpc(args)
        : { data: { committed: true, version: args.p_expected_version, written: args.p_rows.length }, error: null };
      return Promise.resolve(result);
    },
  };
  return { db, calls, rpcCalls, log };
}

const USER = uuid(900);
const SUBJECT = uuid(901);
const S1 = uuid(1);
const S2 = uuid(2);
const S3 = uuid(3);
const ownedSubject = (version: unknown = { version: 7 }) => ({
  instructor_id: USER,
  subject_grading_systems: null,
  final_grade_input_versions: version,
});
const subRow = (student: string, activity_id: string, score: number | null) => ({
  id: `${student}-${activity_id}`,
  student_id: student,
  activity_id,
  score,
  assessment_type: ACTIVITIES.find((a) => a.id === activity_id)!.type,
});
const TABLES = {
  enrollments: [{ id: 'e1', student_id: S1 }, { id: 'e2', student_id: S2 }],
  activities: ACTIVITIES,
  attendance: [{ id: 'a1', student_id: S1, status: 'present' }, { id: 'a2', student_id: S2, status: 'present' }],
  final_grade_releases: [] as unknown[],
  submissions: [
    ...[ACT, PROJ, MID, FIN].map((a) => subRow(S1, a, a === ACT ? 40 : 80)),
    ...[ACT, PROJ, MID].map((a) => subRow(S2, a, 50)), // S2 has no Final row
  ],
};
// Default weights; Activity 80, Project 80, Exam (80 + 80) / 2 = 80, attendance 100.
const S1_GRADE = 83;

describe('runRelease', () => {
  it('returns 401 without a verified user and makes no query', async () => {
    const f = fakeDb({ subject: ownedSubject(), tables: TABLES });
    expect((await runRelease(f.db, null, { subject_id: SUBJECT })).status).toBe(401);
    expect(f.log).toEqual([]);
  });

  it('returns 400 for an invalid body before any query', async () => {
    const f = fakeDb({ subject: ownedSubject(), tables: TABLES });
    for (const body of [null, {}, { subject_id: 'x' }, { subject_id: SUBJECT, student_ids: ['nope'] }, {
      subject_id: SUBJECT,
      student_ids: Array.from({ length: 501 }, (_, i) => uuid(i)),
    }]) {
      expect((await runRelease(f.db, USER, body)).status).toBe(400);
    }
    expect(f.log).toEqual([]);
  });

  it('returns 403 for a non-instructor after only the role query', async () => {
    const f = fakeDb({ role: false, subject: ownedSubject(), tables: TABLES });
    expect((await runRelease(f.db, USER, { subject_id: SUBJECT })).status).toBe(403);
    expect(f.log).toEqual(['from:user_roles']);
  });

  it('returns 403 for a non-owner or unknown subject after only the role and subject queries', async () => {
    for (const subject of [{ ...ownedSubject(), instructor_id: uuid(999) }, null]) {
      const f = fakeDb({ subject, tables: TABLES });
      expect((await runRelease(f.db, USER, { subject_id: SUBJECT })).status).toBe(403);
      expect(f.log).toEqual(['from:user_roles', 'from:subjects']);
    }
  });

  it('releases complete students through the version-checked RPC and reports incomplete ones', async () => {
    const f = fakeDb({ subject: ownedSubject({ version: 7 }), tables: TABLES });
    const res = await runRelease(f.db, USER, { subject_id: SUBJECT });
    expect(res.status).toBe(200);
    expect(f.log).toEqual([
      'from:user_roles',
      'from:subjects',
      'from:enrollments',
      'from:activities',
      'from:attendance',
      'from:final_grade_releases',
      'from:submissions',
      'rpc:commit_final_grade_releases',
    ]);
    expect(f.calls[1].select).toContain('final_grade_input_versions(version)');
    expect(f.rpcCalls[0].args).toEqual({
      p_subject_id: SUBJECT,
      p_expected_version: 7,
      p_released_by: USER,
      p_rows: [{ student_id: S1, final_grade: S1_GRADE, weights: W }],
    });
    expect(res.body).toMatchObject({
      subject_id: SUBJECT,
      outcome: 'partial',
      released: 1,
      unchanged: 0,
      not_enrolled: [],
      newly_released: [{ student_id: S1, final_grade: S1_GRADE }],
    });
    expect((res.body.incomplete as any[])[0]).toEqual({
      student_id: S2,
      missing: [{ kind: 'assessment_unscored', category: 'exam_final', activity_id: FIN, title: 'Final', type: 'final_exam', reason: 'no_submission' }],
    });
  });

  it('uses version 0 when the subject has no version row, and accepts the array embed shape', async () => {
    for (const [embed, expected] of [[null, 0], [[{ version: '12' }], 12]] as const) {
      const f = fakeDb({ subject: ownedSubject(embed), tables: TABLES });
      await runRelease(f.db, USER, { subject_id: SUBJECT });
      expect(f.rpcCalls[0].args.p_expected_version).toBe(expected);
    }
  });

  it('returns 409 on a stale version, writes nothing else and does not retry', async () => {
    const f = fakeDb({
      subject: ownedSubject(),
      tables: TABLES,
      rpc: () => ({ data: { committed: false, version: 8, written: 0 }, error: null }),
    });
    const res = await runRelease(f.db, USER, { subject_id: SUBJECT });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'inputs_changed', retry: true, subject_id: SUBJECT });
    expect(String(res.body.message)).toMatch(/release again/);
    expect(f.rpcCalls).toHaveLength(1);
    expect(f.log[f.log.length - 1]).toBe('rpc:commit_final_grade_releases');
  });

  it('makes no RPC call when every complete student is already released unchanged', async () => {
    const f = fakeDb({
      subject: ownedSubject(),
      tables: { ...TABLES, final_grade_releases: [{ student_id: S1, final_grade: '83.00', weights: W, status: 'released' }] },
    });
    const res = await runRelease(f.db, USER, { subject_id: SUBJECT });
    expect(f.rpcCalls).toHaveLength(0);
    expect(res.body).toMatchObject({ outcome: 'partial', released: 0, unchanged: 1 });
  });

  it('counts rows the RPC skipped as unchanged', async () => {
    const f = fakeDb({
      subject: ownedSubject(),
      tables: TABLES,
      rpc: () => ({ data: { committed: true, version: 7, written: 0 }, error: null }),
    });
    const res = await runRelease(f.db, USER, { subject_id: SUBJECT });
    expect(res.body).toMatchObject({ released: 0, unchanged: 1 });
  });

  it('limits the run to student_ids and lists ids that are not actively enrolled', async () => {
    const f = fakeDb({ subject: ownedSubject(), tables: TABLES });
    const res = await runRelease(f.db, USER, { subject_id: SUBJECT, student_ids: [S2, S3, S2] });
    expect(f.rpcCalls).toHaveLength(0);
    expect(res.body).toMatchObject({ outcome: 'none_released', released: 0, not_enrolled: [S3] });
    expect((res.body.incomplete as any[]).map((i) => i.student_id)).toEqual([S2]);
  });

  it('propagates an RPC error', async () => {
    const f = fakeDb({ subject: ownedSubject(), tables: TABLES, rpc: () => ({ data: null, error: { message: 'boom' } }) });
    await expect(runRelease(f.db, USER, { subject_id: SUBJECT })).rejects.toEqual({ message: 'boom' });
  });

  it('pages past the PostgREST row cap, advancing by the rows actually returned', async () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ id: `a${i}`, student_id: S1, status: 'present' }));
    const f = fakeDb({ subject: ownedSubject(), tables: { ...TABLES, attendance: many } });
    await runRelease(f.db, USER, { subject_id: SUBJECT });
    const ranges = f.calls.filter((c) => c.table === 'attendance').map((c) => c.range);
    expect(ranges).toEqual([[0, PAGE_SIZE - 1], [PAGE_SIZE, 2 * PAGE_SIZE - 1]]);
  });
});

describe('release-final-grades source checks', () => {
  const root = resolve(__dirname, '../..');
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
  const index = read('supabase/functions/release-final-grades/index.ts');
  const shared = read('supabase/functions/_shared/final-grade-release.ts');
  const migration = read('supabase/migrations/20261013130000_final_grade_releases.sql');

  it('has no direct Brevo send, prediction, AI, delete or direct upsert side effects in shared release logic', () => {
    expect(shared).not.toMatch(/sendBrevoEmail|predictions|functions\.invoke|\.delete\(|\.upsert\(|ai-coach|channel\(/);
    expect(shared).toContain('db.rpc("commit_final_grade_releases"');
    expect(shared).toContain('newly_released');
  });

  it('fans out final-grade release emails through send-notification after a successful commit', () => {
    expect(index).toContain('final_grade_released');
    expect(index).toContain('send-notification');
    expect(index).not.toContain('sendBrevoEmail');
  });

  it('verifies the caller before running the release', () => {
    expect(index.indexOf('auth.getUser(token)')).toBeLessThan(index.indexOf('getClaims'));
    expect(index.indexOf('getClaims')).toBeLessThan(index.indexOf('runRelease(supabase, userId, body)'));
    expect(read('supabase/config.toml')).toMatch(/\[functions\.release-final-grades\]\s*verify_jwt = false/);
  });

  it('bumps the version before flagging, and never touches the realtime publication', () => {
    const helper = migration.slice(migration.indexOf('CREATE FUNCTION public.final_grade_inputs_changed'));
    expect(helper.indexOf('INSERT INTO public.final_grade_input_versions')).toBeGreaterThan(0);
    expect(helper.indexOf('INSERT INTO public.final_grade_input_versions')).toBeLessThan(
      helper.indexOf('UPDATE public.final_grade_releases'),
    );
    expect(migration).not.toMatch(/ALTER PUBLICATION/i);
  });
});
