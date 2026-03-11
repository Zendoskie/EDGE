import { Outlet, Navigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { GraduationCap } from 'lucide-react';

function DashboardHeader() {
  const { state } = useSidebar();
  const isSidebarOpen = state === 'expanded';

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
        <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse-glow"></div>
        <span className="text-sm text-muted-foreground">System Active</span>
      </div>
    </header>
  );
}

export default function DashboardLayout() {
  const { user, loading } = useAuth();

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
