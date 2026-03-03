import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Activities() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Activities</h1>
      <Card>
        <CardHeader><CardTitle>Quizzes, Assignments & Projects</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Create activities and input scores. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
