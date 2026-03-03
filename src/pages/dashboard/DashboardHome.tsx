import { useAuth } from '@/hooks/useAuth';
import InstructorDashboard from './InstructorDashboard';
import StudentDashboard from './StudentDashboard';

export default function DashboardHome() {
  const { role } = useAuth();

  if (role === 'instructor') return <InstructorDashboard />;
  return <StudentDashboard />;
}
