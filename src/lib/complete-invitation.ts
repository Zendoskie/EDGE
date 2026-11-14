import { supabase } from '@/integrations/supabase/client';

/**
 * Auth trigger (`handle_new_user`) may lag behind signUp; the completion RPCs
 * need a profiles row to exist before they run. Poll briefly for it.
 */
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

/**
 * Calls a completion RPC with a pre-flight wait for the profiles row and
 * in-flight retries for the transient `user_profile_not_found` race. This
 * prevents users from having to click "Complete registration" repeatedly when
 * the auth trigger has not committed the profile yet.
 */
export async function callCompleteInvitationRpc(
  rpcName: string,
  params: Record<string, unknown>,
  userId: string,
): Promise<{ error: { message: string } | null }> {
  const hasProfile = await waitForProfileRow(userId);
  if (!hasProfile) {
    return { error: { message: 'user_profile_not_found' } };
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await (supabase as any).rpc(rpcName, params);
    if (!error) return { error: null };
    const cm = (error.message || '').toLowerCase();
    if (cm.includes('user_profile_not_found') && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      continue;
    }
    return { error };
  }
  return { error: { message: `${rpcName} failed` } };
}

/**
 * Supabase RPC/auth errors are plain objects (`{ message, details, hint, code }`),
 * not `Error` instances, so `err instanceof Error` misses them and callers fall
 * back to a generic message. Extract the real message when present.
 */
export function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return err.message?.trim() ? err.message : fallback;
  }
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
