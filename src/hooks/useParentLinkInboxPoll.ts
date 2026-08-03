import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import {
  normalizeParentLinkStatus,
  parentLinkDecisionNotification,
  studentParentRequestNotification,
} from "@/lib/parent-link-notifications";

const POLL_INTERVAL_MS = 90_000;
const SEEN_KEY_PREFIX = "edge_parent_link_poll_seen_";

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

async function fetchProfileName(userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.full_name?.trim() || data?.email?.trim() || "Unknown";
}

function notificationForStatusChange(
  role: string,
  prevStatus: string | undefined,
  status: string,
  opts: { linkId: string; parentName: string; studentName: string },
): { title: string; body: string } | null {
  const normalized = normalizeParentLinkStatus(status);
  const wasPending = !prevStatus || normalizeParentLinkStatus(prevStatus) === "pending";

  if (role === "student") {
    if ((!prevStatus || normalizeParentLinkStatus(prevStatus) === "rejected") && normalized === "pending") {
      return studentParentRequestNotification({
        linkId: opts.linkId,
        parentName: opts.parentName,
      });
    }
    return null;
  }

  if (role === "parent" && wasPending && (normalized === "approved" || normalized === "rejected")) {
    return parentLinkDecisionNotification({
      linkId: opts.linkId,
      status: normalized,
      studentName: opts.studentName,
    });
  }

  return null;
}

/**
 * Polls parent_student_links when Realtime is unavailable; detects new requests and status transitions.
 */
export function useParentLinkInboxPoll(userId: string | undefined, role: string | undefined) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationInbox();
  const addRef = useRef(addNotification);
  addRef.current = addNotification;
  const seenRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!userId || !role) return;
    if (role !== "student" && role !== "parent") return;

    seenRef.current = loadSeen(userId);

    let cancelled = false;

    const poll = async () => {
      try {
        let query = supabase
          .from("parent_student_links")
          .select("id, status, parent_user_id, student_user_id, requested_at")
          .order("requested_at", { ascending: false })
          .limit(50);

        if (role === "student") query = query.eq("student_user_id", userId);
        else query = query.eq("parent_user_id", userId);

        const { data, error } = await query;
        if (error || cancelled) return;

        const seen = { ...seenRef.current };
        const isInitialSeed = Object.keys(seen).length === 0;
        let changed = false;

        const profileNameCache = new Map<string, string>();

        const getName = async (profileUserId: string) => {
          if (profileNameCache.has(profileUserId)) return profileNameCache.get(profileUserId)!;
          const name = await fetchProfileName(profileUserId);
          profileNameCache.set(profileUserId, name);
          return name;
        };

        for (const row of data ?? []) {
          const id = String((row as { id?: string }).id ?? "");
          const status = String((row as { status?: string }).status ?? "pending");
          const parentUserId = String((row as { parent_user_id?: string }).parent_user_id ?? "");
          const studentUserId = String((row as { student_user_id?: string }).student_user_id ?? "");
          // Use requested_at to differentiate request cycles; prevents duplicate notification
          // suppression when a parent re-requests and is rejected a second time.
          const requestedAt = String((row as { requested_at?: string }).requested_at ?? "");
          const prev = seen[id];

          const parentName = parentUserId ? await getName(parentUserId) : "A parent/guardian";
          const studentName = studentUserId ? await getName(studentUserId) : "the student";

          // Key includes requestedAt so that re-request cycles produce distinct seen entries.
          const seenValue = `${status}:${requestedAt}`;

          if (prev === undefined) {
            seen[id] = seenValue;
            if (!isInitialSeed) {
              const msg = notificationForStatusChange(role, undefined, status, {
                linkId: id,
                parentName,
                studentName,
              });
              if (msg) {
                addRef.current({
                  ...msg,
                  dedupeKey: `parent-link-poll:${id}:${status}:${requestedAt}:new`,
                });
              }
            }
            changed = true;
            continue;
          }

          if (prev !== seenValue) {
            // Extract the previously stored status (before the colon) for transition detection.
            const prevStatus = prev?.split(":")[0];
            const msg = notificationForStatusChange(role, prevStatus, status, {
              linkId: id,
              parentName,
              studentName,
            });
            if (msg) {
              addRef.current({
                ...msg,
                dedupeKey: `parent-link-poll:${id}:${status}:${requestedAt}`,
              });
            }
            seen[id] = seenValue;
            changed = true;
          }
        }

        if (changed) {
          seenRef.current = seen;
          saveSeen(userId, seen);
          if (role === "student") {
            void queryClient.invalidateQueries({ queryKey: ["student-parent-requests", userId] });
            void queryClient.invalidateQueries({ queryKey: ["student-parent-request-history", userId] });
          } else {
            void queryClient.invalidateQueries({ queryKey: ["parent-latest-link", userId] });
            void queryClient.invalidateQueries({ queryKey: ["parent-approved-link", userId] });
            void queryClient.invalidateQueries({ queryKey: ["parent-my-links", userId] });
          }
        }
      } catch (e) {
        console.warn("useParentLinkInboxPoll:", e);
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
