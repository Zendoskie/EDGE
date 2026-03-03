import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Students() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Students</h1>
      <Card>
        <CardHeader><CardTitle>Student Management</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">View and manage enrolled students. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
