import { useEffect, useState } from "react";
import { Navigate, useNavigate, useOutlet } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar, navItemsForRole } from "@/components/AppSidebar";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { useAuth } from "@/hooks/useAuth";
import { useEdgeRealtimeNotifications } from "@/hooks/useEdgeRealtimeNotifications";
import { useStudentInboxPoll } from "@/hooks/useStudentInboxPoll";
import { useInstructorRealtimeNotifications } from "@/hooks/useInstructorRealtimeNotifications";
import { useInstructorInboxPoll } from "@/hooks/useInstructorInboxPoll";
import { useReferralRealtime } from "@/hooks/useReferralRealtime";
import { useReferralInboxPoll } from "@/hooks/useReferralInboxPoll";
import { useParentLinkRealtime } from "@/hooks/useParentLinkRealtime";
import { useParentLinkInboxPoll } from "@/hooks/useParentLinkInboxPoll";
import { useEngagementSummaryRealtime } from "@/hooks/useEngagementSummaryRealtime";
import { useStudentSessionTracking } from "@/hooks/useStudentSessionTracking";
import { useEngagementFeedbackRealtime } from "@/hooks/useEngagementFeedbackRealtime";
import { useAdminPendingUsersPoll } from "@/hooks/useAdminPendingUsersPoll";
import { useAdminStaffRequestsPoll } from "@/hooks/useAdminStaffRequestsPoll";
import { useDurableInboxNotifications } from "@/hooks/useAccountApprovalNotification";
import { NotificationInboxProvider } from "@/contexts/NotificationInboxContext";
import { NotificationInboxTrigger } from "@/components/NotificationInboxTrigger";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { GraduationCap } from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICoachPopup } from "@/components/AICoachPopup";
import ErrorBoundary from "@/components/ErrorBoundary";
import { shouldShowHeaderAiCoach } from "@/lib/dashboard-role-features";
import {
  buildStudentCoachingContext,
  formatAtRiskSubjectLabels,
  formatSubjectLabel,
  type SubjectCoachingMetrics,
} from "@/lib/coaching-context";
import { useStudentEnrolledSubjectIds } from "@/hooks/useStudentEnrolledSubjectIds";

type StudentPredictionContext = {
  riskLevel: string | null;
  subjectLabel: string | null;
  atRiskSubjects: string[];
  metrics: SubjectCoachingMetrics | null;
  coachingSubjects: SubjectCoachingMetrics[];
};

function AnimatedDashboardOutlet() {
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();

  // Keep the outlet mounted across routes so React Query caches survive navigation.
  return (
    <motion.div
      key="dashboard-outlet"
      initial={false}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <ErrorBoundary>{outlet}</ErrorBoundary>
    </motion.div>
  );
}

function DashboardHeader() {
  const { state } = useSidebar();
  const isSidebarOpen = state === "expanded";
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const initials = (user?.email ?? "E").slice(0, 1).toUpperCase();

  return (
    <header className="sticky top-0 z-30 mx-3 mt-3 flex h-[60px] items-center gap-2 overflow-hidden rounded-[22px] border border-border bg-card px-3 shadow-[0_16px_40px_-28px_hsl(234_60%_40%/0.45)] sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 md:gap-4">
        <div className="flex shrink-0 md:hidden">
          <SidebarTrigger aria-label="Open navigation" />
        </div>
        {!isSidebarOpen && (
          <>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-primary">
              <GraduationCap className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1 pr-1">
              <h2
                aria-label="EDGE – Student Risk Analysis and AI Coaching System"
                className="truncate font-display text-base font-semibold leading-tight text-foreground sm:text-lg"
                title="EDGE – Student Risk Analysis and AI Coaching System"
              >
                <span className="md:hidden" aria-hidden="true">
                  EDGE
                </span>
                <span className="hidden md:inline" aria-hidden="true">
                  EDGE – Student Risk Analysis and AI Coaching System
                </span>
              </h2>
            </div>
          </>
        )}
      </div>
      <form
        className="hidden min-w-0 flex-1 md:block"
        onSubmit={(event) => {
          event.preventDefault();
          const needle = query.trim().toLowerCase();
          if (!needle) return;
          const match = navItemsForRole(role).find((item) => item.title.toLowerCase().includes(needle));
          if (match) navigate(match.url);
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages"
          aria-label="Search pages"
          className="h-9 bg-muted/50"
        />
      </form>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {/* Slot for the AI Coach trigger so it stays in the header (not covering content) */}
        <div id="ai-coach-header-slot" className="inline-flex shrink-0 items-center" />
        <NotificationInboxTrigger />
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary" aria-hidden>
          {initials}
        </span>
      </div>
    </header>
  );
}

function useDeferredCoachContext(enabled: boolean) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => setReady(true), { timeout: 2_500 });
      return () => win.cancelIdleCallback?.(id);
    }

    const timer = window.setTimeout(() => setReady(true), 1_500);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  return ready;
}

function DashboardShell({ userId, role }: { userId: string; role: AppRole | null }) {
  useEdgeRealtimeNotifications(userId, role ?? undefined);
  useStudentInboxPoll(userId, role ?? undefined);
  useInstructorRealtimeNotifications(userId, role ?? undefined);
  useInstructorInboxPoll(userId, role ?? undefined);
  useReferralRealtime(userId, role ?? undefined);
  useReferralInboxPoll(userId, role ?? undefined);
  useParentLinkRealtime(userId, role ?? undefined);
  useParentLinkInboxPoll(userId, role ?? undefined);
  useEngagementSummaryRealtime();
  useStudentSessionTracking();
  useEngagementFeedbackRealtime(userId, role ?? undefined);
  useAdminPendingUsersPoll(userId, role ?? undefined);
  useAdminStaffRequestsPoll(userId, role ?? undefined);
  useDurableInboxNotifications(userId, role ?? undefined);

  const coachContextReady = useDeferredCoachContext(role === "student" && !!userId);
  const { data: enrolledSubjectIds = [], isFetched: enrollmentsFetched } = useStudentEnrolledSubjectIds(
    role === "student" ? userId : undefined,
  );

  const { data: coachContext } = useQuery<StudentPredictionContext>({
    queryKey: ["ai-coach-student-context", userId, enrolledSubjectIds],
    enabled: role === "student" && !!userId && coachContextReady && enrollmentsFetched,
    staleTime: 60_000,
    queryFn: async () => {
      if (enrolledSubjectIds.length === 0) {
        return { riskLevel: null, subjectLabel: null, atRiskSubjects: [], metrics: null, coachingSubjects: [] };
      }

      const { data, error } = await supabase
        .from("predictions")
        .select(
          "risk_level, risk_score, confidence, attendance_rate, activity_average, activity_completion_rate, quiz_average, laboratory_exam_average, comprehension_rating, recommendation, created_at, subject_id, subjects(code, name)",
        )
        .eq("student_id", userId)
        .in("subject_id", enrolledSubjectIds)
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;
      if (!data?.length) {
        return { riskLevel: null, subjectLabel: null, atRiskSubjects: [], metrics: null, coachingSubjects: [] };
      }

      const coaching = buildStudentCoachingContext(data as any[]);
      const focus = coaching.focusSubject;
      if (!focus) {
        return { riskLevel: null, subjectLabel: null, atRiskSubjects: [], metrics: null, coachingSubjects: [] };
      }

      const subjectLabel =
        coaching.atRiskSubjects.length > 1
          ? `${coaching.atRiskSubjects.length} subjects need attention`
          : formatSubjectLabel(focus);

      return {
        riskLevel: focus.riskClassification,
        subjectLabel,
        atRiskSubjects: formatAtRiskSubjectLabels(coaching.atRiskSubjects),
        metrics: focus,
        coachingSubjects: coaching.subjects,
      };
    },
  });

  const reduceMotion = useReducedMotion();

  return (
    <SidebarProvider defaultOpen={false}>
      <motion.div
        className="flex h-[100dvh] min-h-0 w-full min-w-0 flex-1 flex-col"
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
      <div className="peoplo-canvas flex h-full min-h-0 w-full flex-1 overflow-hidden">
        <AppSidebar />
        <div className="flex-1 min-h-0 flex flex-col">
          <DashboardHeader />
          {shouldShowHeaderAiCoach(role) ? (
            <AICoachPopup
              riskLevel={coachContext?.riskLevel ?? null}
              subjectLabel={coachContext?.subjectLabel ?? null}
              atRiskSubjects={coachContext?.atRiskSubjects ?? []}
              metrics={coachContext?.metrics ?? null}
              coachingSubjects={coachContext?.coachingSubjects ?? []}
              storageKey={`edge_ai_coach_dismissed_dashboard_header_v1:${userId}`}
              variant="compact"
            />
          ) : null}
          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pb-24 sm:p-4 md:p-5 md:pb-5">
            <div className="content-grid">
              <AnimatedDashboardOutlet />
            </div>
          </main>
          <MobileTabBar items={navItemsForRole(role)} />
        </div>
      </div>
      </motion.div>
    </SidebarProvider>
  );
}

export default function DashboardLayout() {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="w-64 h-8" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <NotificationInboxProvider userId={user.id}>
      <DashboardShell userId={user.id} role={role} />
    </NotificationInboxProvider>
  );
}
