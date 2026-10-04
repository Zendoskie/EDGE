import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: boolean;
  className?: string;
};

export function KpiCard({ label, value, hint, icon: Icon, accent, className }: KpiCardProps) {
  return (
    <article className={cn("vision-stat", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-[30px] font-bold leading-none tracking-tight text-card-foreground">{value}</p>
          {hint ? <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">{hint}</p> : null}
        </div>
        {Icon ? (
          <span className={cn("vision-stat-icon", accent && "is-accent")} aria-hidden>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
    </article>
  );
}
