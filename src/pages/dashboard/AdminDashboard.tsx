import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Tooltip, Legend,
} from 'recharts';
import {
  Users, GraduationCap, Users2, BookOpen, UserCog, ShieldCheck,
  Clock, ShieldOff, Mail, ClipboardList, UserPlus, BarChart3,
  RefreshCw, ArrowRight, CalendarCheck, Bell,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type AppRole = 'student' | 'parent' | 'instructor' | 'guidance_counselor' | 'admin';
type AccountStatus = 'pending' | 'approved' | 'rejected' | 'deactivated';

type DashboardStats = {
  students: number;
  parents: number;
  instructors: number;
  counselors: number;
  admins: number;
  pendingRequests: number;
  pendingInvitations: number;
  inactiveAccounts: number;
};

type RecentRegistration = {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  accountStatus: AccountStatus;
  createdAt: string;
};

type RecentRequest = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  submittedAt: string;
};

type RecentInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

const ROLE_COLORS: Record<AppRole, string> = {
  student:            '#3b82f6',
  parent:             '#a855f7',
  instructor:         '#22c55e',
  guidance_counselor: '#f97316',
  admin:              '#f43f5e',
};

const ROLE_BG: Record<AppRole, string> = {
  student:            'bg-blue-500',
  parent:             'bg-purple-500',
  instructor:         'bg-green-500',
  guidance_counselor: 'bg-orange-500',
  admin:              'bg-rose-500',
};

const ROLE_LABELS: Record<AppRole, string> = {
  student:            'Student',
  parent:             'Parent',
  instructor:         'Instructor',
  guidance_counselor: 'Guidance Counselor',
  admin:              'Admin',
};

const STATUS_COLORS: Record<string, string> = {
  approved:    '#10b981',
  pending:     '#eab308',
  deactivated: '#64748b',
  rejected:    '#ef4444',
};

function RoleAvatar({ name, role }: { name: string; role: AppRole }) {
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${ROLE_BG[role] ?? 'bg-slate-500'}`}>
      {getInitials(name) || '?'}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved:  'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    pending:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    rejected:  'bg-red-500/10 text-red-400 border-red-500/20',
    accepted:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
    deactivated: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    expired:   'bg-slate-500/10 text-slate-400 border-slate-500/20',
    revoked:   'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize ${map[status] ?? ''}`}>
      {status}
    </span>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, color, href, loading,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  href?: string;
  loading: boolean;
}) {
  const inner = (
    <Card className="group border-border/50 bg-card/50 transition-colors hover:bg-card/80">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${color} bg-opacity-10`}>
          <Icon className={`h-5 w-5 ${color.replace('bg-', 'text-')}`} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold leading-none mt-0.5">
            {loading ? <span className="inline-block h-5 w-10 animate-pulse rounded bg-muted" /> : value}
          </p>
        </div>
        {href && <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
      </CardContent>
    </Card>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}

// ── Charts ─────────────────────────────────────────────────────────────────────

function RolePieChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const RADIAN = Math.PI / 180;
  const renderLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
    if (value === 0) return null;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
        {value}
      </text>
    );
  };

  return (
    <ChartContainer
      config={Object.fromEntries(data.map(d => [d.name, { label: d.name, color: d.color }]))}
      className="h-[220px] w-full"
    >
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          outerRadius={80}
          dataKey="value"
          labelLine={false}
          label={renderLabel}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0];
            return (
              <div className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs shadow-lg">
                <span className="font-medium">{p.name}</span>: {p.value}
              </div>
            );
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={v => <span className="text-xs text-muted-foreground">{v}</span>}
        />
      </PieChart>
    </ChartContainer>
  );
}

function StatusBarChart({ data }: { data: { status: string; count: number; color: string }[] }) {
  return (
    <ChartContainer
      config={Object.fromEntries(data.map(d => [d.status, { label: d.status, color: d.color }]))}
      className="h-[220px] w-full"
    >
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis dataKey="status" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs shadow-lg">
                <span className="font-medium capitalize">{payload[0].payload.status}</span>: {payload[0].value}
              </div>
            );
          }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function MonthlyAreaChart({ data }: { data: { label: string; registrations: number }[] }) {
  return (
    <ChartContainer
      config={{ registrations: { label: 'Registrations', color: '#3b82f6' } }}
      className="h-[220px] w-full"
    >
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="regGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area type="monotone" dataKey="registrations" stroke="#3b82f6" fill="url(#regGradient)" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} />
      </AreaChart>
    </ChartContainer>
  );
}

function LoginsBarChart({ data }: { data: { label: string; logins: number }[] }) {
  return (
    <ChartContainer
      config={{ logins: { label: 'Logins', color: '#22c55e' } }}
      className="h-[220px] w-full"
    >
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="logins" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

// ── Quick Actions ──────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  {
    label: 'Invite Staff',
    description: 'Send a new staff invitation',
    icon: UserPlus,
    href: '/dashboard/admin/staff-invitations',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 hover:bg-blue-500/20',
    border: 'border-blue-500/20',
  },
  {
    label: 'Manage Users',
    description: 'View and edit all user accounts',
    icon: Users,
    href: '/dashboard/admin/user-management',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 hover:bg-purple-500/20',
    border: 'border-purple-500/20',
  },
  {
    label: 'View Requests',
    description: 'Review staff registration requests',
    icon: ClipboardList,
    href: '/dashboard/admin/staff-requests',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 hover:bg-orange-500/20',
    border: 'border-orange-500/20',
  },
  {
    label: 'Reports',
    description: 'Analytics and system reports',
    icon: BarChart3,
    href: '/dashboard/reports',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 hover:bg-emerald-500/20',
    border: 'border-emerald-500/20',
  },
];

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [stats, setStats]                       = useState<DashboardStats | null>(null);
  const [recentReg, setRecentReg]               = useState<RecentRegistration[]>([]);
  const [recentRequests, setRecentRequests]     = useState<RecentRequest[]>([]);
  const [recentInvitations, setRecentInvitations] = useState<RecentInvitation[]>([]);
  const [monthlyData, setMonthlyData]           = useState<{ label: string; registrations: number }[]>([]);
  const [loginData, setLoginData]               = useState<{ label: string; logins: number }[]>([]);
  const [roleChartData, setRoleChartData]       = useState<{ name: string; value: number; color: string }[]>([]);
  const [statusChartData, setStatusChartData]   = useState<{ status: string; count: number; color: string }[]>([]);
  const [loading, setLoading]                   = useState(true);
  const [lastRefreshed, setLastRefreshed]       = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = supabase as any;

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        profilesRes, rolesRes,
        requestsRes, invitationsRes,
        loginsRes,
      ] = await Promise.all([
        db.from('profiles').select('user_id, full_name, email, account_status, created_at'),
        db.from('user_roles').select('user_id, role'),
        db.from('staff_registration_requests')
          .select('id, full_name, email, role, status, submitted_at')
          .order('submitted_at', { ascending: false })
          .limit(5),
        db.from('staff_invitations')
          .select('id, email, role, status, expires_at, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
        db.from('student_login_history')
          .select('login_time')
          .gte('login_time', sevenDaysAgo)
          .order('login_time', { ascending: false }),
      ]);

      const profiles: any[] = profilesRes.data ?? [];
      const roles: any[]    = rolesRes.data ?? [];

      // Build role map
      const roleMap = new Map<string, AppRole>(roles.map(r => [r.user_id, r.role as AppRole]));

      // ── Stats ──────────────────────────────────────────────────────────────
      const roleCounts = { student: 0, parent: 0, instructor: 0, guidance_counselor: 0, admin: 0 };
      for (const r of roles) {
        if (r.role in roleCounts) roleCounts[r.role as AppRole]++;
      }

      const allRequests: any[] = requestsRes.data ?? [];
      const allInvitations: any[] = invitationsRes.data ?? [];

      setStats({
        students:           roleCounts.student,
        parents:            roleCounts.parent,
        instructors:        roleCounts.instructor,
        counselors:         roleCounts.guidance_counselor,
        admins:             roleCounts.admin,
        pendingRequests:    0, // overridden below via full counts
        pendingInvitations: 0,
        inactiveAccounts:   profiles.filter(p => p.account_status === 'deactivated').length,
      });

      // Get actual pending counts (the limited queries above may not include all pending)
      const [pendingReqRes, pendingInvRes] = await Promise.all([
        db.from('staff_registration_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        db.from('staff_invitations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);

      setStats(prev => prev ? ({
        ...prev,
        pendingRequests:    pendingReqRes.count ?? 0,
        pendingInvitations: pendingInvRes.count ?? 0,
      }) : prev);

      // ── Role pie chart ─────────────────────────────────────────────────────
      setRoleChartData([
        { name: 'Students',    value: roleCounts.student,            color: ROLE_COLORS.student },
        { name: 'Parents',     value: roleCounts.parent,             color: ROLE_COLORS.parent },
        { name: 'Instructors', value: roleCounts.instructor,         color: ROLE_COLORS.instructor },
        { name: 'Counselors',  value: roleCounts.guidance_counselor, color: ROLE_COLORS.guidance_counselor },
        { name: 'Admins',      value: roleCounts.admin,              color: ROLE_COLORS.admin },
      ].filter(d => d.value > 0));

      // ── Status bar chart ───────────────────────────────────────────────────
      const statusCounts: Record<string, number> = { approved: 0, pending: 0, deactivated: 0, rejected: 0 };
      for (const p of profiles) {
        if (p.account_status in statusCounts) statusCounts[p.account_status]++;
      }
      setStatusChartData([
        { status: 'Active',      count: statusCounts.approved,    color: STATUS_COLORS.approved },
        { status: 'Pending',     count: statusCounts.pending,     color: STATUS_COLORS.pending },
        { status: 'Deactivated', count: statusCounts.deactivated, color: STATUS_COLORS.deactivated },
        { status: 'Rejected',    count: statusCounts.rejected,    color: STATUS_COLORS.rejected },
      ]);

      // ── Monthly registrations (last 6 months) ──────────────────────────────
      const now = new Date();
      const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
        return { key, label, registrations: 0 };
      });
      for (const p of profiles) {
        if (!p.created_at) continue;
        const d = new Date(p.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const m = months.find(m => m.key === key);
        if (m) m.registrations++;
      }
      setMonthlyData(months.map(({ label, registrations }) => ({ label, registrations })));

      // ── Login activity (last 7 days) ───────────────────────────────────────
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const key = d.toISOString().split('T')[0];
        const label = d.toLocaleDateString('en-PH', { weekday: 'short' });
        return { key, label, logins: 0 };
      });
      for (const l of (loginsRes.data ?? []) as any[]) {
        const key = new Date(l.login_time).toISOString().split('T')[0];
        const d = days.find(d => d.key === key);
        if (d) d.logins++;
      }
      setLoginData(days.map(({ label, logins }) => ({ label, logins })));

      // ── Recent registrations (latest 5) ───────────────────────────────────
      const sortedProfiles = [...profiles]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5);
      setRecentReg(sortedProfiles.map(p => ({
        userId: p.user_id,
        fullName: p.full_name || '(No Name)',
        email: p.email ?? '',
        role: roleMap.get(p.user_id) ?? 'student',
        accountStatus: p.account_status as AccountStatus,
        createdAt: p.created_at,
      })));

      // ── Recent staff requests ──────────────────────────────────────────────
      setRecentRequests((allRequests ?? []).map((r: any) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        role: r.role,
        status: r.status,
        submittedAt: r.submitted_at,
      })));

      // ── Recent invitations ─────────────────────────────────────────────────
      setRecentInvitations((allInvitations ?? []).map((i: any) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expires_at,
        createdAt: i.created_at,
      })));

      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Admin dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Stat card definitions ──────────────────────────────────────────────────
  const statCards = useMemo(() => [
    { label: 'Students',            value: stats?.students ?? 0,           icon: GraduationCap, color: 'bg-blue-500',    href: '/dashboard/admin/user-management' },
    { label: 'Parents',             value: stats?.parents ?? 0,            icon: Users2,        color: 'bg-purple-500',  href: '/dashboard/admin/user-management' },
    { label: 'Instructors',         value: stats?.instructors ?? 0,        icon: BookOpen,      color: 'bg-green-500',   href: '/dashboard/admin/user-management' },
    { label: 'Guidance Counselors', value: stats?.counselors ?? 0,         icon: UserCog,       color: 'bg-orange-500',  href: '/dashboard/admin/user-management' },
    { label: 'Administrators',      value: stats?.admins ?? 0,             icon: ShieldCheck,   color: 'bg-rose-500',    href: '/dashboard/admin/user-management' },
    { label: 'Pending Requests',    value: stats?.pendingRequests ?? 0,    icon: ClipboardList, color: 'bg-yellow-500',  href: '/dashboard/admin/staff-requests' },
    { label: 'Pending Invitations', value: stats?.pendingInvitations ?? 0, icon: Mail,          color: 'bg-blue-500',    href: '/dashboard/admin/staff-invitations' },
    { label: 'Inactive Accounts',   value: stats?.inactiveAccounts ?? 0,   icon: ShieldOff,     color: 'bg-slate-500',   href: '/dashboard/admin/user-management' },
  ], [stats]);

  return (
    <div className="space-y-6 p-4 md:p-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            System overview — last updated {lastRefreshed.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {statCards.map(c => (
          <StatCard key={c.label} {...c} loading={loading} />
        ))}
      </div>

      {/* ── Charts Row 1: Role Pie + Status Bar ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Users by Role</CardTitle>
            <CardDescription className="text-xs">Distribution across all roles</CardDescription>
          </CardHeader>
          <CardContent>
            {loading || roleChartData.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'No data'}
              </div>
            ) : (
              <RolePieChart data={roleChartData} />
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Users by Status</CardTitle>
            <CardDescription className="text-xs">Account status breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <StatusBarChart data={statusChartData} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row 2: Monthly Registrations + Recent Logins ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Monthly Registrations</CardTitle>
            <CardDescription className="text-xs">New user registrations — last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <MonthlyAreaChart data={monthlyData} />
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Recent Logins</CardTitle>
            <CardDescription className="text-xs">Student login sessions — last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <LoginsBarChart data={loginData} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Quick Actions ── */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_ACTIONS.map(action => (
            <Link key={action.label} to={action.href}>
              <Card className={`group cursor-pointer border transition-colors ${action.border} ${action.bg}`}>
                <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-background/50`}>
                    <action.icon className={`h-5 w-5 ${action.color}`} />
                  </div>
                  <p className="text-sm font-medium">{action.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight">{action.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Activity Tables ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Latest Registrations */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-semibold">Latest Registrations</CardTitle>
              <CardDescription className="text-xs">Most recently registered users</CardDescription>
            </div>
            <Link to="/dashboard/admin/user-management">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentReg.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No registrations yet.</p>
            ) : (
              <div className="space-y-2.5">
                {recentReg.map(u => (
                  <div key={u.userId} className="flex items-center gap-2.5">
                    <RoleAvatar name={u.fullName} role={u.role} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{u.fullName}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{ROLE_LABELS[u.role]}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StatusPill status={u.accountStatus} />
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{formatRelative(u.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Staff Requests */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-semibold">Recent Staff Requests</CardTitle>
              <CardDescription className="text-xs">Latest staff account requests</CardDescription>
            </div>
            <Link to="/dashboard/admin/staff-requests">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : recentRequests.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No requests yet.</p>
            ) : (
              <div className="space-y-2">
                {recentRequests.map(r => (
                  <div key={r.id} className="rounded-lg border border-border/40 bg-card/30 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{r.fullName}</p>
                      <StatusPill status={r.status} />
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {r.role === 'guidance_counselor' ? 'Guidance Counselor' : 'Instructor'} · {formatRelative(r.submittedAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Invitations */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-semibold">Recent Invitations</CardTitle>
              <CardDescription className="text-xs">Latest staff invitations sent</CardDescription>
            </div>
            <Link to="/dashboard/admin/staff-invitations">
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {loading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : recentInvitations.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No invitations sent yet.</p>
            ) : (
              <div className="space-y-2">
                {recentInvitations.map(inv => (
                  <div key={inv.id} className="rounded-lg border border-border/40 bg-card/30 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{inv.email}</p>
                      <StatusPill status={inv.status} />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {inv.role === 'guidance_counselor' ? 'Guidance Counselor' : 'Instructor'}
                      {inv.status === 'pending' && (
                        <> · Expires {formatDate(inv.expiresAt)}</>
                      )}
                      {inv.status !== 'pending' && (
                        <> · {formatRelative(inv.createdAt)}</>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

    </div>
  );
}
