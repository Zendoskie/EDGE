import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-[16px] border border-border bg-card px-3 py-2", className)}>
      {children}
    </div>
  );
}
