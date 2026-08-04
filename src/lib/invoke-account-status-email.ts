import { supabase } from "@/integrations/supabase/client";
import { getPublicAppUrl } from "@/lib/app-url";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type AccountStatusEmailInput = {
  /** The user whose account status changed. */
  user_id: string;
  /** The new status that was set. */
  status: "approved" | "rejected";
};

/**
 * Calls the `send-account-status-email` Edge Function to notify an instructor
 * or guidance counselor that their registration was approved or rejected.
 * The caller must be an admin (verified server-side by the Edge Function).
 */
export async function sendAccountStatusEmail(
  input: AccountStatusEmailInput,
): Promise<void> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in required to send notifications.");
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/functions/v1/send-account-status-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ ...input, app_url: getPublicAppUrl() }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    const err = json.error;
    const msg =
      typeof err === "string"
        ? err
        : JSON.stringify(json || {});
    throw new Error(msg || `Account status email failed (${res.status})`);
  }
}

/** Fire-and-forget wrapper — email failures never block the admin action. */
export function sendAccountStatusEmailBestEffort(
  input: AccountStatusEmailInput,
): void {
  sendAccountStatusEmail(input).catch((e: Error) => {
    console.warn("send-account-status-email (best effort):", e?.message ?? e);
  });
}
