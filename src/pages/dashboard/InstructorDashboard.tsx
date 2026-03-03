import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, BookOpen, Brain, AlertTriangle } from 'lucide-react';

const stats = [
  { title: 'Total Students', value: '—', icon: Users, color: 'text-primary' },
  { title: 'Active Subjects', value: '—', icon: BookOpen, color: 'text-accent-foreground' },
  { title: 'Predictions Run', value: '—', icon: Brain, color: 'text-success' },
  { title: 'At-Risk Students', value: '—', icon: AlertTriangle, color: 'text-risk' },
];

export default function InstructorDashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold">Instructor Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your academic monitoring</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Predictions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No predictions have been run yet. Create subjects, enroll students, and record grades to begin.</p>
        </CardContent>
      </Card>
    </div>
  );
}
