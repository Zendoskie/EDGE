import { supabase } from '@/integrations/supabase/client';
import { emailRegistrationRequestRejected } from '@/lib/registration-rejection-email';

export type RejectStudentRegistrationResult =
  | { ok: true; emailError: string | null; alreadySent: boolean }
  | { ok: false; rpcError: string };

/**
 * Rejects a pending student registration request (pre-auth applicant) and sends the rejection email.
 * Recipient is resolved server-side from the request row — never from client input.
 */
export async function rejectStudentRegistrationRequest(input: {
  requestId: string;
  rejectionReason: string | null;
}): Promise<RejectStudentRegistrationResult> {
  const reason = input.rejectionReason?.trim() || null;
  const { error } = await supabase.rpc('admin_review_student_request', {
    p_request_id: input.requestId,
    p_status: 'rejected',
    p_rejection_reason: reason,
  });
  if (error) {
    return { ok: false, rpcError: error.message };
  }

  const email = await emailRegistrationRequestRejected(input.requestId, 'student');
  return { ok: true, emailError: email.emailError, alreadySent: email.alreadySent };
}
