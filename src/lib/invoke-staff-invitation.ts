import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Calls the `send-staff-invitation` Edge Function to email the invitation
 * link to the applicant.  The caller must be an admin (verified server-side).
 *
 * Throws a descriptive Error on any failure so the caller can surface the
 * exact reason in the UI (missing secrets, Brevo rejection, network error…).
 */
export async function sendStaffInvitation(invitationId: string): Promise<void> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      "Client is missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Check your .env file."
    );
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("You must be signed in to send invitation emails.");
  }

  const url = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/send-staff-invitation`;

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${session.access_token}`,
        apikey:         ANON_KEY,
      },
      body: JSON.stringify({ invitation_id: invitationId }),
    });
  } catch (networkErr) {
    throw new Error(
      `Network error reaching the email Edge Function. ` +
      `Is the function deployed? (${networkErr instanceof Error ? networkErr.message : networkErr})`
    );
  }

  if (res.status === 404) {
    throw new Error(
      "Edge Function 'send-staff-invitation' was not found. " +
      "Deploy it with: supabase functions deploy send-staff-invitation"
    );
  }

  const json = await res.json().catch(() => ({})) as { error?: unknown };

  if (!res.ok) {
    const raw = json.error;
    const msg =
      typeof raw === "string"   ? raw :
      typeof raw === "object"   ? JSON.stringify(raw) :
                                  `HTTP ${res.status}`;
    throw new Error(msg);
  }
}
