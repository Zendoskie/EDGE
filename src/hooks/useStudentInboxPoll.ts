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

const POLL_KEY_PREFIX = "edge_inbox_poll_";
const COACHING_REC_SEEN_PREFIX = "edge_coaching_rec_seen_";

function pollStorageKey(userId: string) {
  return `${POLL_KEY_PREFIX}${userId}`;
}

function coachingRecSeenKey(userId: string) {
  return `${COACHING_REC_SEEN_PREFIX}${userId}`;
}

function loadCoachingRecSeen(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(coachingRecSeenKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCoachingRecSeen(userId: string, map: Record<string, string>) {
  try {
    localStorage.setItem(coachingRecSeenKey(userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Polls recent grades, predictions, and new attendance rows so the bell fills in even when
 * Realtime is not enabled on the Supabase project. Instructors never run this (student-only).
 */
export function useStudentInboxPoll(userId: string | undefined, role: string | undefined) {
  const { addNotification } = useNotificationInbox();
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
        // Missing-grade alerts: when an instructor publishes grades for an activity,
        // notify students who do not have a recorded score for that activity.
        const { data: myEnrollments } = await supabase
          .from("enrollments")
          .select("subject_id")
          .eq("student_id", userId)
          .eq("status", "active");
        const mySubjectIds = (myEnrollments ?? [])
          .map((e) => (e as { subject_id?: string | null }).subject_id)
          .filter(Boolean) as string[];

        if (mySubjectIds.length > 0) {
          const { data: publishedActivities } = await supabase
            .from("activities")
            .select("id, title, grades_published_at, subject_id, subjects(code)")
            .in("subject_id", mySubjectIds)
            .gt("grades_published_at", lastPoll);

          const published = (publishedActivities ?? []).filter(
            (a) => (a as { grades_published_at?: string | null }).grades_published_at,
          ) as Array<{
            id: string;
            title: string;
            grades_published_at: string;
            subject_id: string | null;
            subjects: { code?: string } | null;
          }>;

          if (published.length > 0) {
            const activityIds = published.map((a) => a.id);
            const { data: mySubsForPublished } = await supabase
              .from("submissions")
              .select("activity_id, score")
              .eq("student_id", userId)
              .in("activity_id", activityIds);

            const scoreByActivityId = new Map<string, number | null>();
            for (const s of mySubsForPublished ?? []) {
              const row = s as { activity_id?: string | null; score?: number | null };
              if (!row.activity_id) continue;
              scoreByActivityId.set(row.activity_id, row.score ?? null);
            }

            for (const a of published) {
              const hasRow = scoreByActivityId.has(a.id);
              const score = scoreByActivityId.get(a.id);
              const isMissing = !hasRow || score == null;
              if (!isMissing) continue;

              const courseCode = a.subjects?.code ?? "your course";
              addRef.current({
                title: "Missing grade",
                body: `${courseCode}: "${a.title}" grades were published, but no score is recorded for you yet. Contact your instructor.`,
                dedupeKey: `missing-grade:${a.id}:${a.grades_published_at}`,
              });
            }
          }
        }

        const { data: subsGraded } = await supabase
          .from("submissions")
          .select("id, score, graded_at, submitted_at, activities(title)")
          .eq("student_id", userId)
          .not("score", "is", null)
          .gt("graded_at", lastPoll);

        for (const s of subsGraded ?? []) {
          const row = s as {
            id: string;
            graded_at: string | null;
            submitted_at: string | null;
            activities: { title?: string } | null;
          };
          const t = row.graded_at || row.submitted_at || "";
          const title = row.activities?.title ?? "Activity";
          addRef.current({
            title: "New grade posted",
            body: `${title}: your work has been graded. Open Scores to review.`,
            dedupeKey: `sub-grade:${row.id}:${t}`,
          });
        }

        const { data: subsLegacy } = await supabase
          .from("submissions")
          .select("id, score, graded_at, submitted_at, activities(title)")
          .eq("student_id", userId)
          .not("score", "is", null)
          .is("graded_at", null)
          .gt("submitted_at", lastPoll);

        for (const s of subsLegacy ?? []) {
          const row = s as {
            id: string;
            graded_at: string | null;
            submitted_at: string | null;
            activities: { title?: string } | null;
          };
          const t = row.submitted_at || "";
          const title = row.activities?.title ?? "Activity";
          addRef.current({
            title: "New grade posted",
            body: `${title}: your work has been graded. Open Scores to review.`,
            dedupeKey: `sub-grade:${row.id}:${t}`,
          });
        }

        const { data: preds } = await supabase
          .from("predictions")
          .select(
            "id, created_at, risk_level, previous_risk_level, attendance_rate, previous_attendance_rate, recommendation, subject_id, subjects(code)",
          )
          .eq("student_id", userId)
          .gt("created_at", lastPoll);

        for (const p of preds ?? []) {
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
        const { data: coachingRows } = await supabase
          .from("predictions")
          .select("id, recommendation, subject_id, subjects(code)")
          .eq("student_id", userId)
          .not("recommendation", "is", null);

        const nextCoachingSeen = { ...coachingSeen };
        for (const p of coachingRows ?? []) {
          const row = p as {
            id: string;
            recommendation: string | null;
            subjects: { code?: string } | null;
          };
          const rec = row.recommendation?.trim() ?? "";
          if (!rec) continue;
          const prev = coachingSeen[row.id];
          if (prev === rec) continue;

          const n = studentCoachingRecommendationNotification(row, row.subjects?.code ?? null, prev ?? null);
          if (n) addRef.current(n);
          nextCoachingSeen[row.id] = rec;
        }
        saveCoachingRecSeen(userId, nextCoachingSeen);

        const { data: attRows } = await supabase
          .from("attendance")
          .select("id, date, status, created_at")
          .eq("student_id", userId)
          .gt("created_at", lastPoll);

        for (const a of attRows ?? []) {
          const row = a as { id: string; date: string; status: string };
          addRef.current({
            title: "Attendance recorded",
            body: `${row.date}: ${row.status}`,
            dedupeKey: `att:${row.id}:${row.date}:${row.status}`,
          });
        }

        const { data: interventions } = await supabase
          .from("interventions")
          .select("id, sent_at, subject_id, message, subjects(code)")
          .eq("student_id", userId)
          .gt("sent_at", lastPoll)
          .order("sent_at", { ascending: false })
          .limit(25);

        for (const i of interventions ?? []) {
          const row = i as {
            id: string;
            sent_at: string | null;
            message: string | null;
            subjects: { code?: string } | null;
          };
          const msg = row.message?.trim();
          if (!msg || !msg.toLowerCase().startsWith("early warning alert")) continue;
          const code = row.subjects?.code ?? "your subject";
          addRef.current({
            title: "Instructor early warning",
            body: `${code}: ${msg}`,
            dedupeKey: `early-warning:${row.id}:${row.sent_at ?? ""}`,
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
    const intervalId = window.setInterval(run, 90_000);
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
