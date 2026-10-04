import { NavLink } from "@/components/NavLink";
import type { LucideIcon } from "lucide-react";

export type MobileTab = { title: string; url: string; icon: LucideIcon; end?: boolean };

export function MobileTabBar({ items }: { items: MobileTab[] }) {
  const tabs = items.slice(0, 5);
  return (
    <nav
      aria-label="Primary"
      className="vision-panel fixed inset-x-3 bottom-3 z-40 grid h-16 grid-flow-col rounded-2xl px-1 md:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((item) => (
        <NavLink
          key={item.url}
          to={item.url}
          end={item.end ?? item.url === "/dashboard"}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground"
          activeClassName="text-primary"
        >
          <item.icon className="h-4 w-4" aria-hidden />
          <span className="max-w-full truncate px-1">{item.title}</span>
        </NavLink>
      ))}
    </nav>
  );
}
