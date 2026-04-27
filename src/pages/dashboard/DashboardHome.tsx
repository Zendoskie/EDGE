import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import InstructorDashboard from './InstructorDashboard';
import StudentDashboard from './StudentDashboard';

export default function DashboardHome() {
  const { role } = useAuth();

  if (role === 'admin') return <Navigate to="/dashboard/admin/approvals" replace />;
  if (role === 'guidance_counselor') return <Navigate to="/dashboard/guidance-referrals" replace />;
  if (role === 'parent') return <Navigate to="/dashboard/parent-performance" replace />;
  if (role === 'instructor') return <InstructorDashboard />;
  return <StudentDashboard />;
}
