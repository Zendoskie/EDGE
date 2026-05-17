import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { normalizeReferralStatus, referralStatusLabel } from "@/lib/referral-utils";

function invalidateReferralQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  role: string,
  subjectId?: string,
) {
  if (role === "student") {
    void queryClient.invalidateQueries({ queryKey: ["student-counseling-referrals", userId] });
  } else if (role === "instructor") {
    void queryClient.invalidateQueries({ queryKey: ["instructor-counseling-referrals", userId] });
    if (subjectId) {
      void queryClient.invalidateQueries({ queryKey: ["counseling-referrals", subjectId] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["counseling-referrals"] });
    }
  } else if (role === "guidance_counselor") {
    void queryClient.invalidateQueries({ queryKey: ["guidance-referrals", userId] });
  }
}

function notificationForReferral(
  role: string,
  eventType: string,
  row: Record<string, unknown>,
): { title: string; body: string } | null {
  const id = String(row.id ?? "");
  const status = normalizeReferralStatus(row.status);
  const subjectHint =
    typeof row.recommendation_message === "string" && row.recommendation_message.trim()
      ? row.recommendation_message.trim().slice(0, 80)
      : "your course";

  if (role === "guidance_counselor") {
    if (eventType === "INSERT" && status === "pending") {
      return {
        title: "New counseling referral",
        body: "An instructor submitted a counseling referral for your review.",
      };
    }
    return null;
  }

  if (role === "student") {
    if (eventType === "INSERT") {
      return {
        title: "Counseling referral submitted",
        body: "Your instructor referred you for guidance counseling. Status: Pending.",
      };
    }
    if (eventType === "UPDATE" && (status === "approved" || status === "rejected")) {
      return {
        title: `Counseling referral ${referralStatusLabel(status).toLowerCase()}`,
        body:
          status === "approved"
            ? "Your counseling referral was approved. Your instructor may proceed with counseling support."
            : "Your counseling referral was not approved at this time. Contact your instructor or guidance office for details.",
      };
    }
    return null;
  }

  if (role === "instructor") {
    if (eventType === "INSERT") {
      return {
        title: "Counseling referral submitted",
        body: `Referral sent to guidance counselor. Status: Pending. ${subjectHint}`,
      };
    }
    if (eventType === "UPDATE" && (status === "approved" || status === "rejected")) {
      return {
        title: `Referral ${referralStatusLabel(status).toLowerCase()}`,
        body:
          status === "approved"
            ? "Guidance counselor approved your counseling referral. You can now log a counseling intervention."
            : "Guidance counselor rejected your counseling referral.",
      };
    }
  }

  return null;
}

/**
 * Realtime counseling_referrals: inbox alerts + React Query invalidation for students, instructors, and counselors.
 */
export function useReferralRealtime(
  userId: string | undefined,
  role: string | undefined,
) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || !role) return;
    if (!["student", "instructor", "guidance_counselor"].includes(role)) return;

    const handleRow = (eventType: string, row: Record<string, unknown> | undefined) => {
      if (!row) return;
      const id = String(row.id ?? "");
      const status = normalizeReferralStatus(row.status);
      const subjectId = typeof row.subject_id === "string" ? row.subject_id : undefined;

      const msg = notificationForReferral(role, eventType, row);
      if (msg) {
        addRef.current({
          ...msg,
          dedupeKey: `referral:${id}:${status}:${eventType}`,
        });
      }

      invalidateReferralQueries(queryClient, userId, role, subjectId);
    };

    const channelName = `edge-referral-${role}-${userId}`;
    let channel = supabase.channel(channelName);

    if (role === "student") {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "counseling_referrals",
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          handleRow(payload.eventType, payload.new as Record<string, unknown> | undefined);
        },
      );
    } else if (role === "instructor") {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "counseling_referrals",
          filter: `instructor_id=eq.${userId}`,
        },
        (payload) => {
          handleRow(payload.eventType, payload.new as Record<string, unknown> | undefined);
        },
      );
    } else {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "counseling_referrals",
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          if (!row || normalizeReferralStatus(row.status) !== "pending") return;
          handleRow(payload.eventType, row);
        },
      );
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "counseling_referrals",
        },
        (payload) => {
          handleRow(payload.eventType, payload.new as Record<string, unknown> | undefined);
        },
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role, queryClient]);
}
