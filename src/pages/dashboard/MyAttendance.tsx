import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MyAttendance() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">My Attendance</h1>
      <Card>
        <CardHeader><CardTitle>Attendance Records</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">View your attendance history across subjects. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
