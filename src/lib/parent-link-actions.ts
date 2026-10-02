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

/** Step 2: an administrator approves (-> approved, parent account activated) or rejects. */
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
