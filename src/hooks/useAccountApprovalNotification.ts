import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";

type DurableNotificationRow = {
  id: string;
  title: string;
  body: string;
  source_name: string;
};

/**
 * Bridges durable `user_inbox_notifications` into the dashboard bell inbox.
 * Covers account approval, engagement alerts, and any other server-written rows.
 * Existing localStorage/poll hooks remain; this is the shared durable channel.
 */
export function useDurableInboxNotifications(
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

    const ingest = async (rows: DurableNotificationRow[]) => {
      const fresh: DurableNotificationRow[] = [];
      for (const row of rows) {
        if (seenIdsRef.current.has(row.id)) continue;
        seenIdsRef.current.add(row.id);
        fresh.push(row);
        addRef.current({
          title: row.title,
          body: row.body,
          sourceName: row.source_name,
          dedupeKey: `user-inbox-notification:${row.id}`,
        });
      }
      if (fresh.length === 0) return;
      await supabase
        .from("user_inbox_notifications")
        .update({ read: true })
        .in(
          "id",
          fresh.map((n) => n.id),
        )
        .eq("user_id", userId);
    };

    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("user_inbox_notifications")
          .select("id, title, body, source_name")
          .eq("user_id", userId)
          .eq("read", false)
          .order("created_at", { ascending: true })
          .limit(50);

        if (error || cancelled || !data?.length) return;
        await ingest(data as DurableNotificationRow[]);
      } catch (e) {
        console.warn("useDurableInboxNotifications:", e);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 45_000);

    const channel = supabase
      .channel(`durable-inbox:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_inbox_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as DurableNotificationRow & { read?: boolean };
          if (!row?.id || row.read) return;
          void ingest([row]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId, role]);
}

/** @deprecated Prefer useDurableInboxNotifications — kept for existing imports. */
export const useAccountApprovalNotification = useDurableInboxNotifications;
