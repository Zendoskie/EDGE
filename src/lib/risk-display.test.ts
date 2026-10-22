import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyRiskScore,
  INSUFFICIENT_DATA_LABEL,
  officialBandCounts,
  riskDisplayStatus,
  riskPieData,
  riskSummaryCaption,
  summarizeRiskStatuses,
} from '@/lib/risk-scoring';
import { resolveStudentRiskSummary } from '@/lib/student-performance-scope';
import { formatAtRiskSubjectLabels, mapPredictionToCoachingMetrics } from '@/lib/coaching-context';
import { instructorAtRiskNotification, studentPredictionNotifications } from '@/lib/notification-events';
import { classifyStudentRisk } from '../../supabase/functions/_shared/risk-scoring';
import {
  buildRiskEmail,
  escapeHtml,
  planRiskEmails,
  RISK_EMAIL_GATE_ENV,
  riskEmailsEnabled,
  type RiskEmailCandidate,
} from '../../supabase/functions/_shared/risk-email';
import { buildStudentRecord, riskDisplayLabel } from '../../supabase/functions/ai-coach/academic-context';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

/** A stored prediction row with evidence in every category. */
const complete = {
  activity_average: 70,
  quiz_average: 72,
  project_score: 68,
  attendance_rate: 0.8,
  laboratory_exam_average: 71,
  midterm_exam_average: 69,
  final_exam_average: null,
};
const DEFAULT_WEIGHTS = null;

describe('official bands at 90 / 80 / 75', () => {
  it.each([
    [90, 'excelling', 'Excelling (90.00)'],
    [89.99, 'stable', 'Stable (89.99)'],
    [80, 'stable', 'Stable (80.00)'],
    [79.99, 'at_risk', 'Vulnerable (79.99)'],
    [75, 'at_risk', 'Vulnerable (75.00)'],
    [74.99, 'critical', 'Crucial (74.99)'],
  ] as const)('%s is %s', (score, level, label) => {
    expect(classifyRiskScore(score)).toBe(level);
    const s = riskDisplayStatus({ level, evidence: { ...complete, risk_score: score }, weights: DEFAULT_WEIGHTS });
    expect(s.state).toBe('confirmed');
    expect(s.label).toBe(label);
  });
});

describe('riskDisplayStatus', () => {
  it('shows Insufficient data, never Stable, when there is no weighted grade', () => {
    const s = riskDisplayStatus({ level: 'stable', evidence: { ...complete, risk_score: null }, weights: DEFAULT_WEIGHTS });
    expect(s).toMatchObject({ state: 'insufficient', level: null, label: INSUFFICIENT_DATA_LABEL });
    expect(s.label).not.toMatch(/Stable/);
    // Rows from latest_student_predictions carry risk_score but not every evidence column.
    expect(riskDisplayStatus({ level: 'stable', evidence: { risk_score: null } }).label).toBe(INSUFFICIENT_DATA_LABEL);
  });

  it('keeps zero as a real score and as real evidence', () => {
    const zero = { ...complete, activity_average: 0, quiz_average: null, project_score: 0, risk_score: 0 };
    const s = riskDisplayStatus({ level: 'critical', evidence: zero, weights: DEFAULT_WEIGHTS });
    expect(s.state).toBe('confirmed');
    expect(s.label).toBe('Crucial (0.00)');
    expect(classifyStudentRisk({ items: [], attendancePercent: 0, weights: null }).risk_score).toBe(0);
  });

  it('keeps missing scores incomplete and qualifies the stored label without changing it', () => {
    const missingProject = { ...complete, project_score: null, risk_score: 70 };
    const s = riskDisplayStatus({ level: 'at_risk', evidence: missingProject, weights: DEFAULT_WEIGHTS });
    expect(s).toMatchObject({ state: 'provisional', level: 'at_risk', missing: ['project'] });
    expect(s.label).toBe('Vulnerable — Provisional (incomplete data)');
    expect(s.description).toContain('Project');
  });

  it('treats a category with weight 0 as not required', () => {
    const noProject = { activity_weight: 40, project_weight: 0, attendance_weight: 20, exam_weight: 40 };
    const s = riskDisplayStatus({ level: 'stable', evidence: { ...complete, project_score: null, risk_score: 85 }, weights: noProject });
    expect(s).toMatchObject({ state: 'confirmed', label: 'Stable (85.00)' });
  });

  it('is unverified when the view lacks the evidence columns or the weights', () => {
    expect(riskDisplayStatus({ level: 'critical' }).label).toBe('Crucial — Risk status unverified');
    expect(riskDisplayStatus({ level: 'critical', evidence: { risk_score: 40 } }).state).toBe('unverified');
    const incomplete = { ...complete, project_score: null, risk_score: 70 };
    expect(riskDisplayStatus({ level: 'at_risk', evidence: incomplete }).state).toBe('unverified');
    // With unknown weights, evidence in all four categories is still enough to confirm.
    expect(riskDisplayStatus({ level: 'at_risk', evidence: { ...complete, risk_score: 76 } }).state).toBe('confirmed');
  });

  it('gives each coverage state different text', () => {
    const labels = new Set([
      riskDisplayStatus({ level: 'at_risk', evidence: { ...complete, risk_score: 76 }, weights: null }).label,
      riskDisplayStatus({ level: 'at_risk', evidence: { ...complete, project_score: null, risk_score: 76 }, weights: null }).label,
      riskDisplayStatus({ level: 'at_risk', evidence: { ...complete, risk_score: null }, weights: null }).label,
      riskDisplayStatus({ level: 'at_risk' }).label,
    ]);
    expect(labels.size).toBe(4);
  });

  it('separates risk coverage from final-grade completeness', () => {
    // One graded quiz among many unscored items still counts as activity evidence for risk.
    // Final-grade release separately requires every assessment to be scored.
    const graded = classifyStudentRisk({
      items: [
        { type: 'quiz', score: 8, maxScore: 10 },
        { type: 'quiz', score: null, maxScore: 10 },
        { type: 'project', score: 40, maxScore: 50 },
        { type: 'midterm_exam', score: 70, maxScore: 100 },
      ],
      attendancePercent: 90,
      weights: null,
    });
    expect(graded.coverage.complete).toBe(true);

    const missingCategory = classifyStudentRisk({
      items: [{ type: 'quiz', score: 8, maxScore: 10 }],
      attendancePercent: 90,
      weights: null,
    });
    expect(missingCategory.coverage.complete).toBe(false);
    expect(missingCategory.coverage.missing).toEqual(['project', 'exam']);
  });
});

describe('distributions and analytics', () => {
  it('does not count insufficient rows as any level and captions unconfirmed rows', () => {
    const rows = [
      { risk_level: 'critical', ...complete, risk_score: 50 },
      { risk_level: 'at_risk', ...complete, project_score: null, risk_score: 77 },
      { risk_level: 'stable', ...complete, risk_score: null },
    ];
    const s = summarizeRiskStatuses(rows, null);
    expect(s.counts).toEqual({ critical: 1, at_risk: 1, stable: 0, excelling: 0 });
    expect(s.insufficient).toBe(1);
    expect(s.notConfirmed).toBe(1);
    expect(riskPieData(s).map((r) => r.name)).toEqual(['Vulnerable', 'Crucial', INSUFFICIENT_DATA_LABEL]);
    expect(riskSummaryCaption(s)).toContain('insufficient data');
    expect(riskSummaryCaption(summarizeRiskStatuses([{ risk_level: 'stable', ...complete, risk_score: 85 }], null))).toBeNull();
  });

  it('buckets analytics with the official thresholds and invents no class for a missing grade', () => {
    expect(officialBandCounts([90, 89.99, 80, 79.99, 75, 74.99, 0, null, undefined, Number.NaN])).toEqual({
      excelling: 1,
      stable: 2,
      at_risk: 2,
      critical: 2,
    });
    const src = read('src/components/EnhancedAnalytics.tsx');
    expect(src).toContain('officialBandCounts(');
    expect(src).not.toMatch(/>= 60|'Excellent'|'Good'|'Needs Improvement'/);
  });
});

describe('terminology and unweighted averages', () => {
  it('no longer shows Critical / At Risk as risk classifications', () => {
    for (const file of [
      'src/pages/dashboard/StudentEngagementMonitoring.tsx',
      'src/pages/dashboard/AdminUserManagement.tsx',
      'src/pages/dashboard/StudentDashboard.tsx',
      'supabase/functions/predict-risk/index.ts',
      'supabase/functions/_shared/risk-email.ts',
    ]) {
      expect(read(file), file).not.toMatch(/>Critical<|>At Risk<|"Critical"|"At Risk"|'Critical'|'At Risk'|high\/critical/);
    }
  });

  it('labels unweighted averages wherever they are shown', () => {
    expect(read('src/pages/dashboard/Insights.tsx')).toContain('Unweighted average score');
    expect(read('src/pages/dashboard/ParentPerformance.tsx')).toContain('Unweighted avg');
    expect(read('src/pages/dashboard/StudentDashboard.tsx')).toContain("'Unweighted avg'");
    expect(read('src/pages/dashboard/Reports.tsx')).toContain('Quiz Avg (unweighted)');
    expect(read('src/pages/dashboard/InstructorDashboard.tsx')).toContain('Unweighted score avg');
  });
});

describe('shared status in student scope, coaching and in-app notifications', () => {
  it('student summary carries the qualified label and state', () => {
    const summary = resolveStudentRiskSummary({
      overallAveragePercent: null,
      attendanceRatePercent: null,
      latestPrediction: {
        risk_level: 'critical',
        created_at: null,
        evidence: { ...complete, project_score: null, risk_score: 60 },
      },
      weights: null,
    });
    expect(summary.riskStatusLabel).toBe('Crucial — Provisional (incomplete data)');
    expect(summary.riskState).toBe('provisional');
  });

  it('coaching labels use the stored row', () => {
    const m = mapPredictionToCoachingMetrics({ subject_id: 's1', risk_level: 'at_risk', risk_score: null, subjects: { code: 'CS1' } });
    expect(formatAtRiskSubjectLabels([m!])).toEqual(['CS1 (Insufficient data)']);
  });

  it('dashboard and instructor notifications still fire, with qualified text', () => {
    const row = {
      id: 'p1',
      student_id: 'st',
      subject_id: 'sub',
      risk_level: 'at_risk',
      previous_risk_level: 'stable',
      created_at: '2026-10-13T00:00:00Z',
      ...complete,
      project_score: null,
      risk_score: 77,
    };
    // Notifications do not load subject weights, so incomplete evidence reads as unverified.
    const student = studentPredictionNotifications(row, 'CS1');
    expect(student[0].body).toBe(
      'CS1: your status changed from Stable to Vulnerable — Risk status unverified. Open Performance Insights.',
    );
    const instructor = instructorAtRiskNotification(row, { studentName: 'Ana', subjectCode: 'CS1' });
    expect(instructor?.title).toBe('Student now Vulnerable');
    expect(instructor?.body).toContain('Vulnerable — Risk status unverified');

    const confirmed = { ...row, project_score: 80 };
    expect(studentPredictionNotifications(confirmed, 'CS1')[0].body).toContain('to Vulnerable (77.00).');
    expect(instructorAtRiskNotification(confirmed, { studentName: 'Ana', subjectCode: 'CS1' })?.body).toContain(
      'classified as Vulnerable (77.00).',
    );
  });
});

describe('AI Coach risk line', () => {
  const live = { activity: true, project: true, attendance: true, exam: true };

  it('says Insufficient data, provisional or the plain label', () => {
    expect(riskDisplayLabel('stable', { risk_score: null }, null, live)).toBe('Insufficient data');
    expect(riskDisplayLabel('critical', { risk_score: 50, ...complete }, null, live)).toBe('Crucial');
    // Live evidence postdates the stored analysis: it may mark a label provisional, never confirm it.
    expect(riskDisplayLabel('critical', { risk_score: 50 }, null, live)).toBe('Crucial — Risk status unverified');
    expect(riskDisplayLabel('at_risk', { risk_score: 76 }, null, { ...live, exam: false })).toBe(
      'Vulnerable — Provisional (incomplete data: no evidence yet for Exams)',
    );
    // Stored evidence columns win over live evidence when present.
    expect(riskDisplayLabel('at_risk', { risk_score: 76, ...complete, project_score: null }, null, live)).toContain(
      'no evidence yet for Project',
    );
  });

  it('flows into the student record', () => {
    const record = buildStudentRecord({
      enrollments: [{ subject_id: 's1', subjects: { code: 'CS1', name: 'Intro' } }],
      activities: [{ id: 'a1', subject_id: 's1', type: 'quiz', max_score: 10 }],
      submissions: [{ activity_id: 'a1', score: 5 }],
      attendance: [{ subject_id: 's1', status: 'present' }],
      gradingSystems: [],
      predictions: [{ subject_id: 's1', risk_level: 'at_risk', risk_score: 60, created_at: '2026-10-01' }],
      engagement: null,
    });
    expect(record.subjects[0].risk?.classification).toBe('at_risk');
    expect(record.subjects[0].risk?.label).toBe('Vulnerable — Provisional (incomplete data: no evidence yet for Project, Exams)');
  });
});

describe('risk emails', () => {
  const coverage = (complete: boolean) => ({
    required: ['activity', 'project', 'attendance', 'exam'] as const,
    missing: complete ? [] : (['project'] as const),
    complete,
  });
  const candidate = (over: Partial<RiskEmailCandidate> = {}): RiskEmailCandidate => ({
    student_id: 's1',
    risk_level: 'critical',
    risk_score: 50,
    coverage: coverage(true) as unknown as RiskEmailCandidate['coverage'],
    ...over,
  });

  it('gate is off when the setting is absent, empty or anything but "true"', () => {
    expect(RISK_EMAIL_GATE_ENV).toBe('EDGE_RISK_EMAILS_ENABLED');
    for (const v of [undefined, null, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      expect(riskEmailsEnabled(v), String(v)).toBe(false);
    }
    expect(riskEmailsEnabled('true')).toBe(true);
    expect(planRiskEmails({ enabled: false, candidates: [candidate()], alreadySent: new Set() })).toEqual([]);
  });

  it('sends only definitive Crucial / Vulnerable results when enabled', () => {
    const plan = planRiskEmails({
      enabled: true,
      alreadySent: new Set(['s5:critical']),
      candidates: [
        candidate({ student_id: 's1' }),
        candidate({ student_id: 's2', risk_level: 'at_risk', risk_score: 77 }),
        candidate({ student_id: 's3', coverage: coverage(false) as unknown as RiskEmailCandidate['coverage'] }),
        candidate({ student_id: 's4', risk_score: null }),
        candidate({ student_id: 's5' }),
        candidate({ student_id: 's6', risk_level: 'stable', risk_score: 85 }),
      ],
    });
    expect(plan.map((c) => c.student_id)).toEqual(['s1', 's2']);
  });

  it('never emails a guarded (incomplete) result, even with the gate on', () => {
    const r = classifyStudentRisk({ items: [{ type: 'quiz', score: 1, maxScore: 10 }], attendancePercent: 20, weights: null });
    expect(r.band).toBe('critical');
    expect(r.risk_level).toBe('at_risk');
    const plan = planRiskEmails({
      enabled: true,
      alreadySent: new Set(),
      candidates: [{ student_id: 's1', risk_level: r.risk_level, risk_score: r.risk_score, coverage: r.coverage }],
    });
    expect(plan).toEqual([]);
  });

  it('uses the official names and escapes HTML', () => {
    const crucial = buildRiskEmail({ riskLevel: 'critical', studentName: '<b>Ana</b>', subjectCode: 'CS1', subjectName: 'A & B' });
    expect(crucial.subject).toBe('EDGE Alert: Crucial — CS1');
    expect(crucial.html).toContain('<strong>Crucial</strong>');
    expect(crucial.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(crucial.html).toContain('A &amp; B');
    expect(buildRiskEmail({ riskLevel: 'at_risk', studentName: null, subjectCode: 'CS1', subjectName: null }).subject).toBe(
      'EDGE Alert: Vulnerable — CS1',
    );
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });

  it('predict-risk reads the gate after ownership and skips the dedupe query when it is off', () => {
    const src = read('supabase/functions/predict-risk/index.ts');
    const owner = src.indexOf('isSubjectOwner(subject, user.id)');
    const gate = src.indexOf('riskEmailsEnabled(Deno.env.get(RISK_EMAIL_GATE_ENV))');
    const gateIf = src.indexOf('if (riskEmailsOn && emailCandidates.some(isDefinitiveRiskEmail))');
    const dedupe = src.indexOf('.from("email_notifications")');
    const send = src.indexOf('sendBrevoEmail({ to: studentEmail');
    expect(owner).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(owner);
    expect(gateIf).toBeGreaterThan(gate);
    expect(dedupe).toBeGreaterThan(gateIf);
    expect(send).toBeGreaterThan(dedupe);
    expect(src).toContain('planRiskEmails({ enabled: riskEmailsOn');
    expect(src).toContain('profileMap[n.student_id]?.email');
    // Predictions are written before, and independently of, the email step.
    expect(src.indexOf('upsert(plan.upserts')).toBeLessThan(gate);
    expect(src).not.toMatch(/BREVO_API_KEY\s*=\s*["']/);
  });
});
