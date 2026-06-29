import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import InstructorDashboard from './InstructorDashboard';
import StudentDashboard from './StudentDashboard';

export default function DashboardHome() {
  const { user, role, loading } = useAuth();

  if (loading || (user && role === null)) {
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

  if (role === 'admin') return <Navigate to="/dashboard/admin/approvals" replace />;
  if (role === 'guidance_counselor') return <Navigate to="/dashboard/guidance-referrals" replace />;
  if (role === 'parent') return <Navigate to="/dashboard/parent-performance" replace />;
  if (role === 'instructor') return <InstructorDashboard />;
  return <StudentDashboard />;
}
