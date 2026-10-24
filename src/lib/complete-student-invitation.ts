import { supabase } from '@/integrations/supabase/client';

/** Auth trigger may lag behind signUp; complete_student_invitation needs a profiles row. */
export async function waitForProfileRow(userId: string, maxMs = 6000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (data?.user_id) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function completeStudentInvitationRpc(
  token: string,
  userId: string,
): Promise<{ error: { message: string } | null }> {
  const hasProfile = await waitForProfileRow(userId);
  if (!hasProfile) {
    return { error: { message: 'user_profile_not_found' } };
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await (supabase as any).rpc('complete_student_invitation', {
      p_token: token,
      p_user_id: userId,
    });
    if (!error) return { error: null };
    const cm = (error.message || '').toLowerCase();
    if (cm.includes('user_profile_not_found') && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    return { error };
  }
  return { error: { message: 'complete_student_invitation failed' } };
}
