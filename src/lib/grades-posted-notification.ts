import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const GRADES_EMAIL_FAILED = 'Grade email could not be sent.';
export const GRADES_EMAIL_ALREADY_SENT = 'Grade emails were already sent for those scores.';

/** Email only. Does not upsert submissions or write inbox rows. */
export async function emailGradesPosted(
  subjectId: string,
  items: Array<{ activity_id: string; student_id: string }>,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  if (items.length === 0) return { emailError: null, alreadySent: false };

  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: {
      event: 'grades_posted',
      subject_id: subjectId,
      items,
    },
  });
  if (error) return { emailError: GRADES_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: GRADES_EMAIL_FAILED, alreadySent: false };
}
