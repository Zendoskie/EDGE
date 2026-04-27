import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { UserCheck, UserX, RefreshCw, Shield } from 'lucide-react';
import type { AppRole } from '@/hooks/useAuth';

type PendingRow = {
  user_id: string;
  full_name: string;
  email: string;
  student_id: string | null;
  role: AppRole;
};

export default function AdminApprovals() {
  const { role } = useAuth();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, student_id, account_status')
        .eq('account_status', 'pending');
      if (pErr) throw pErr;
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
        list.map((p) => {
          const resolvedRole = roleByUser.get(p.user_id) ?? 'student';
          return {
            user_id: p.user_id,
            full_name: p.full_name ?? '',
            email: p.email ?? '',
            student_id: typeof p.student_id === 'string' && p.student_id.trim() ? p.student_id.trim() : null,
            role: resolvedRole,
          };
        })
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load pending users');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
            Admin
          </div>
          <h1 className="mt-3 text-xl font-display font-bold tracking-tight text-foreground sm:text-2xl">User approvals</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Review new student, instructor, parent, and guidance counselor accounts. Only approved users can sign in. Passwords are never shown here;
            authentication stays with Supabase Auth.
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
    </div>
  );
}
