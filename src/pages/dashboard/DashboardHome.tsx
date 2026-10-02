import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';

const InstructorDashboard = lazy(() => import('./InstructorDashboard'));
const StudentDashboard = lazy(() => import('./StudentDashboard'));
const AdminDashboard = lazy(() => import('./AdminDashboard'));

function DashboardHomeSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardHome() {
  const { user, role, loading } = useAuth();

  if (loading || (user && role === null)) {
    return <DashboardHomeSkeleton />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Suspense fallback={<DashboardHomeSkeleton />}>
      {role === 'admin' ? <AdminDashboard /> : null}
      {role === 'guidance_counselor' ? <Navigate to="/dashboard/guidance-referrals" replace /> : null}
      {role === 'parent' ? <Navigate to="/dashboard/parent-performance" replace /> : null}
      {role === 'instructor' ? <InstructorDashboard /> : null}
      {role === 'student' ? <StudentDashboard /> : null}
    </Suspense>
  );
}
