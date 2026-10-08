import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { idsToAnnounce } from "@/lib/notification-delivery";

const POLL_INTERVAL_MS = 120_000;
const SEEN_KEY_PREFIX = "edge_admin_pending_poll_seen_";

function seenStorageKey(userId: string) {
  return `${SEEN_KEY_PREFIX}${userId}`;
}

function loadSeen(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(userId: string, seen: Set<string>) {
  try {
    localStorage.setItem(seenStorageKey(userId), JSON.stringify([...seen]));
  } catch {
    /* ignore storage errors */
  }
}

function friendlyRole(role: string): string {
  if (role === "instructor") return "Instructor";
  if (role === "guidance_counselor") return "Guidance Counselor";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Admin-only poll: fires a dashboard inbox notification when a new instructor
 * or guidance counselor account is waiting for approval.
 *
 * Remembers announced user ids in localStorage. A pending account is announced
 * the first time it is seen, including accounts that were already pending at login.
 */
export function useAdminPendingUsersPoll(
  userId: string | undefined,
  role: string | undefined,
) {
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || role !== "admin") return;

    seenRef.current = loadSeen(userId);
    let cancelled = false;

    const poll = async () => {
      try {
        // 1. Get all pending profiles.
        const { data: profiles, error: profErr } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("account_status", "pending");
        if (profErr || cancelled) return;

        const pendingIds = (profiles ?? []).map((p) => (p as { user_id: string }).user_id);
        if (pendingIds.length === 0) return;

        // 2. Filter to instructor / guidance_counselor only.
        const { data: rolesRows } = await supabase
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", pendingIds)
          .in("role", ["instructor", "guidance_counselor"]);
        if (cancelled) return;

        const seen = new Set(seenRef.current);
        const rows = (rolesRows ?? []) as Array<{ user_id: string; role: string }>;
        const announce = new Set(idsToAnnounce(seen, rows.map((row) => row.user_id)));
        let changed = false;

        for (const row of rows) {
          if (!announce.has(row.user_id)) continue;
          seen.add(row.user_id);
          changed = true;
          addRef.current({
            title: "New Registration Pending",
            body: `A new ${friendlyRole(row.role)} account is awaiting approval. Open User Approvals to review.`,
            dedupeKey: `admin-pending-user:${row.user_id}`,
            sourceName: "EDGE System",
          });
        }

        if (changed) {
          seenRef.current = seen;
          saveSeen(userId, seen);
        }
      } catch (e) {
        console.warn("useAdminPendingUsersPoll:", e);
      }
    };

    void poll();
    const intervalId = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [userId, role]);
}
