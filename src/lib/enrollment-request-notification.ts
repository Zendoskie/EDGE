import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const ENROLLMENT_REQUEST_EMAIL_FAILED = 'Enrollment request saved. The instructor email could not be sent.';

export async function emailEnrollmentRequest(
  enrollmentId: string,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event: 'enrollment_request', enrollment_id: enrollmentId },
  });
  if (error) return { emailError: ENROLLMENT_REQUEST_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: ENROLLMENT_REQUEST_EMAIL_FAILED, alreadySent: false };
}
