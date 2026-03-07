import {
  LayoutDashboard, BookOpen, BarChart3, GraduationCap, CalendarCheck, FileText, LogOut, Settings, Library, FileBarChart
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

  const items = role === 'instructor' ? instructorItems : studentItems;
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
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2 px-3 py-4">
            {showText ? (
              <span className="text-sidebar-primary font-display font-bold text-lg">EDGE</span>
            ) : (
              <GraduationCap className="w-5 h-5 text-sidebar-primary" />
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/dashboard'}
                      className="hover:bg-sidebar-accent/60 transition-colors"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium shadow-[inset_3px_0_0_0_hsl(var(--sidebar-primary))]"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {showText && <span className="text-sidebar-foreground">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        {showText && (
          <p className="text-xs text-sidebar-foreground/60 mb-2 truncate">
            {user?.email}
          </p>
        )}
        <Button
          variant="ghost"
          size={showText ? 'sm' : 'icon'}
          className="w-full justify-start text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {showText && <span className="ml-2">Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
