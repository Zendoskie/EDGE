import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MySubjects() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">My Subjects</h1>
      <Card>
        <CardHeader><CardTitle>Enrolled Subjects</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">View your enrolled subjects and course information. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
