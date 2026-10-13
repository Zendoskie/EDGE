import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateStudentReleases } from "@/lib/final-grade-freshness";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import {
  loadCoachingRecSeen,
  saveCoachingRecSeen,
  studentEngagementDropNotification,
  studentInactivityNotification,
  studentNoParticipationNotification,
  studentPredictionNotifications,
  unseenCoachingRecommendation,
} from "@/lib/notification-events";
import { resolveProfileSource } from "@/lib/notification-sources";
import { PREDICTION_EVIDENCE_COLUMNS } from "@/lib/risk-scoring";

const POLL_KEY_PREFIX = "edge_inbox_poll_";

function pollStorageKey(userId: string) {
  return `${POLL_KEY_PREFIX}${userId}`;
}

/**
 * Polls recent grades, predictions, and new attendance rows so the bell fills in even when
 * Realtime is not enabled on the Supabase project. Instructors never run this (student-only).
 */
export function useStudentInboxPoll(userId: string | undefined, role: string | undefined) {
  const { addNotification } = useNotificationInbox();
  const queryClient = useQueryClient();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || role !== "student") return;

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
        const sourceCache = new Map<string, string>();
        const getSourceName = async (actorId?: string | null) => {
          if (!actorId) return "Course Instructor";
          const cached = sourceCache.get(actorId);
          if (cached) return cached;
          const sourceName = await resolveProfileSource(actorId, "Course Instructor");
          sourceCache.set(actorId, sourceName);
          return sourceName;
        };

        const sinceMs = Date.parse(lastPoll);
        const { data: predictionRows } = await supabase
          .from("predictions")
          .select(
            `id, created_at, risk_level, previous_risk_level, previous_attendance_rate, recommendation, subject_id, subjects(code), ${PREDICTION_EVIDENCE_COLUMNS}`,
          )
          .eq("student_id", userId)
          .or(`created_at.gt."${lastPoll}",recommendation.not.is.null`);

        const preds = (predictionRows ?? []).filter((row) => {
          const createdMs = Date.parse(row.created_at ?? "");
          return Number.isFinite(sinceMs) && Number.isFinite(createdMs) && createdMs > sinceMs;
        });

        for (const p of preds) {
          const row = p as {
            id: string;
            subjects: { code?: string } | null;
          };
          const code = row.subjects?.code ?? null;
          for (const n of studentPredictionNotifications(row, code)) {
            addRef.current(n);
          }
        }

        const coachingSeen = loadCoachingRecSeen(userId);
        for (const p of predictionRows ?? []) {
          const row = p as { id: string; recommendation: string | null; subjects: { code?: string } | null };
          const n = unseenCoachingRecommendation(row, row.subjects?.code ?? null, coachingSeen);
          if (n) addRef.current(n);
        }
        saveCoachingRecSeen(userId, coachingSeen);

        const { data: attRows } = await supabase
          .from("attendance")
          .select("id, date, status, created_at, recorded_by, subjects(instructor_id)")
          .eq("student_id", userId)
          .gt("created_at", lastPoll);

        // A changed prediction or a new attendance row means grade inputs changed since the last poll.
        if (preds.length > 0 || (attRows ?? []).length > 0) invalidateStudentReleases(queryClient, userId);

        for (const a of attRows ?? []) {
          const row = a as {
            id: string;
            date: string;
            status: string;
            recorded_by: string | null;
            subjects: { instructor_id?: string | null } | null;
          };
          addRef.current({
            title: "Attendance recorded",
            body: `${row.date}: ${row.status}`,
            dedupeKey: `att:${row.id}:${row.date}:${row.status}`,
            sourceName: await getSourceName(
              row.recorded_by ?? row.subjects?.instructor_id,
            ),
          });
        }

        const { data: interventions } = await supabase
          .from("interventions")
          .select("id, sent_at, subject_id, message, subjects(code, instructor_id)")
          .eq("student_id", userId)
          .gt("sent_at", lastPoll)
          .order("sent_at", { ascending: false })
          .limit(25);

        for (const i of interventions ?? []) {
          const row = i as {
            id: string;
            sent_at: string | null;
            message: string | null;
            subjects: { code?: string; instructor_id?: string | null } | null;
          };
          const msg = row.message?.trim();
          if (!msg || !msg.toLowerCase().startsWith("early warning alert")) continue;
          const code = row.subjects?.code ?? "your subject";
          addRef.current({
            title: "Instructor early warning",
            body: `${code}: ${msg}`,
            dedupeKey: `early-warning:${row.id}:${row.sent_at ?? ""}`,
            sourceName: await getSourceName(row.subjects?.instructor_id),
          });
        }

        const { data: engagementRow } = await supabase
          .from("student_engagement_summary")
          .select(
            "student_id, engagement_level, previous_engagement_level, last_login_at, participation_count, updated_at",
          )
          .eq("student_id", userId)
          .maybeSingle();

        if (engagementRow) {
          const drop = studentEngagementDropNotification(engagementRow);
          if (drop) addRef.current(drop);
          const inactive = studentInactivityNotification(engagementRow);
          if (inactive) addRef.current(inactive);
          const noPart = studentNoParticipationNotification(engagementRow);
          if (noPart) addRef.current(noPart);
        }
      } catch (e) {
        console.warn("useStudentInboxPoll:", e);
      }

      if (!cancelled) {
        localStorage.setItem(pollKey, nowIso);
      }
    };

    void run();
    const intervalId = window.setInterval(run, 180_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, role, queryClient]);
}
