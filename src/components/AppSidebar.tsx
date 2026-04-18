import {
  LayoutDashboard, BookOpen, BarChart3, GraduationCap, CalendarCheck, FileText, LogOut, Settings, Library, FileBarChart, UserCheck,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink } from '@/components/NavLink';
import { useAuth } from '@/hooks/useAuth';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

const instructorItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Subjects', url: '/dashboard/subjects', icon: BookOpen },
  { title: 'Reports', url: '/dashboard/reports', icon: FileBarChart },
  { title: 'Programs', url: '/dashboard/programs', icon: Library },
  { title: 'Insights', url: '/dashboard/insights', icon: BarChart3 },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

const studentItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'My Subjects', url: '/dashboard/my-subjects', icon: BookOpen },
  { title: 'Attendance', url: '/dashboard/my-attendance', icon: CalendarCheck },
  { title: 'Scores', url: '/dashboard/my-scores', icon: FileText },
  { title: 'Insights', url: '/dashboard/insights', icon: BarChart3 },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

const adminItems = [
  { title: 'User approvals', url: '/dashboard/admin/approvals', icon: UserCheck },
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
];

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

  const items = role === 'admin' ? adminItems : role === 'instructor' ? instructorItems : studentItems;
  const showText = !collapsed || isMobile;

  return (
    <Sidebar
      collapsible="icon"
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
      <SidebarContent className="border-r border-sidebar-border/40 bg-sidebar/90 backdrop-blur-md">
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-center gap-3 px-4 py-5 border-b border-sidebar-border/20 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sidebar-primary to-violet-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-primary/20">
              <GraduationCap className="w-4 h-4 text-sidebar-primary-foreground" />
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
                      end={item.url === '/dashboard' || item.url === '/dashboard/admin/approvals'}
                      className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/55 transition-all duration-200 ease-in-out interactive-lift group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium shadow-sm border border-sidebar-border/60"
                    >
                      <item.icon className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                      {showText && <span className="text-sm font-medium">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/50 p-4 group-data-[collapsible=icon]:p-2 bg-sidebar/80">
        {showText && (
          <div className="mb-3 p-2 rounded-xl border border-sidebar-border/40 bg-sidebar-accent/35">
            <p className="text-xs text-sidebar-foreground/80 truncate font-medium">
              {user?.email}
            </p>
            <p className="text-xs text-sidebar-foreground/60 mt-1 capitalize">
              {role} Account
            </p>
          </div>
        )}
        <Button
          variant="ghost"
          size={showText ? 'sm' : 'icon'}
          className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200 group-data-[collapsible=icon]:justify-center"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {showText && <span className="ml-2 text-sm font-medium">Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
