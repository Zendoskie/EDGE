import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Users, UserCheck, UserX, Clock, ShieldOff, RefreshCw, Search,
  Eye, Pencil, Trash2, Download, ChevronDown, GraduationCap,
  Users2, ShieldCheck, BookOpen, UserCog,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type AppRole = 'student' | 'parent' | 'instructor' | 'guidance_counselor' | 'admin';
type AccountStatus = 'pending' | 'approved' | 'rejected' | 'deactivated';

type UserRow = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  department: string | null;
  accountStatus: AccountStatus;
  registrationDate: string;
  lastLogin: string | null;
  studentId: string | null;
};

type Stats = {
  total: number;
  students: number;
  parents: number;
  instructors: number;
  counselors: number;
  admins: number;
  pending: number;
  inactive: number;
};

type RoleTab = 'all' | AppRole;
type StatusFilter = 'all' | AccountStatus;
type SortOrder = 'newest' | 'oldest';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRoleLabel(role: AppRole): string {
  const map: Record<AppRole, string> = {
    student: 'Student',
    parent: 'Parent',
    instructor: 'Instructor',
    guidance_counselor: 'Guidance Counselor',
    admin: 'Administrator',
  };
  return map[role] ?? role;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');
}

const ROLE_COLORS: Record<AppRole, string> = {
  student: 'bg-blue-500',
  parent: 'bg-purple-500',
  instructor: 'bg-green-500',
  guidance_counselor: 'bg-orange-500',
  admin: 'bg-rose-500',
};

function InitialsAvatar({ name, role }: { name: string; role: AppRole }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${ROLE_COLORS[role]}`}
    >
      {getInitials(name) || '?'}
    </div>
  );
}

function StatusBadge({ status }: { status: AccountStatus }) {
  const variants: Record<AccountStatus, { label: string; className: string }> = {
    approved:    { label: 'Active',       className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    pending:     { label: 'Pending',      className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
    rejected:    { label: 'Rejected',     className: 'bg-red-500/10 text-red-400 border-red-500/20' },
    deactivated: { label: 'Deactivated',  className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  };
  const v = variants[status] ?? { label: status, className: '' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${v.className}`}>
      {v.label}
    </span>
  );
}

function RoleBadge({ role }: { role: AppRole }) {
  const colors: Record<AppRole, string> = {
    student: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    parent: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    instructor: 'bg-green-500/10 text-green-400 border-green-500/20',
    guidance_counselor: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    admin: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colors[role]}`}>
      {formatRoleLabel(role)}
    </span>
  );
}

function exportToCSV(rows: UserRow[], filename: string) {
  const headers = ['Name', 'Email', 'Role', 'Department', 'Status', 'Registration Date', 'Last Login'];
  const lines = [
    headers.join(','),
    ...rows.map(r => [
      `"${r.fullName.replace(/"/g, '""')}"`,
      `"${r.email}"`,
      `"${formatRoleLabel(r.role)}"`,
      `"${r.department ?? '—'}"`,
      `"${r.accountStatus}"`,
      `"${formatDate(r.registrationDate)}"`,
      `"${r.lastLogin ? formatDateTime(r.lastLogin) : '—'}"`,
    ].join(',')),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Statistics Cards ────────────────────────────────────────────────────────────

function StatsCards({ stats, loading }: { stats: Stats; loading: boolean }) {
  const cards = [
    { label: 'Total Users',        value: stats.total,      icon: Users,      color: 'text-blue-400' },
    { label: 'Students',           value: stats.students,   icon: GraduationCap, color: 'text-blue-400' },
    { label: 'Parents',            value: stats.parents,    icon: Users2,     color: 'text-purple-400' },
    { label: 'Instructors',        value: stats.instructors,icon: BookOpen,   color: 'text-green-400' },
    { label: 'Counselors',         value: stats.counselors, icon: UserCog,    color: 'text-orange-400' },
    { label: 'Administrators',     value: stats.admins,     icon: ShieldCheck,color: 'text-rose-400' },
    { label: 'Pending Approval',   value: stats.pending,    icon: Clock,      color: 'text-yellow-400' },
    { label: 'Inactive/Deactivated', value: stats.inactive, icon: ShieldOff,  color: 'text-slate-400' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      {cards.map(c => (
        <Card key={c.label} className="border-border/50 bg-card/50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <c.icon className={`h-4 w-4 shrink-0 ${c.color}`} />
              <span className="truncate text-xs text-muted-foreground">{c.label}</span>
            </div>
            <p className="mt-1 text-2xl font-bold">
              {loading ? '—' : stats.total === 0 && c.value === 0 ? '0' : c.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Profile Viewer ─────────────────────────────────────────────────────────────

type ProfileData = {
  engagementLevel?: string;
  engagementScore?: number;
  totalLoginCount?: number;
  lastLoginAt?: string;
  predictionsCount?: number;
  highRiskCount?: number;
  attendanceTotal?: number;
  attendancePresent?: number;
  feedbackCount?: number;
  linkedStudents?: { userId: string; fullName: string; email: string; status: string }[];
  subjects?: { id: string; name: string; code: string; enrollmentCount?: number }[];
  referralsTotal?: number;
  referralsPending?: number;
  referralsResolved?: number;
};

function ProfileViewerDialog({
  user,
  open,
  onClose,
}: {
  user: UserRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !user) { setProfileData(null); return; }
    setLoading(true);

    (async () => {
      const db = supabase as any;
      const result: ProfileData = {};

      if (user.role === 'student') {
        const [engRes, predRes, attRes, fbRes] = await Promise.all([
          db.from('student_engagement_summary')
            .select('engagement_level, engagement_score, total_login_count, last_login_at')
            .eq('student_id', user.userId)
            .maybeSingle(),
          db.from('predictions')
            .select('risk_level')
            .eq('student_id', user.userId),
          db.from('attendance')
            .select('status')
            .eq('student_id', user.userId),
          db.from('student_feedback')
            .select('id', { count: 'exact', head: true })
            .eq('student_id', user.userId),
        ]);

        const eng = engRes.data;
        result.engagementLevel = eng?.engagement_level ?? 'moderate';
        result.engagementScore = eng?.engagement_score ?? 0;
        result.totalLoginCount = eng?.total_login_count ?? 0;
        result.lastLoginAt = eng?.last_login_at ?? null;

        const preds: { risk_level: string }[] = predRes.data ?? [];
        result.predictionsCount = preds.length;
        result.highRiskCount = preds.filter(p =>
          p.risk_level === 'high' || p.risk_level === 'very_high' || p.risk_level === 'critical'
        ).length;

        const att: { status: string }[] = attRes.data ?? [];
        result.attendanceTotal = att.length;
        result.attendancePresent = att.filter(a => a.status === 'present').length;

        result.feedbackCount = fbRes.count ?? 0;
      }

      if (user.role === 'parent') {
        const linkRes = await db
          .from('parent_student_links')
          .select('student_id, status, profiles!parent_student_links_student_id_fkey(full_name, email)')
          .eq('parent_id', user.userId);
        result.linkedStudents = (linkRes.data ?? []).map((l: any) => ({
          userId: l.student_id,
          fullName: l.profiles?.full_name ?? 'Unknown',
          email: l.profiles?.email ?? '—',
          status: l.status,
        }));
      }

      if (user.role === 'instructor') {
        const subRes = await db
          .from('subjects')
          .select('id, name, code')
          .eq('instructor_id', user.userId);
        result.subjects = subRes.data ?? [];
      }

      if (user.role === 'guidance_counselor') {
        const refRes = await db
          .from('counseling_referrals')
          .select('status')
          .eq('counselor_id', user.userId);
        const refs: { status: string }[] = refRes.data ?? [];
        result.referralsTotal = refs.length;
        result.referralsPending = refs.filter(r => r.status === 'pending').length;
        result.referralsResolved = refs.filter(r =>
          r.status === 'resolved' || r.status === 'closed'
        ).length;
      }

      setProfileData(result);
      setLoading(false);
    })();
  }, [open, user]);

  if (!user) return null;

  const attendanceRate =
    profileData && profileData.attendanceTotal && profileData.attendanceTotal > 0
      ? Math.round((profileData.attendancePresent! / profileData.attendanceTotal) * 100)
      : null;

  const engagementColor: Record<string, string> = {
    very_high: 'text-emerald-400',
    high: 'text-green-400',
    moderate: 'text-yellow-400',
    low: 'text-red-400',
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-border/50 bg-card/50 p-6">
          <InitialsAvatar name={user.fullName} role={user.role} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{user.fullName}</h2>
              <StatusBadge status={user.accountStatus} />
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <RoleBadge role={user.role} />
              {user.department && (
                <span className="text-xs text-muted-foreground">{user.department}</span>
              )}
              {user.studentId && (
                <span className="text-xs text-muted-foreground">ID: {user.studentId}</span>
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="max-h-[calc(90vh-120px)]">
          <div className="space-y-4 p-6">
            {/* Metadata row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                <p className="text-xs text-muted-foreground">Registered</p>
                <p className="mt-0.5 text-sm font-medium">{formatDate(user.registrationDate)}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                <p className="text-xs text-muted-foreground">Last Login</p>
                <p className="mt-0.5 text-sm font-medium">
                  {user.lastLogin ? formatDateTime(user.lastLogin) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                <p className="text-xs text-muted-foreground">Account Status</p>
                <p className="mt-0.5 text-sm font-medium capitalize">{user.accountStatus}</p>
              </div>
            </div>

            <Separator className="opacity-30" />

            {/* Role-specific sections */}
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Loading profile data…
              </div>
            ) : (
              <>
                {/* ── Student ── */}
                {user.role === 'student' && profileData && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Academic Overview
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                        <p className="text-xs text-muted-foreground">Engagement</p>
                        <p className={`mt-0.5 text-sm font-semibold capitalize ${engagementColor[profileData.engagementLevel ?? 'moderate'] ?? ''}`}>
                          {(profileData.engagementLevel ?? 'moderate').replace('_', ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Score: {profileData.engagementScore?.toFixed(1) ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                        <p className="text-xs text-muted-foreground">Total Logins</p>
                        <p className="mt-0.5 text-sm font-semibold">{profileData.totalLoginCount ?? 0}</p>
                        <p className="text-xs text-muted-foreground">sessions tracked</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                        <p className="text-xs text-muted-foreground">Attendance Rate</p>
                        <p className="mt-0.5 text-sm font-semibold">
                          {attendanceRate !== null ? `${attendanceRate}%` : '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {profileData.attendancePresent ?? 0} / {profileData.attendanceTotal ?? 0} records
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                        <p className="text-xs text-muted-foreground">Risk Predictions</p>
                        <p className="mt-0.5 text-sm font-semibold">{profileData.predictionsCount ?? 0}</p>
                        <p className="text-xs text-muted-foreground">
                          {profileData.highRiskCount ?? 0} high/critical
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3">
                        <p className="text-xs text-muted-foreground">Feedback Given</p>
                        <p className="mt-0.5 text-sm font-semibold">{profileData.feedbackCount ?? 0}</p>
                        <p className="text-xs text-muted-foreground">entries submitted</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Parent ── */}
                {user.role === 'parent' && profileData && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Linked Students ({profileData.linkedStudents?.length ?? 0})
                    </h3>
                    {(profileData.linkedStudents?.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">No linked students yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {profileData.linkedStudents!.map(s => (
                          <div
                            key={s.userId}
                            className="flex items-center justify-between rounded-lg border border-border/50 bg-card/30 px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-medium">{s.fullName}</p>
                              <p className="text-xs text-muted-foreground">{s.email}</p>
                            </div>
                            <span className="text-xs capitalize text-muted-foreground">{s.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Instructor ── */}
                {user.role === 'instructor' && profileData && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Subjects Taught ({profileData.subjects?.length ?? 0})
                    </h3>
                    {(profileData.subjects?.length ?? 0) === 0 ? (
                      <p className="text-sm text-muted-foreground">No subjects assigned yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {profileData.subjects!.map(s => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between rounded-lg border border-border/50 bg-card/30 px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-medium">{s.name}</p>
                              <p className="text-xs text-muted-foreground">{s.code}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Guidance Counselor ── */}
                {user.role === 'guidance_counselor' && profileData && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Counseling Referrals
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3 text-center">
                        <p className="text-2xl font-bold">{profileData.referralsTotal ?? 0}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3 text-center">
                        <p className="text-2xl font-bold text-yellow-400">
                          {profileData.referralsPending ?? 0}
                        </p>
                        <p className="text-xs text-muted-foreground">Pending</p>
                      </div>
                      <div className="rounded-lg border border-border/50 bg-card/30 p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-400">
                          {profileData.referralsResolved ?? 0}
                        </p>
                        <p className="text-xs text-muted-foreground">Resolved</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Admin ── */}
                {user.role === 'admin' && (
                  <div className="rounded-lg border border-border/50 bg-card/30 p-4 text-center text-sm text-muted-foreground">
                    Administrator account. No additional profile data available.
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit User Dialog ───────────────────────────────────────────────────────────

function EditUserDialog({
  user,
  open,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: (userId: string, newName: string, newStatus: AccountStatus) => void;
}) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<AccountStatus>('pending');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) { setName(user.fullName); setStatus(user.accountStatus); }
  }, [user]);

  if (!user) return null;

  async function handleSave() {
    if (!name.trim()) { toast.error('Name cannot be empty.'); return; }
    setSaving(true);
    try {
      const db = supabase as any;
      if (name.trim() !== user!.fullName) {
        const { error } = await db
          .from('profiles')
          .update({ full_name: name.trim(), updated_at: new Date().toISOString() })
          .eq('user_id', user!.userId);
        if (error) throw error;
      }
      if (status !== user!.accountStatus) {
        const { error } = await db.rpc('admin_set_account_status', {
          p_target_user_id: user!.userId,
          p_status: status,
        });
        if (error) throw error;
      }
      toast.success('User updated.');
      onSaved(user!.userId, name.trim(), status);
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Update profile information and account status.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Full Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Full name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" value={user.email} disabled className="opacity-60" />
            <p className="text-xs text-muted-foreground">Email changes are managed via Supabase Auth.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-status">Account Status</Label>
            <Select value={status} onValueChange={v => setStatus(v as AccountStatus)}>
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="deactivated">Deactivated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <RefreshCw className="mr-2 h-3 w-3 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirm Dialog ──────────────────────────────────────────────────────

function DeleteConfirmDialog({
  users,
  open,
  onClose,
  onDeleted,
}: {
  users: UserRow[];
  open: boolean;
  onClose: () => void;
  onDeleted: (ids: string[]) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const db = supabase as any;
    const failed: string[] = [];
    for (const u of users) {
      const { error } = await db.rpc('admin_delete_user', { p_target_user_id: u.userId });
      if (error) { failed.push(u.fullName); console.error(error); }
    }
    if (failed.length > 0) {
      toast.error(`Failed to delete: ${failed.join(', ')}`);
    } else {
      toast.success(`${users.length} user${users.length > 1 ? 's' : ''} deleted.`);
    }
    onDeleted(users.filter(u => !failed.includes(u.fullName)).map(u => u.userId));
    setDeleting(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-red-400">Confirm Delete</DialogTitle>
          <DialogDescription>
            This action is <strong className="text-foreground">permanent</strong> and cannot be
            undone. The following user{users.length > 1 ? 's' : ''} and all associated data will
            be permanently removed:
          </DialogDescription>
        </DialogHeader>
        <ul className="my-2 space-y-1 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm">
          {users.map(u => (
            <li key={u.userId} className="truncate">
              <span className="font-medium">{u.fullName}</span>
              <span className="ml-1 text-muted-foreground">({u.email})</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting && <RefreshCw className="mr-2 h-3 w-3 animate-spin" />}
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Actions Bar ───────────────────────────────────────────────────────────

function BulkActionsBar({
  selectedCount,
  selectedRows,
  onDeactivate,
  onReactivate,
  onDelete,
  onExport,
  onClear,
}: {
  selectedCount: number;
  selectedRows: UserRow[];
  onDeactivate: () => void;
  onReactivate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/80 px-4 py-2 backdrop-blur">
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Button size="sm" variant="outline" onClick={onDeactivate}>
        <ShieldOff className="mr-1 h-3.5 w-3.5" /> Deactivate
      </Button>
      <Button size="sm" variant="outline" onClick={onReactivate}>
        <UserCheck className="mr-1 h-3.5 w-3.5" /> Reactivate
      </Button>
      <Button size="sm" variant="outline" onClick={onExport}>
        <Download className="mr-1 h-3.5 w-3.5" /> Export
      </Button>
      <Button size="sm" variant="destructive" onClick={onDelete}>
        <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        Clear
      </Button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const ROLE_TABS: { value: RoleTab; label: string }[] = [
  { value: 'all',                label: 'All Users' },
  { value: 'student',            label: 'Students' },
  { value: 'parent',             label: 'Parents' },
  { value: 'instructor',         label: 'Instructors' },
  { value: 'guidance_counselor', label: 'Counselors' },
  { value: 'admin',              label: 'Administrators' },
];

export default function AdminUserManagement() {
  const { role } = useAuth();
  if (role !== 'admin') return <Navigate to="/dashboard" replace />;

  const [allRows, setAllRows]         = useState<UserRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState<RoleTab>('all');
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder]     = useState<SortOrder>('newest');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dialogs
  const [viewUser,   setViewUser]   = useState<UserRow | null>(null);
  const [editUser,   setEditUser]   = useState<UserRow | null>(null);
  const [deleteUsers, setDeleteUsers] = useState<UserRow[]>([]);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const db = supabase as any;
      const [profilesRes, rolesRes, engagementRes, invitationsRes] = await Promise.all([
        db.from('profiles').select('user_id, full_name, email, student_id, account_status, created_at'),
        db.from('user_roles').select('user_id, role'),
        db.from('student_engagement_summary').select('student_id, last_login_at'),
        db.from('staff_invitations').select('email, department').eq('status', 'accepted'),
      ]);

      const roleMap = new Map<string, AppRole>(
        (rolesRes.data ?? []).map((r: any) => [r.user_id, r.role as AppRole])
      );
      const engMap = new Map<string, string>(
        (engagementRes.data ?? []).map((e: any) => [e.student_id, e.last_login_at])
      );
      const deptMap = new Map<string, string>(
        (invitationsRes.data ?? []).map((i: any) => [i.email?.toLowerCase(), i.department])
      );

      const rows: UserRow[] = (profilesRes.data ?? []).map((p: any) => ({
        userId: p.user_id,
        fullName: p.full_name || '(No Name)',
        email: p.email ?? '',
        role: roleMap.get(p.user_id) ?? 'student',
        department: deptMap.get(p.email?.toLowerCase()) ?? null,
        accountStatus: p.account_status as AccountStatus,
        registrationDate: p.created_at,
        lastLogin: engMap.get(p.user_id) ?? null,
        studentId: p.student_id ?? null,
      }));

      setAllRows(rows);
    } catch (err: any) {
      toast.error('Failed to load users: ' + (err.message ?? 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Computed stats ─────────────────────────────────────────────────────────
  const stats = useMemo<Stats>(() => ({
    total:       allRows.length,
    students:    allRows.filter(r => r.role === 'student').length,
    parents:     allRows.filter(r => r.role === 'parent').length,
    instructors: allRows.filter(r => r.role === 'instructor').length,
    counselors:  allRows.filter(r => r.role === 'guidance_counselor').length,
    admins:      allRows.filter(r => r.role === 'admin').length,
    pending:     allRows.filter(r => r.accountStatus === 'pending').length,
    inactive:    allRows.filter(r => r.accountStatus === 'deactivated').length,
  }), [allRows]);

  // ── Filtered & sorted rows ─────────────────────────────────────────────────
  const displayRows = useMemo(() => {
    let rows = allRows;

    if (activeTab !== 'all') rows = rows.filter(r => r.role === activeTab);
    if (statusFilter !== 'all') rows = rows.filter(r => r.accountStatus === statusFilter);

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.department ?? '').toLowerCase().includes(q) ||
        formatRoleLabel(r.role).toLowerCase().includes(q)
      );
    }

    rows = [...rows].sort((a, b) => {
      const diff = new Date(a.registrationDate).getTime() - new Date(b.registrationDate).getTime();
      return sortOrder === 'newest' ? -diff : diff;
    });

    return rows;
  }, [allRows, activeTab, statusFilter, search, sortOrder]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  const isAllSelected =
    displayRows.length > 0 && displayRows.every(r => selectedIds.has(r.userId));
  const isSomeSelected = displayRows.some(r => selectedIds.has(r.userId));

  function toggleAll() {
    if (isAllSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        displayRows.forEach(r => next.delete(r.userId));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        displayRows.forEach(r => next.add(r.userId));
        return next;
      });
    }
  }

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedRows = displayRows.filter(r => selectedIds.has(r.userId));

  // ── Bulk status change ─────────────────────────────────────────────────────
  async function bulkSetStatus(newStatus: AccountStatus) {
    const db = supabase as any;
    let succeeded = 0;
    for (const u of selectedRows) {
      const { error } = await db.rpc('admin_set_account_status', {
        p_target_user_id: u.userId,
        p_status: newStatus,
      });
      if (!error) succeeded++;
    }
    toast.success(`${succeeded} user${succeeded !== 1 ? 's' : ''} updated to ${newStatus}.`);
    setAllRows(prev => prev.map(r =>
      selectedIds.has(r.userId) ? { ...r, accountStatus: newStatus } : r
    ));
    setSelectedIds(new Set());
  }

  // ── Row mutations ──────────────────────────────────────────────────────────
  function handleEditSaved(userId: string, newName: string, newStatus: AccountStatus) {
    setAllRows(prev => prev.map(r =>
      r.userId === userId ? { ...r, fullName: newName, accountStatus: newStatus } : r
    ));
  }

  function handleDeleted(ids: string[]) {
    setAllRows(prev => prev.filter(r => !ids.includes(r.userId)));
    setSelectedIds(new Set());
  }

  // ── Quick single-row actions ───────────────────────────────────────────────
  async function quickSetStatus(userId: string, newStatus: AccountStatus) {
    const db = supabase as any;
    const { error } = await db.rpc('admin_set_account_status', {
      p_target_user_id: userId,
      p_status: newStatus,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Account ${newStatus}.`);
    setAllRows(prev => prev.map(r =>
      r.userId === userId ? { ...r, accountStatus: newStatus } : r
    ));
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage all registered users, roles, and account statuses.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <StatsCards stats={stats} loading={loading} />

      {/* Tabs + Controls */}
      <Card className="border-border/50">
        <CardHeader className="pb-0">
          <Tabs value={activeTab} onValueChange={v => { setActiveTab(v as RoleTab); setSelectedIds(new Set()); }}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
                {ROLE_TABS.map(t => (
                  <TabsTrigger
                    key={t.value}
                    value={t.value}
                    className="h-8 rounded-md px-3 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    {t.label}
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      {t.value === 'all'
                        ? allRows.length
                        : t.value === 'guidance_counselor'
                          ? stats.counselors
                          : stats[t.value as keyof Stats] as number}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Search / filter / sort */}
            <div className="mt-4 flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search name, email, department, role…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="h-9 w-[140px] text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="approved">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="deactivated">Deactivated</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortOrder} onValueChange={v => setSortOrder(v as SortOrder)}>
                <SelectTrigger className="h-9 w-[120px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => exportToCSV(displayRows, `users-${activeTab}-${new Date().toISOString().split('T')[0]}.csv`)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export All
              </Button>
            </div>

            {/* Bulk actions bar */}
            {selectedIds.size > 0 && (
              <div className="mt-3">
                <BulkActionsBar
                  selectedCount={selectedIds.size}
                  selectedRows={selectedRows}
                  onDeactivate={() => bulkSetStatus('deactivated')}
                  onReactivate={() => bulkSetStatus('approved')}
                  onExport={() => exportToCSV(selectedRows, `selected-users-${Date.now()}.csv`)}
                  onDelete={() => setDeleteUsers(selectedRows)}
                  onClear={() => setSelectedIds(new Set())}
                />
              </div>
            )}

            {/* Table — same for all tabs */}
            {ROLE_TABS.map(t => (
              <TabsContent key={t.value} value={t.value} className="mt-4">
                {loading ? (
                  <div className="flex items-center justify-center py-20 text-muted-foreground">
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Loading users…
                  </div>
                ) : displayRows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Users className="mb-2 h-8 w-8 opacity-40" />
                    <p className="text-sm">No users found.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border/50">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-10">
                            <Checkbox
                              checked={isAllSelected ? true : isSomeSelected ? 'indeterminate' : false}
                              onCheckedChange={toggleAll}
                              aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead>User</TableHead>
                          <TableHead className="hidden sm:table-cell">Role</TableHead>
                          <TableHead className="hidden md:table-cell">Department</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="hidden lg:table-cell">Registered</TableHead>
                          <TableHead className="hidden lg:table-cell">Last Login</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayRows.map(row => (
                          <TableRow
                            key={row.userId}
                            className={selectedIds.has(row.userId) ? 'bg-primary/5' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(row.userId)}
                                onCheckedChange={() => toggleRow(row.userId)}
                                aria-label={`Select ${row.fullName}`}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <InitialsAvatar name={row.fullName} role={row.role} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{row.fullName}</p>
                                  <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <RoleBadge role={row.role} />
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                              {row.department ?? '—'}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={row.accountStatus} />
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {formatDate(row.registrationDate)}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                              {row.lastLogin ? formatDateTime(row.lastLogin) : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="View profile"
                                  onClick={() => setViewUser(row)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="Edit user"
                                  onClick={() => setEditUser(row)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                {row.accountStatus === 'approved' ? (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-yellow-500 hover:text-yellow-400"
                                    title="Deactivate"
                                    onClick={() => quickSetStatus(row.userId, 'deactivated')}
                                  >
                                    <UserX className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-emerald-500 hover:text-emerald-400"
                                    title="Reactivate"
                                    onClick={() => quickSetStatus(row.userId, 'approved')}
                                  >
                                    <UserCheck className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-red-500 hover:text-red-400"
                                  title="Delete user"
                                  onClick={() => setDeleteUsers([row])}
                                  disabled={row.role === 'admin'}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="mt-2 text-right text-xs text-muted-foreground">
                  {displayRows.length} user{displayRows.length !== 1 ? 's' : ''}
                  {allRows.length !== displayRows.length && ` (filtered from ${allRows.length})`}
                </p>
              </TabsContent>
            ))}
          </Tabs>
        </CardHeader>
        <CardContent />
      </Card>

      {/* Dialogs */}
      <ProfileViewerDialog
        user={viewUser}
        open={!!viewUser}
        onClose={() => setViewUser(null)}
      />
      <EditUserDialog
        user={editUser}
        open={!!editUser}
        onClose={() => setEditUser(null)}
        onSaved={handleEditSaved}
      />
      <DeleteConfirmDialog
        users={deleteUsers}
        open={deleteUsers.length > 0}
        onClose={() => setDeleteUsers([])}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
