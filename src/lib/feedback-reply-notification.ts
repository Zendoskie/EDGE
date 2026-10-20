import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const FEEDBACK_REPLY_EMAIL_FAILED = 'Reply saved. The student email could not be sent.';

export async function emailFeedbackReply(input: {
  kind: 'engagement' | 'struggle';
  feedbackId: string;
}): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event: 'feedback_reply', kind: input.kind, feedback_id: input.feedbackId },
  });
  if (error) return { emailError: FEEDBACK_REPLY_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: FEEDBACK_REPLY_EMAIL_FAILED, alreadySent: false };
}
