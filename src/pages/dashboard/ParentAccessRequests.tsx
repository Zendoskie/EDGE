import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { ParentEmailMatchIndicator } from '@/components/ParentEmailMatchIndicator';
import { studentDecideParentRegistration, studentDecideParentRequest, type ParentLinkDecision } from '@/lib/parent-link-actions';
import { parentEmailsMatch } from '@/lib/parent-email-match';
import { parentLinkStatusBadgeVariant, parentLinkStatusLabel } from '@/lib/parent-link-status';

type ParentRequestRow = {
  id: string;
  parent_name: string;
  parent_email: string;
  student_id_no: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  source: 'registration' | 'link';
};

type HistoryRow = {
  id: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function ParentAccessRequests() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const { data: registeredParentEmail = null } = useQuery({
    queryKey: ['student-registered-parent-email', user?.id],
    enabled: role === 'student' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('parent_email')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.parent_email ?? null;
    },
  });

  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['student-parent-requests', user?.id],
    enabled: role === 'student' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select('id, status, requested_at, decided_at, parent_user_id, student_id_no')
        .eq('student_user_id', user!.id)
        .order('requested_at', { ascending: false });
      if (error) throw error;
      const parentIds = Array.from(new Set((data ?? []).map((r: any) => r.parent_user_id).filter(Boolean)));
      const { data: parentProfiles, error: profileError } = parentIds.length
        ? await supabase.from('profiles').select('user_id, full_name, email').in('user_id', parentIds)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const parentMap = new Map((parentProfiles ?? []).map((p: any) => [p.user_id, p]));
      const linkRows = (data ?? []).map((row: any): ParentRequestRow => ({
        ...row,
        parent_name: parentMap.get(row.parent_user_id)?.full_name ?? 'Unknown',
        parent_email: parentMap.get(row.parent_user_id)?.email ?? '',
        source: 'link',
      }));

      const { data: registrations, error: registrationError } = await (supabase as any)
        .from('parent_registration_requests')
        .select('id, full_name, email, student_id, status, submitted_at, student_decided_at')
        .eq('student_user_id', user!.id)
        .order('submitted_at', { ascending: false });
      if (registrationError) throw registrationError;

      const registrationRows = (registrations ?? []).map((row: any): ParentRequestRow => ({
        id: row.id,
        parent_name: row.full_name ?? 'Unknown',
        parent_email: row.email ?? '',
        student_id_no: row.student_id,
        status: row.status,
        requested_at: row.submitted_at,
        decided_at: row.student_decided_at,
        source: 'registration',
      }));

      return [...registrationRows, ...linkRows].sort(
        (a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
      );
    },
  });

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['student-parent-request-history', user?.id],
    enabled: role === 'student' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_link_request_history')
        .select('id, status, created_at, decided_at, decided_by, note')
        .eq('student_user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as HistoryRow[];
    },
  });

  const decideParentRequest = useMutation({
    mutationFn: ({ linkId, decision, source }: { linkId: string; decision: ParentLinkDecision; source: 'registration' | 'link' }) =>
      source === 'registration'
        ? studentDecideParentRegistration(linkId, decision)
        : studentDecideParentRequest(linkId, decision),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['student-parent-requests', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['student-parent-request-history', user?.id] });
      toast.success(
        vars.decision === 'approve'
          ? 'Request approved. An administrator will review it next.'
          : 'Parent request rejected'
      );
    },
    onError: (e: Error) => {
      toast.error(e.message);
      void queryClient.invalidateQueries({ queryKey: ['student-parent-requests', user?.id] });
    },
  });

  if (role !== 'student') {
    return (
      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            Parent access requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This page is available to student accounts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-6 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Parent Access Requests</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Parents request access with your Student ID. Review the parent&apos;s name and email before deciding. After you approve, an administrator must also approve. The parent then creates a password from an email before they can view your records.
            </p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90 w-full min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            Requests
            {pendingCount > 0 ? (
              <Badge variant="secondary" className="ml-1">{pendingCount} pending</Badge>
            ) : null}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Approve only a parent/guardian you recognize. Approved requests go to an administrator for final approval.
          </p>
        </CardHeader>
        <CardContent>
          {requestsLoading ? (
            <p className="text-sm text-muted-foreground">Loading parent requests…</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parent/guardian requests yet.</p>
          ) : (
            <>
              <ul className="divide-y divide-border/60 md:hidden">
                {requests.map((r) => (
                  <li key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0 min-w-0">
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Parent / Guardian</p>
                      <p className="font-medium break-words">{r.parent_name}</p>
                      <p className="text-xs text-muted-foreground break-all">{r.parent_email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">ID used: {r.student_id_no}</span>
                      <Badge variant={parentLinkStatusBadgeVariant(r.status)}>
                        {parentLinkStatusLabel(r.status)}
                      </Badge>
                    </div>
                    <span className="block text-xs text-muted-foreground">Requested {formatDate(r.requested_at)}</span>
                    {r.status === 'pending' ? (
                      <div className="flex flex-col gap-2">
                        <ParentEmailMatchIndicator registeredEmail={registeredParentEmail} requestEmail={r.parent_email} />
                        <Button size="sm" className="w-full" onClick={() => decideParentRequest.mutate({ linkId: r.id, decision: 'approve', source: r.source })} disabled={decideParentRequest.isPending || !parentEmailsMatch(registeredParentEmail, r.parent_email)}>Approve</Button>
                        <Button size="sm" variant="outline" className="w-full" onClick={() => decideParentRequest.mutate({ linkId: r.id, decision: 'reject', source: r.source })} disabled={decideParentRequest.isPending}>Reject</Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Decided {formatDate(r.decided_at)}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="hidden rounded-xl border border-border/50 md:block md:overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parent / Guardian</TableHead>
                      <TableHead>Student ID used</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.parent_name}</div>
                          <div className="text-xs text-muted-foreground">{r.parent_email}</div>
                        </TableCell>
                        <TableCell>{r.student_id_no}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(r.requested_at)}</TableCell>
                        <TableCell>
                          <Badge variant={parentLinkStatusBadgeVariant(r.status)}>{parentLinkStatusLabel(r.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === 'pending' ? (
                            <div className="flex flex-col items-end gap-2">
                              <ParentEmailMatchIndicator registeredEmail={registeredParentEmail} requestEmail={r.parent_email} />
                              <div className="flex justify-end gap-2 flex-wrap">
                                <Button size="sm" onClick={() => decideParentRequest.mutate({ linkId: r.id, decision: 'approve', source: r.source })} disabled={decideParentRequest.isPending || !parentEmailsMatch(registeredParentEmail, r.parent_email)}>Approve</Button>
                                <Button size="sm" variant="outline" onClick={() => decideParentRequest.mutate({ linkId: r.id, decision: 'reject', source: r.source })} disabled={decideParentRequest.isPending}>Reject</Button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Decided {formatDate(r.decided_at)}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/90 w-full min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            Request history
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Every request, approval, rejection, and re-submission is recorded here.
          </p>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <p className="text-sm text-muted-foreground">Loading history…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parent/guardian request history yet.</p>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(h.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant={parentLinkStatusBadgeVariant(h.status)}>
                          {parentLinkStatusLabel(h.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{h.note || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
