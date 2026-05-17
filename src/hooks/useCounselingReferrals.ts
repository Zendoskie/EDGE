import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ReferralStatus } from "@/lib/referral-utils";

export type CounselingReferralRow = {
  id: string;
  student_id: string;
  subject_id: string;
  instructor_id: string;
  status: ReferralStatus | string;
  created_at: string | null;
  reviewed_at: string | null;
  recommendation_message: string | null;
  student?: {
    user_id: string;
    full_name: string | null;
    email: string | null;
    student_id: string | null;
  } | null;
  instructor?: {
    user_id: string;
    full_name: string | null;
    email: string | null;
  } | null;
  subject?: {
    id: string;
    code: string | null;
    name: string | null;
  } | null;
};

async function enrichReferrals(rows: Array<Record<string, unknown>>): Promise<CounselingReferralRow[]> {
  const studentIds = Array.from(new Set(rows.map((r) => r.student_id).filter(Boolean))) as string[];
  const instructorIds = Array.from(new Set(rows.map((r) => r.instructor_id).filter(Boolean))) as string[];
  const subjectIds = Array.from(new Set(rows.map((r) => r.subject_id).filter(Boolean))) as string[];

  const [studentsRes, instructorsRes, subjectsRes] = await Promise.all([
    studentIds.length > 0
      ? supabase.from("profiles").select("user_id, full_name, email, student_id").in("user_id", studentIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    instructorIds.length > 0
      ? supabase.from("profiles").select("user_id, full_name, email").in("user_id", instructorIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    subjectIds.length > 0
      ? supabase.from("subjects").select("id, code, name").in("id", subjectIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ]);

  if (studentsRes.error) throw studentsRes.error;
  if (instructorsRes.error) throw instructorsRes.error;
  if (subjectsRes.error) throw subjectsRes.error;

  const studentMap = new Map((studentsRes.data ?? []).map((p) => [p.user_id, p]));
  const instructorMap = new Map((instructorsRes.data ?? []).map((p) => [p.user_id, p]));
  const subjectMap = new Map((subjectsRes.data ?? []).map((s) => [s.id, s]));

  return rows.map((r) => ({
    ...(r as CounselingReferralRow),
    student: studentMap.get(r.student_id as string) ?? null,
    instructor: instructorMap.get(r.instructor_id as string) ?? null,
    subject: subjectMap.get(r.subject_id as string) ?? null,
  }));
}

const REFERRAL_SELECT =
  "id, student_id, subject_id, instructor_id, recommendation_message, status, created_at, reviewed_at";

export function useCounselingReferrals(options?: { subjectId?: string; enabled?: boolean }) {
  const { user, role } = useAuth();
  const subjectId = options?.subjectId;
  const enabled = options?.enabled !== false && !!user?.id;

  const queryKey =
    role === "student"
      ? ["student-counseling-referrals", user?.id]
      : role === "instructor"
        ? subjectId
          ? ["counseling-referrals", subjectId]
          : ["instructor-counseling-referrals", user?.id]
        : ["guidance-referrals", user?.id];

  return useQuery({
    queryKey,
    enabled:
      enabled &&
      (role === "student" ||
        role === "instructor" ||
        role === "guidance_counselor"),
    queryFn: async (): Promise<CounselingReferralRow[]> => {
      if (!user?.id) return [];

      let query = supabase.from("counseling_referrals").select(REFERRAL_SELECT).order("created_at", {
        ascending: false,
      });

      if (role === "student") {
        query = query.eq("student_id", user.id);
      } else if (role === "instructor") {
        query = query.eq("instructor_id", user.id);
        if (subjectId) query = query.eq("subject_id", subjectId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return enrichReferrals((data ?? []) as Array<Record<string, unknown>>);
    },
  });
}
