import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, MessageSquare } from 'lucide-react';

export default function Insights() {
  const { user } = useAuth();

  const { data: predictions = [], isLoading } = useQuery({
    queryKey: ['my-predictions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('predictions')
        .select('*, subjects(id, code, name)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const { data: interventions = [] } = useQuery({
    queryKey: ['my-interventions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('interventions')
        .select('id, type, message, sent_at, subject_id, subjects(code, name)')
        .eq('student_id', user.id)
        .order('sent_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.id,
  });

  const riskLabel = (level: string) => {
    if (level === 'critical') return 'Critical';
    if (level === 'at_risk') return 'At Risk';
    if (level === 'excelling') return 'Excelling';
    return 'Stable';
  };

  const riskVariant = (level: string): 'destructive' | 'default' | 'secondary' => {
    if (level === 'critical' || level === 'at_risk') return 'destructive';
    if (level === 'excelling') return 'default';
    return 'secondary';
  };

  const latestBySubject = predictions.reduce((acc: Record<string, any>, p) => {
    const sid = p.subject_id;
    if (!acc[sid] || new Date(p.created_at) > new Date(acc[sid].created_at)) acc[sid] = p;
    return acc;
  }, {});

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-display font-bold">Performance Insights</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5" />
            AI-powered risk & recommendations
          </CardTitle>
          <p className="text-muted-foreground text-sm">Your academic risk level and personalized recommendations per subject (when your instructor runs predictions).</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : Object.keys(latestBySubject).length === 0 ? (
            <p className="text-muted-foreground text-sm">No predictions yet. Your instructor will run risk analysis per subject; your insights will appear here.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(latestBySubject).map(([, p]) => (
                <div key={p.id} className="border rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{(p.subjects as any)?.code} — {(p.subjects as any)?.name}</span>
                    <Badge variant={riskVariant(p.risk_level)}>{riskLabel(p.risk_level)}</Badge>
                  </div>
                  {p.recommendation && (
                    <p className="text-sm text-muted-foreground">{p.recommendation}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5" />
            Instructor interventions
          </CardTitle>
          <p className="text-muted-foreground text-sm">When your instructor logs outreach (e.g. email, meeting) for support, it will appear here.</p>
        </CardHeader>
        <CardContent>
          {interventions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No interventions recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {interventions.map((i: any) => (
                <li key={i.id} className="flex items-start gap-2 py-2 border-b border-border/50 last:border-0 text-sm">
                  <Badge variant="outline" className="capitalize shrink-0">{i.type}</Badge>
                  <div>
                    <span className="text-muted-foreground">{(i.subjects as any)?.code}</span>
                    {i.message && <p className="mt-0.5">{i.message}</p>}
                    <p className="text-xs text-muted-foreground">{i.sent_at ? new Date(i.sent_at).toLocaleString() : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
