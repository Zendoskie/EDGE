import { supabase } from '@/integrations/supabase/client';

export const ENROLLMENT_REQUEST_EMAIL_FAILED = 'Enrollment request saved. The instructor email could not be sent.';

export async function emailEnrollmentRequest(
  enrollmentId: string,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event: 'enrollment_request', enrollment_id: enrollmentId },
  });
  if (error) return { emailError: ENROLLMENT_REQUEST_EMAIL_FAILED, alreadySent: false };
  if (data?.duplicate) return { emailError: null, alreadySent: true };
  const failed = typeof data?.failed === 'number' ? data.failed : 0;
  if (failed > 0 || data?.skipped) return { emailError: ENROLLMENT_REQUEST_EMAIL_FAILED, alreadySent: false };
  return { emailError: null, alreadySent: false };
}
