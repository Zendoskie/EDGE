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
    <article
      className={cn(
        "relative overflow-hidden rounded-[22px] border border-border bg-card px-5 py-4",
        "shadow-[0_16px_40px_-28px_hsl(234_60%_40%/0.55)]",
        accent && "bg-primary text-primary-foreground border-transparent",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[13px] font-medium", accent ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl",
              accent ? "bg-white/15 text-primary-foreground" : "bg-secondary text-primary",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[30px] font-semibold leading-none tracking-tight">{value}</p>
      {hint ? (
        <p className={cn("mt-2 text-xs", accent ? "text-primary-foreground/75" : "text-muted-foreground")}>{hint}</p>
      ) : null}
    </article>
  );
}
