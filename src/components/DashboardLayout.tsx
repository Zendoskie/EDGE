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

function DashboardHeader() {
  const { state } = useSidebar();
  const isSidebarOpen = state === "expanded";

  return (
    <header className="h-16 flex items-center border-b bg-card/80 backdrop-blur-sm px-4 md:px-6 shadow-sm">
      <div className="flex items-center gap-3 md:gap-4">
        <div className="md:hidden">
          <SidebarTrigger aria-label="Open navigation" />
        </div>
        {!isSidebarOpen && (
          <>
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 flex items-center justify-center flex-shrink-0">
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
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse-glow" />
          <span className="text-base text-muted-foreground">System Active</span>
        </div>
      </div>
    </header>
  );
}

function DashboardShell({ userId, role }: { userId: string; role: AppRole | null }) {
  useEdgeRealtimeNotifications(userId, role ?? undefined);
  useStudentInboxPoll(userId, role ?? undefined);

  const { data: latestPrediction } = useQuery({
    queryKey: ["ai-coach-latest-prediction", userId, role],
    enabled: role === "student" && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("predictions")
        .select("risk_level, recommendation, created_at, subjects(code, name)")
        .eq("student_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <DashboardHeader />
          <AICoachPopup
            riskLevel={(latestPrediction as any)?.risk_level ?? null}
            recommendation={(latestPrediction as any)?.recommendation ?? null}
            subjectLabel={(latestPrediction as any)?.subjects?.code
              ? `${(latestPrediction as any)?.subjects?.code} — ${(latestPrediction as any)?.subjects?.name ?? ""}`.trim()
              : null}
            storageKey="edge_ai_coach_dismissed_dashboard_header_v1"
            variant="compact"
          />
          <main className="flex-1 p-4 sm:p-6 md:p-6 overflow-auto">
            <Outlet />
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
