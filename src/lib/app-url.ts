/**
 * Public site URL used in emails and invite links.
 *
 * Priority:
 * 1. VITE_APP_URL (set this in Vercel to your production domain)
 * 2. window.location.origin (correct when the admin opens the deployed site)
 */
export function getPublicAppUrl(): string {
  const fromEnv = (import.meta.env.VITE_APP_URL as string | undefined)?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
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
