import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Bell, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNotificationInbox } from "@/contexts/NotificationInboxContext";
import { cn } from "@/lib/utils";

export function NotificationInboxTrigger() {
  const { items, unreadCount, markAllRead, clearAll } = useNotificationInbox();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) markAllRead();
  }, [open, markAllRead]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex rounded-md">
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  "relative h-9 w-9 shrink-0 border-border/80 bg-background/80",
                  unreadCount > 0 && "border-primary/40 bg-primary/5",
                )}
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Open notifications"}
              >
                <Bell className={cn("h-4 w-4", unreadCount > 0 && "text-primary")} />
                {unreadCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0" align="end" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {items.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={() => clearAll()}>
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
        </div>
        <ScrollArea className="h-[min(60vh,280px)]">
          {items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing new yet. When your instructors update grades, attendance, or predictions, entries will show up
              here.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "px-3 py-3 transition-colors",
                    !n.read && "bg-primary/5",
                  )}
                >
                  <p className="text-sm font-medium leading-snug">{n.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{n.body}</p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground/80">
                    {formatDistanceToNow(n.createdAt, { addSuffix: true })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
