import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Insights() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Performance Insights</h1>
      <Card>
        <CardHeader><CardTitle>AI-Powered Analysis</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">View your academic risk predictions and personalized recommendations. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
