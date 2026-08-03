import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  RefreshCw, ClipboardList, Search, UserCheck, UserX, Eye,
  ChevronDown,
} from 'lucide-react';
import { sendStaffInvitation } from '@/lib/invoke-staff-invitation';

// ── Types ──────────────────────────────────────────────────────────────────────

type StaffRole = 'instructor' | 'guidance_counselor';
type RequestStatus = 'pending' | 'approved' | 'rejected';

type StaffRequest = {
  id: string;
  full_name: string;
  email: string;
  department: string | null;
  role: StaffRole;
  remarks: string | null;
  status: RequestStatus;
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type FilterTab = 'all' | RequestStatus;
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

function StatusBadge({ status }: { status: RequestStatus }) {
  const variants: Record<RequestStatus, { label: string; className: string }> = {
    pending:  { label: 'Pending',  className: 'bg-amber-500/15 text-amber-500 border-amber-500/25 hover:bg-amber-500/20' },
    approved: { label: 'Approved', className: 'bg-green-500/15 text-green-500 border-green-500/25 hover:bg-green-500/20' },
    rejected: { label: 'Rejected', className: 'bg-destructive/15 text-destructive border-destructive/25 hover:bg-destructive/20' },
  };
  const v = variants[status];
  return (
    <Badge variant="outline" className={`capitalize font-medium ${v.className}`}>
      {v.label}
    </Badge>
  );
}

// ── Filter tabs ────────────────────────────────────────────────────────────────

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function AdminStaffRequests() {
  const { role, user } = useAuth();

  const [rows, setRows]           = useState<StaffRequest[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busyId, setBusyId]       = useState<string | null>(null);

  // Filters / search / sort
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [search, setSearch]       = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  // View detail dialog
  const [viewRow, setViewRow]     = useState<StaffRequest | null>(null);

  // Reject confirmation dialog
  const [rejectTarget, setRejectTarget]   = useState<StaffRequest | null>(null);
  const [rejectReason, setRejectReason]   = useState('');
  const [rejectBusy, setRejectBusy]       = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('staff_registration_requests')
        .select(
          'id, full_name, email, department, role, remarks, status, submitted_at, reviewed_at, rejection_reason'
        )
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      setRows((data ?? []) as StaffRequest[]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load staff requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Client-side filtering + search + sort ────────────────────────────────────

  const processed = useMemo(() => {
    let result = [...rows];

    // Status filter
    if (filterTab !== 'all') {
      result = result.filter((r) => r.status === filterTab);
    }

    // Search (name, email, department, role label)
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q) ||
        formatRole(r.role).toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      const diff = new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
      return sortOrder === 'newest' ? -diff : diff;
    });

    return result;
  }, [rows, filterTab, search, sortOrder]);

  // Counts for filter tab badges
  const counts = useMemo(() => ({
    all:      rows.length,
    pending:  rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  }), [rows]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleApprove = async (row: StaffRequest) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      // Atomically approves the request and creates the invitation (returns invitation id + token).
      const { data, error } = await supabase.rpc(
        'admin_review_staff_request' as any,
        { p_request_id: row.id, p_status: 'approved' },
      );
      if (error) throw error;

      const invitationId = data as string | null;
      // #region agent log
      fetch('http://127.0.0.1:7856/ingest/329beaee-e1be-431d-b955-54c3ff2257dc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5efc3d'},body:JSON.stringify({sessionId:'5efc3d',location:'AdminStaffRequests.tsx:approve',message:'RPC result',data:{dataRaw:data,dataType:typeof data,invitationId},hypothesisId:'H-D',timestamp:Date.now()})}).catch(()=>{});
      console.log('[DBG-APPROVE rpc]', { dataRaw: data, dataType: typeof data, invitationId });
      // #endregion
      toast.success(`${row.full_name}'s request approved. Sending invitation email…`);

      if (invitationId) {
        try {
          await sendStaffInvitation(invitationId);
          toast.success(`Invitation email sent to ${row.email}.`);
        } catch (emailErr: unknown) {
          const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
          // Fetch the token so the admin can copy the link manually as a fallback.
          const { data: inv } = await (supabase as any)
            .from('staff_invitations')
            .select('token')
            .eq('id', invitationId)
            .maybeSingle();
          const inviteUrl = inv?.token
            ? `${window.location.origin}/request-staff-account?token=${inv.token}`
            : null;

          toast.warning(
            `Invitation created but email failed to send: ${msg}` +
            (inviteUrl ? ' — Copy the link from Staff Invitations and share it manually.' : ''),
            { duration: 10000 },
          );

          if (inviteUrl) {
            navigator.clipboard.writeText(inviteUrl).catch(() => {});
            toast.info('Invitation link copied to clipboard.', { duration: 5000 });
          }
        }
      }

      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setBusyId(null);
    }
  };

  const openRejectDialog = (row: StaffRequest) => {
    setRejectTarget(row);
    setRejectReason('');
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setRejectBusy(true);
    try {
      const { error } = await (supabase as any)
        .from('staff_registration_requests')
        .update({
          status:           'rejected',
          reviewed_at:      new Date().toISOString(),
          reviewed_by:      user?.id ?? null,
          rejection_reason: rejectReason.trim() || null,
        })
        .eq('id', rejectTarget.id)
        .eq('status', 'pending');

      if (error) throw error;
      toast.success(`${rejectTarget.full_name}'s request rejected.`);
      setRejectTarget(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Rejection failed');
    } finally {
      setRejectBusy(false);
    }
  };

  // ── Guard ─────────────────────────────────────────────────────────────────────

  if (role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto min-w-0 max-w-full space-y-5 sm:space-y-6">

      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5 shrink-0 text-primary" />
            Admin
          </div>
          <h1 className="mt-3 text-xl font-display font-bold tracking-tight text-foreground sm:text-2xl">
            Staff Registration Requests
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Review account requests submitted by Instructors and Guidance Counselors through the
            public registration form.
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

      {/* Toolbar: tabs + search + sort */}
      <div className="flex flex-col gap-3">

        {/* Filter tabs */}
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

        {/* Search + sort row */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, department, or role…"
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
            Requests
            {!loading && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({processed.length} {processed.length === 1 ? 'result' : 'results'})
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-pretty">
            All staff account requests. Use the filters and search above to narrow down the list.
          </CardDescription>
        </CardHeader>

        <CardContent className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : processed.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search || filterTab !== 'all'
                ? 'No requests match the current filters.'
                : 'No staff registration requests yet.'}
            </p>
          ) : (
            <>
              {/* ── Mobile card list ────────────────────────────────────────────── */}
              <ul className="divide-y divide-border/60 md:hidden">
                {processed.map((r) => (
                  <li key={r.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-medium text-foreground break-words">{r.full_name}</p>
                        <p className="text-xs text-muted-foreground break-all">{r.email}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <p className="font-medium uppercase tracking-wide text-muted-foreground">Role</p>
                        <p className="mt-0.5 text-foreground">{formatRole(r.role)}</p>
                      </div>
                      <div>
                        <p className="font-medium uppercase tracking-wide text-muted-foreground">Department</p>
                        <p className="mt-0.5 text-foreground">{r.department || '—'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="font-medium uppercase tracking-wide text-muted-foreground">Submitted</p>
                        <p className="mt-0.5 text-foreground">{formatDate(r.submitted_at)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => setViewRow(r)}
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                      {r.status === 'pending' && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1"
                            disabled={busyId === r.id}
                            onClick={() => void handleApprove(r)}
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            {busyId === r.id ? 'Approving…' : 'Approve'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1 text-destructive hover:text-destructive"
                            disabled={busyId === r.id}
                            onClick={() => openRejectDialog(r)}
                          >
                            <UserX className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {/* ── Desktop table ───────────────────────────────────────────────── */}
              <div className="hidden rounded-xl border border-border/50 md:block md:overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[140px]">Name</TableHead>
                      <TableHead className="min-w-[180px]">Email</TableHead>
                      <TableHead className="min-w-[130px]">Department</TableHead>
                      <TableHead className="w-[150px]">Role</TableHead>
                      <TableHead className="w-[110px]">Status</TableHead>
                      <TableHead className="w-[160px]">Submitted</TableHead>
                      <TableHead className="w-[220px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processed.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-[180px] break-words font-medium">
                          {r.full_name}
                        </TableCell>
                        <TableCell className="max-w-[220px] break-all text-muted-foreground">
                          {r.email}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.department || '—'}
                        </TableCell>
                        <TableCell>{formatRole(r.role)}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(r.submitted_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => setViewRow(r)}
                            >
                              <Eye className="h-3.5 w-3.5" /> View
                            </Button>
                            {r.status === 'pending' && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="gap-1"
                                  disabled={busyId === r.id}
                                  onClick={() => void handleApprove(r)}
                                >
                                  <UserCheck className="h-3.5 w-3.5" />
                                  {busyId === r.id ? 'Approving…' : 'Approve'}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  disabled={busyId === r.id}
                                  onClick={() => openRejectDialog(r)}
                                >
                                  <UserX className="h-3.5 w-3.5" /> Reject
                                </Button>
                              </>
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

      {/* ── View detail dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!viewRow} onOpenChange={(open) => { if (!open) setViewRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Details</DialogTitle>
            <DialogDescription>
              Full details for this staff account request.
            </DialogDescription>
          </DialogHeader>

          {viewRow && (
            <div className="space-y-4 py-1">
              <div className="grid grid-cols-2 gap-4">
                <DetailField label="Full Name"   value={viewRow.full_name} className="col-span-2" />
                <DetailField label="Email"        value={viewRow.email}     className="col-span-2" />
                <DetailField label="Department"   value={viewRow.department || '—'} />
                <DetailField label="Role"         value={formatRole(viewRow.role)} />
                <div className="col-span-2 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
                  <StatusBadge status={viewRow.status} />
                </div>
                <DetailField label="Submitted"    value={formatDate(viewRow.submitted_at)} />
                {viewRow.reviewed_at && (
                  <DetailField label="Reviewed"   value={formatDate(viewRow.reviewed_at)} />
                )}
              </div>
              {viewRow.remarks && (
                <div className="space-y-1 rounded-lg border border-border/50 bg-muted/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Remarks</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{viewRow.remarks}</p>
                </div>
              )}
              {viewRow.status === 'rejected' && viewRow.rejection_reason && (
                <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-destructive">Rejection Reason</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{viewRow.rejection_reason}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {viewRow?.status === 'pending' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busyId === viewRow?.id}
                  onClick={() => { setViewRow(null); openRejectDialog(viewRow!); }}
                >
                  <UserX className="mr-1.5 h-4 w-4" /> Reject
                </Button>
                <Button
                  type="button"
                  disabled={busyId === viewRow?.id}
                  onClick={() => { setViewRow(null); void handleApprove(viewRow!); }}
                >
                  <UserCheck className="mr-1.5 h-4 w-4" />
                  {busyId === viewRow?.id ? 'Approving…' : 'Approve'}
                </Button>
              </>
            )}
            <Button type="button" variant="outline" onClick={() => setViewRow(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject confirmation dialog ─────────────────────────────────────────── */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>
              Rejecting <span className="font-medium text-foreground">{rejectTarget?.full_name}</span>
              &apos;s {rejectTarget ? formatRole(rejectTarget.role) : ''} account request.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-1">
            <Label htmlFor="reject-reason">Rejection Reason <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Provide a reason for the applicant (optional)…"
              rows={3}
              className="resize-none"
              disabled={rejectBusy}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={rejectBusy}
              onClick={() => setRejectTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={rejectBusy}
              onClick={() => void handleReject()}
            >
              <UserX className="mr-1.5 h-4 w-4" />
              {rejectBusy ? 'Rejecting…' : 'Confirm Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small helper ───────────────────────────────────────────────────────────────

function DetailField({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="break-words text-sm text-foreground">{value}</p>
    </div>
  );
}
