import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { instructorAtRiskNotification, instructorEngagementAlertNotification, instructorEngagementFeedbackNotification } from "@/lib/notification-events";

type SubjectRef = { id: string; code: string };

/**
 * Realtime: alerts instructors when enrolled students newly become Crucial or Vulnerable.
 */
export function useInstructorRealtimeNotifications(
  userId: string | undefined,
  role: string | undefined,
) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || role !== "instructor") return;

    let cancelled = false;
    let channel = supabase.channel(`edge-instructor-notify-${userId}`);

    const attach = async () => {
      const { data: subjects } = await supabase
        .from("subjects")
        .select("id, code")
        .eq("instructor_id", userId);

      if (cancelled) return;

      const subjectList = (subjects ?? []) as SubjectRef[];
      if (subjectList.length === 0) return;

      const handlePrediction = async (row: Record<string, unknown> | undefined) => {
        if (!row) return;

        const studentId = typeof row.student_id === "string" ? row.student_id : null;
        const subjectId = typeof row.subject_id === "string" ? row.subject_id : null;
        if (!studentId || !subjectId) return;

        const subject = subjectList.find((s) => s.id === subjectId);
        if (!subject) return;

        let studentName: string | null = null;
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", studentId)
          .maybeSingle();
        studentName = profile?.full_name ?? null;

        const n = instructorAtRiskNotification(row, {
          studentName,
          subjectCode: subject.code,
        });
        if (n) addRef.current(n);
      };

      for (const subject of subjectList) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "predictions",
            filter: `subject_id=eq.${subject.id}`,
          },
          (payload) => {
            void handlePrediction(payload.new as Record<string, unknown> | undefined);
          },
        );
      }

      const handleEngagement = async (row: Record<string, unknown> | undefined) => {
        if (!row) return;
        const studentId = typeof row.student_id === "string" ? row.student_id : null;
        if (!studentId) return;

        const { data: enrollment } = await supabase
          .from("enrollments")
          .select("subject_id, subjects(code)")
          .eq("student_id", studentId)
          .in(
            "subject_id",
            subjectList.map((s) => s.id),
          )
          .eq("status", "active")
          .limit(1)
          .maybeSingle();

        if (!enrollment) return;

        let studentName: string | null = null;
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", studentId)
          .maybeSingle();
        studentName = profile?.full_name ?? null;

        const subjectCode =
          (enrollment.subjects as { code?: string } | null)?.code ?? null;

        const n = instructorEngagementAlertNotification(row, {
          studentName,
          subjectCode,
        });
        if (n) addRef.current(n);
      };

      for (const subject of subjectList) {
        const { data: enrollments } = await supabase
          .from("enrollments")
          .select("student_id")
          .eq("subject_id", subject.id)
          .eq("status", "active");

        for (const enroll of enrollments ?? []) {
          const sid = (enroll as { student_id?: string }).student_id;
          if (!sid) continue;
          channel = channel.on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "student_engagement_summary",
              filter: `student_id=eq.${sid}`,
            },
            (payload) => {
              void handleEngagement(payload.new as Record<string, unknown> | undefined);
            },
          );

          channel = channel.on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "student_engagement_feedback",
              filter: `student_id=eq.${sid}`,
            },
            async (payload) => {
              const row = payload.new as {
                id?: string;
                student_id?: string;
                subject?: string | null;
              } | null;
              if (!row?.id || !row.student_id) return;

              const { data: profile } = await supabase
                .from("profiles")
                .select("full_name")
                .eq("user_id", row.student_id)
                .maybeSingle();

              addRef.current(
                instructorEngagementFeedbackNotification({
                  feedbackId: row.id,
                  studentName: profile?.full_name ?? null,
                  subject: row.subject ?? null,
                }),
              );
            },
          );
        }
      }

      channel.subscribe();
    };

    void attach();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
