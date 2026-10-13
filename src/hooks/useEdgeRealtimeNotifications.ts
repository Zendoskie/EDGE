import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { invalidateEngagementKeys } from "@/hooks/useEngagementSummaryRealtime";
import { invalidateStudentReleases, isReleaseRelevantRealtime } from "@/lib/final-grade-freshness";
import {
  loadCoachingRecSeen,
  saveCoachingRecSeen,
  studentCoachingRecommendationNotification,
  studentEngagementDropNotification,
  studentInactivityNotification,
  studentNoParticipationNotification,
  studentPredictionNotifications,
  unseenCoachingRecommendation,
} from "@/lib/notification-events";
import {
  createProfileSourceCache,
  resolveSubjectInstructorSource,
} from "@/lib/notification-sources";

/**
 * Realtime: pushes inbox items when the student’s rows change (requires tables in `supabase_realtime`).
 * Attendance is often UPDATED (same day row), not INSERT — both are handled.
 */
export function useEdgeRealtimeNotifications(userId: string | undefined, role: string | undefined) {
  const { addNotification } = useNotificationInbox();
  const queryClient = useQueryClient();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || role !== "student") return;

    // The attendance channel is filtered to this student's rows, so a session's roster default
    // reaches each student once; the memo keeps repeat events from one instructor to one lookup.
    const instructorSource = createProfileSourceCache("Course Instructor");

    const pushAttendance = async (row: Record<string, unknown>) => {
      const id = String(row.id ?? "");
      const status = String(row.status ?? "recorded");
      const date = String(row.date ?? "");
      const sourceName =
        typeof row.recorded_by === "string" && row.recorded_by
          ? await instructorSource(row.recorded_by)
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

    // predict-risk updates rows in place, so risk changes arrive as UPDATEs. The subject code is
    // fetched only when there is something to show; the body text is the only place it is used.
    const pushPredictionUpdate = async (row: Record<string, unknown>) => {
      const seen = loadCoachingRecSeen(userId);
      const hasNewCoaching = unseenCoachingRecommendation(row, null, seen) != null;
      if (hasNewCoaching) saveCoachingRecSeen(userId, seen);
      if (!hasNewCoaching && studentPredictionNotifications(row, null).length === 0) return;

      let subjectCode: string | null = null;
      if (typeof row.subject_id === "string") {
        const { data } = await supabase
          .from("subjects")
          .select("code")
          .eq("id", row.subject_id)
          .maybeSingle();
        subjectCode = data?.code ?? null;
      }

      for (const n of studentPredictionNotifications(row, subjectCode)) addRef.current(n);
      if (hasNewCoaching) {
        const n = studentCoachingRecommendationNotification(row, subjectCode);
        if (n) addRef.current(n);
      }
    };

    const channel = supabase
      .channel(`edge-student-notify-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "predictions",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          invalidateStudentReleases(queryClient, userId);
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
          invalidateStudentReleases(queryClient, userId);
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row) return;
          void pushPredictionUpdate(row);
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
          if (isReleaseRelevantRealtime("attendance", payload.eventType)) {
            invalidateStudentReleases(queryClient, userId);
          }
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
          invalidateEngagementKeys(queryClient, userId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role, queryClient]);
}
