import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { UserCheck, UserX, RefreshCw } from 'lucide-react';
import type { AppRole } from '@/hooks/useAuth';
import { sendAccountStatusEmailBestEffort } from '@/lib/invoke-account-status-email';
import { sendStaffInvitation } from '@/lib/invoke-staff-invitation';
import { getPublicAppUrl } from '@/lib/app-url';
import ParentGuardianRequestsCard from '@/components/ParentGuardianRequestsCard';
import { PageHeader } from '@/components/shell/PageHeader';

type PendingRow = {
  user_id: string;
  full_name: string;
  email: string;
  student_id: string | null;
  role: AppRole;
};

type StudentRequest = {
  id: string;
  full_name: string;
  email: string;
  student_id: string;
  course: string;
  year_level: string;
  submitted_at: string;
};

export default function AdminApprovals() {
  const { role } = useAuth();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [studentRequests, setStudentRequests] = useState<StudentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<Array<{ id: string; email: string; url: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, student_id, account_status')
        .eq('account_status', 'pending');
      if (pErr) throw pErr;

      const { data: requestRows, error: requestErr } = await (supabase as any)
        .from('student_registration_requests')
        .select('id, full_name, email, student_id, course, year_level, submitted_at')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false });
      if (requestErr) throw requestErr;
      setStudentRequests((requestRows ?? []) as StudentRequest[]);

      const list = profiles ?? [];
      if (list.length === 0) {
        setRows([]);
        return;
      }
      const ids = list.map((p) => p.user_id);
      const { data: rolesRows, error: rErr } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', ids);
      if (rErr) throw rErr;
      const roleByUser = new Map<string, AppRole>();
      for (const row of rolesRows ?? []) {
        const uid = row.user_id as string;
        const r = row.role as string;
        const cur = roleByUser.get(uid);
        const next: AppRole =
          r === 'admin' || cur === 'admin'
            ? 'admin'
            : r === 'guidance_counselor' || cur === 'guidance_counselor'
              ? 'guidance_counselor'
            : r === 'parent' || cur === 'parent'
              ? 'parent'
            : r === 'instructor' || cur === 'instructor'
              ? 'instructor'
              : 'student';
        roleByUser.set(uid, next);
      }
      setRows(
        list
          .map((p) => {
            const resolvedRole = roleByUser.get(p.user_id) ?? 'student';
            return {
              user_id: p.user_id,
              full_name: p.full_name ?? '',
              email: p.email ?? '',
              student_id: typeof p.student_id === 'string' && p.student_id.trim() ? p.student_id.trim() : null,
              role: resolvedRole,
            };
          })
          // Parents are activated through their Parent/Guardian request after the student approves it.
          .filter((r) => r.role !== 'parent')
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load pending users');
      setRows([]);
      setStudentRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewStudentRequest = async (request: StudentRequest, status: 'approved' | 'rejected') => {
    setBusyId(request.id);
    try {
      const { data, error } = await (supabase as any).rpc('admin_review_student_request', {
        p_request_id: request.id,
        p_status: status,
      });
      if (error) throw error;

      if (status === 'rejected') {
        toast.success('Student request rejected. No invitation was sent.');
        await load();
        return;
      }

      const invitationId = data as string | null;
      if (invitationId) {
        try {
          await sendStaffInvitation(invitationId);
          toast.success(`Registration email sent to ${request.email}.`);
        } catch (emailErr: unknown) {
          const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
          const { data: inv } = await (supabase as any)
            .from('staff_invitations')
            .select('token')
            .eq('id', invitationId)
            .maybeSingle();
          const inviteUrl = inv?.token
            ? `${getPublicAppUrl()}/complete-registration?token=${inv.token}`
            : null;
          toast.warning(`Approved, but the email failed: ${msg}`, { duration: 8000 });
          if (inviteUrl) {
            setInviteLinks((prev) => prev.some((l) => l.id === invitationId)
              ? prev
              : [...prev, { id: invitationId, email: request.email, url: inviteUrl }]);
          }
        }
      }
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows.length]);
  const showStudentIdColumn = useMemo(() => rows.some((r) => r.role === 'student'), [rows]);

  const setStatus = async (userId: string, status: 'approved' | 'rejected') => {
    setBusyId(userId);
    try {
      const { error } = await supabase.rpc('admin_set_account_status', {
        p_target_user_id: userId,
        p_status: status,
      });
      if (error) throw error;
      toast.success(status === 'approved' ? 'User approved' : 'User rejected');
      // Notify instructor / guidance counselor by email (best-effort — never blocks the action).
      sendAccountStatusEmailBestEffort({ user_id: userId, status });
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  if (role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="mx-auto min-w-0 max-w-full space-y-5 sm:space-y-6">
      <PageHeader
        title="User approvals"
        description="Review pending student signup requests, existing accounts waiting for approval, and parent/guardian requests. Approving a student request emails a one-time link so they can create a password. Passwords are never shown here."
        actions={<Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="w-full shrink-0 sm:w-auto"
        >
          <RefreshCw className={`mr-2 h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>}
      />

      <Card className="min-w-0 border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="space-y-1 border-b border-border/50 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-base sm:text-lg">Student signup requests</CardTitle>
          <CardDescription className="text-pretty">
            Phase 1 requests include the Student ID. Approval sends a single-use registration email. Rejection sends nothing, and the student cannot sign in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : studentRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending student requests.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {studentRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">{request.full_name}</TableCell>
                      <TableCell className="break-all text-muted-foreground">{request.email}</TableCell>
                      <TableCell className="font-mono text-sm">{request.student_id}</TableCell>
                      <TableCell>{request.course}</TableCell>
                      <TableCell>{request.year_level}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="gap-1"
                            disabled={busyId === request.id}
                            onClick={() => void reviewStudentRequest(request, 'approved')}
                          >
                            <UserCheck className="h-4 w-4 shrink-0" />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={busyId === request.id}
                            onClick={() => void reviewStudentRequest(request, 'rejected')}
                          >
                            <UserX className="h-4 w-4 shrink-0" />
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {inviteLinks.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border/60 p-3 text-sm">
              <p className="font-medium">Email could not be sent. Share this one-time link directly:</p>
              {inviteLinks.map((link) => (
                <p key={link.id} className="break-all text-muted-foreground">
                  {link.email}: {link.url}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="space-y-1 border-b border-border/50 px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
          <CardTitle className="text-base sm:text-lg">Pending accounts</CardTitle>
          <CardDescription className="text-pretty">
            Name, email, and role for each signup; student ID appears only for pending student accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : empty ? (
            <p className="text-sm text-muted-foreground">No pending users right now.</p>
          ) : (
            <>
              <ul className="divide-y divide-border/60 md:hidden">
                {rows.map((r) => (
                  <li key={r.user_id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Name</p>
                      <p className="break-words font-medium text-foreground">{r.full_name || '—'}</p>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Email</p>
                      <p className="break-all text-sm text-muted-foreground">{r.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Role</p>
                        <p className="capitalize text-sm font-medium text-foreground">{r.role}</p>
                      </div>
                      {r.role === 'student' && (
                        <div className="min-w-0 space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Student ID</p>
                          <p className="font-mono text-sm tabular-nums text-muted-foreground">{r.student_id ?? '—'}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        className="w-full gap-1"
                        disabled={busyId === r.user_id}
                        onClick={() => void setStatus(r.user_id, 'approved')}
                      >
                        <UserCheck className="h-4 w-4 shrink-0" />
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full gap-1"
                        disabled={busyId === r.user_id}
                        onClick={() => void setStatus(r.user_id, 'rejected')}
                      >
                        <UserX className="h-4 w-4 shrink-0" />
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden rounded-xl border border-border/50 md:block md:overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px]">Name</TableHead>
                      <TableHead className="min-w-[160px]">Email</TableHead>
                      {showStudentIdColumn ? (
                        <TableHead className="min-w-[100px]">Student ID</TableHead>
                      ) : null}
                      <TableHead className="w-[100px]">Role</TableHead>
                      <TableHead className="w-[200px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.user_id}>
                        <TableCell className="max-w-[200px] break-words font-medium">{r.full_name || '—'}</TableCell>
                        <TableCell className="max-w-[240px] break-all text-muted-foreground">{r.email}</TableCell>
                        {showStudentIdColumn ? (
                          <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                            {r.role === 'student' ? r.student_id ?? '—' : ''}
                          </TableCell>
                        ) : null}
                        <TableCell className="capitalize">{r.role}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              className="gap-1"
                              disabled={busyId === r.user_id}
                              onClick={() => void setStatus(r.user_id, 'approved')}
                            >
                              <UserCheck className="h-4 w-4 shrink-0" />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={busyId === r.user_id}
                              onClick={() => void setStatus(r.user_id, 'rejected')}
                            >
                              <UserX className="h-4 w-4 shrink-0" />
                              Reject
                            </Button>
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

      <ParentGuardianRequestsCard />
    </div>
  );
}
