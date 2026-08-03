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

// ---------------------------------------------------------------------------
// Registration-time parent invitation (no user session required)
// ---------------------------------------------------------------------------

export type NotifyParentOnRegistrationInput = {
  /** The student's own email address (used to look up and verify the profile). */
  student_email: string;
  /** The parent Gmail entered during student registration. */
  parent_email: string;
  student_name?: string;
  student_id_no?: string;
};

/**
 * Sends the registration invitation email to the parent via the
 * `notify-parent-on-registration` Edge Function.
 *
 * Unlike `sendParentLinkEmail`, this does NOT require an active user session.
 * The Edge Function verifies the parent email against the database before sending.
 */
export async function notifyParentOnRegistration(
  input: NotifyParentOnRegistrationInput,
): Promise<void> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/functions/v1/notify-parent-on-registration`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify(input),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    const err = json.error;
    const msg =
      typeof err === "string"
        ? err
        : JSON.stringify(json || {});
    throw new Error(msg || `Registration invitation failed (${res.status})`);
  }
}

/** Fire-and-forget wrapper for the registration invitation. */
export function notifyParentOnRegistrationBestEffort(
  input: NotifyParentOnRegistrationInput,
): void {
  notifyParentOnRegistration(input).catch((e: Error) => {
    console.warn("notify-parent-on-registration (best effort):", e?.message ?? e);
  });
}

// ---------------------------------------------------------------------------
// Student notification when a parent registers (no user session required)
// ---------------------------------------------------------------------------

export type NotifyStudentOnParentRegistrationInput = {
  /** The parent's Gmail used to register, so the function can locate their pending link. */
  parent_email: string;
};

/**
 * Notifies the student by email when a parent registers against their account.
 * Calls `notify-student-on-parent-registration` which uses the service role and
 * does NOT require a user session.
 */
export async function notifyStudentOnParentRegistration(
  input: NotifyStudentOnParentRegistrationInput,
): Promise<void> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/functions/v1/notify-student-on-parent-registration`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify(input),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (!res.ok) {
    const err = json.error;
    const msg = typeof err === "string" ? err : JSON.stringify(json || {});
    throw new Error(msg || `Student notification failed (${res.status})`);
  }
}

/** Fire-and-forget wrapper for the student notification on parent registration. */
export function notifyStudentOnParentRegistrationBestEffort(
  input: NotifyStudentOnParentRegistrationInput,
): void {
  notifyStudentOnParentRegistration(input).catch((e: Error) => {
    console.warn("notify-student-on-parent-registration (best effort):", e?.message ?? e);
  });
}
