import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";

/**
 * Bridges durable `user_inbox_notifications` rows into the dashboard inbox.
 * Used for account approval (instructors/guidance) and engagement alerts
 * (students + instructors). Existing localStorage/poll notification flows stay intact.
 */
export function useAccountApprovalNotification(
  userId: string | undefined,
  role: string | undefined,
) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || !role) return;

    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("user_inbox_notifications")
          .select("id, title, body")
          .eq("user_id", userId)
          .eq("read", false)
          .order("created_at", { ascending: true })
          .limit(50);

        if (error || cancelled || !data?.length) return;

        const fresh: { id: string; title: string; body: string }[] = [];
        for (const n of data) {
          const row = n as { id: string; title: string; body: string };
          if (seenIdsRef.current.has(row.id)) continue;
          seenIdsRef.current.add(row.id);
          fresh.push(row);
          addRef.current({
            title: row.title,
            body: row.body,
            dedupeKey: `user-inbox-notification:${row.id}`,
          });
        }

        if (fresh.length === 0) return;

        const ids = fresh.map((n) => n.id);
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
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [userId, role]);
}
