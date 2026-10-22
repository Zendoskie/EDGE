import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverEmail,
  emailLogKey,
  feedbackReplyEmail,
} from '../../supabase/functions/_shared/notification-channels';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke } },
}));

import {
  emailFeedbackReply,
  FEEDBACK_REPLY_EMAIL_FAILED,
} from '@/lib/feedback-reply-notification';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('engagement feedback reply notification contract', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  describe('client invoke payload and outcomes', () => {
    it('calls send-notification with feedback_reply engagement and feedback id', async () => {
      invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });
      await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-eng-1' });
      expect(invoke).toHaveBeenCalledWith('send-notification', {
        body: { event: 'feedback_reply', kind: 'engagement', feedback_id: 'fb-eng-1' },
      });
    });

    it('reports failure on invoke network error', async () => {
      invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
      const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });
      expect(result).toEqual({ emailError: FEEDBACK_REPLY_EMAIL_FAILED, alreadySent: false });
    });

    it('treats provider failure (failed:1) as email failure', async () => {
      invoke.mockResolvedValue({ data: { sent: 0, failed: 1 }, error: null });
      const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });
      expect(result.emailError).toBe(FEEDBACK_REPLY_EMAIL_FAILED);
    });

    it('treats skipped sends as failure for the instructor UI', async () => {
      invoke.mockResolvedValue({ data: { sent: 0, skipped: 'no_email' }, error: null });
      const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });
      expect(result.emailError).toBe(FEEDBACK_REPLY_EMAIL_FAILED);
    });

    it('does not treat empty success bodies as delivered', async () => {
      invoke.mockResolvedValue({ data: { success: true, sent: 0, failed: 0 }, error: null });
      expect(interpretNotificationInvokeResult({ success: true, sent: 0, failed: 0 })).toBe('failed');
      const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });
      expect(result.emailError).toBe(FEEDBACK_REPLY_EMAIL_FAILED);
    });

    it('treats duplicate as already sent without error', async () => {
      invoke.mockResolvedValue({ data: { sent: 0, duplicate: true }, error: null });
      const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });
      expect(result).toEqual({ emailError: null, alreadySent: true });
    });
  });

  describe('edge handler and deduplication contract', () => {
    it('loads engagement replies from student_engagement_feedback', () => {
      const notifyFn = read('supabase/functions/send-notification/index.ts');
      const branch = notifyFn.slice(
        notifyFn.indexOf('if (kind === "engagement")'),
        notifyFn.indexOf('if (kind === "struggle")'),
      );
      expect(branch).toContain('.from("student_engagement_feedback")');
      expect(branch).toContain('instructor_response');
      expect(branch).toContain('instructorCanViewStudent');
      expect(branch).not.toContain('.from("engagement_feedback")');
    });

    it('uses stable dedupe keys for engagement feedback replies', () => {
      expect(emailLogKey('feedback_reply', 'engagement:fb-99')).toBe('feedback_reply:engagement:fb-99');
    });

    it('sends only after provider acceptance via deliverEmail', async () => {
      const log = vi.fn();
      const send = vi.fn(async () => undefined);
      await expect(
        deliverEmail({ alreadyLogged: false, send, log }),
      ).resolves.toBe('sent');
      expect(send).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('skips provider send when dedupe log already exists', async () => {
      const send = vi.fn(async () => undefined);
      await expect(
        deliverEmail({ alreadyLogged: true, send, log: async () => undefined }),
      ).resolves.toBe('duplicate');
      expect(send).not.toHaveBeenCalled();
    });

    it('does not write dedupe log when provider send fails', async () => {
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
    });

    it('builds student-facing reply email without leaking full thread', () => {
      const email = feedbackReplyEmail({
        subjectLabel: 'CS101',
        replyPreview: 'Let us meet after class.',
      });
      expect(email.subject).toContain('Instructor replied');
      expect(email.html).toContain('Let us meet after class.');
    });
  });

  describe('instructor UI wiring', () => {
    it('persists via instructor_reply_to_feedback before emailFeedbackReply', () => {
      const page = read('src/pages/dashboard/InstructorFeedback.tsx');
      const save = page.slice(page.indexOf('async function saveReply'), page.indexOf('const { data, isLoading'));
      expect(save).toContain("rpc('instructor_reply_to_feedback'");
      expect(save.indexOf('instructor_reply_to_feedback')).toBeLessThan(save.indexOf('emailFeedbackReply'));
      expect(save).toContain('finally');
      expect(save).toContain('setSavingReply(false)');
    });
  });
});
