import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { normalizeReferralStatus, referralStatusLabel } from "@/lib/referral-utils";

const POLL_INTERVAL_MS = 90_000;
const SEEN_KEY_PREFIX = "edge_referral_poll_seen_";

function seenStorageKey(userId: string) {
  return `${SEEN_KEY_PREFIX}${userId}`;
}

function loadSeen(userId: string): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(seenStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveSeen(userId: string, map: Record<string, string>) {
  try {
    sessionStorage.setItem(seenStorageKey(userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function notificationForStatusChange(
  role: string,
  prevStatus: string | undefined,
  status: string,
): { title: string; body: string } | null {
  const normalized = normalizeReferralStatus(status);
  const wasPending = !prevStatus || normalizeReferralStatus(prevStatus) === "pending";

  if (role === "student") {
    if (!prevStatus) {
      return {
        title: "Counseling referral submitted",
        body: "Your instructor referred you for guidance counseling. Status: Pending.",
      };
    }
    if (wasPending && (normalized === "approved" || normalized === "rejected")) {
      return {
        title: `Counseling referral ${referralStatusLabel(normalized).toLowerCase()}`,
        body:
          normalized === "approved"
            ? "Your counseling referral was approved."
            : "Your counseling referral was not approved at this time.",
      };
    }
  }

  if (role === "instructor") {
    if (!prevStatus) {
      return {
        title: "Counseling referral submitted",
        body: "Referral sent to guidance counselor. Status: Pending.",
      };
    }
    if (wasPending && (normalized === "approved" || normalized === "rejected")) {
      return {
        title: `Referral ${referralStatusLabel(normalized).toLowerCase()}`,
        body:
          normalized === "approved"
            ? "Guidance counselor approved your counseling referral."
            : "Guidance counselor rejected your counseling referral.",
      };
    }
  }

  if (role === "guidance_counselor" && !prevStatus && normalized === "pending") {
    return {
      title: "New counseling referral",
      body: "An instructor submitted a counseling referral for your review.",
    };
  }

  return null;
}

/**
 * Polls counseling_referrals when Realtime is unavailable; detects status transitions for all roles.
 */
export function useReferralInboxPoll(userId: string | undefined, role: string | undefined) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const seenRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!userId || !role) return;
    if (!["student", "instructor", "guidance_counselor"].includes(role)) return;

    seenRef.current = loadSeen(userId);

    let cancelled = false;

    const poll = async () => {
      try {
        let query = supabase
          .from("counseling_referrals")
          .select("id, status, created_at")
          .order("created_at", { ascending: false })
          .limit(50);

        if (role === "student") query = query.eq("student_id", userId);
        else if (role === "instructor") query = query.eq("instructor_id", userId);

        const { data, error } = await query;
        if (error || cancelled) return;

        const seen = { ...seenRef.current };
        const isInitialSeed = Object.keys(seen).length === 0;
        let changed = false;

        for (const row of data ?? []) {
          const id = String((row as { id?: string }).id ?? "");
          const status = String((row as { status?: string }).status ?? "pending");
          const prev = seen[id];

          if (prev === undefined) {
            seen[id] = status;
            if (!isInitialSeed) {
              const msg = notificationForStatusChange(role, undefined, status);
              if (msg) {
                addRef.current({
                  ...msg,
                  dedupeKey: `referral-poll:${id}:${status}:new`,
                });
              }
            }
            changed = true;
            continue;
          }

          if (prev !== status) {
            const msg = notificationForStatusChange(role, prev, status);
            if (msg) {
              addRef.current({
                ...msg,
                dedupeKey: `referral-poll:${id}:${status}`,
              });
            }
            seen[id] = status;
            changed = true;
          }
        }

        if (changed) {
          seenRef.current = seen;
          saveSeen(userId, seen);
          if (role === "student") {
            void queryClient.invalidateQueries({ queryKey: ["student-counseling-referrals", userId] });
          } else if (role === "instructor") {
            void queryClient.invalidateQueries({ queryKey: ["instructor-counseling-referrals", userId] });
            void queryClient.invalidateQueries({ queryKey: ["counseling-referrals"] });
          } else {
            void queryClient.invalidateQueries({ queryKey: ["guidance-referrals", userId] });
          }
        }
      } catch (e) {
        console.warn("useReferralInboxPoll:", e);
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [userId, role, queryClient]);
}
