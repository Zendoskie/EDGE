import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { ReferralStatus } from "@/lib/referral-utils";

export type CounselingReferralRow = {
  id: string;
  student_id: string;
  subject_id: string;
  instructor_id: string;
  prediction_id: string | null;
  status: ReferralStatus | string;
  created_at: string | null;
  reviewed_at: string | null;
  recommendation_message: string | null;
  counselor_remarks: string | null;
  prediction?: {
    risk_level: string | null;
    risk_score: number | null;
    recommendation: string | null;
  } | null;
  latest_feedback?: {
    id: string;
    risk_level: string | null;
    reasons: string[] | null;
    details: string | null;
    created_at: string | null;
  } | null;
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
  const predictionIds = Array.from(new Set(rows.map((r) => r.prediction_id).filter(Boolean))) as string[];

  const [studentsRes, instructorsRes, subjectsRes, predictionsRes] = await Promise.all([
    studentIds.length > 0
      ? supabase.from("profiles").select("user_id, full_name, email, student_id").in("user_id", studentIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    instructorIds.length > 0
      ? supabase.from("profiles").select("user_id, full_name, email").in("user_id", instructorIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    subjectIds.length > 0
      ? supabase.from("subjects").select("id, code, name").in("id", subjectIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    predictionIds.length > 0
      ? supabase.from("predictions").select("id, risk_level, risk_score, recommendation").in("id", predictionIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ]);

  if (studentsRes.error) throw studentsRes.error;
  if (instructorsRes.error) throw instructorsRes.error;
  if (subjectsRes.error) throw subjectsRes.error;
  if (predictionsRes.error) throw predictionsRes.error;

  const studentMap = new Map((studentsRes.data ?? []).map((p) => [p.user_id, p]));
  const instructorMap = new Map((instructorsRes.data ?? []).map((p) => [p.user_id, p]));
  const subjectMap = new Map((subjectsRes.data ?? []).map((s) => [s.id, s]));
  const predictionMap = new Map((predictionsRes.data ?? []).map((p) => [p.id, p]));

  let feedbackMap = new Map<string, CounselingReferralRow["latest_feedback"]>();
  if (studentIds.length > 0 && subjectIds.length > 0) {
    const { data: feedbackRows, error: feedbackError } = await supabase
      .from("student_feedback")
      .select("id, student_id, subject_id, risk_level, reasons, details, created_at")
      .in("student_id", studentIds)
      .in("subject_id", subjectIds)
      .order("created_at", { ascending: false })
      .limit(100);
    if (feedbackError) throw feedbackError;

    for (const row of feedbackRows ?? []) {
      const key = `${row.student_id}:${row.subject_id}`;
      if (!feedbackMap.has(key)) {
        feedbackMap.set(key, {
          id: row.id,
          risk_level: row.risk_level,
          reasons: row.reasons,
          details: row.details,
          created_at: row.created_at,
        });
      }
    }
  }

  return rows.map((r) => ({
    ...(r as CounselingReferralRow),
    student: studentMap.get(r.student_id as string) ?? null,
    instructor: instructorMap.get(r.instructor_id as string) ?? null,
    subject: subjectMap.get(r.subject_id as string) ?? null,
    prediction: r.prediction_id ? (predictionMap.get(r.prediction_id as string) as CounselingReferralRow["prediction"]) ?? null : null,
    latest_feedback: feedbackMap.get(`${r.student_id}:${r.subject_id}`) ?? null,
  }));
}

const REFERRAL_SELECT =
  "id, student_id, subject_id, instructor_id, prediction_id, recommendation_message, counselor_remarks, status, created_at, reviewed_at";

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
    refetchOnWindowFocus: role === "guidance_counselor",
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
