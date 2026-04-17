import { Outlet, Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useEdgeRealtimeNotifications } from "@/hooks/useEdgeRealtimeNotifications";
import { useStudentInboxPoll } from "@/hooks/useStudentInboxPoll";
import { NotificationInboxProvider } from "@/contexts/NotificationInboxContext";
import { NotificationInboxTrigger } from "@/components/NotificationInboxTrigger";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap } from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICoachPopup } from "@/components/AICoachPopup";

type StudentPredictionContext = {
  riskLevel: string | null;
  recommendation: string | null;
  subjectLabel: string | null;
  atRiskSubjects: string[];
};

const RISK_PRIORITY: Record<string, number> = {
  excelling: 0,
  stable: 1,
  at_risk: 2,
  critical: 3,
};

function normalizeRisk(level: unknown): "critical" | "at_risk" | "stable" | "excelling" {
  if (typeof level !== "string") return "stable";
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "critical") return "critical";
  if (normalized === "at_risk" || normalized === "at-risk" || normalized === "atrisk") return "at_risk";
  if (normalized === "excelling") return "excelling";
  return "stable";
}

function predictionDateTs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function DashboardHeader() {
  const { state } = useSidebar();
  const isSidebarOpen = state === "expanded";

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center border-b border-border/70 bg-card/80 backdrop-blur-md px-4 md:px-6 shadow-sm">
      <div className="flex items-center gap-3 md:gap-4">
        <div className="md:hidden">
          <SidebarTrigger aria-label="Open navigation" />
        </div>
        {!isSidebarOpen && (
          <>
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sidebar-primary to-violet-500 flex items-center justify-center flex-shrink-0 shadow-sm">
              <GraduationCap className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground font-display leading-none">
              EDGE – Student Risk Analysis and AI Coaching System
            </h2>
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        {/* Slot for the AI Coach trigger so it stays in the header (not covering content) */}
        <div id="ai-coach-header-slot" className="inline-flex items-center" />
        <NotificationInboxTrigger />
        <div className="hidden sm:block h-6 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/65 px-2.5 py-1">
          <div className="status-dot bg-green-500 animate-pulse-glow" />
          <span className="text-base text-muted-foreground">System Active</span>
        </div>
      </div>
    </header>
  );
}

function DashboardShell({ userId, role }: { userId: string; role: AppRole | null }) {
  useEdgeRealtimeNotifications(userId, role ?? undefined);
  useStudentInboxPoll(userId, role ?? undefined);

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
        return { riskLevel: null, recommendation: null, subjectLabel: null, atRiskSubjects: [] };
      }

      const { data, error } = await supabase
        .from("predictions")
        .select("risk_level, recommendation, created_at, subject_id, subjects(code, name)")
        .eq("student_id", userId)
        .in("subject_id", enrolledSubjectIds)
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;
      if (!data?.length) {
        return { riskLevel: null, recommendation: null, subjectLabel: null, atRiskSubjects: [] };
      }

      const bySubject = new Map<string, any>();
      for (const row of data as any[]) {
        const sid = typeof row?.subject_id === "string" ? row.subject_id : null;
        if (!sid || bySubject.has(sid)) continue;
        bySubject.set(sid, row);
      }

      const latestPerSubject = Array.from(bySubject.values());
      if (latestPerSubject.length === 0) {
        return { riskLevel: null, recommendation: null, subjectLabel: null, atRiskSubjects: [] };
      }

      const ranked = [...latestPerSubject].sort((a: any, b: any) => {
        const pa = RISK_PRIORITY[normalizeRisk(a?.risk_level)] ?? 1;
        const pb = RISK_PRIORITY[normalizeRisk(b?.risk_level)] ?? 1;
        if (pa !== pb) return pb - pa;
        return predictionDateTs(b?.created_at) - predictionDateTs(a?.created_at);
      });

      const focus = ranked[0];
      const focusRisk = normalizeRisk(focus?.risk_level);
      const focusedSubjects = ranked.filter((p: any) => {
        const level = normalizeRisk(p?.risk_level);
        return level === "critical" || level === "at_risk";
      });
      const subjectsToMention = focusedSubjects.length > 0 ? focusedSubjects : ranked.slice(0, 3);

      const subjectLabel =
        focusedSubjects.length > 1
          ? `${focusedSubjects.length} subjects need attention`
          : focus?.subjects?.code
            ? `${focus.subjects.code} — ${focus.subjects?.name ?? ""}`.trim()
            : null;

      const recommendationLines = subjectsToMention.map((p: any) => {
        const code = p?.subjects?.code ?? "Subject";
        const level = normalizeRisk(p?.risk_level);
        const rec = typeof p?.recommendation === "string" ? p.recommendation.trim() : "";
        const riskText =
          level === "critical"
            ? "critical"
            : level === "at_risk"
              ? "at risk"
              : level === "excelling"
                ? "excelling"
                : "stable";
        return `${code} (${riskText})${rec ? `: ${rec}` : ""}`;
      });

      const atRiskSubjects = focusedSubjects
        .map((p: any) => {
          const code = typeof p?.subjects?.code === "string" ? p.subjects.code : "Subject";
          const name = typeof p?.subjects?.name === "string" ? p.subjects.name : "";
          const level = normalizeRisk(p?.risk_level) === "critical" ? "Critical" : "At Risk";
          return `${code}${name ? ` — ${name}` : ""} (${level})`;
        })
        .slice(0, 6);

      return {
        riskLevel: focusRisk,
        subjectLabel,
        atRiskSubjects,
        recommendation:
          recommendationLines.length > 0
            ? `Cross-subject status:\n${recommendationLines.join("\n")}`
            : null,
      };
    },
  });

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-app flex w-full app-shell-bg">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <DashboardHeader />
          <AICoachPopup
            riskLevel={coachContext?.riskLevel ?? null}
            recommendation={coachContext?.recommendation ?? null}
            subjectLabel={coachContext?.subjectLabel ?? null}
            atRiskSubjects={coachContext?.atRiskSubjects ?? []}
            storageKey="edge_ai_coach_dismissed_dashboard_header_v1"
            variant="compact"
          />
          <main className="flex-1 overflow-auto p-4 sm:p-5 md:p-6">
            <div className="content-grid animate-fade-in">
              <Outlet />
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
