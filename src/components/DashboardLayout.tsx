import { Outlet, Navigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

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
          <header className="h-16 flex items-center border-b bg-card/80 backdrop-blur-sm px-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-sm">AG</span>
              </div>
              <h2 className="text-lg font-semibold text-foreground font-display">
                Academic Risk Analysis & Early Warning System
              </h2>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse-glow"></div>
              <span className="text-sm text-muted-foreground">System Active</span>
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
