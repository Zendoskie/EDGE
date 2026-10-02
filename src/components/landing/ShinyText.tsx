import type { ReactNode } from "react";

/** Brand emphasis on the landing page. Static, so the wordmark stays readable. */
export function ShinyText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-primary ${className}`}>{children}</span>;
}
