import { supabase } from "@/integrations/supabase/client";
import { sendParentLinkEmailBestEffort } from "@/lib/invoke-parent-email";
import { parentLinkErrorMessage } from "@/lib/parent-link-status";

export type ParentLinkDecision = "approve" | "reject";

/** Step 1: the linked student approves (-> pending_admin) or rejects (-> rejected). */
export async function studentDecideParentRequest(linkId: string, decision: ParentLinkDecision): Promise<string> {
  const { data, error } = await supabase.rpc("student_decide_parent_request", {
    p_link_id: linkId,
    p_decision: decision,
  });
  if (error) throw new Error(parentLinkErrorMessage(error.message));
  sendParentLinkEmailBestEffort({
    type: decision === "approve" ? "student_approved" : "student_rejected",
    link_id: linkId,
  });
  return String(data ?? "");
}

/** Student decision on a Phase 1 parent registration request (no account exists yet). */
export async function studentDecideParentRegistration(requestId: string, decision: ParentLinkDecision): Promise<string> {
  const { data, error } = await (supabase as any).rpc("student_decide_parent_registration", {
    p_request_id: requestId,
    p_decision: decision,
  });
  if (error) throw new Error(parentLinkErrorMessage(error.message));
  return String(data ?? "");
}

/** Admin decision on a request the student already approved. Approve returns an invitation id. */
export async function adminReviewParentRequest(requestId: string, decision: ParentLinkDecision): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("admin_review_parent_request", {
    p_request_id: requestId,
    p_decision: decision,
  });
  if (error) throw new Error(parentLinkErrorMessage(error.message));
  return data ? String(data) : null;
}

/** Step 2 for an existing parent account that already has a password. */
export async function adminDecideParentRequest(linkId: string, decision: ParentLinkDecision): Promise<string> {
  const { data, error } = await supabase.rpc("admin_decide_parent_request", {
    p_link_id: linkId,
    p_decision: decision,
  });
  if (error) throw new Error(parentLinkErrorMessage(error.message));
  sendParentLinkEmailBestEffort({
    type: decision === "approve" ? "admin_approved" : "admin_rejected",
    link_id: linkId,
  });
  return String(data ?? "");
}
