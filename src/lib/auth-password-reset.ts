import { getPublicAppUrl, isLocalAppUrl } from '@/lib/app-url';

/** Where Supabase should send users after they click the reset link in email. */
export function getPasswordResetRedirectUrl(): string {
  let base = getPublicAppUrl();
  if (typeof window !== 'undefined') {
    const origin = window.location.origin.replace(/\/+$/, '');
    if (!base || (isLocalAppUrl(origin) && !isLocalAppUrl(base))) {
      base = origin;
    }
  }
  if (!base) base = 'http://localhost:5173';
  return `${base}/reset-password`;
}
