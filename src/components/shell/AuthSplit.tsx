import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";

export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <div className="peoplo-canvas grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-16 top-10 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 rounded-full bg-[#4BD0F2]/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-xl font-semibold tracking-tight">EDGE</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Academic risk, attendance, and coaching in one place.
          </h2>
          <p className="mt-4 text-sm leading-6 text-primary-foreground/80">
            Sign in to your student, parent, instructor, counselor, or administrator workspace.
          </p>
        </div>
        <p className="relative text-xs text-primary-foreground/70">Student Risk Analysis and AI Coaching System</p>
      </aside>
      <div className="flex items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
