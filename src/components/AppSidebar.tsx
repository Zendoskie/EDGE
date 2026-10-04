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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

function roleLabel(role: string | null): string {
  if (role === 'guidance_counselor') return 'Counselor';
  if (role === 'admin') return 'Administrator';
  if (role === 'instructor') return 'Instructor';
  if (role === 'parent') return 'Parent';
  if (role === 'student') return 'Student';
  return 'Account';
}

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

  const signOutButton = (
    <Button
      variant="ghost"
      size={showText ? 'sm' : 'icon'}
      className="mt-2 h-8 w-full justify-center gap-2 rounded-lg bg-white text-[#0b1437] hover:bg-white/90 hover:text-[#0b1437] group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:text-white group-data-[collapsible=icon]:px-0"
      onClick={signOut}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      {showText && <span className="text-sm font-medium">Sign out</span>}
    </Button>
  );

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
      <SidebarContent className="bg-transparent px-3 pt-4 group-data-[collapsible=icon]:m-1.5 group-data-[collapsible=icon]:mb-0 group-data-[collapsible=icon]:!h-auto group-data-[collapsible=icon]:!flex-none group-data-[collapsible=icon]:!overflow-visible group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:pt-2">
        <SidebarGroup className="p-0 group-data-[collapsible=icon]:p-1">
          <SidebarGroupLabel className="mb-4 flex h-auto items-center gap-2.5 px-2 py-1 group-data-[collapsible=icon]:!mt-0 group-data-[collapsible=icon]:!h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-1 group-data-[collapsible=icon]:!opacity-100">
            <div className="vision-mark flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl">
              <GraduationCap className="h-4 w-4 text-white" />
            </div>
            {showText && (
              <span className="text-[13px] font-bold tracking-[0.14em] text-sidebar-foreground">EDGE</span>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent className="group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2">
            <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
              {items.map((item) => (
                <SidebarMenuItem key={item.title} className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                  <SidebarMenuButton asChild tooltip={item.title} className="h-10 group-data-[collapsible=icon]:!size-8">
                    <NavLink
                      to={item.url}
                      end={item.url === '/dashboard' || item.url.startsWith('/dashboard/admin/')}
                      className="group/nav flex items-center gap-3 rounded-[12px] px-3 py-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0"
                      activeClassName="is-active vision-nav-active font-semibold text-sidebar-accent-foreground"
                    >
                      <item.icon className="vision-nav-icon h-4 w-4 shrink-0" />
                      {showText && <span className="truncate text-sm font-medium">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="vision-account mx-3 mb-4 gap-2 rounded-2xl border border-white/10 px-3 py-3 group-data-[collapsible=icon]:mx-1.5 group-data-[collapsible=icon]:mb-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-1.5 group-data-[collapsible=icon]:py-1.5">
        {showText && (
          <div className="min-w-0">
            <p className="text-sm font-semibold text-sidebar-foreground">{roleLabel(role)}</p>
            <p className="truncate text-xs text-sidebar-foreground/70">{user?.email}</p>
          </div>
        )}
        {showText ? signOutButton : (
          <Tooltip>
            <TooltipTrigger asChild>{signOutButton}</TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
