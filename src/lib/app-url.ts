/**
 * Public site URL used in emails and invite links.
 *
 * Priority:
 * 1. VITE_APP_URL (set this in Vercel to your production domain)
 * 2. window.location.origin when it is not localhost
 * 3. origin fallback (local dev only)
 */
export function getPublicAppUrl(): string {
  const fromEnv = (import.meta.env.VITE_APP_URL as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin.replace(/\/+$/, "");
    if (!isLocalAppUrl(origin)) return origin;
    // Prefer env over localhost when admins test invites from a local session.
    return origin;
  }
  return "";
}

export function isLocalAppUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

/** True when production build is using a localhost app URL (misconfiguration). */
export function isProductionLocalhostMisconfig(): boolean {
  if (!import.meta.env.PROD) return false;
  const url = getPublicAppUrl();
  return Boolean(url) && isLocalAppUrl(url);
}
