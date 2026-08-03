import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Calls the `send-staff-invitation` Edge Function to email the invitation
 * link to the applicant.  The caller must be an admin (verified server-side).
 */
export async function sendStaffInvitation(invitationId: string): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7856/ingest/329beaee-e1be-431d-b955-54c3ff2257dc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5efc3d'},body:JSON.stringify({sessionId:'5efc3d',location:'invoke-staff-invitation.ts:entry',message:'sendStaffInvitation called',data:{invitationId,hasUrl:!!SUPABASE_URL,hasKey:!!ANON_KEY},hypothesisId:'H-A,H-C',timestamp:Date.now()})}).catch(()=>{});
  console.log('[DBG-INVITE entry]', { invitationId, hasUrl: !!SUPABASE_URL, hasKey: !!ANON_KEY });
  // #endregion

  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.");
  }

  const { data: { session } } = await supabase.auth.getSession();
  // #region agent log
  fetch('http://127.0.0.1:7856/ingest/329beaee-e1be-431d-b955-54c3ff2257dc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5efc3d'},body:JSON.stringify({sessionId:'5efc3d',location:'invoke-staff-invitation.ts:session',message:'session check',data:{hasSession:!!session,hasToken:!!session?.access_token},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
  console.log('[DBG-INVITE session]', { hasSession: !!session, hasToken: !!session?.access_token });
  // #endregion
  if (!session?.access_token) {
    throw new Error("Sign in required to send invitation emails.");
  }

  const base = SUPABASE_URL.replace(/\/$/, "");
  const url  = `${base}/functions/v1/send-staff-invitation`;
  const res  = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ invitation_id: invitationId }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  // #region agent log
  fetch('http://127.0.0.1:7856/ingest/329beaee-e1be-431d-b955-54c3ff2257dc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5efc3d'},body:JSON.stringify({sessionId:'5efc3d',location:'invoke-staff-invitation.ts:response',message:'edge function response',data:{status:res.status,ok:res.ok,url,body:json},hypothesisId:'H-B,H-C',timestamp:Date.now()})}).catch(()=>{});
  console.log('[DBG-INVITE response]', { status: res.status, ok: res.ok, url, body: json });
  // #endregion
  if (!res.ok) {
    const err = json.error;
    const msg = typeof err === "string" ? err : JSON.stringify(json || {});
    throw new Error(msg || `Staff invitation email failed (${res.status})`);
  }
}

/** Fire-and-forget — email failures never block the admin action. */
export function sendStaffInvitationBestEffort(invitationId: string): void {
  sendStaffInvitation(invitationId).catch((e: Error) => {
    console.warn("send-staff-invitation (best effort):", e?.message ?? e);
  });
}
