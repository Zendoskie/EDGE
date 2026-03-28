import { Outlet, Navigate } from "react-router-dom";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { useEdgeRealtimeNotifications } from "@/hooks/useEdgeRealtimeNotifications";
import { useStudentInboxPoll } from "@/hooks/useStudentInboxPoll";
import { NotificationInboxProvider } from "@/contexts/NotificationInboxContext";
import { NotificationInboxTrigger } from "@/components/NotificationInboxTrigger";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap } from "lucide-react";
import type { AppRole } from "@/hooks/useAuth";

function DashboardHeader() {
  const { state } = useSidebar();
  const isSidebarOpen = state === "expanded";

  return (
    <header className="h-16 flex items-center border-b bg-card/80 backdrop-blur-sm px-6 shadow-sm">
      <div className="flex items-center gap-4">
        {!isSidebarOpen && (
          <>
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sidebar-primary to-sidebar-primary/80 flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground font-display leading-none">
              EDGE – Early Detection of Grade Evaluation
            </h2>
          </>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <NotificationInboxTrigger />
        <div className="hidden sm:block h-6 w-px bg-border" aria-hidden />
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse-glow" />
          <span className="text-sm text-muted-foreground">System Active</span>
        </div>
      </div>
    </header>
  );
}

function DashboardShell({ userId, role }: { userId: string; role: AppRole | null }) {
  useEdgeRealtimeNotifications(userId, role ?? undefined);
  useStudentInboxPoll(userId, role ?? undefined);

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <DashboardHeader />
          <main className="flex-1 p-6 overflow-auto">
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
