import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * `student_approved` / `student_rejected` are sent by the student (step 1);
 * `admin_approved` / `admin_rejected` by an administrator (step 2).
 * `approved` / `rejected` are accepted as aliases of the student types.
 */
export type ParentEmailType =
  | "invitation"
  | "request_received"
  | "student_approved"
  | "student_rejected"
  | "admin_approved"
  | "admin_rejected"
  | "approved"
  | "rejected";

export type SendParentEmailInput = {
  type: ParentEmailType;
  /** Recipient email. Required for `invitation`; resolved server-side for link-based types. */
  to?: string;
  link_id?: string;
  registration_request_id?: string;
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
// Student notification when a parent registers (no user session required)
// ---------------------------------------------------------------------------

export type NotifyStudentOnParentRegistrationInput = {
  /** Legacy parent signup: locate pending parent_student_links by parent email. */
  parent_email?: string;
  /** Two-phase parent registration request (submit_parent_registration_request). */
  registration_request_id?: string;
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
  if (!input.parent_email?.trim() && !input.registration_request_id?.trim()) {
    throw new Error("parent_email or registration_request_id is required.");
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

  const json = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    sent?: number;
    failed?: number;
    skipped?: boolean;
    duplicate?: boolean;
  };
  // #region agent log
  fetch('http://127.0.0.1:7625/ingest/6a79715d-0b2e-4776-b3c6-a4d1d1f425c5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'b4b4c1' },
    body: JSON.stringify({
      sessionId: 'b4b4c1',
      runId: 'parent-email-fix',
      hypothesisId: 'F',
      location: 'invoke-parent-email.ts:notifyStudentOnParentRegistration',
      message: 'notify-student-on-parent-registration response',
      data: {
        ok: res.ok,
        status: res.status,
        hasRequestId: Boolean(input.registration_request_id?.trim()),
        hasParentEmail: Boolean(input.parent_email?.trim()),
        sent: json.sent,
        failed: json.failed,
        skipped: json.skipped,
        duplicate: json.duplicate,
        edgeError: typeof json.error === 'string' ? json.error : null,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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

export type ParentRegistrationWelcomeResult = {
  sent: boolean;
  failed: boolean;
  duplicate: boolean;
  error: string | null;
};

/**
 * Sends the access-active welcome email after registration completion.
 * Uses the one-time invitation token (no user session). Does not affect RPC success.
 */
export async function sendParentRegistrationWelcomeEmail(
  input: { completion_token: string },
): Promise<ParentRegistrationWelcomeResult> {
  if (!SUPABASE_URL || !ANON_KEY) {
    return { sent: false, failed: true, duplicate: false, error: "Missing Supabase client configuration." };
  }
  if (!input.completion_token?.trim()) {
    return { sent: false, failed: true, duplicate: false, error: "completion_token is required" };
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/functions/v1/send-parent-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      type: "registration_access_activated",
      completion_token: input.completion_token.trim(),
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: unknown;
    sent?: number;
    failed?: number;
    duplicate?: boolean;
  };

  if (!res.ok) {
    const err = json.error;
    const msg = typeof err === "string" ? err : `Welcome email request failed (${res.status})`;
    return { sent: false, failed: true, duplicate: false, error: msg };
  }
  if (json.duplicate) {
    return { sent: false, failed: false, duplicate: true, error: null };
  }
  if ((json.sent ?? 0) > 0) {
    return { sent: true, failed: false, duplicate: false, error: null };
  }
  if ((json.failed ?? 0) > 0) {
    return { sent: false, failed: true, duplicate: false, error: "Welcome email could not be delivered." };
  }
  return { sent: false, failed: false, duplicate: false, error: null };
}

export function sendParentRegistrationWelcomeBestEffort(input: { completion_token: string }): void {
  sendParentRegistrationWelcomeEmail(input).catch((e: Error) => {
    console.warn("send-parent-email registration_access_activated (best effort):", e?.message ?? e);
  });
}
