import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { instructorAtRiskNotification } from "@/lib/notification-events";

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

      channel.subscribe();
    };

    void attach();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
