import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('emailFeedbackReply', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invokes send-notification with engagement feedback_reply payload', async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0 }, error: null });

    const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });

    expect(invoke).toHaveBeenCalledWith('send-notification', {
      body: { event: 'feedback_reply', kind: 'engagement', feedback_id: 'fb-1' },
    });
    expect(result).toEqual({ emailError: null, alreadySent: false });
  });

  it('reports failure when the function returns no sent message', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 0 }, error: null });

    const result = await emailFeedbackReply({ kind: 'engagement', feedbackId: 'fb-1' });

    expect(result).toEqual({ emailError: FEEDBACK_REPLY_EMAIL_FAILED, alreadySent: false });
  });

  it('treats duplicate responses as already sent', async () => {
    invoke.mockResolvedValue({ data: { sent: 0, duplicate: true }, error: null });

    const result = await emailFeedbackReply({ kind: 'struggle', feedbackId: 'fb-2' });

    expect(result).toEqual({ emailError: null, alreadySent: true });
  });
});
