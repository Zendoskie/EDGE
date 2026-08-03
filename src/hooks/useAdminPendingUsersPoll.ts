import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";

const POLL_INTERVAL_MS = 60_000;
const SEEN_KEY_PREFIX = "edge_admin_pending_poll_seen_";

function seenStorageKey(userId: string) {
  return `${SEEN_KEY_PREFIX}${userId}`;
}

function loadSeen(userId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(seenStorageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(userId: string, seen: Set<string>) {
  try {
    sessionStorage.setItem(seenStorageKey(userId), JSON.stringify([...seen]));
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
 * Uses sessionStorage to track which pending users have already been announced
 * so the admin is not notified about users who were pending before they logged in.
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

        const isInitialSeed = seenRef.current.size === 0;
        const seen = new Set(seenRef.current);
        let changed = false;

        for (const row of rolesRows ?? []) {
          const uid = (row as { user_id: string }).user_id;
          const r = (row as { role: string }).role;
          if (!seen.has(uid)) {
            seen.add(uid);
            changed = true;
            if (!isInitialSeed) {
              addRef.current({
                title: "New Registration Pending",
                body: `A new ${friendlyRole(r)} account is awaiting approval. Open User Approvals to review.`,
                dedupeKey: `admin-pending-user:${uid}`,
              });
            }
          }
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
