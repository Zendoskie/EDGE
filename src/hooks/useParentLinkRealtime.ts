import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import {
  normalizeParentLinkStatus,
  parentLinkDecisionNotification,
  studentParentRequestNotification,
} from "@/lib/parent-link-notifications";

function invalidateParentLinkQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  role: string,
) {
  if (role === "student") {
    void queryClient.invalidateQueries({ queryKey: ["student-parent-requests", userId] });
    void queryClient.invalidateQueries({ queryKey: ["student-parent-request-history", userId] });
  } else if (role === "parent") {
    void queryClient.invalidateQueries({ queryKey: ["parent-latest-link", userId] });
    void queryClient.invalidateQueries({ queryKey: ["parent-approved-link", userId] });
    void queryClient.invalidateQueries({ queryKey: ["parent-my-links", userId] });
  }
}

async function fetchProfileName(userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.full_name?.trim() || data?.email?.trim() || "Unknown";
}

/**
 * Realtime parent_student_links: inbox alerts + React Query invalidation for students and parents.
 */
export function useParentLinkRealtime(userId: string | undefined, role: string | undefined) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;

  useEffect(() => {
    if (!userId || !role) return;
    if (role !== "student" && role !== "parent") return;

    const handleInsertForStudent = async (row: Record<string, unknown> | undefined) => {
      if (!row || role !== "student") return;
      const status = normalizeParentLinkStatus(row.status);
      if (status !== "pending") return;

      const linkId = String(row.id ?? "");
      const parentUserId = String(row.parent_user_id ?? "");
      const parentName = parentUserId ? await fetchProfileName(parentUserId) : "A parent/guardian";
      const msg = studentParentRequestNotification({ linkId, parentName });
      addRef.current(msg);
      invalidateParentLinkQueries(queryClient, userId, role);
    };

    const handleUpdateForParent = async (row: Record<string, unknown> | undefined) => {
      if (!row || role !== "parent") return;
      const status = normalizeParentLinkStatus(row.status);
      if (status === "pending") return;

      const linkId = String(row.id ?? "");
      const studentUserId = String(row.student_user_id ?? "");
      const studentName = studentUserId ? await fetchProfileName(studentUserId) : "the student";
      const msg = parentLinkDecisionNotification({ linkId, status, studentName });
      if (msg) addRef.current(msg);
      invalidateParentLinkQueries(queryClient, userId, role);
    };

    const channelName = `edge-parent-link-${role}-${userId}`;
    let channel = supabase.channel(channelName);

    if (role === "student") {
      channel = channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "parent_student_links",
          filter: `student_user_id=eq.${userId}`,
        },
        (payload) => {
          void handleInsertForStudent(payload.new as Record<string, unknown> | undefined);
        },
      );
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "parent_student_links",
          filter: `student_user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined;
          const oldRow = payload.old as Record<string, unknown> | undefined;
          const prevStatus = normalizeParentLinkStatus(oldRow?.status);
          const nextStatus = normalizeParentLinkStatus(row?.status);
          if (prevStatus !== "pending" && nextStatus === "pending") {
            void handleInsertForStudent(row);
          }
        },
      );
    } else {
      channel = channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "parent_student_links",
          filter: `parent_user_id=eq.${userId}`,
        },
        (payload) => {
          void handleUpdateForParent(payload.new as Record<string, unknown> | undefined);
        },
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, role, queryClient]);
}
