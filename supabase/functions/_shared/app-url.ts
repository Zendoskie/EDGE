/** Shared resolver for public frontend URLs used in outbound emails. */

export function isLocalHostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return /localhost|127\.0\.0\.1/.test(url);
  }
}

function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Resolve the public app base URL for invitation / notification links.
 *
 * Prefer a non-localhost URL from:
 * 1) request body `app_url` (sent by the deployed Vercel client)
 * 2) APP_URL secret
 * 3) FRONTEND_URL secret
 * Fall back to localhost only for local development.
 */
export function resolveAppUrl(bodyAppUrl?: unknown): string {
  const candidates = [
    normalizeUrl(typeof bodyAppUrl === "string" ? bodyAppUrl : null),
    normalizeUrl(Deno.env.get("APP_URL")),
    normalizeUrl(Deno.env.get("FRONTEND_URL")),
  ].filter((u): u is string => !!u);

  const publicCandidate = candidates.find((u) => !isLocalHostUrl(u));
  if (publicCandidate) return publicCandidate;

  if (candidates[0]) return candidates[0];

  throw new Error(
    "Public APP_URL is not configured. Set the Supabase secret APP_URL " +
      "to your Vercel URL (e.g. https://your-app.vercel.app), " +
      "or open the admin UI from the deployed site so the client can send app_url.",
  );
}
