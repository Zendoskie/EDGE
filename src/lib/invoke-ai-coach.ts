import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Calls the `ai-coach` Edge Function with a fresh JWT.
 * The coach generates recommendations from system-computed risk analysis metrics only.
 */
export async function invokeAiCoach(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const { data: { session: initial } } = await supabase.auth.getSession();
  if (!initial?.access_token) {
    throw new Error("Sign in required to use AI features.");
  }

  // Refresh only when the access token is expired or about to expire.
  // Refreshing on every message rotates the refresh token and races with
  // auto-refresh, which makes the next follow-up fail with a dead session.
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresSoon = !initial.expires_at || initial.expires_at <= nowSec + 60;
  let session = initial;
  if (expiresSoon) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    session = refreshed.session ?? session;
    if (!session?.access_token) {
      throw new Error(
        refreshError?.message || "Session expired. Please sign out and sign in again.",
      );
    }
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const bodyText = JSON.stringify(body);
  const postCoach = () =>
    fetch(`${base}/functions/v1/ai-coach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: ANON_KEY,
      },
      body: bodyText,
      signal: AbortSignal.timeout(14_000),
    });

  let res: Response;
  try {
    res = await postCoach();
  } catch {
    // A dropped connection on a follow-up leaves the chat stuck. Try once more.
    res = await postCoach();
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const err = json.error ?? json.message;
    const hint = typeof json.hint === "string" ? json.hint : "";
    const msg =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err && typeof (err as { message: string }).message === "string"
          ? (err as { message: string }).message
          : JSON.stringify(json || {});
    const combined = [msg, hint].filter(Boolean).join(" ");
    throw new Error(combined || `AI request failed (${res.status})`);
  }

  return json;
}
