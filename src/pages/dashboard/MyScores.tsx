import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function MyScores() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">My Scores</h1>
      <Card>
        <CardHeader><CardTitle>Activity Scores</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">View your quiz, assignment, and project scores. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
