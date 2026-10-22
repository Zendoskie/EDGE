import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canReadInboxRow, durableRowToInboxInput } from '@/lib/notification-delivery';
import {
  authorizeFeedbackEmail,
  authorizeGradesPostedCaller,
  authorizeRiskFeedbackEmail,
  counselingOutcomeEmail,
  counselingOutcomeRecipient,
  counselorFollowupEmail,
  counselorFollowupRecipient,
  deliverEmail,
  emailLogKey,
  enrollmentInstructors,
  engagementInterventionEmail,
  engagementInterventionRecipient,
  engagementOutcomeRecipient,
  enrollmentRequestRecipient,
  feedbackReplyRecipient,
  attendanceUpdateRecipient,
  gradesPostedEmail,
  gradesPostedLogId,
  instructorFeedbackEmail,
  interventionStudentEmail,
  isRiskEmailLevel,
  loggedInterventionRecipient,
  omitLoggedGradesPostedLines,
  responsibleFeedbackInstructor,
  riskFeedbackEmail,
  riskFeedbackInstructor,
  selectGradesPostedLines,
  shouldEmailEngagementIntervention,
} from '../../supabase/functions/_shared/notification-channels';
import {
  canRetryCounselorFollowupEmail,
  emailCounselorFollowup,
  emailEngagementIntervention,
  emailLoggedIntervention,
} from '@/lib/intervention-notification';
import { emailGradesPosted } from '@/lib/grades-posted-notification';
import { submitRiskFeedback } from '@/lib/student-feedback-notification';

const { rpc, invoke, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc,
    from,
    functions: { invoke },
  },
}));

import {
  OUTCOME_EMAIL_ALREADY_SENT,
  OUTCOME_SAVED_EMAIL_FAILED,
  canRetryOutcomeEmail,
  recordCounselingOutcome,
  retryCounselingOutcomeEmail,
} from '@/lib/counseling-outcome-notification';
import { sendReferralNotification } from '@/lib/referral-notifications';
import { submitEngagementFeedback } from '@/lib/student-feedback-notification';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const student = 'student-1';
const counselor = 'counselor-1';
const instructor = 'instructor-1';
const otherInstructor = 'instructor-2';
const parent = 'parent-1';

describe('counseling referral channels', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ error: null });
  });

  it('writes one student inbox row in the database and keeps the existing email call', async () => {
    const sql = read('supabase/migrations/20261005195000_counselor_approval_inbox_notification.sql');
    expect(sql).toContain('NEW.student_id');
    expect(sql).toContain("'Counseling referral'");
    expect(sql).toContain("'counseling-referral:' || NEW.id::text || ':' || v_event");
    expect(sql).toContain('ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING');
    expect(sql).not.toContain('parent');

    const realtime = read('src/hooks/useReferralRealtime.ts');
    expect(realtime).toContain('role === "student" || role === "instructor" || role === "guidance_counselor"');
    expect(realtime).toContain('? null');

    await sendReferralNotification({ event: 'referral_created', referralId: 'ref-1' });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('send-referral-notification', {
      body: { event: 'referral_created', referral_id: 'ref-1', counselor_remarks: null },
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('shows that inbox row only to the referred student', () => {
    const row = durableRowToInboxInput({
      id: 'row-1',
      title: 'Counseling referral',
      body: 'You received a counseling referral from the instructor. Status: Pending.',
      source_name: 'Course Instructor',
    });
    expect(row?.dedupeKey).toBe('user-inbox-notification:row-1');
    expect(canReadInboxRow(student, student)).toBe(true);
    expect(canReadInboxRow(student, instructor)).toBe(false);
    expect(canReadInboxRow(student, counselor)).toBe(false);
    expect(canReadInboxRow(student, parent)).toBe(false);
  });
});

describe('counseling outcome email', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it('emails only the referred student and keeps the inbox rpc when email fails', async () => {
    rpc.mockResolvedValue({ data: 'intervention-1', error: null });
    invoke.mockResolvedValue({ data: null, error: { message: 'provider down' } });

    const result = await recordCounselingOutcome({
      interventionId: 'intervention-1',
      outcomeRating: 'improved',
      outcomeNote: 'private note',
      actionType: 'guidance_counseling',
      actorRole: 'guidance_counselor',
    });

    expect(rpc).toHaveBeenCalledWith('complete_engagement_intervention', {
      p_intervention_id: 'intervention-1',
      p_outcome_rating: 'improved',
      p_outcome_note: 'private note',
    });
    expect(result).toEqual({
      id: 'intervention-1',
      emailError: OUTCOME_SAVED_EMAIL_FAILED,
      alreadySent: false,
    });
    expect(invoke).toHaveBeenCalledWith('send-referral-notification', {
      body: { event: 'counseling_outcome', intervention_id: 'intervention-1' },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('private note');
    expect(from).not.toHaveBeenCalled();
  });

  it('does not email a repeated completion or a non-counseling follow-up', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'intervention_already_closed' } });
    await expect(
      recordCounselingOutcome({
        interventionId: 'intervention-1',
        outcomeRating: 'improved',
        actionType: 'guidance_counseling',
        actorRole: 'guidance_counselor',
      }),
    ).rejects.toEqual({ message: 'intervention_already_closed' });
    expect(invoke).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: 'intervention-2', error: null });
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    const other = await recordCounselingOutcome({
      interventionId: 'intervention-2',
      outcomeRating: 'no_change',
      actionType: 'send_reminder',
      actorRole: 'instructor',
    });
    expect(other).toEqual({ id: 'intervention-2', emailError: null, alreadySent: false });
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'engagement_outcome', intervention_id: 'intervention-2' },
    });
  });

  it('targets the student and hides counseling notes', () => {
    expect(
      counselingOutcomeRecipient({
        callerIsCounselor: true,
        actionType: 'guidance_counseling',
        actorRole: 'guidance_counselor',
        status: 'completed',
        studentId: student,
        callerId: counselor,
        ownerId: counselor,
        completedBy: counselor,
      }),
    ).toBe(student);
    expect(
      counselingOutcomeRecipient({
        callerIsCounselor: true,
        actionType: 'guidance_counseling',
        actorRole: 'guidance_counselor',
        status: 'completed',
        studentId: student,
        callerId: instructor,
        ownerId: counselor,
        completedBy: counselor,
      }),
    ).toBeNull();
    expect(
      counselingOutcomeRecipient({
        callerIsCounselor: false,
        actionType: 'guidance_counseling',
        actorRole: 'guidance_counselor',
        status: 'completed',
        studentId: student,
        callerId: counselor,
        ownerId: counselor,
        completedBy: counselor,
      }),
    ).toBeNull();
    expect(
      counselingOutcomeRecipient({
        callerIsCounselor: true,
        actionType: 'send_reminder',
        actorRole: 'instructor',
        status: 'completed',
        studentId: student,
        callerId: instructor,
        ownerId: instructor,
        completedBy: instructor,
      }),
    ).toBeNull();

    const email = counselingOutcomeEmail({
      subjectCode: 'CS101 <script>',
      message: 'Keep practicing',
      outcomeRating: 'improved',
      outcomeNote: 'Great progress',
    });
    expect(email.subject).toContain('CS101 <script>');
    expect(email.html).toContain('CS101 &lt;script&gt;');
    expect(email.html).toContain('Keep practicing');
    expect(email.html).toContain('Improved');
    expect(email.html).toContain('Great progress');
    expect(email.html).not.toContain(instructor);
    expect(email.html).not.toContain(parent);
    expect(isRiskEmailLevel(emailLogKey('counseling_outcome', 'intervention-1'))).toBe(false);
    expect(emailLogKey('counseling_outcome', 'intervention-1')).toBe('counseling_outcome:intervention-1');
  });

  it('retries a failed outcome email without completing the outcome again', async () => {
    rpc.mockResolvedValue({ data: 'intervention-1', error: null });
    invoke.mockResolvedValueOnce({ data: { sent: 0, failed: 1 }, error: null });
    const saved = await recordCounselingOutcome({
      interventionId: 'intervention-1',
      outcomeRating: 'improved',
      actionType: 'guidance_counseling',
      actorRole: 'guidance_counselor',
    });
    expect(saved.emailError).toBe(OUTCOME_SAVED_EMAIL_FAILED);
    expect(rpc).toHaveBeenCalledTimes(1);

    invoke.mockResolvedValueOnce({ data: { sent: 1, failed: 0 }, error: null });
    const retried = await retryCounselingOutcomeEmail('intervention-1', 'guidance_counseling', 'guidance_counselor');
    expect(retried).toEqual({ emailError: null, alreadySent: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('send-referral-notification', {
      body: { event: 'counseling_outcome', intervention_id: 'intervention-1' },
    });

    invoke.mockResolvedValueOnce({ data: { sent: 0, failed: 0, duplicate: true }, error: null });
    const again = await retryCounselingOutcomeEmail('intervention-1', 'guidance_counseling', 'guidance_counselor');
    expect(again).toEqual({ emailError: null, alreadySent: true });
    expect(again.emailError).not.toBe(OUTCOME_EMAIL_ALREADY_SENT);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('offers retry only to the counselor who owns the completed counseling outcome', () => {
    const completed = {
      status: 'completed',
      action_type: 'guidance_counseling',
      actor_role: 'guidance_counselor',
      instructor_id: counselor,
      completed_by: counselor,
    };
    expect(canRetryOutcomeEmail(completed, counselor)).toBe(true);
    expect(canRetryOutcomeEmail(completed, instructor)).toBe(false);
    expect(canRetryOutcomeEmail(completed, student)).toBe(false);
    expect(canRetryOutcomeEmail(completed, parent)).toBe(false);
    expect(canRetryOutcomeEmail({ ...completed, status: 'open' }, counselor)).toBe(false);
    expect(
      canRetryOutcomeEmail(
        { ...completed, action_type: 'send_reminder', actor_role: 'instructor', instructor_id: instructor, completed_by: instructor },
        instructor,
      ),
    ).toBe(true);
  });

  it('routes instructor-completed outcomes through send-notification', async () => {
    rpc.mockResolvedValue({ data: 'intervention-2', error: null });
    invoke.mockResolvedValueOnce({ data: { sent: 1, failed: 0 }, error: null });
    const saved = await recordCounselingOutcome({
      interventionId: 'intervention-2',
      outcomeRating: 'no_change',
      actionType: 'send_reminder',
      actorRole: 'instructor',
    });
    expect(saved.emailError).toBeNull();
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'engagement_outcome', intervention_id: 'intervention-2' },
    });
  });
});

describe('student feedback instructor email', () => {
  beforeEach(() => {
    invoke.mockReset();
    from.mockReset();
  });

  it('keeps the feedback row when the instructor email fails', async () => {
    from.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'feedback-1' }, error: null }),
        }),
      }),
    });
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });

    const result = await submitEngagementFeedback({
      studentId: student,
      subject: 'CS101',
      message: 'The lab was hard.',
    });

    expect(result).toEqual({
      id: 'feedback-1',
      emailError: 'Feedback saved. The instructor email could not be sent.',
    });
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'instructor_feedback', feedback_id: 'feedback-1' },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('The lab was hard.');
    expect(JSON.stringify(from.mock.calls)).not.toContain('delete');
  });

  it('emails the subject instructor and nobody else', () => {
    const rows = enrollmentInstructors([
      { subjects: { instructor_id: instructor, code: 'CS101', name: 'Programming' } },
      { subjects: { instructor_id: otherInstructor, code: 'ENG1', name: 'English' } },
    ]);
    expect(responsibleFeedbackInstructor('CS101', rows)).toBe(instructor);
    expect(responsibleFeedbackInstructor('English', rows)).toBe(otherInstructor);
    expect(responsibleFeedbackInstructor('general', rows)).toBeNull();
    expect(responsibleFeedbackInstructor(null, rows)).toBeNull();
    expect(responsibleFeedbackInstructor(null, [rows[0]])).toBe(instructor);

    const email = instructorFeedbackEmail({ studentName: 'Ana', topic: 'CS101' });
    expect(email.html).toContain('Ana submitted new feedback: CS101.');
    expect(email.html).not.toContain(parent);
    expect(email.html).not.toContain(counselor);
    expect(email.html).not.toContain('The lab was hard.');
    expect(isRiskEmailLevel(emailLogKey('instructor_feedback', 'feedback-1'))).toBe(false);
  });

  it('authorizes only the student who owns the stored feedback row', () => {
    const owned = { studentId: student, topic: 'CS101' };
    expect(authorizeFeedbackEmail({ callerId: student, callerRole: 'student', feedback: owned })).toEqual({
      studentId: student,
      topic: 'CS101',
    });
    expect(
      authorizeFeedbackEmail({ callerId: 'student-2', callerRole: 'student', feedback: owned }),
    ).toBeNull();
    expect(authorizeFeedbackEmail({ callerId: student, callerRole: 'student', feedback: null })).toBeNull();
    for (const role of ['instructor', 'guidance_counselor', 'parent', 'admin', null]) {
      expect(authorizeFeedbackEmail({ callerId: student, callerRole: role, feedback: owned })).toBeNull();
    }
    const rows = enrollmentInstructors([
      { subjects: { instructor_id: instructor, code: 'CS101', name: 'Programming' } },
      { subjects: { instructor_id: otherInstructor, code: 'ENG1', name: 'English' } },
    ]);
    const allowed = authorizeFeedbackEmail({ callerId: student, callerRole: 'student', feedback: owned });
    expect(responsibleFeedbackInstructor(allowed?.topic, rows)).toBe(instructor);
    expect(responsibleFeedbackInstructor('unmatched topic', rows)).toBeNull();
  });
});

describe('grades_posted email', () => {
  it('emails only stored non-null scores for A1 and Midterm and skips missing P1', () => {
    expect(authorizeGradesPostedCaller({
      callerIsInstructor: true,
      callerId: instructor,
      subjectInstructorId: instructor,
    })).toBe(true);
    expect(authorizeGradesPostedCaller({
      callerIsInstructor: true,
      callerId: otherInstructor,
      subjectInstructorId: instructor,
    })).toBe(false);
    expect(authorizeGradesPostedCaller({
      callerIsInstructor: false,
      callerId: instructor,
      subjectInstructorId: instructor,
    })).toBe(false);

    const subjectId = 'sub-1';
    const a1 = 'act-a1';
    const p1 = 'act-p1';
    const mid = 'act-mid';
    const lines = selectGradesPostedLines({
      subjectId,
      items: [
        { activityId: a1, studentId: student },
        { activityId: p1, studentId: student },
        { activityId: mid, studentId: student },
      ],
      activitySubjectId: new Map([
        [a1, subjectId],
        [p1, subjectId],
        [mid, subjectId],
        ['foreign', 'other-sub'],
      ]),
      scoreByPair: new Map([
        [gradesPostedLogId(a1, student), 16],
        [gradesPostedLogId(p1, student), null],
        [gradesPostedLogId(mid, student), 45],
      ]),
      titleByActivityId: new Map([
        [a1, 'Activity A1'],
        [p1, 'Project P1'],
        [mid, 'Midterm Exam'],
      ]),
    });
    expect(lines).toEqual([
      { studentId: student, activityId: a1, title: 'Activity A1', score: 16 },
      { studentId: student, activityId: mid, title: 'Midterm Exam', score: 45 },
    ]);
    expect(lines.some((line) => line.activityId === p1 || line.score === 0 && line.title.includes('P1'))).toBe(false);

    const zeroKept = selectGradesPostedLines({
      subjectId,
      items: [{ activityId: a1, studentId: student }],
      activitySubjectId: new Map([[a1, subjectId]]),
      scoreByPair: new Map([[gradesPostedLogId(a1, student), 0]]),
      titleByActivityId: new Map([[a1, 'Activity A1']]),
    });
    expect(zeroKept).toEqual([{ studentId: student, activityId: a1, title: 'Activity A1', score: 0 }]);

    const email = gradesPostedEmail('PL101', lines.map((line) => ({ title: line.title, score: line.score })));
    expect(email.html).toContain('Activity A1: 16');
    expect(email.html).toContain('Midterm Exam: 45');
    expect(email.html).not.toContain('Project P1');
    expect(isRiskEmailLevel(emailLogKey('grades_posted', gradesPostedLogId(a1, student)))).toBe(false);

    const pending = omitLoggedGradesPostedLines(lines, new Set([gradesPostedLogId(a1, student)]));
    expect(pending).toEqual([
      { studentId: student, activityId: mid, title: 'Midterm Exam', score: 45 },
    ]);
    const mixedEmail = gradesPostedEmail(
      'PL101',
      pending.map((line) => ({ title: line.title, score: line.score })),
    );
    expect(mixedEmail.html).toContain('Midterm Exam: 45');
    expect(mixedEmail.html).not.toContain('Activity A1');
    expect(omitLoggedGradesPostedLines(lines, new Set([
      gradesPostedLogId(a1, student),
      gradesPostedLogId(mid, student),
    ]))).toEqual([]);
  });

  it('retries grades_posted without writing another submission', async () => {
    invoke.mockReset();
    from.mockReset();
    rpc.mockReset();
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
    const failed = await emailGradesPosted('sub-1', [
      { activity_id: 'a1', student_id: student },
      { activity_id: 'mid', student_id: student },
    ]);
    expect(failed.emailError).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();

    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    const sent = await emailGradesPosted('sub-1', [
      { activity_id: 'a1', student_id: student },
      { activity_id: 'mid', student_id: student },
    ]);
    expect(sent).toEqual({ emailError: null, alreadySent: false });
    expect(invoke).toHaveBeenLastCalledWith('send-notification', {
      body: {
        event: 'grades_posted',
        subject_id: 'sub-1',
        items: [
          { activity_id: 'a1', student_id: student },
          { activity_id: 'mid', student_id: student },
        ],
      },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('"to"');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('risk feedback instructor email', () => {
  beforeEach(() => {
    invoke.mockReset();
    from.mockReset();
  });

  it('authorizes only the owning student and fails closed without an instructor', () => {
    const owned = { studentId: student, subjectId: 'sub-1' };
    expect(authorizeRiskFeedbackEmail({ callerId: student, callerRole: 'student', feedback: owned })).toEqual(owned);
    expect(
      authorizeRiskFeedbackEmail({ callerId: 'student-2', callerRole: 'student', feedback: owned }),
    ).toBeNull();
    expect(authorizeRiskFeedbackEmail({ callerId: student, callerRole: 'instructor', feedback: owned })).toBeNull();
    expect(riskFeedbackInstructor(instructor)).toBe(instructor);
    expect(riskFeedbackInstructor(null)).toBeNull();
    expect(riskFeedbackInstructor('')).toBeNull();
    const email = riskFeedbackEmail({ studentName: 'Ana', subjectCode: 'CS101' });
    expect(email.html).toContain('Ana submitted risk feedback');
    expect(email.html).toContain('CS101');
    expect(isRiskEmailLevel(emailLogKey('risk_feedback', 'feedback-1'))).toBe(false);
  });

  it('keeps the risk feedback row when the instructor email fails', async () => {
    from.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'risk-1' }, error: null }),
        }),
      }),
    });
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });

    const result = await submitRiskFeedback({
      studentId: student,
      subjectId: 'sub-1',
      predictionId: 'pred-1',
      riskLevel: 'at_risk',
      reasons: ['Lack of motivation'],
      details: null,
    });
    expect(result).toEqual({
      id: 'risk-1',
      emailError: 'Feedback saved. The instructor email could not be sent.',
    });
    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'risk_feedback', feedback_id: 'risk-1' },
    });
    expect(JSON.stringify(from.mock.calls)).not.toContain('delete');
  });
});

describe('counselor engagement follow-up email', () => {
  const stored = {
    studentId: student,
    instructorId: counselor,
    actionType: 'guidance_counseling',
    status: 'open',
  };

  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    from.mockReset();
  });

  it('emails only the stored student for an owned guidance_counseling follow-up', () => {
    expect(
      counselorFollowupRecipient({
        callerIsCounselor: true,
        callerId: counselor,
        intervention: stored,
      }),
    ).toBe(student);
    expect(
      counselorFollowupRecipient({
        callerIsCounselor: true,
        callerId: instructor,
        intervention: stored,
      }),
    ).toBeNull();
    expect(
      counselorFollowupRecipient({
        callerIsCounselor: false,
        callerId: counselor,
        intervention: stored,
      }),
    ).toBeNull();
    expect(
      counselorFollowupRecipient({
        callerIsCounselor: true,
        callerId: counselor,
        intervention: { ...stored, actionType: 'send_reminder' },
      }),
    ).toBeNull();
    expect(
      counselorFollowupRecipient({
        callerIsCounselor: true,
        callerId: counselor,
        intervention: { ...stored, status: 'cancelled' },
      }),
    ).toBeNull();
    expect(counselorFollowupEmail({ subjectCode: 'CS101', message: 'Check in weekly' }).html).toContain('guidance counselor');
    expect(counselorFollowupEmail({ subjectCode: 'CS101', message: 'Check in weekly' }).html).toContain('Check in weekly');
    expect(isRiskEmailLevel(emailLogKey('counselor_followup', 'int-1'))).toBe(false);
    expect(
      canRetryCounselorFollowupEmail(
        {
          status: 'open',
          action_type: 'guidance_counseling',
          actor_role: 'guidance_counselor',
          instructor_id: counselor,
        },
        counselor,
      ),
    ).toBe(true);
    expect(
      canRetryCounselorFollowupEmail(
        {
          status: 'completed',
          action_type: 'guidance_counseling',
          actor_role: 'guidance_counselor',
          instructor_id: counselor,
        },
        counselor,
      ),
    ).toBe(false);
  });

  it('retries counselor follow-up email without logging another intervention', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
    const failed = await emailCounselorFollowup('intervention-c1');
    expect(failed.emailError).toBe('Intervention saved. The student email could not be sent.');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    const sent = await emailCounselorFollowup('intervention-c1');
    expect(sent).toEqual({ emailError: null, alreadySent: false });
    expect(invoke).toHaveBeenLastCalledWith('send-referral-notification', {
      body: { event: 'counselor_followup', intervention_id: 'intervention-c1' },
    });
  });
});

describe('instructor intervention email', () => {
  const stored = {
    studentId: student,
    instructorId: instructor,
    actionType: 'send_reminder',
  };

  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    from.mockReset();
  });

  it('emails only the student stored on the intervention', () => {
    expect(shouldEmailEngagementIntervention('send_reminder')).toBe(true);
    expect(shouldEmailEngagementIntervention('send_email_reminder')).toBe(true);
    expect(shouldEmailEngagementIntervention('guidance_counseling')).toBe(false);
    expect(shouldEmailEngagementIntervention('add_note')).toBe(false);
    expect(
      engagementInterventionRecipient({
        callerId: instructor,
        intervention: stored,
      }),
    ).toBe(student);
    expect(
      engagementInterventionRecipient({
        callerId: otherInstructor,
        intervention: stored,
      }),
    ).toBeNull();
    expect(
      engagementInterventionRecipient({
        callerId: instructor,
        intervention: { ...stored, actionType: 'guidance_counseling' },
      }),
    ).toBeNull();
    expect(engagementInterventionEmail({ subjectCode: 'CS101', message: 'Please attend office hours' }).html).toContain(
      'Please attend office hours',
    );
    expect(interventionStudentEmail({ subjectCode: 'CS101', message: 'Meet after class' }).html).toContain('Meet after class');
    expect(
      enrollmentRequestRecipient({
        callerId: student,
        enrollment: { studentId: student, status: 'pending', instructorId: instructor },
      }),
    ).toBe(instructor);
    expect(
      enrollmentRequestRecipient({
        callerId: student,
        enrollment: { studentId: student, status: 'active', instructorId: instructor },
      }),
    ).toBeNull();
    expect(
      feedbackReplyRecipient({
        callerId: instructor,
        callerIsInstructor: true,
        feedback: { studentId: student, instructorId: instructor },
      }),
    ).toBe(student);
    expect(
      attendanceUpdateRecipient({
        callerId: instructor,
        callerIsInstructor: true,
        attendance: { studentId: student, subjectInstructorId: instructor },
      }),
    ).toBe(student);
    expect(
      engagementOutcomeRecipient({
        callerId: instructor,
        intervention: {
          studentId: student,
          instructorId: instructor,
          status: 'completed',
          completedBy: instructor,
        },
      }),
    ).toBe(student);
    expect(
      loggedInterventionRecipient({
        callerIsInstructor: true,
        callerId: instructor,
        intervention: { studentId: student, subjectInstructorId: instructor },
      }),
    ).toBe(student);
    expect(
      loggedInterventionRecipient({
        callerIsInstructor: true,
        callerId: instructor,
        intervention: { studentId: 'student-2', subjectInstructorId: otherInstructor },
      }),
    ).toBeNull();
    expect(
      loggedInterventionRecipient({
        callerIsInstructor: true,
        callerId: instructor,
        intervention: { studentId: student, subjectInstructorId: null },
      }),
    ).toBeNull();
  });

  it('retries the email without writing another intervention', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
    const failed = await emailEngagementIntervention('intervention-1');
    expect(failed.emailError).toBe('Intervention saved. The student email could not be sent.');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();

    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
    const sent = await emailLoggedIntervention('intervention-2');
    expect(sent).toEqual({ emailError: null, alreadySent: false });
    expect(invoke).toHaveBeenLastCalledWith('send-notification', {
      body: { event: 'logged_intervention', intervention_id: 'intervention-2' },
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('email delivery safety', () => {
  it('does not log a failed send and does not send a duplicate', async () => {
    const log = vi.fn();
    await expect(
      deliverEmail({
        alreadyLogged: false,
        send: async () => {
          throw new Error('provider down');
        },
        log,
      }),
    ).resolves.toBe('failed');
    expect(log).not.toHaveBeenCalled();

    await expect(
      deliverEmail({
        alreadyLogged: true,
        send: async () => undefined,
        log,
      }),
    ).resolves.toBe('duplicate');
    expect(log).not.toHaveBeenCalled();
  });

  it('uses the existing provider helper and keeps credentials on the server', () => {
    const outcome = read('src/lib/counseling-outcome-notification.ts');
    const feedback = read('src/lib/student-feedback-notification.ts');
    const referral = read('src/lib/referral-notifications.ts');
    const referralFn = read('supabase/functions/send-referral-notification/index.ts');
    const notifyFn = read('supabase/functions/send-notification/index.ts');

    for (const src of [outcome, feedback, referral]) {
      expect(src).not.toContain('BREVO');
      expect(src).not.toContain('BREVO_API_KEY');
      expect(src).not.toContain('SERVICE_ROLE');
      expect(src).not.toContain('api-key');
    }
    expect(outcome).toContain("invoke('send-referral-notification'");
    expect(feedback).toContain("invoke('send-notification'");
    expect(referralFn).toContain('sendBrevoEmail');
    expect(referralFn).toContain('../_shared/brevo-email.ts');
    expect(referralFn).toContain('sendCounselingOutcomeEmail');
    expect(notifyFn.indexOf('event === "instructor_feedback"')).toBeLessThan(
      notifyFn.indexOf('Only instructors can send notifications'),
    );
    const feedbackFn = notifyFn.slice(
      notifyFn.indexOf('async function sendInstructorFeedbackEmail'),
      notifyFn.indexOf('serve(async'),
    );
    expect(feedbackFn.indexOf('authorizeFeedbackEmail')).toBeGreaterThan(0);
    expect(feedbackFn.indexOf('authorizeFeedbackEmail')).toBeLessThan(feedbackFn.indexOf('sendBrevoEmail'));
    expect(feedbackFn).toContain('.eq("role", "student")');
    expect(feedbackFn).not.toContain('body?.student_id');
    expect(feedbackFn).not.toContain('body?.to');
    const outcomeFn = referralFn.slice(
      referralFn.indexOf('async function sendCounselingOutcomeEmail'),
      referralFn.indexOf('serve(async'),
    );
    expect(outcomeFn).not.toContain('user_inbox_notifications');
    expect(outcomeFn).not.toContain('complete_engagement_intervention');
    expect(outcomeFn.indexOf('counselingOutcomeRecipient')).toBeLessThan(outcomeFn.indexOf('sendBrevoEmail'));
    expect(outcomeFn.indexOf('.insert(')).toBeGreaterThan(outcomeFn.indexOf('sendBrevoEmail'));
    expect(notifyFn).toContain('../_shared/brevo-email.ts');
    expect(read('supabase/functions/_shared/risk-email.ts')).toContain('EDGE_RISK_EMAILS_ENABLED');
    expect(read('supabase/functions/_shared/brevo-email.ts')).toContain('BREVO_API_KEY');
    for (const fn of [
      'send-notification',
      'predict-risk',
      'send-referral-notification',
      'send-parent-email',
      'send-staff-invitation',
      'send-account-status-email',
      'notify-missing-grades',
      'notify-parent-on-registration',
      'notify-student-on-parent-registration',
    ]) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).toContain('../_shared/brevo-email.ts');
      expect(src).not.toContain('api.brevo.com');
    }
  });

  it('does not publish missing grades when an assessment is created', () => {
    const detail = read('src/pages/dashboard/SubjectDetail.tsx');
    const create = detail.slice(detail.indexOf('const create = useMutation'), detail.indexOf('const remove = useMutation'));
    expect(create).not.toContain('publishMissingGradeAlerts');
    const missing = read('supabase/functions/notify-missing-grades/index.ts');
    expect(missing.indexOf('missingGradeAlertAllowed')).toBeLessThan(missing.indexOf('grades_published_at:'));
    expect(missing.indexOf('missingGradeAlertAllowed')).toBeLessThan(missing.indexOf('user_inbox_notifications'));
    const sql = read('supabase/migrations/20261018130000_missing_grade_requires_recorded_score.sql');
    const guard = sql.indexOf('submission.score IS NOT NULL');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sql.indexOf('grades_published_at = COALESCE'));
  });

  it('emails the stored intervention student after the inbox row exists', () => {
    const hook = read('src/hooks/useEngagementAlerts.ts');
    const log = hook.slice(hook.indexOf('mutationFn: async (input: LogInterventionInput)'), hook.indexOf('onSuccess: (_data, variables)'));
    expect(log.indexOf("rpc('log_engagement_intervention'")).toBeLessThan(log.indexOf('emailEngagementIntervention'));
    expect(log.indexOf("rpc('log_engagement_intervention'")).toBeLessThan(log.indexOf('emailCounselorFollowup'));
    expect(log).not.toContain('input.studentEmail');
    const detail = read('src/pages/dashboard/SubjectDetail.tsx');
    const saveStart = detail.indexOf('const logIntervention = useMutation');
    const save = detail.slice(saveStart, detail.indexOf('onSuccess: (result)', saveStart));
    expect(save.indexOf(".from('interventions')")).toBeLessThan(save.indexOf('emailLoggedIntervention'));
    expect(save).not.toContain('sendEmailNotification');
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const engagement = notifyFn.slice(
      notifyFn.indexOf('async function sendEngagementInterventionEmail'),
      notifyFn.indexOf('async function sendLoggedInterventionEmail'),
    );
    expect(engagement).not.toContain('user_inbox_notifications');
    expect(engagement).not.toContain('log_engagement_intervention');
    expect(engagement.indexOf('engagementInterventionRecipient')).toBeLessThan(engagement.indexOf('sendBrevoEmail'));
    const logged = notifyFn.slice(
      notifyFn.indexOf('async function sendLoggedInterventionEmail'),
      notifyFn.indexOf('serve(async'),
    );
    expect(logged).not.toContain('user_inbox_notifications');
    expect(logged.indexOf('loggedInterventionRecipient')).toBeLessThan(logged.indexOf('sendBrevoEmail'));
    expect(logged).not.toContain('body?.to');
    expect(logged).toContain('message');
    expect(logged).toContain('interventionStudentEmail({');
  });

  it('writes the instructor engagement-feedback inbox before the feedback email', () => {
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const feedbackFn = notifyFn.slice(
      notifyFn.indexOf('async function sendInstructorFeedbackEmail'),
      notifyFn.indexOf('async function sendEngagementInterventionEmail'),
    );
    expect(feedbackFn.indexOf('ambiguous_instructor')).toBeLessThan(feedbackFn.indexOf('user_inbox_notifications'));
    expect(feedbackFn.indexOf('user_inbox_notifications')).toBeLessThan(feedbackFn.indexOf('sendBrevoEmail'));
    expect(feedbackFn).toContain('engagement-feedback:');
    expect(feedbackFn).toContain('dedupe_key');
    expect(feedbackFn).toContain('23505');
  });

  it('uses grades_posted without client score lines or a second grade inbox writer', () => {
    const table = read('src/components/GradebookTable.tsx');
    const save = table.slice(table.indexOf('const saveGrades = useMutation'), table.indexOf('onSuccess: async (result)'));
    expect(save).toContain('emailGradesPosted');
    expect(save).not.toContain("to: email");
    expect(save).not.toContain('A grade is now available');
    expect(save.indexOf('emailGradesPosted')).toBeLessThan(save.indexOf('publishMissingGradeAlerts'));
    expect(table).toContain('retryGradeEmails');
    expect(table).toContain('gradesPostedItemsFromSavedScores');
    expect(table.indexOf('gradesPostedItemsFromSavedScores')).toBeLessThan(table.indexOf('emailGradesPosted(subjectId, items)'));
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const gradesFn = notifyFn.slice(
      notifyFn.indexOf('async function sendGradesPostedEmail'),
      notifyFn.indexOf('async function sendRiskFeedbackEmail'),
    );
    expect(gradesFn).toContain('authorizeGradesPostedCaller');
    expect(gradesFn).toContain('selectGradesPostedLines');
    expect(gradesFn).toContain('omitLoggedGradesPostedLines');
    expect(gradesFn).not.toContain('user_inbox_notifications');
    expect(gradesFn).not.toContain('body?.to');
  });

  it('keeps risk feedback email-only on the edge and does not duplicate the inbox write', () => {
    const dashboard = read('src/pages/dashboard/StudentDashboard.tsx');
    expect(dashboard).toContain('submitRiskFeedback');
    const client = read('src/lib/student-feedback-notification.ts');
    const riskClient = client.slice(
      client.indexOf('export async function submitRiskFeedback'),
      client.indexOf('export async function submitEngagementFeedback'),
    );
    expect(riskClient).toContain("event: 'risk_feedback'");
    expect(riskClient).toContain('feedback_id: data.id');
    expect(riskClient).not.toContain('user_inbox_notifications');
    expect(riskClient).not.toContain('risk-feedback:');
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const riskFn = notifyFn.slice(
      notifyFn.indexOf('async function sendRiskFeedbackEmail'),
      notifyFn.indexOf('async function sendInstructorFeedbackEmail'),
    );
    expect(riskFn).toContain('authorizeRiskFeedbackEmail');
    expect(riskFn).toContain('sendBrevoEmail');
    expect(riskFn).not.toContain('user_inbox_notifications');
    expect(riskFn).not.toContain('risk-feedback:');
    expect(riskFn).not.toContain('body?.to');
    // Inbox for risk feedback is owned by the already-applied production DB trigger
    // (notify_instructor_risk_feedback / risk-feedback:<id>), not by this Edge handler.
  });

  it('emails counselor follow-up after the log RPC and retries without another inbox row', () => {
    const hook = read('src/hooks/useEngagementAlerts.ts');
    const log = hook.slice(hook.indexOf('mutationFn: async (input: LogInterventionInput)'), hook.indexOf('onSuccess: (_data, variables)'));
    expect(log).toContain('emailCounselorFollowup');
    expect(log.indexOf("rpc('log_engagement_intervention'")).toBeLessThan(log.indexOf('emailCounselorFollowup'));
    expect(log).toContain("input.actionType === 'guidance_counseling'");
    const history = read('src/components/InterventionHistory.tsx');
    expect(history).toContain('canRetryCounselorFollowupEmail');
    expect(history).toContain('emailCounselorFollowup');
    const referralFn = read('supabase/functions/send-referral-notification/index.ts');
    expect(referralFn).toContain('counselor_followup');
    const followFn = referralFn.slice(
      referralFn.indexOf('async function sendCounselorFollowupEmail'),
      referralFn.indexOf('async function sendCounselingOutcomeEmail'),
    );
    expect(followFn).toContain('counselorFollowupRecipient');
    expect(followFn).not.toContain('user_inbox_notifications');
    expect(followFn).not.toContain('log_engagement_intervention');
    expect(followFn).not.toContain('complete_engagement_intervention');
  });

  it('loads engagement feedback replies from student_engagement_feedback', () => {
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const replyFn = notifyFn.slice(
      notifyFn.indexOf('async function sendFeedbackReplyEmail'),
      notifyFn.indexOf('async function sendAttendanceUpdateEmail'),
    );
    expect(replyFn).toContain('student_engagement_feedback');
    expect(replyFn).not.toContain('.from("engagement_feedback")');
  });

  it('authorizes engagement feedback replies like instructor_reply_to_feedback', () => {
    const notifyFn = read('supabase/functions/send-notification/index.ts');
    const engagementBranch = notifyFn.slice(
      notifyFn.indexOf('if (kind === "engagement")'),
      notifyFn.indexOf('if (kind === "struggle")'),
    );
    expect(engagementBranch).toContain('instructorCanViewStudent');
    expect(engagementBranch).toContain('const studentId = row.student_id');
    expect(engagementBranch).not.toContain('feedbackReplyRecipient');
  });
});
