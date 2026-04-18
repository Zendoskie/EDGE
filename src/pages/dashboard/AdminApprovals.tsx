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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-primary" />
            Admin
          </div>
          <h1 className="mt-3 text-2xl font-display font-bold tracking-tight text-foreground">User approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Review new student and instructor accounts. Only approved users can sign in. Passwords are never shown here;
            authentication stays with Supabase Auth.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="shrink-0">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card className="border-border/60 bg-card/90 shadow-sm">
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Pending accounts</CardTitle>
          <CardDescription>
            Name, email, role, and student ID (for pending students) for each signup awaiting approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : empty ? (
            <p className="text-sm text-muted-foreground">No pending users right now.</p>
          ) : (
            <div className="rounded-xl border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right w-[200px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.user_id}>
                      <TableCell className="font-medium">{r.full_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{r.email}</TableCell>
                      <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                        {r.role === 'student' ? r.student_id ?? '—' : '—'}
                      </TableCell>
                      <TableCell className="capitalize">{r.role}</TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1"
                          disabled={busyId === r.user_id}
                          onClick={() => void setStatus(r.user_id, 'approved')}
                        >
                          <UserCheck className="h-4 w-4" />
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
                          <UserX className="h-4 w-4" />
                          Reject
                        </Button>
                      </TableCell>
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
