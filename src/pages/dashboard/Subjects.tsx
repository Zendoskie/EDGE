import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Subjects() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Subjects</h1>
      <Card>
        <CardHeader><CardTitle>Manage Subjects</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Create subjects and assign them to programs. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
