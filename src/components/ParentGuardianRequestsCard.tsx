import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { UserCheck, UserX } from 'lucide-react';
import { adminDecideParentRequest, adminReviewParentRequest, type ParentLinkDecision } from '@/lib/parent-link-actions';
import { sendStaffInvitation } from '@/lib/invoke-staff-invitation';
import { getPublicAppUrl } from '@/lib/app-url';
import {
  adminApprovalState,
  approvalStepLabel,
  parentLinkStatusBadgeVariant,
  parentLinkStatusLabel,
  studentApprovalState,
  type ApprovalStepState,
} from '@/lib/parent-link-status';

type RequestRow = {
  id: string;
  status: string;
  requested_at: string;
  student_id_no: string;
  parent_name: string;
  parent_email: string;
  student_name: string;
  source: 'registration' | 'link';
  completed: boolean;
};

type Filter = 'awaiting' | 'all';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function StepBadge({ state }: { state: ApprovalStepState }) {
  const variant = state === 'approved' ? 'default' : state === 'rejected' ? 'destructive' : state === 'pending' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{approvalStepLabel(state)}</Badge>;
}

/**
 * Step 2 of parent/guardian verification: requests the student already approved
 * wait here for an administrator's decision.
 */
export default function ParentGuardianRequestsCard() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('awaiting');
  const [inviteLinks, setInviteLinks] = useState<Array<{ id: string; email: string; url: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const visibleStatuses = filter === 'awaiting'
        ? ['pending_admin']
        : ['pending_admin', 'admin_rejected', 'approved'];
      let query = supabase
        .from('parent_student_links')
        .select('id, status, requested_at, student_id_no, parent_user_id, student_user_id')
        .in('status', visibleStatuses)
        .order('requested_at', { ascending: false })
        .limit(200);
      const { data: links, error } = await query;
      if (error) throw error;

      const { data: registrations, error: registrationError } = await (supabase as any)
        .from('parent_registration_requests')
        .select('id, status, submitted_at, student_id, full_name, email, student_name, completed_at')
        .in('status', visibleStatuses)
        .order('submitted_at', { ascending: false })
        .limit(200);
      if (registrationError) throw registrationError;

      const ids = Array.from(new Set((links ?? []).flatMap((l) => [l.parent_user_id, l.student_user_id])));
      const { data: profiles, error: pErr } = ids.length
        ? await supabase.from('profiles').select('user_id, full_name, email').in('user_id', ids)
        : { data: [], error: null };
      if (pErr) throw pErr;
      const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));

      const linkRows: RequestRow[] = (links ?? []).map((l) => ({
        id: l.id,
        status: l.status,
        requested_at: l.requested_at,
        student_id_no: l.student_id_no,
        parent_name: byId.get(l.parent_user_id)?.full_name || '—',
        parent_email: byId.get(l.parent_user_id)?.email || '—',
        student_name: byId.get(l.student_user_id)?.full_name || '—',
        source: 'link',
        completed: l.status === 'approved',
      }));
      const registrationRows: RequestRow[] = (registrations ?? []).map((r: any) => ({
        id: r.id,
        status: r.status,
        requested_at: r.submitted_at,
        student_id_no: r.student_id,
        parent_name: r.full_name || '—',
        parent_email: r.email || '—',
        student_name: r.student_name || '—',
        source: 'registration',
        completed: Boolean(r.completed_at),
      }));
      setRows(
        [...registrationRows, ...linkRows].sort(
          (a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
        ),
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load parent/guardian requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (row: RequestRow, decision: ParentLinkDecision) => {
    setBusyId(row.id);
    try {
      if (row.source === 'registration') {
        const invitationId = await adminReviewParentRequest(row.id, decision);
        if (decision === 'reject') {
          toast.success('Parent request rejected. No invitation was sent.');
        } else if (invitationId) {
          try {
            await sendStaffInvitation(invitationId);
            toast.success(`Registration email sent to ${row.parent_email}.`);
          } catch (emailErr: unknown) {
            const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
            const { data: inv } = await (supabase as any)
              .from('staff_invitations')
              .select('token')
              .eq('id', invitationId)
              .maybeSingle();
            const inviteUrl = inv?.token
              ? `${getPublicAppUrl()}/complete-parent-registration?token=${inv.token}`
              : null;
            toast.warning(`Approved, but the email failed: ${msg}`, { duration: 8000 });
            if (inviteUrl) {
              setInviteLinks((prev) => prev.some((l) => l.id === invitationId)
                ? prev
                : [...prev, { id: invitationId, email: row.parent_email, url: inviteUrl }]);
            }
          }
        }
      } else {
        await adminDecideParentRequest(row.id, decision);
        toast.success(decision === 'approve' ? 'Parent/guardian approved. Their account is now active.' : 'Parent/guardian request rejected. No invitation was sent.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
      await load();
    }
  };

  const statusText = (r: RequestRow) =>
    r.source === 'registration' && r.status === 'approved' && !r.completed
      ? 'Invitation sent'
      : parentLinkStatusLabel(r.status);

  const actions = (r: RequestRow, fullWidth: boolean) =>
    r.status === 'pending_admin' ? (
      <div className={fullWidth ? 'flex flex-col gap-2 pt-1' : 'flex flex-wrap justify-end gap-2'}>
        <Button type="button" size="sm" className={fullWidth ? 'w-full gap-1' : 'gap-1'} disabled={busyId === r.id} onClick={() => void decide(r, 'approve')}>
          <UserCheck className="h-4 w-4 shrink-0" />
          Approve
        </Button>
        <Button type="button" size="sm" variant="outline" className={fullWidth ? 'w-full gap-1' : 'gap-1'} disabled={busyId === r.id} onClick={() => void decide(r, 'reject')}>
          <UserX className="h-4 w-4 shrink-0" />
          Reject
        </Button>
      </div>
    ) : (
      <Badge variant={parentLinkStatusBadgeVariant(r.status)}>{statusText(r)}</Badge>
    );

  return (
    <Card className="min-w-0 border-border/60 bg-card/90 shadow-sm">
      <CardHeader className="space-y-1 border-b border-border/50 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base sm:text-lg">Parent / Guardian requests</CardTitle>
            <CardDescription className="text-pretty">
              Only requests the student has already approved appear here. Approving emails the parent a one-time link to create a password. Rejecting sends no invitation.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant={filter === 'awaiting' ? 'default' : 'outline'} onClick={() => setFilter('awaiting')}>
              Awaiting admin
            </Button>
            <Button type="button" size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
              All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
        {inviteLinks.length > 0 && (
          <div className="mb-4 space-y-2 rounded-lg border border-border/60 p-3 text-sm">
            {inviteLinks.map((link) => (
              <p key={link.id} className="break-all">
                Email failed for {link.email}. Complete registration: {link.url}
              </p>
            ))}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {filter === 'awaiting' ? 'No parent/guardian requests awaiting admin approval.' : 'No parent/guardian requests yet.'}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border/60 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Parent / Guardian</p>
                    <p className="break-words font-medium text-foreground">{r.parent_name}</p>
                    <p className="break-all text-sm text-muted-foreground">{r.parent_email}</p>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Student</p>
                    <p className="break-words text-sm font-medium text-foreground">{r.student_name}</p>
                    <p className="font-mono text-sm tabular-nums text-muted-foreground">{r.student_id_no}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    Student: <StepBadge state={studentApprovalState(r.status)} />
                    Admin: <StepBadge state={adminApprovalState(r.status)} />
                  </div>
                  <p className="text-xs text-muted-foreground">Requested {formatDate(r.requested_at)}</p>
                  {actions(r, true)}
                </li>
              ))}
            </ul>

            <div className="hidden rounded-xl border border-border/50 md:block md:overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Parent name</TableHead>
                    <TableHead className="min-w-[160px]">Parent email</TableHead>
                    <TableHead className="min-w-[140px]">Student name</TableHead>
                    <TableHead className="min-w-[110px]">Student ID</TableHead>
                    <TableHead>Student approval</TableHead>
                    <TableHead>Admin approval</TableHead>
                    <TableHead className="min-w-[140px]">Requested</TableHead>
                    <TableHead className="w-[200px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[200px] break-words font-medium">{r.parent_name}</TableCell>
                      <TableCell className="max-w-[240px] break-all text-muted-foreground">{r.parent_email}</TableCell>
                      <TableCell className="max-w-[200px] break-words">{r.student_name}</TableCell>
                      <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">{r.student_id_no}</TableCell>
                      <TableCell><StepBadge state={studentApprovalState(r.status)} /></TableCell>
                      <TableCell><StepBadge state={adminApprovalState(r.status)} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(r.requested_at)}</TableCell>
                      <TableCell className="text-right">{actions(r, false)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
