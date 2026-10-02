import {
  LayoutDashboard, BookOpen, BarChart3, GraduationCap, CalendarCheck, FileText, LogOut, Settings, Library, FileBarChart, UserCheck, ClipboardList, Mail, Users, Activity,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/hooks/useAuth';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

export type SidebarNavItem = { title: string; url: string; icon: LucideIcon };

const instructorItems: SidebarNavItem[] = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Subjects', url: '/dashboard/subjects', icon: BookOpen },
  { title: 'Engagement Monitoring', url: '/dashboard/student-engagement', icon: Activity },
  { title: 'Reports', url: '/dashboard/reports', icon: FileBarChart },
  { title: 'Programs', url: '/dashboard/programs', icon: Library },
  { title: 'Insights', url: '/dashboard/insights', icon: BarChart3 },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

const studentItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'My Subjects', url: '/dashboard/my-subjects', icon: BookOpen },
  { title: 'My Engagement', url: '/dashboard/my-engagement', icon: Activity },
  { title: 'Feedback', url: '/dashboard/feedback', icon: FileText },
  { title: 'Attendance', url: '/dashboard/my-attendance', icon: CalendarCheck },
  { title: 'Scores', url: '/dashboard/my-scores', icon: FileText },
  { title: 'Insights', url: '/dashboard/insights', icon: BarChart3 },
  { title: 'Parent Access', url: '/dashboard/parent-access', icon: UserCheck },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

const parentItems = [
  { title: 'Student Performance', url: '/dashboard/parent-performance', icon: BarChart3 },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

const guidanceItems = [
  { title: 'Counseling Referrals', url: '/dashboard/guidance-referrals', icon: UserCheck },
  { title: 'Student Engagement', url: '/dashboard/guidance-engagement', icon: Activity },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

const adminItems = [
  { title: 'User Management',   url: '/dashboard/admin/user-management',    icon: Users },
  { title: 'User Approvals',    url: '/dashboard/admin/approvals',          icon: UserCheck },
  { title: 'Staff Requests',    url: '/dashboard/admin/staff-requests',     icon: ClipboardList },
  { title: 'Staff Invitations', url: '/dashboard/admin/staff-invitations',  icon: Mail },
  { title: 'Engagement Analytics', url: '/dashboard/admin/engagement-analytics', icon: Activity },
  { title: 'Settings',          url: '/dashboard/settings',                 icon: Settings },
];

export function navItemsForRole(role: string | null): SidebarNavItem[] {
  if (role === 'admin') return adminItems;
  if (role === 'instructor') return instructorItems;
  if (role === 'parent') return parentItems;
  if (role === 'guidance_counselor') return guidanceItems;
  return studentItems;
}

export function AppSidebar() {
  const { state, setOpen, isMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const { role, signOut, user } = useAuth();
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const items = navItemsForRole(role);
  const showText = !collapsed || isMobile;

  return (
    <Sidebar
      collapsible="icon"
      className="border-0 bg-transparent"
      onMouseEnter={() => {
        if (isMobile) return;
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        setOpen(true);
      }}
      onMouseLeave={() => {
        if (isMobile) return;
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        closeTimer.current = window.setTimeout(() => setOpen(false), 140);
      }}
    >
      <SidebarContent className="m-3 rounded-[22px] border border-sidebar-border bg-sidebar shadow-[0_16px_40px_-28px_hsl(234_60%_40%/0.45)]">
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2.5 border-b border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[12px] bg-sidebar-primary">
              <GraduationCap className="h-4 w-4 text-sidebar-primary-foreground" />
            </div>
            {showText && (
              <span className="text-sidebar-foreground font-display font-bold text-lg leading-none">EDGE</span>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent className="px-2 py-3 group-data-[collapsible=icon]:px-1">
            <SidebarMenu className="space-y-1">
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/dashboard' || item.url.startsWith('/dashboard/admin/')}
                      className="group flex items-center gap-3 rounded-[12px] px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2"
                      activeClassName="bg-sidebar-accent font-semibold text-sidebar-primary"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {showText && <span className="text-sm font-medium">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="mx-3 mb-3 rounded-b-[22px] border border-t-0 border-sidebar-border bg-sidebar p-4 group-data-[collapsible=icon]:p-2">
        {showText && (
          <div className="mb-3 rounded-md border border-sidebar-border px-2.5 py-2">
            <p className="truncate text-xs font-medium text-sidebar-foreground">
              {user?.email}
            </p>
            <p className="mt-1 text-xs capitalize text-muted-foreground">
              {role} Account
            </p>
          </div>
        )}
        <Button
          variant="ghost"
          size={showText ? 'sm' : 'icon'}
          className="w-full justify-start text-sidebar-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {showText && <span className="ml-2 text-sm font-medium">Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
