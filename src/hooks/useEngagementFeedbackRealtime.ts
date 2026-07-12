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

          const { data: referral } = await supabase
            .from("counseling_referrals")
            .select("id")
            .eq("student_id", row.student_id)
            .in("status", ["pending", "approved"])
            .limit(1)
            .maybeSingle();

          if (!referral) return;

          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", row.student_id)
            .maybeSingle();

          addRef.current(
            guidanceEngagementFeedbackNotification({
              feedbackId: row.id,
              studentName: profile?.full_name ?? null,
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
