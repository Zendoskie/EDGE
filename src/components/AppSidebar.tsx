import {
  LayoutDashboard, BookOpen, Users, ClipboardList, Brain,
  BarChart3, GraduationCap, CalendarCheck, FileText, LogOut, FolderOpen
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarFooter, useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

const instructorItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Programs', url: '/dashboard/programs', icon: FolderOpen },
  { title: 'Subjects', url: '/dashboard/subjects', icon: BookOpen },
  { title: 'Students', url: '/dashboard/students', icon: Users },
  { title: 'Attendance', url: '/dashboard/attendance', icon: CalendarCheck },
  { title: 'Activities', url: '/dashboard/activities', icon: ClipboardList },
  { title: 'Predictions', url: '/dashboard/predictions', icon: Brain },
];

const studentItems = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'My Subjects', url: '/dashboard/my-subjects', icon: BookOpen },
  { title: 'Attendance', url: '/dashboard/my-attendance', icon: CalendarCheck },
  { title: 'Scores', url: '/dashboard/my-scores', icon: FileText },
  { title: 'Insights', url: '/dashboard/insights', icon: BarChart3 },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { role, signOut, user } = useAuth();
  const location = useLocation();

  const items = role === 'instructor' ? instructorItems : studentItems;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center gap-2 px-3 py-4">
            {!collapsed && (
              <span className="text-sidebar-primary font-display font-bold text-lg">EDGE</span>
            )}
            {collapsed && <GraduationCap className="w-5 h-5 text-sidebar-primary" />}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === '/dashboard'}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        {!collapsed && (
          <p className="text-xs text-sidebar-foreground/60 mb-2 truncate">
            {user?.email}
          </p>
        )}
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
