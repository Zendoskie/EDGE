import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import {
  studentCoachingRecommendationNotification,
  studentEngagementDropNotification,
  studentInactivityNotification,
  studentNoParticipationNotification,
  studentPredictionNotifications,
} from "@/lib/notification-events";
import {
  resolveActivitySource,
  resolveProfileSource,
  resolveSubjectInstructorSource,
} from "@/lib/notification-sources";

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

    const pushGrade = async (row: Record<string, unknown>) => {
      if (row.score == null && !row.graded_at) return;
      const id = String(row.id ?? "");
      const t =
        row.graded_at != null
          ? String(row.graded_at)
          : row.submitted_at != null
            ? String(row.submitted_at)
            : "";
      const sourceName =
        typeof row.graded_by === "string" && row.graded_by
          ? await resolveProfileSource(row.graded_by, "Course Instructor")
          : await resolveActivitySource(
              typeof row.activity_id === "string" ? row.activity_id : null,
              "Course Instructor",
            );
      addRef.current({
        title: "New grade posted",
        body: "One of your submissions has been graded. Open Scores to review.",
        dedupeKey: `sub-grade:${id}:${t}`,
        sourceName,
      });
    };

    const pushAttendance = async (row: Record<string, unknown>) => {
      const id = String(row.id ?? "");
      const status = String(row.status ?? "recorded");
      const date = String(row.date ?? "");
      const sourceName =
        typeof row.recorded_by === "string" && row.recorded_by
          ? await resolveProfileSource(row.recorded_by, "Course Instructor")
          : await resolveSubjectInstructorSource(
              typeof row.subject_id === "string" ? row.subject_id : null,
              "Course Instructor",
            );
      addRef.current({
        title: "Attendance updated",
        body: date ? `${date}: ${status}` : `Status: ${status}`,
        dedupeKey: `att:${id}:${date}:${status}`,
        sourceName,
      });
    };

    const pushPredictionInsert = async (row: Record<string, unknown>) => {
      let subjectCode: string | null = null;
      if (typeof row.subject_id === "string") {
        const { data } = await supabase
          .from("subjects")
          .select("code")
          .eq("id", row.subject_id)
          .maybeSingle();
        subjectCode = data?.code ?? null;
      }

      for (const n of studentPredictionNotifications(row, subjectCode)) {
        addRef.current(n);
      }
    };

    const pushPredictionUpdate = async (
      row: Record<string, unknown>,
      oldRow: Record<string, unknown> | undefined,
    ) => {
      const prevRec =
        typeof oldRow?.recommendation === "string" ? oldRow.recommendation : null;

      let subjectCode: string | null = null;
      if (typeof row.subject_id === "string") {
        const { data } = await supabase
          .from("subjects")
          .select("code")
          .eq("id", row.subject_id)
          .maybeSingle();
        subjectCode = data?.code ?? null;
      }

      const n = studentCoachingRecommendationNotification(row, subjectCode, prevRec);
      if (n) addRef.current(n);
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
            if (row.score != null || row.graded_at) void pushGrade(row);
            return;
          }
          if (payload.eventType === "UPDATE") {
            if (row.score != null || row.graded_at) void pushGrade(row);
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
          void (async () => {
            const id = String(row.id ?? payload.commit_timestamp ?? Date.now());
            const msg = typeof row.message === "string" && row.message.trim()
              ? row.message
              : "Your instructor sent an early warning alert. Please review your progress.";
            const sourceName = await resolveSubjectInstructorSource(
              typeof row.subject_id === "string" ? row.subject_id : null,
              "Course Instructor",
            );
            addRef.current({
              title: "Instructor early warning",
              body: msg,
              dedupeKey: `intervention:${id}`,
              sourceName,
            });
          })();
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
          if (!row) return;
          void pushPredictionInsert(row);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "predictions",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          void pushPredictionUpdate(row, payload.old as Record<string, unknown> | undefined);
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
            void pushAttendance(row);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "student_engagement_summary",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          const drop = studentEngagementDropNotification(row);
          if (drop) addRef.current(drop);
          const inactive = studentInactivityNotification(row);
          if (inactive) addRef.current(inactive);
          const noPart = studentNoParticipationNotification(row);
          if (noPart) addRef.current(noPart);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
