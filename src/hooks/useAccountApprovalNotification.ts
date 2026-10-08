import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import {
  DURABLE_INBOX_POLL_MS,
  durableInboxRetryDelay,
  durableRowToInboxInput,
  readServerIdsToSync,
  type DurableInboxRow,
} from "@/lib/notification-delivery";

/**
 * Bridges durable `user_inbox_notifications` into the dashboard bell inbox.
 * Covers account approval, engagement alerts, and any other server-written rows.
 * Existing localStorage/poll hooks remain; this is the shared durable channel.
 */
export function useDurableInboxNotifications(
  userId: string | undefined,
  role: string | undefined,
) {
  const { addNotification, items } = useNotificationInbox();
  const queryClient = useQueryClient();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const syncedReadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ids = readServerIdsToSync(items, syncedReadRef.current);
    if (!userId || ids.length === 0) return;
    for (const id of ids) syncedReadRef.current.add(id);
    void supabase
      .from("user_inbox_notifications")
      .update({ read: true })
      .in("id", ids)
      .eq("user_id", userId)
      .then(({ error }) => {
        if (!error) return;
        for (const id of ids) syncedReadRef.current.delete(id);
        console.warn("useDurableInboxNotifications: mark read failed");
      });
  }, [items, userId]);

  useEffect(() => {
    if (!userId || !role) return;

    let cancelled = false;
    let retryTimer: number | undefined;

    const ingest = (rows: DurableInboxRow[]) => {
      const shown = new Set(
        itemsRef.current.map((item) => item.serverId).filter((id): id is string => Boolean(id)),
      );
      let added = 0;
      for (const row of rows) {
        const input = durableRowToInboxInput(row);
        if (!input || shown.has(input.serverId)) continue;
        shown.add(input.serverId);
        added += 1;
        addRef.current(input);
      }
      if (added > 0 && role === "guidance_counselor") {
        void queryClient.invalidateQueries({ queryKey: ["guidance-referrals", userId] });
      }
    };

    const load = async (attempt = 0) => {
      try {
        const { data, error } = await supabase
          .from("user_inbox_notifications")
          .select("id, title, body, source_name")
          .eq("user_id", userId)
          .eq("read", false)
          .order("created_at", { ascending: false })
          .limit(50);

        if (cancelled) return;
        if (error) {
          const delay = durableInboxRetryDelay(attempt);
          if (delay != null) {
            retryTimer = window.setTimeout(() => {
              void load(attempt + 1);
            }, delay);
          } else {
            console.warn("useDurableInboxNotifications:", error.message);
          }
          return;
        }
        if (data?.length) ingest(data as DurableInboxRow[]);
      } catch (e) {
        if (cancelled) return;
        const delay = durableInboxRetryDelay(attempt);
        if (delay != null) {
          retryTimer = window.setTimeout(() => {
            void load(attempt + 1);
          }, delay);
        } else {
          console.warn("useDurableInboxNotifications:", e);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, DURABLE_INBOX_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

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
          const row = payload.new as DurableInboxRow & { read?: boolean };
          if (!row?.id || row.read) return;
          ingest([row]);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [userId, role, queryClient]);
}

/** @deprecated Prefer useDurableInboxNotifications — kept for existing imports. */
export const useAccountApprovalNotification = useDurableInboxNotifications;
