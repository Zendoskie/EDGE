import { describe, expect, it, vi } from 'vitest';
import {
  analyzeWeakAreas,
  buildFallbackSummary,
  buildStudentRecord,
  formatStudentRecordForPrompt,
  type StudentRecord,
  type SubjectRecord,
} from '../../supabase/functions/ai-coach/academic-context';
import { runCoachChat, type ChatMessage, type CoachDeps } from '../../supabase/functions/ai-coach/coach-chat';

const NOW = new Date('2026-10-02T08:00:00Z');
const PAST = '2026-09-01T00:00:00Z';
const FUTURE = '2026-12-10T00:00:00Z';

type Item = { type: string | null; score?: number | null; max?: number; title?: string; due?: string | null };

/** Stored evidence for every category, so the official label is shown without a qualifier. */
const STORED_EVIDENCE = {
  activity_average: 80,
  quiz_average: null,
  project_score: 55,
  attendance_rate: 0.9,
  laboratory_exam_average: null,
  midterm_exam_average: 68,
  final_exam_average: null,
};

function subjectOf(items: Item[], opts: { present?: number; absent?: number; risk?: string; storedEvidence?: boolean } = {}) {
  const rec = buildStudentRecord({
    enrollments: [{ subject_id: 's', subjects: { code: 'WK101', name: 'Weak Areas' } }],
    activities: items.map((it, i) => ({
      id: `w${i}`,
      subject_id: 's',
      title: it.title ?? `${it.type} ${i + 1}`,
      type: it.type,
      max_score: it.max ?? 100,
      due_date: it.due ?? null,
    })),
    submissions: items.flatMap((it, i) =>
      it.score === undefined ? [] : [{ activity_id: `w${i}`, score: it.score, assessment_type: it.type }],
    ),
    attendance: [
      ...Array.from({ length: opts.present ?? 0 }, () => ({ subject_id: 's', status: 'present' })),
      ...Array.from({ length: opts.absent ?? 0 }, () => ({ subject_id: 's', status: 'absent' })),
    ],
    gradingSystems: [],
    predictions: [
      {
        subject_id: 's',
        risk_level: opts.risk ?? 'critical',
        risk_score: 60,
        created_at: '2026-09-30T00:00:00Z',
        ...(opts.storedEvidence ? STORED_EVIDENCE : {}),
      },
    ],
    engagement: null,
  });
  return rec.subjects[0];
}

const recordOf = (s: SubjectRecord): StudentRecord => ({ subjects: [s], engagement: null, riskAvailable: true });
const fallbackOf = (s: SubjectRecord) => buildFallbackSummary(recordOf(s), [s], NOW);

async function aiDown(s: SubjectRecord, question = 'How can I improve in WK101?') {
  const callModel = vi.fn(async () => {
    throw new Error('503 upstream sk-abcdefghijklmnopqrstuvwxyz123456');
  });
  const deps: CoachDeps = { loadRecord: vi.fn(async () => recordOf(s)), callModel, aiEnabled: true, now: () => NOW };
  const messages: ChatMessage[] = [{ role: 'user', content: question }];
  return { res: await runCoachChat(deps, messages), callModel };
}

describe('AI-down fallback uses the Phase 2 weak-area analysis', () => {
  const crucial = () =>
    subjectOf(
      [
        { type: 'activity', score: 80, title: 'Activity 1' },
        { type: 'project', score: 55, title: 'Web App Project' },
        { type: 'midterm_exam', score: 68, title: 'Midterm Exam' },
        { type: 'final_exam', title: 'Final Exam', due: FUTURE },
      ],
      { present: 9, absent: 1, storedEvidence: true },
    );

  it('gives a Crucial student the ranked weak areas, the named low scores and grounded next steps', async () => {
    const s = crucial();
    const { res, callModel } = await aiDown(s);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(res.source).toBe('fallback');
    expect(res.degraded).toBe(true);
    expect(res.risk_level).toBe('critical');
    const r = res.reply;
    expect(r).toContain('temporarily unavailable');
    expect(r).toContain('Official risk classification: Crucial (risk score 60.00).');
    expect(r).toContain('1. Project: 55.00%, effective weight 25.00% of your provisional grade. Low scores: Web App Project 55/100 (55.00%).');
    expect(r).toContain('2. Midterm Exam: 68.00%, effective weight 35.00% of your provisional grade. Low scores: Midterm Exam 68/100 (68.00%).');
    expect(r.indexOf('1. Project')).toBeLessThan(r.indexOf('2. Midterm Exam'));
    expect(r).toContain('Next step: Check the project requirements with your instructor');
    expect(r).toContain('Use them to prepare for the Final Exam.');
    expect(r).not.toContain('3. ');
    expect(r).not.toMatch(/Activity 1 80/);
    expect(r).not.toMatch(/sk-|503|upstream/i);
  });

  it('matches the ranking the AI prompt receives', () => {
    const s = crucial();
    const ranked = analyzeWeakAreas(s, NOW).ranked.map((c) => c.label);
    expect(ranked).toEqual(['Project', 'Midterm Exam']);
    const prompt = formatStudentRecordForPrompt(recordOf(s), s, NOW);
    expect(prompt).toContain('1. Project: 55.00%');
    expect(prompt).toContain('2. Midterm Exam: 68.00%');
  });

  it('separates incomplete evidence from low scores and never calls it zero', () => {
    const s = subjectOf(
      [
        { type: 'activity', score: 60, title: 'Activity A' },
        { type: 'activity', title: 'Activity B', due: PAST },
        { type: 'midterm_exam', score: 70, title: 'Midterm Exam' },
        { type: 'final_exam', title: 'Final Exam', due: FUTURE },
      ],
      { present: 8, absent: 2 },
    );
    const r = fallbackOf(s);
    expect(r).toContain('Low scores: Activity A 60/100 (60.00%).');
    expect(r).toContain(
      'Missing or not yet scored (not counted as zero): Activity B [Activity]: no score recorded and its due date has passed; Project: no assessments recorded yet (configured weight 25).',
    );
    expect(r).toContain('Upcoming, not graded yet: Final Exam (due 2026-12-10).');
    expect(r).not.toMatch(/Activity B[^\n]*0\.00%/);
    expect(r).not.toMatch(/Final Exam[^\n]*0\.00%/);
    expect(r).not.toMatch(/\b\d+\. Project\b/);
  });

  it('names a recorded zero as a real score of 0', () => {
    const s = subjectOf(
      [
        { type: 'project', score: 0, title: 'Capstone Proposal' },
        { type: 'activity', score: 90, title: 'Activity 1' },
      ],
      { present: 10 },
    );
    const r = fallbackOf(s);
    expect(r).toContain('1. Project: 0.00%');
    expect(r).toContain('Low scores: Capstone Proposal 0/100 (0.00%), a recorded score of 0.');
    expect(r).not.toMatch(/Capstone Proposal[^\n]*not counted as zero/);
  });

  it('gives no personalised steps when there is no usable academic evidence', () => {
    const s = subjectOf([
      { type: 'activity', title: 'Activity 1', due: FUTURE },
      { type: 'quiz', title: 'Quiz 1', due: FUTURE },
    ]);
    const r = fallbackOf(s);
    expect(r).toContain("No scores or attendance are recorded for this subject yet, so I can't point to weak areas or give personalised steps.");
    expect(r).not.toContain('Priority areas');
    expect(r).not.toContain('Next step');
    expect(r).not.toMatch(/\d+\.\d{2}%/);
  });

  it('keeps the stored classification and invents no dates or assessments', async () => {
    const s = subjectOf(
      [
        { type: 'activity', score: 20, title: 'Activity 1' },
        { type: 'project', score: 10, title: 'Project 1' },
        { type: 'final_exam', title: 'Final Exam', due: FUTURE },
      ],
      { risk: 'stable', present: 5 },
    );
    const { res } = await aiDown(s);
    expect(res.risk_level).toBe('stable');
    expect(res.reply).toContain(`Official risk classification: ${s.risk!.label}`);
    expect(res.reply).not.toMatch(/Crucial|Vulnerable/);
    expect(res.reply.match(/\d{4}-\d{2}-\d{2}/g)).toEqual(['2026-12-10']);
    const quoted = [...res.reply.matchAll(/(?:^|[:;] )([A-Z][\w ]*?) (\d+)\/(\d+) \(/gm)].map((m) => `${m[1]} ${m[2]}/${m[3]}`);
    expect(quoted.sort()).toEqual(['Activity 1 20/100', 'Project 1 10/100']);
  });
});

describe('unrecognised assessment types', () => {
  const known: Item[] = [
    { type: 'activity', score: 70, title: 'Activity 1' },
    { type: 'project', score: 50, title: 'Project 1' },
    { type: 'midterm_exam', score: 60, title: 'Midterm Exam' },
  ];
  const unknown: Item[] = [
    { type: 'lab_report', score: 5, title: 'Lab Report 1' },
    { type: 'Quiz', score: 100, title: 'Pop Quiz' },
    { type: null, score: 0, title: 'Untyped Task' },
  ];

  it('leave the official grade, component weights and priorities unchanged', () => {
    const base = subjectOf(known, { present: 10 });
    const mixed = subjectOf([...known, ...unknown], { present: 10 });
    expect(mixed.provisionalGrade).toBe(base.provisionalGrade);
    expect([mixed.courseworkAverage, mixed.projectAverage, mixed.examAverage]).toEqual([
      base.courseworkAverage,
      base.projectAverage,
      base.examAverage,
    ]);
    const a = analyzeWeakAreas(mixed, NOW);
    const b = analyzeWeakAreas(base, NOW);
    const shape = (x: typeof a) =>
      x.components.map((c) => ({ key: c.key, percent: c.percent, weight: c.effectiveWeight, priority: c.priority, n: c.scored.length + c.unscored.length }));
    expect(shape(a)).toEqual(shape(b));
    expect(a.ranked.map((c) => c.key)).toEqual(b.ranked.map((c) => c.key));
    expect(a.belowBenchmarkAssessments.map((x) => x.title)).toEqual(b.belowBenchmarkAssessments.map((x) => x.title));
  });

  it('are reported as unmapped evidence instead of being dropped silently', () => {
    const s = subjectOf([...known, ...unknown], { present: 10 });
    const a = analyzeWeakAreas(s, NOW);
    expect(a.unmapped.map((x) => x.title)).toEqual(['Lab Report 1', 'Pop Quiz', 'Untyped Task']);
    expect(a.unmapped.every((x) => x.effectiveWeight === null)).toBe(true);

    const prompt = formatStudentRecordForPrompt(recordOf(s), s, NOW);
    const block = prompt.split('Unmapped assessments')[1].split('At or above')[0];
    expect(block).toContain('- Lab Report 1 [lab report]: 5/100 (5.00%)');
    expect(block).toContain('- Pop Quiz [Quiz]: 100/100 (100.00%)');
    expect(block).toContain('- Untyped Task [Assessment]: 0/100 (0.00%)');
    const below = prompt.split('Below-benchmark assessments')[1].split('Incomplete or missing evidence')[0];
    expect(below).not.toMatch(/Lab Report 1|Untyped Task/);

    const r = fallbackOf(s);
    expect(r).toContain('Not counted in your grade (assessment type not recognised): Lab Report 1; Pop Quiz; Untyped Task.');
    expect(r).not.toMatch(/Low scores:[^\n]*(Lab Report 1|Untyped Task)/);
  });

  it('add no prompt section when every type is recognised', () => {
    const s = subjectOf(known, { present: 10 });
    expect(analyzeWeakAreas(s, NOW).unmapped).toEqual([]);
    expect(formatStudentRecordForPrompt(recordOf(s), s, NOW)).not.toContain('Unmapped assessments');
    expect(fallbackOf(s)).not.toContain('Not counted in your grade');
  });
});
