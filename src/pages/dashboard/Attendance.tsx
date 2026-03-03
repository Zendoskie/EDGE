import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Attendance() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Attendance</h1>
      <Card>
        <CardHeader><CardTitle>Record Attendance</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Track student attendance per subject. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
