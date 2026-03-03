import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Programs() {
  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Programs</h1>
      <Card>
        <CardHeader><CardTitle>Manage Programs</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Create and manage academic programs here. Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  );
}
