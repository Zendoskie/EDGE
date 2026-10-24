import { getPublicAppUrl } from '@/lib/app-url';
import { getPasswordResetRedirectUrl } from '@/lib/auth-password-reset';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type PasswordResetRequestResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Password reset via Brevo (same channel as other EDGE emails).
 * Supabase Auth's built-in recovery SMTP is not configured on this project.
 */
export async function requestPasswordResetEmail(email: string): Promise<PasswordResetRequestResult> {
  if (!SUPABASE_URL || !ANON_KEY) {
    return { ok: false, message: 'Missing Supabase configuration.' };
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/functions/v1/send-password-reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      email: email.trim(),
      redirect_to: getPasswordResetRedirectUrl(),
      app_url: getPublicAppUrl() || undefined,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown; sent?: number };
  // #region agent log
  fetch('http://127.0.0.1:7625/ingest/6a79715d-0b2e-4776-b3c6-a4d1d1f425c5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b4b4c1' },
    body: JSON.stringify({
      sessionId: 'b4b4c1',
      runId: 'password-reset-brevo',
      hypothesisId: 'H-smtp',
      location: 'request-password-reset.ts',
      message: 'send-password-reset response',
      data: {
        httpOk: res.ok,
        status: res.status,
        sent: json.sent,
        edgeError: typeof json.error === 'string' ? json.error : null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!res.ok) {
    const err = json.error;
    const msg = typeof err === 'string' ? err : `Reset email failed (${res.status})`;
    return { ok: false, message: msg };
  }
  return { ok: true };
}
