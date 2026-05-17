import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Horizontal scroll + min width so Recharts stays readable on narrow viewports. */
export function InsightsChartFrame({
  children,
  className,
  minWidth = 280,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: number;
}) {
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      <div className="w-full" style={{ minWidth: `${minWidth}px` }}>
        {children}
      </div>
    </div>
  );
}
