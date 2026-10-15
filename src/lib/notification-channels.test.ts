import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canReadInboxRow, durableRowToInboxInput } from '@/lib/notification-delivery';
import {
  authorizeFeedbackEmail,
  counselingOutcomeEmail,
  counselingOutcomeRecipient,
  deliverEmail,
  emailLogKey,
  enrollmentInstructors,
  instructorFeedbackEmail,
  isRiskEmailLevel,
  responsibleFeedbackInstructor,
} from '../../supabase/functions/_shared/notification-channels';

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
    const other = await recordCounselingOutcome({
      interventionId: 'intervention-2',
      outcomeRating: 'no_change',
      actionType: 'send_reminder',
      actorRole: 'instructor',
    });
    expect(other).toEqual({ id: 'intervention-2', emailError: null, alreadySent: false });
    expect(invoke).not.toHaveBeenCalled();
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

    const email = counselingOutcomeEmail('CS101 <script>');
    expect(email.subject).toContain('CS101 <script>');
    expect(email.html).toContain('CS101 &lt;script&gt;');
    expect(email.html).toContain('does not include counseling notes');
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
    const retried = await retryCounselingOutcomeEmail('intervention-1');
    expect(retried).toEqual({ emailError: null, alreadySent: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('send-referral-notification', {
      body: { event: 'counseling_outcome', intervention_id: 'intervention-1' },
    });

    invoke.mockResolvedValueOnce({ data: { sent: 0, failed: 0, duplicate: true }, error: null });
    const again = await retryCounselingOutcomeEmail('intervention-1');
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
      canRetryOutcomeEmail({ ...completed, action_type: 'send_reminder', actor_role: 'instructor' }, instructor),
    ).toBe(false);
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
      expect(src).not.toContain('SERVICE_ROLE');
      expect(src).not.toContain('api-key');
    }
    expect(outcome).toContain("invoke('send-referral-notification'");
    expect(feedback).toContain("invoke('send-notification'");
    expect(referralFn).toContain('Deno.env.get("BREVO_API_KEY")');
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
    expect(notifyFn).toContain('Deno.env.get("BREVO_API_KEY")');
    expect(read('supabase/functions/_shared/risk-email.ts')).toContain('EDGE_RISK_EMAILS_ENABLED');
  });
});
