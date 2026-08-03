import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  RefreshCw, Mail, Search, Eye, Send, Ban, Clock, CheckCircle2,
  AlertTriangle, XCircle,
} from 'lucide-react';
import { sendStaffInvitation } from '@/lib/invoke-staff-invitation';

// ── Types ──────────────────────────────────────────────────────────────────────

type StaffRole = 'instructor' | 'guidance_counselor';
type InvStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

type StaffInvitation = {
  id: string;
  request_id: string | null;
  email: string;
  department: string | null;
  role: StaffRole;
  status: InvStatus;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  // From joined request
  full_name: string | null;
};

type FilterTab = 'all' | InvStatus;
type SortOrder = 'newest' | 'oldest';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRole(role: StaffRole): string {
  return role === 'guidance_counselor' ? 'Guidance Counselor' : 'Instructor';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isExpired(inv: StaffInvitation): boolean {
  return inv.status === 'pending' && new Date(inv.expires_at) < new Date();
}

const STATUS_META: Record<
  InvStatus,
  { label: string; className: string; Icon: React.ElementType }
> = {
  pending:  { label: 'Pending',  className: 'bg-amber-500/15 text-amber-500 border-amber-500/25',   Icon: Clock },
  accepted: { label: 'Accepted', className: 'bg-green-500/15 text-green-500 border-green-500/25',   Icon: CheckCircle2 },
  expired:  { label: 'Expired',  className: 'bg-muted/60 text-muted-foreground border-border/50',   Icon: AlertTriangle },
  revoked:  { label: 'Revoked',  className: 'bg-destructive/15 text-destructive border-destructive/25', Icon: XCircle },
};

function InvStatusBadge({ status, inv }: { status: InvStatus; inv: StaffInvitation }) {
  const effective = isExpired(inv) ? 'expired' : status;
  const meta = STATUS_META[effective];
  const Icon = meta.Icon;
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${meta.className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

// ── Filter tabs ────────────────────────────────────────────────────────────────

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'pending',  label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'expired',  label: 'Expired' },
  { value: 'revoked',  label: 'Revoked' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function AdminStaffInvitations() {
  const { role } = useAuth();

  const [rows, setRows]         = useState<StaffInvitation[]>([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState<string | null>(null);

  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [search, setSearch]       = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const [viewRow, setViewRow]   = useState<StaffInvitation | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('staff_invitations')
        .select(`
          id, request_id, email, department, role, status,
          expires_at, created_at, accepted_at,
          staff_registration_requests ( full_name )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: StaffInvitation[] = (data ?? []).map((r: any) => ({
        id:          r.id,
        request_id:  r.request_id,
        email:       r.email,
        department:  r.department,
        role:        r.role,
        status:      r.status,
        expires_at:  r.expires_at,
        created_at:  r.created_at,
        accepted_at: r.accepted_at,
        full_name:   r.staff_registration_requests?.full_name ?? null,
      }));

      setRows(mapped);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load invitations');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Filtering / search / sort ─────────────────────────────────────────────────

  const processed = useMemo(() => {
    let result = [...rows];

    if (filterTab !== 'all') {
      if (filterTab === 'expired') {
        result = result.filter((r) => isExpired(r) || r.status === 'expired');
      } else {
        result = result.filter((r) => !isExpired(r) && r.status === filterTab);
      }
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((r) =>
        r.email.toLowerCase().includes(q) ||
        (r.full_name ?? '').toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q) ||
        formatRole(r.role).toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortOrder === 'newest' ? -diff : diff;
    });

    return result;
  }, [rows, filterTab, search, sortOrder]);

  const counts = useMemo(() => ({
    all:      rows.length,
    pending:  rows.filter((r) => !isExpired(r) && r.status === 'pending').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    expired:  rows.filter((r) => isExpired(r) || r.status === 'expired').length,
    revoked:  rows.filter((r) => r.status === 'revoked').length,
  }), [rows]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleResend = async (inv: StaffInvitation) => {
    // #region agent log
    fetch('http://127.0.0.1:7856/ingest/329beaee-e1be-431d-b955-54c3ff2257dc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5efc3d'},body:JSON.stringify({sessionId:'5efc3d',location:'AdminStaffInvitations.tsx:resend-entry',message:'handleResend called',data:{invId:inv.id,invStatus:inv.status,currentBusyId:busyId},hypothesisId:'H-E',timestamp:Date.now()})}).catch(()=>{});
    console.log('[DBG-RESEND entry]', { invId: inv.id, invStatus: inv.status, currentBusyId: busyId });
    // #endregion
    if (busyId) return;
    setBusyId(inv.id);
    try {
      // Regenerate token + extend expiry via RPC.
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'resend_staff_invitation' as any,
        { p_invitation_id: inv.id },
      );
      // #region agent log — placed BEFORE throw so error is always captured
      fetch('http://127.0.0.1:7856/ingest/329beaee-e1be-431d-b955-54c3ff2257dc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5efc3d'},body:JSON.stringify({sessionId:'5efc3d',location:'AdminStaffInvitations.tsx:resend-rpc',message:'resend_staff_invitation RPC result',data:{rpcDataRaw:rpcData,rpcErrCode:rpcErr?.code,rpcErrMsg:rpcErr?.message,rpcErrDetails:rpcErr?.details},hypothesisId:'H-E',timestamp:Date.now()})}).catch(()=>{});
      console.log('[DBG-RESEND rpc]', { rpcData, rpcErrCode: rpcErr?.code, rpcErrMsg: rpcErr?.message, rpcErrDetails: rpcErr?.details, rpcErrHint: (rpcErr as any)?.hint });
      // #endregion
      if (rpcErr) throw rpcErr;
      // RPC returns RETURNS TABLE → data is an array; grab the first row's token.
      const newToken: string | null = (rpcData as any)?.[0]?.token ?? null;

      // Refresh the list so the new expiry/token are shown.
      await load();

      // Attempt to send the email.
      try {
        await sendStaffInvitation(inv.id);
        toast.success(`Invitation resent to ${inv.email}.`);
      } catch (emailErr: unknown) {
        const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);

        // Build fallback URL from the new token returned by the RPC, or re-fetch.
        let fallbackUrl: string | null = null;
        if (newToken) {
          fallbackUrl = `${window.location.origin}/request-staff-account?token=${newToken}`;
        } else {
          const { data: fresh } = await (supabase as any)
            .from('staff_invitations')
            .select('token')
            .eq('id', inv.id)
            .maybeSingle();
          if (fresh?.token) {
            fallbackUrl = `${window.location.origin}/request-staff-account?token=${fresh.token}`;
          }
        }

        toast.warning(
          `Token refreshed but email failed: ${msg}` +
          (fallbackUrl ? ' — Invite link copied to clipboard.' : ''),
          { duration: 10000 },
        );

        if (fallbackUrl) {
          navigator.clipboard.writeText(fallbackUrl).catch(() => {});
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Resend failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (inv: StaffInvitation) => {
    if (busyId) return;
    setBusyId(inv.id);
    try {
      const { error } = await (supabase as any)
        .from('staff_invitations')
        .update({ status: 'revoked' })
        .eq('id', inv.id)
        .neq('status', 'accepted'); // never revoke an accepted invitation

      if (error) throw error;
      toast.success(`Invitation to ${inv.email} cancelled.`);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusyId(null);
    }
  };

  // Actions are available based on effective status
  function canResend(inv: StaffInvitation): boolean {
    return inv.status !== 'accepted';
  }
  function canCancel(inv: StaffInvitation): boolean {
    return inv.status !== 'accepted' && inv.status !== 'revoked';
  }

  // ── Guard ─────────────────────────────────────────────────────────────────────

  if (role !== 'admin') return <Navigate to="/dashboard" replace />;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto min-w-0 max-w-full space-y-5 sm:space-y-6">

      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
            Admin
          </div>
          <h1 className="mt-3 text-xl font-display font-bold tracking-tight text-foreground sm:text-2xl">
            Staff Invitations
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Manage invitation links sent to approved staff applicants. Invitations are
            single-use and expire after 7 days.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="w-full shrink-0 sm:w-auto"
        >
          <RefreshCw className={`mr-2 h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilterTab(tab.value)}
              className={[
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                filterTab === tab.value
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border/60 bg-card/80 text-muted-foreground hover:border-border hover:text-foreground',
              ].join(' ')}
            >
              {tab.label}
              <span className={[
                'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                filterTab === tab.value ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              ].join(' ')}>
                {counts[tab.value]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email, name, department, or role…"
              className="pl-9"
            />
          </div>
          <Select value={sortOrder} onValueChange={(v: SortOrder) => setSortOrder(v)}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table card */}
      <Card className="min-w-0 border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="space-y-1 border-b border-border/50 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-base sm:text-lg">
            Invitations
            {!loading && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({processed.length} {processed.length === 1 ? 'result' : 'results'})
              </span>
            )}
          </CardTitle>
          <CardDescription>
            All generated staff invitations. Resend to issue a fresh link; Cancel to revoke access.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : processed.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search || filterTab !== 'all'
                ? 'No invitations match the current filters.'
                : 'No invitations yet. Approve a staff request to generate one.'}
            </p>
          ) : (
            <>
              {/* ── Mobile card list ─────────────────────────────────────── */}
              <ul className="divide-y divide-border/60 md:hidden">
                {processed.map((inv) => (
                  <li key={inv.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium text-foreground break-words">
                          {inv.full_name || inv.email}
                        </p>
                        <p className="text-xs text-muted-foreground break-all">{inv.email}</p>
                      </div>
                      <InvStatusBadge status={inv.status} inv={inv} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <p className="font-medium uppercase tracking-wide text-muted-foreground">Role</p>
                        <p className="mt-0.5 text-foreground">{formatRole(inv.role)}</p>
                      </div>
                      <div>
                        <p className="font-medium uppercase tracking-wide text-muted-foreground">Department</p>
                        <p className="mt-0.5 text-foreground">{inv.department || '—'}</p>
                      </div>
                      <div>
                        <p className="font-medium uppercase tracking-wide text-muted-foreground">Expires</p>
                        <p className="mt-0.5 text-foreground">{formatDate(inv.expires_at)}</p>
                      </div>
                      {inv.accepted_at && (
                        <div>
                          <p className="font-medium uppercase tracking-wide text-muted-foreground">Accepted</p>
                          <p className="mt-0.5 text-foreground">{formatDate(inv.accepted_at)}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" className="gap-1"
                        onClick={() => setViewRow(inv)}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                      {canResend(inv) && (
                        <Button type="button" size="sm" className="gap-1"
                          disabled={busyId === inv.id}
                          onClick={() => void handleResend(inv)}>
                          <Send className="h-3.5 w-3.5" />
                          {busyId === inv.id ? 'Sending…' : 'Resend'}
                        </Button>
                      )}
                      {canCancel(inv) && (
                        <Button type="button" size="sm" variant="outline"
                          className="gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busyId === inv.id}
                          onClick={() => void handleCancel(inv)}>
                          <Ban className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {/* ── Desktop table ─────────────────────────────────────────── */}
              <div className="hidden rounded-xl border border-border/50 md:block md:overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]">Email</TableHead>
                      <TableHead className="w-[150px]">Role</TableHead>
                      <TableHead className="min-w-[120px]">Department</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[160px]">Expires</TableHead>
                      <TableHead className="w-[160px]">Accepted</TableHead>
                      <TableHead className="w-[210px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processed.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <div>
                            {inv.full_name && (
                              <p className="font-medium text-foreground text-sm">{inv.full_name}</p>
                            )}
                            <p className="break-all text-xs text-muted-foreground">{inv.email}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{formatRole(inv.role)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {inv.department || '—'}
                        </TableCell>
                        <TableCell><InvStatusBadge status={inv.status} inv={inv} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(inv.expires_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {inv.accepted_at ? formatDate(inv.accepted_at) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button type="button" size="sm" variant="outline" className="gap-1"
                              onClick={() => setViewRow(inv)}>
                              <Eye className="h-3.5 w-3.5" /> View
                            </Button>
                            {canResend(inv) && (
                              <Button type="button" size="sm" className="gap-1"
                                disabled={busyId === inv.id}
                                onClick={() => void handleResend(inv)}>
                                <Send className="h-3.5 w-3.5" />
                                {busyId === inv.id ? 'Sending…' : 'Resend'}
                              </Button>
                            )}
                            {canCancel(inv) && (
                              <Button type="button" size="sm" variant="outline"
                                className="gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={busyId === inv.id}
                                onClick={() => void handleCancel(inv)}>
                                <Ban className="h-3.5 w-3.5" /> Cancel
                              </Button>
                            )}
                          </div>
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

      {/* ── View detail dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!viewRow} onOpenChange={(open) => { if (!open) setViewRow(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invitation Details</DialogTitle>
            <DialogDescription>
              Full details for this staff invitation.
            </DialogDescription>
          </DialogHeader>

          {viewRow && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-4">
                {viewRow.full_name && (
                  <InvDetailField label="Applicant Name" value={viewRow.full_name} className="col-span-2" />
                )}
                <InvDetailField label="Email"      value={viewRow.email}              className="col-span-2" />
                <InvDetailField label="Role"        value={formatRole(viewRow.role)} />
                <InvDetailField label="Department"  value={viewRow.department || '—'} />

                <div className="col-span-2 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                  <InvStatusBadge status={viewRow.status} inv={viewRow} />
                </div>

                <InvDetailField label="Expires"     value={formatDate(viewRow.expires_at)} />
                <InvDetailField label="Created"     value={formatDate(viewRow.created_at)} />
                {viewRow.accepted_at && (
                  <InvDetailField label="Accepted"  value={formatDate(viewRow.accepted_at)} className="col-span-2" />
                )}
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  🔒 The invitation token is not displayed here for security reasons.
                  Use <strong>Resend</strong> to generate a fresh link and re-email the applicant.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {viewRow && canResend(viewRow) && (
              <Button
                type="button"
                disabled={busyId === viewRow.id}
                onClick={() => { setViewRow(null); void handleResend(viewRow!); }}
              >
                <Send className="mr-1.5 h-4 w-4" />
                {busyId === viewRow.id ? 'Sending…' : 'Resend Invitation'}
              </Button>
            )}
            {viewRow && canCancel(viewRow) && (
              <Button
                type="button"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busyId === viewRow.id}
                onClick={() => { setViewRow(null); void handleCancel(viewRow!); }}
              >
                <Ban className="mr-1.5 h-4 w-4" /> Cancel
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setViewRow(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Detail field helper ────────────────────────────────────────────────────────

function InvDetailField({
  label, value, className = '',
}: { label: string; value: string; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm text-foreground">{value}</p>
    </div>
  );
}
