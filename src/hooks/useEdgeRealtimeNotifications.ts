import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";

/**
 * Realtime: pushes inbox items when the student’s rows change (requires tables in `supabase_realtime`).
 * Attendance is often UPDATED (same day row), not INSERT — both are handled.
 */
export function useEdgeRealtimeNotifications(userId: string | undefined, role: string | undefined) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || role !== "student") return;

    const pushGrade = (row: Record<string, unknown>) => {
      if (row.score == null && !row.graded_at) return;
      const id = String(row.id ?? "");
      const t =
        row.graded_at != null
          ? String(row.graded_at)
          : row.submitted_at != null
            ? String(row.submitted_at)
            : "";
      addRef.current({
        title: "New grade posted",
        body: "One of your submissions has been graded. Open Scores to review.",
        dedupeKey: `sub-grade:${id}:${t}`,
      });
    };

    const pushAttendance = (row: Record<string, unknown>) => {
      const id = String(row.id ?? "");
      const status = String(row.status ?? "recorded");
      const date = String(row.date ?? "");
      addRef.current({
        title: "Attendance updated",
        body: date ? `${date}: ${status}` : `Status: ${status}`,
        dedupeKey: `att:${id}:${date}:${status}`,
      });
    };

    const channel = supabase
      .channel(`edge-student-notify-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          if (payload.eventType === "INSERT") {
            if (row.score != null || row.graded_at) pushGrade(row);
            return;
          }
          if (payload.eventType === "UPDATE") {
            if (row.score != null || row.graded_at) pushGrade(row);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "interventions",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          const id = String(row.id ?? payload.commit_timestamp ?? Date.now());
          const msg = typeof row.message === "string" && row.message.trim()
            ? row.message
            : "Your instructor sent an early warning alert. Please review your progress.";
          addRef.current({
            title: "Instructor early warning",
            body: msg,
            dedupeKey: `intervention:${id}`,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "predictions",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          const id = String(row?.id ?? payload.commit_timestamp ?? Date.now());
          addRef.current({
            title: "Academic insight updated",
            body: "A new risk prediction is available. Check Performance Insights.",
            dedupeKey: `pred:${id}`,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            pushAttendance(row);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
