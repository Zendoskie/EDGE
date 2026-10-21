import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type LinkedParentRecipient = {
  parentUserId: string;
  email: string;
  fullName: string | null;
};

/** Approved parent/guardian accounts linked to the student (trusted DB relationships only). */
export async function listApprovedLinkedParents(
  supabase: ReturnType<typeof createClient>,
  studentUserId: string,
): Promise<LinkedParentRecipient[]> {
  const { data: links, error: linkError } = await supabase
    .from("parent_student_links")
    .select("parent_user_id")
    .eq("student_user_id", studentUserId)
    .eq("status", "approved");
  if (linkError) throw linkError;

  const parentIds = [...new Set((links ?? []).map((row) => row.parent_user_id).filter(Boolean))];
  if (parentIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", parentIds);
  if (profileError) throw profileError;

  const out: LinkedParentRecipient[] = [];
  for (const profile of profiles ?? []) {
    const email = typeof profile.email === "string" ? profile.email.trim() : "";
    if (!email || !email.includes("@")) continue;
    out.push({
      parentUserId: profile.user_id,
      email,
      fullName: profile.full_name ?? null,
    });
  }
  return out;
}

/** Batch lookup: approved linked parents grouped by student user id. */
export async function mapApprovedLinkedParentsByStudent(
  supabase: ReturnType<typeof createClient>,
  studentUserIds: readonly string[],
): Promise<Map<string, LinkedParentRecipient[]>> {
  const uniqueStudents = [...new Set(studentUserIds.filter(Boolean))];
  const result = new Map<string, LinkedParentRecipient[]>();
  if (uniqueStudents.length === 0) return result;

  const { data: links, error: linkError } = await supabase
    .from("parent_student_links")
    .select("parent_user_id, student_user_id")
    .in("student_user_id", uniqueStudents)
    .eq("status", "approved");
  if (linkError) throw linkError;

  const parentIds = [...new Set((links ?? []).map((row) => row.parent_user_id).filter(Boolean))];
  if (parentIds.length === 0) return result;

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, email, full_name")
    .in("user_id", parentIds);
  if (profileError) throw profileError;

  const profileById = new Map(
    (profiles ?? []).map((profile) => [profile.user_id, profile]),
  );

  for (const link of links ?? []) {
    const studentId = link.student_user_id;
    const profile = profileById.get(link.parent_user_id);
    if (!studentId || !profile) continue;
    const email = typeof profile.email === "string" ? profile.email.trim() : "";
    if (!email || !email.includes("@")) continue;
    const row: LinkedParentRecipient = {
      parentUserId: profile.user_id,
      email,
      fullName: profile.full_name ?? null,
    };
    const bucket = result.get(studentId) ?? [];
    if (!bucket.some((p) => p.parentUserId === row.parentUserId)) {
      bucket.push(row);
      result.set(studentId, bucket);
    }
  }
  return result;
}
