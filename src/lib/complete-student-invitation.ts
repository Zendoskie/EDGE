import { callCompleteInvitationRpc, waitForProfileRow } from '@/lib/complete-invitation';

/** Auth trigger may lag behind signUp; complete_student_invitation needs a profiles row. */
export { waitForProfileRow };

export async function completeStudentInvitationRpc(
  token: string,
  userId: string,
): Promise<{ error: { message: string } | null }> {
  return callCompleteInvitationRpc(
    'complete_student_invitation',
    { p_token: token, p_user_id: userId },
    userId,
  );
}
