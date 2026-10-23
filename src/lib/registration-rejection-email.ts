import { supabase } from '@/integrations/supabase/client';
import { interpretNotificationInvokeResult } from '@/lib/notification-invoke-result';

export const REGISTRATION_REJECTION_EMAIL_FAILED =
  'Request rejected. The rejection email could not be sent.';

export type RegistrationRejectionKind = 'student' | 'staff';

export async function emailRegistrationRequestRejected(
  requestId: string,
  kind: RegistrationRejectionKind,
): Promise<{ emailError: string | null; alreadySent: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { event: 'registration_rejected', request_id: requestId, kind },
  });
  if (error) return { emailError: REGISTRATION_REJECTION_EMAIL_FAILED, alreadySent: false };
  const outcome = interpretNotificationInvokeResult(data);
  if (outcome === 'duplicate') return { emailError: null, alreadySent: true };
  if (outcome === 'sent') return { emailError: null, alreadySent: false };
  return { emailError: REGISTRATION_REJECTION_EMAIL_FAILED, alreadySent: false };
}
