import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export type ParentEmailType = "invitation" | "request_received" | "approved" | "rejected";

export type SendParentEmailInput = {
  type: ParentEmailType;
  /** Recipient email. Required for `invitation`; resolved server-side for link-based types. */
  to?: string;
  link_id?: string;
  student_id_no?: string;
  parent_name?: string;
  student_name?: string;
};

/**
 * Sends a parent-link email through the `send-parent-email` Edge Function.
 * Best-effort: callers should not fail the surrounding action when emailing fails.
 */
export async function sendParentLinkEmail(input: SendParentEmailInput): Promise<void> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
  if (input.type === "invitation" && !input.to?.trim()) {
    throw new Error("Recipient email is required for invitation emails.");
  }

  const { data: { session: initial } } = await supabase.auth.getSession();
  if (!initial?.access_token) {
    throw new Error("Sign in required to send notifications.");
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  const nowSec = Math.floor(Date.now() / 1000);
  const initialExpired = !initial.expires_at || initial.expires_at <= nowSec;
  const session = refreshed.session ?? (refreshError || initialExpired ? null : initial);
  if (!session?.access_token) {
    throw new Error(
      refreshError?.message || "Session expired. Please sign out and sign in again.",
    );
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/functions/v1/send-parent-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(input),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown };

  if (!res.ok) {
    const err = json.error ?? json.message;
    const msg =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err && typeof (err as { message: string }).message === "string"
          ? (err as { message: string }).message
          : JSON.stringify(json || {});
    throw new Error(msg || `Email request failed (${res.status})`);
  }
}

/** Fire-and-forget wrapper so email failures never break the main flow. */
export function sendParentLinkEmailBestEffort(input: SendParentEmailInput): void {
  sendParentLinkEmail(input).catch((e: Error) => {
    console.warn("send-parent-email (best effort):", e?.message ?? e);
  });
}
