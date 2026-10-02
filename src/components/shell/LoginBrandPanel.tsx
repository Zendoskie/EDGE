import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  GraduationCap,
  Shield,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";

const capabilities: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: "Academic Performance",
    body: "Monitor grades, assessments, and subject performance.",
    icon: BarChart3,
  },
  {
    title: "Student Engagement",
    body: "View attendance, activity, engagement, and learning participation.",
    icon: Activity,
  },
  {
    title: "Academic Risk Analysis",
    body: "View the system-generated Risk Classification and Risk Score.",
    icon: Brain,
  },
  {
    title: "AI Academic Coaching",
    body: "Receive personalized academic guidance based on available student data.",
    icon: Sparkles,
  },
];

const roles: { label: string; icon: LucideIcon }[] = [
  { label: "Students", icon: GraduationCap },
  { label: "Parents / Guardians", icon: Users },
  { label: "Instructors", icon: BookOpen },
  { label: "Guidance Counselors", icon: UserCheck },
  { label: "Administrators", icon: Shield },
];

export function LoginBrandPanel() {
  return (
    <aside className="relative overflow-hidden px-5 py-8 sm:px-8 lg:flex lg:flex-col lg:justify-between lg:bg-primary lg:px-12 lg:py-12 lg:text-primary-foreground">
      <div
        className="pointer-events-none absolute inset-0 hidden opacity-40 lg:block"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(0 0% 100% / 0.08) 1px, transparent 1px), linear-gradient(to bottom, hsl(0 0% 100% / 0.08) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "linear-gradient(180deg, black, transparent 85%)",
        }}
      />
      <div className="pointer-events-none absolute -right-16 top-16 hidden h-48 w-48 rounded-full bg-white/10 lg:block" aria-hidden />

      <div className="relative max-w-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground lg:bg-white/15">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground lg:text-primary-foreground">EDGE</h1>
            <p className="text-xs text-muted-foreground lg:text-primary-foreground/80">
              Student Risk Analysis and AI Coaching System
            </p>
          </div>
        </div>

        <h2 className="mt-6 hidden max-w-lg text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:block lg:mt-10 lg:text-primary-foreground">
          Academic support, grounded in student performance.
        </h2>
        <p className="mt-3 hidden max-w-lg text-sm leading-6 text-muted-foreground md:block lg:text-base lg:text-primary-foreground/85">
          An academic support platform designed to help students, instructors, counselors, parents, and administrators understand student performance and provide informed academic support.
        </p>

        <div className="mt-8 hidden md:block">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:text-primary-foreground/75">
            Built for the Academic Community
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {capabilities.map((item) => (
              <li
                key={item.title}
                className="rounded-[16px] border border-border bg-card p-4 text-foreground lg:border-white/15 lg:bg-white/10 lg:text-primary-foreground"
              >
                <item.icon className="h-4 w-4 text-primary lg:text-primary-foreground" aria-hidden />
                <p className="mt-3 text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground lg:text-primary-foreground/80">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 hidden md:block">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:text-primary-foreground/75">
            Who signs in
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {roles.map((role) => (
              <li
                key={role.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground lg:border-white/20 lg:bg-white/10 lg:text-primary-foreground"
              >
                <role.icon className="h-3.5 w-3.5" aria-hidden />
                {role.label}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="relative mt-8 hidden max-w-md xl:block" aria-hidden>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[18px] border border-white/15 bg-white/10 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary-foreground/70">Learning record</p>
            <div className="mt-3 space-y-2">
              <div className="h-1.5 w-full rounded-full bg-white/20" />
              <div className="h-1.5 w-4/5 rounded-full bg-white/35" />
              <div className="h-1.5 w-2/3 rounded-full bg-white/20" />
            </div>
          </div>
          <div className="mt-6 rounded-[18px] border border-white/15 bg-white/10 p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary-foreground/70">Academic support</p>
            <p className="mt-3 text-sm font-medium">Performance, engagement, and coaching in one workspace.</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
