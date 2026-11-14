import { callCompleteInvitationRpc } from '@/lib/complete-invitation';

export async function completeStudentInvitationRpc(
  token: string,
  userId: string,
): Promise<{ error: { message: string } | null }> {
  return callCompleteInvitationRpc(
    'complete_student_invitation',
    { p_token: token, p_user_id: userId },
  );
}
