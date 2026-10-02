import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PersonCard({
  name,
  meta,
  action,
  className,
}: {
  name: string;
  meta?: string;
  action?: ReactNode;
  className?: string;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <article className={cn("rounded-[22px] border border-border bg-card p-4 shadow-[0_16px_40px_-28px_hsl(234_60%_40%/0.45)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
            {initials || "—"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{name}</p>
            {meta ? <p className="truncate text-xs text-muted-foreground">{meta}</p> : null}
          </div>
        </div>
        {action}
      </div>
    </article>
  );
}
