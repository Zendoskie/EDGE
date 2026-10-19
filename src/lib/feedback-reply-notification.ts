import { supabase } from '@/integrations/supabase/client';

export const FEEDBACK_REPLY_EMAIL_FAILED = 'Reply saved. The student email could not be sent.';

export async function emailFeedbackReply(input: {
  kind: 'engagement' | 'struggle';
  feedbackId: string;
}): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event: 'feedback_reply', kind: input.kind, feedback_id: input.feedbackId },
  });
  if (error) return { emailError: FEEDBACK_REPLY_EMAIL_FAILED, alreadySent: false };
  if (data?.duplicate) return { emailError: null, alreadySent: true };
  const failed = typeof data?.failed === 'number' ? data.failed : 0;
  if (failed > 0 || data?.skipped) return { emailError: FEEDBACK_REPLY_EMAIL_FAILED, alreadySent: false };
  return { emailError: null, alreadySent: false };
}
