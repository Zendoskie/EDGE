import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * The auth trigger (`handle_new_user`) normally commits the profile in the same
 * transaction as signUp, but under load the completion RPC can still observe it
 * late. These delays retry only that transient case.
 */
export const PROFILE_RETRY_DELAYS_MS = [250, 500, 750, 1000, 1250, 1500];

type RpcError = { message?: string; code?: string; details?: string; hint?: string } | null;

/**
 * Calls a completion RPC directly.
 *
 * Do NOT pre-read `profiles` from the browser: the parent/staff pages sign out
 * before completing, and RLS only lets a signed-in user read their own profile.
 * An anon read therefore returns zero rows even though the profile exists. The
 * RPCs are SECURITY DEFINER and can read the profile themselves; retry only the
 * transient `user_profile_not_found` error the server may still raise.
 */
export async function callCompleteInvitationRpc(
  rpcName: string,
  params: Record<string, unknown>,
): Promise<{ error: { message: string } | null }> {
  for (let attempt = 0; ; attempt++) {
    const { error } = (await (supabase as any).rpc(rpcName, params)) as { error: RpcError };
    if (!error) return { error: null };

    const message = (error.message || '').toLowerCase();
    if (message.includes('user_profile_not_found') && attempt < PROFILE_RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, PROFILE_RETRY_DELAYS_MS[attempt]));
      continue;
    }
    return { error: { message: error.message || `${rpcName} failed` } };
  }
}

/** True when signUp rejected an email that already has an auth account. */
export function isAlreadyRegisteredError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return (
    error.code === 'user_already_exists'
    || error.code === 'email_exists'
    || message.includes('user already registered')
    || message.includes('already registered')
  );
}

/**
 * With email confirmation enabled, Supabase obfuscates signups for existing
 * emails: it returns a user with an empty `identities` array and no error.
 */
export function isObfuscatedExistingUser(user: User | null | undefined): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0);
}

/**
 * After a partially failed attempt the auth account already exists. Sign in
 * with the password the applicant just typed so the completion RPC can finish.
 * Returns null when the password does not match (e.g. they changed it).
 */
export async function signInExistingAccount(
  email: string,
  password: string,
): Promise<{ id: string; hasSession: boolean } | null> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  return { id: data.user.id, hasSession: Boolean(data.session) };
}

export const EXISTING_ACCOUNT_HELP =
  'An account with this email already exists. Use Forgot password on the sign-in page, then reopen this invitation link.';

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
