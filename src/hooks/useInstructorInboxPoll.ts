import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { instructorAtRiskNotification, instructorEngagementAlertNotification, instructorEngagementFeedbackNotification } from "@/lib/notification-events";

const POLL_INTERVAL_MS = 90_000;
const POLL_KEY_PREFIX = "edge_instructor_inbox_poll_";

function pollStorageKey(userId: string) {
  return `${POLL_KEY_PREFIX}${userId}`;
}

/**
 * Polls new prediction rows for instructor subjects so the bell fills when Realtime is unavailable.
 */
export function useInstructorInboxPoll(userId: string | undefined, role: string | undefined) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || role !== "instructor") return;

    let cancelled = false;

    const run = async () => {
      const pollKey = pollStorageKey(userId);
      let lastPoll = localStorage.getItem(pollKey);
      if (!lastPoll) {
        lastPoll = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        localStorage.setItem(pollKey, lastPoll);
      }
      const nowIso = new Date().toISOString();

      try {
        const { data: subjects } = await supabase
          .from("subjects")
          .select("id, code")
          .eq("instructor_id", userId);

        const subjectList = subjects ?? [];
        const subjectIds = subjectList.map((s) => s.id).filter(Boolean) as string[];
        if (subjectIds.length === 0) return;

        const codeById = new Map(subjectList.map((s) => [s.id, s.code]));

        const { data: preds } = await supabase
          .from("predictions")
          .select("id, created_at, student_id, subject_id, risk_level, previous_risk_level")
          .in("subject_id", subjectIds)
          .gt("created_at", lastPoll);

        const studentIds = [
          ...new Set(
            (preds ?? [])
              .map((p) => (p as { student_id?: string | null }).student_id)
              .filter(Boolean) as string[],
          ),
        ];

        const nameById = new Map<string, string>();
        if (studentIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, full_name")
            .in("user_id", studentIds);
          for (const pr of profiles ?? []) {
            if (pr.user_id) nameById.set(pr.user_id, pr.full_name ?? "");
          }
        }

        for (const p of preds ?? []) {
          const row = p as {
            id: string;
            student_id: string | null;
            subject_id: string | null;
            risk_level: string;
            previous_risk_level: string | null;
          };
          const subjectCode = row.subject_id ? codeById.get(row.subject_id) ?? null : null;
          const n = instructorAtRiskNotification(row, {
            studentName: row.student_id ? nameById.get(row.student_id) ?? null : null,
            subjectCode,
          });
          if (n) addRef.current(n);
        }

        const { data: enrollments } = await supabase
          .from("enrollments")
          .select("student_id, subject_id")
          .in("subject_id", subjectIds)
          .eq("status", "active");

        const enrolledStudentIds = [
          ...new Set(
            (enrollments ?? [])
              .map((e) => (e as { student_id?: string | null }).student_id)
              .filter(Boolean) as string[],
          ),
        ];

        if (enrolledStudentIds.length > 0) {
          const { data: engagementRows } = await supabase
            .from("student_engagement_summary")
            .select(
              "student_id, engagement_level, previous_engagement_level, last_login_at, participation_count, updated_at",
            )
            .in("student_id", enrolledStudentIds)
            .gt("updated_at", lastPoll);

          const studentSubject = new Map<string, string>();
          for (const e of enrollments ?? []) {
            const sid = (e as { student_id?: string }).student_id;
            const subId = (e as { subject_id?: string }).subject_id;
            if (sid && subId && !studentSubject.has(sid)) {
              studentSubject.set(sid, subId);
            }
          }

          for (const row of engagementRows ?? []) {
            const studentId = (row as { student_id?: string }).student_id;
            const subjectId = studentId ? studentSubject.get(studentId) : undefined;
            const subjectCode = subjectId ? codeById.get(subjectId) ?? null : null;
            const n = instructorEngagementAlertNotification(row, {
              studentName: studentId ? nameById.get(studentId) ?? null : null,
              subjectCode,
            });
            if (n) addRef.current(n);
          }
        }

        if (enrolledStudentIds.length > 0) {
          const { data: feedbackRows } = await supabase
            .from("student_engagement_feedback")
            .select("id, student_id, subject, created_at")
            .in("student_id", enrolledStudentIds)
            .gt("created_at", lastPoll);

          for (const row of feedbackRows ?? []) {
            const studentId = (row as { student_id?: string }).student_id;
            const feedbackId = (row as { id?: string }).id;
            if (!studentId || !feedbackId) continue;
            addRef.current(
              instructorEngagementFeedbackNotification({
                feedbackId,
                studentName: nameById.get(studentId) ?? null,
                subject: (row as { subject?: string | null }).subject ?? null,
              }),
            );
          }
        }
      } catch (e) {
        console.warn("useInstructorInboxPoll:", e);
      }

      if (!cancelled) {
        localStorage.setItem(pollKey, nowIso);
      }
    };

    void run();
    const intervalId = window.setInterval(run, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, role]);
}
