import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Predictions() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">AI Predictions</h1>
      <Card>
        <CardHeader><CardTitle>Academic Risk Analysis</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Run AI-powered predictions on student performance. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
