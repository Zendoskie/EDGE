import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const ENROLLMENT_DECISION_EMAIL_FAILED =
  'Enrollment updated. The student email could not be sent.';

export async function emailEnrollmentDecision(
  enrollmentId: string,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event: 'enrollment_decision', enrollment_id: enrollmentId },
  });
  if (error) return { emailError: ENROLLMENT_DECISION_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: ENROLLMENT_DECISION_EMAIL_FAILED, alreadySent: false };
}
