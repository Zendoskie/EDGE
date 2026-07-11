import { Outlet, Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
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
import { NotificationInboxProvider } from "@/contexts/NotificationInboxContext";
import { NotificationInboxTrigger } from "@/components/NotificationInboxTrigger";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap } from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICoachPopup } from "@/components/AICoachPopup";
import ErrorBoundary from "@/components/ErrorBoundary";
import {
  buildStudentCoachingContext,
  formatAtRiskSubjectLabels,
  formatSubjectLabel,
  type SubjectCoachingMetrics,
} from "@/lib/coaching-context";

type StudentPredictionContext = {
  riskLevel: string | null;
  subjectLabel: string | null;
  atRiskSubjects: string[];
  metrics: SubjectCoachingMetrics | null;
  coachingSubjects: SubjectCoachingMetrics[];
};

function DashboardHeader() {
  const { state } = useSidebar();
  const isSidebarOpen = state === "expanded";

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 overflow-hidden border-b border-border/70 bg-card/80 px-3 py-2 shadow-sm backdrop-blur-md sm:h-16 sm:min-h-0 sm:gap-3 sm:px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 md:gap-4">
        <div className="flex shrink-0 md:hidden">
          <SidebarTrigger aria-label="Open navigation" />
        </div>
        {!isSidebarOpen && (
          <>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-primary to-violet-500 shadow-sm">
              <GraduationCap className="h-4 w-4 text-sidebar-primary-foreground" />
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
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        {/* Slot for the AI Coach trigger so it stays in the header (not covering content) */}
        <div id="ai-coach-header-slot" className="inline-flex shrink-0 items-center" />
        <NotificationInboxTrigger />
        <div className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />
        <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/65 px-2 py-0.5 sm:gap-2 sm:px-2.5 sm:py-1">
          <div className="status-dot shrink-0 bg-green-500 animate-pulse-glow" />
          <span className="hidden text-sm text-muted-foreground sm:inline sm:text-base">System Active</span>
        </div>
      </div>
    </header>
  );
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

  const { data: coachContext } = useQuery<StudentPredictionContext>({
    queryKey: ["ai-coach-student-context", userId, role],
    enabled: role === "student" && !!userId,
    queryFn: async () => {
      const { data: enrollments, error: enrollmentError } = await supabase
        .from("enrollments")
        .select("subject_id")
        .eq("student_id", userId)
        .eq("status", "active");
      if (enrollmentError) throw enrollmentError;

      const enrolledSubjectIds = (enrollments ?? [])
        .map((row: any) => row?.subject_id as string | null)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

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

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-app h-[100dvh] flex w-full overflow-hidden app-shell-bg">
        <AppSidebar />
        <div className="flex-1 min-h-0 flex flex-col">
          <DashboardHeader />
          <AICoachPopup
            riskLevel={coachContext?.riskLevel ?? null}
            subjectLabel={coachContext?.subjectLabel ?? null}
            atRiskSubjects={coachContext?.atRiskSubjects ?? []}
            metrics={coachContext?.metrics ?? null}
            coachingSubjects={coachContext?.coachingSubjects ?? []}
            storageKey="edge_ai_coach_dismissed_dashboard_header_v1"
            variant="compact"
          />
          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5 md:p-6">
            <div className="content-grid animate-fade-in">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
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
