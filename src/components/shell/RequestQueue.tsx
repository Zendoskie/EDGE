import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function RequestQueue({
  title,
  children,
  empty,
  className,
}: {
  title: string;
  children: ReactNode;
  empty?: string;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[22px] border border-border bg-card", className)}>
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
      </header>
      <div className="divide-y divide-border">
        {children ?? <p className="px-5 py-8 text-sm text-muted-foreground">{empty ?? "Nothing waiting."}</p>}
      </div>
    </section>
  );
}
