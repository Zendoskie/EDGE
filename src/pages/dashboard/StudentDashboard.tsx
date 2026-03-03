import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen, CalendarCheck, BarChart3, Brain } from 'lucide-react';

const stats = [
  { title: 'Enrolled Subjects', value: '—', icon: BookOpen, color: 'text-primary' },
  { title: 'Attendance Rate', value: '—', icon: CalendarCheck, color: 'text-success' },
  { title: 'Overall Average', value: '—', icon: BarChart3, color: 'text-accent-foreground' },
  { title: 'Risk Status', value: '—', icon: Brain, color: 'text-muted-foreground' },
];

export default function StudentDashboard() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold">Student Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Your academic performance at a glance</p>
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
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No activity yet. Your performance data will appear here once your instructor records grades.</p>
        </CardContent>
      </Card>
    </div>
  );
}
