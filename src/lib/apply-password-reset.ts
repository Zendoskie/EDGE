import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export async function applyPasswordResetViaEdge(password: string): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
  if (!SUPABASE_URL || !ANON_KEY) {
    return { ok: false, message: 'Missing Supabase configuration.' };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, message: 'Your reset link session expired. Request a new reset email.' };
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/apply-password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ password }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown; email?: string };
  if (!res.ok) {
    const err = json.error;
    const msg = typeof err === 'string' ? err : `Could not update password (${res.status})`;
    return { ok: false, message: msg };
  }

  const email = typeof json.email === 'string' ? json.email : session.user.email ?? '';
  if (!email) {
    return { ok: false, message: 'Could not resolve account email.' };
  }
  return { ok: true, email };
}

/**
 * Save a new password during a recovery session and prove email/password sign-in works
 * (recovery JWT alone does not guarantee the stored password was updated).
 */
export async function commitPasswordReset(password: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.email) {
    throw new Error('Your reset link session expired. Request a new reset email.');
  }

  const email = session.user.email.trim().toLowerCase();

  const { error: updateErr } = await supabase.auth.updateUser({ password });
  if (updateErr) {
    const applied = await applyPasswordResetViaEdge(password);
    if (!applied.ok) {
      throw new Error(applied.message);
    }
  }

  await supabase.auth.signOut({ scope: 'global' });

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    await supabase.auth.signOut({ scope: 'global' });
    throw new Error(
      'Password was not accepted for sign-in. Enter the same password on this page (no spaces), then try again. On the login screen, clear autofill and type the password manually.',
    );
  }

  return email;
}
