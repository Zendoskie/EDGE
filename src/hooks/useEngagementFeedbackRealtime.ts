import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { guidanceEngagementFeedbackNotification } from "@/lib/notification-events";

/**
 * Notifies guidance counselors when a referred student submits engagement feedback.
 */
export function useEngagementFeedbackRealtime(userId: string | undefined, role: string | undefined) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const seenFeedbackIds = useRef(new Set<string>());
  const referredStudentNames = useRef(new Map<string, string | null>());

  useEffect(() => {
    if (!userId || role !== "guidance_counselor") return;

    const channel = supabase
      .channel(`guidance-engagement-feedback-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "student_engagement_feedback" },
        async (payload) => {
          const row = payload.new as {
            id?: string;
            student_id?: string;
            subject?: string | null;
          } | null;
          if (!row?.id || !row.student_id) return;
          if (seenFeedbackIds.current.has(row.id)) return;

          let studentName = referredStudentNames.current.get(row.student_id);
          if (!referredStudentNames.current.has(row.student_id)) {
            const { data: referral, error } = await supabase
              .from("counseling_referrals")
              .select("id")
              .eq("student_id", row.student_id)
              .in("status", ["pending", "approved"])
              .limit(1)
              .maybeSingle();

            if (error) return;
            if (!referral) {
              seenFeedbackIds.current.add(row.id);
              return;
            }

            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("user_id", row.student_id)
              .maybeSingle();
            studentName = profile?.full_name ?? null;
            referredStudentNames.current.set(row.student_id, studentName);
          }

          seenFeedbackIds.current.add(row.id);

          addRef.current(
            guidanceEngagementFeedbackNotification({
              feedbackId: row.id,
              studentName: studentName ?? null,
              subject: row.subject ?? null,
            }),
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role]);
}
