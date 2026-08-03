import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";

/**
 * On first mount for an approved instructor or guidance counselor, loads any
 * unread `user_inbox_notifications` rows from the database, adds them to the
 * dashboard inbox, and marks them as read.
 *
 * The "Account Approved" notification is inserted by the
 * `trg_create_approval_inbox_notification` DB trigger when an admin approves
 * the account. This hook surfaces it the first time the user logs in.
 */
export function useAccountApprovalNotification(
  userId: string | undefined,
  role: string | undefined,
) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!userId || !role) return;
    if (role !== "instructor" && role !== "guidance_counselor") return;
    if (loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("user_inbox_notifications")
          .select("id, title, body")
          .eq("user_id", userId)
          .eq("read", false)
          .order("created_at", { ascending: true });

        if (error || cancelled || !data?.length) return;

        for (const n of data) {
          const row = n as { id: string; title: string; body: string };
          addRef.current({
            title: row.title,
            body: row.body,
            dedupeKey: `user-inbox-notification:${row.id}`,
          });
        }

        // Mark all as read so they don't appear again on the next login.
        const ids = (data as { id: string }[]).map((n) => n.id);
        await supabase
          .from("user_inbox_notifications")
          .update({ read: true })
          .in("id", ids)
          .eq("user_id", userId);
      } catch (e) {
        console.warn("useAccountApprovalNotification:", e);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, role]);
}
