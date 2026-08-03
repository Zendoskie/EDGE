import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";

const POLL_INTERVAL_MS = 60_000;
const SEEN_KEY_PREFIX = "edge_admin_staff_requests_seen_";

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
  return role;
}

/**
 * Admin-only poll: fires a dashboard inbox notification whenever a new pending
 * staff registration request arrives in staff_registration_requests.
 *
 * Mirrors the pattern of useAdminPendingUsersPoll but targets the
 * staff_registration_requests table (Phase 2 / Phase 3 workflow).
 *
 * Uses sessionStorage so the admin is not re-notified about requests
 * that were already pending when they logged in.
 */
export function useAdminStaffRequestsPoll(
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
        const { data, error } = await (supabase as any)
          .from("staff_registration_requests")
          .select("id, full_name, role")
          .eq("status", "pending");

        if (error || cancelled) return;

        const rows = (data ?? []) as Array<{ id: string; full_name: string; role: string }>;
        if (rows.length === 0) return;

        const isInitialSeed = seenRef.current.size === 0;
        const seen = new Set(seenRef.current);
        let changed = false;

        for (const row of rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            changed = true;
            if (!isInitialSeed) {
              addRef.current({
                title: "New Staff Account Request",
                body: `${row.full_name} has submitted a ${friendlyRole(row.role)} account request. Open User Approvals to review.`,
                dedupeKey: `admin-staff-request:${row.id}`,
              });
            }
          }
        }

        if (changed) {
          seenRef.current = seen;
          saveSeen(userId, seen);
        }
      } catch (e) {
        console.warn("useAdminStaffRequestsPoll:", e);
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
