import { useEffect, useState, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GraduationCap,
  Brain,
  TrendingUp,
  Users,
  BookOpen,
  Activity,
  Target,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  LineChart,
} from "lucide-react";
import { AI_COACH_MODEL_LABEL, AI_COACH_MODEL_SHORT } from "@/lib/ai-model";

/** Wrapper that animates children to "pop up" when they enter the viewport on scroll */
function PopInSection({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out will-change-transform ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
    >
      {children}
    </div>
  );
}

function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary/20 blur-[100px] dark:bg-primary/25" />
      <div className="absolute -right-20 top-1/4 h-[22rem] w-[22rem] rounded-full bg-violet-500/15 blur-[90px] dark:bg-violet-400/20" />
      <div className="absolute bottom-0 left-1/3 h-[20rem] w-[20rem] rounded-full bg-cyan-500/10 blur-[80px] dark:bg-cyan-400/15" />
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.2]"
        style={{
          backgroundImage: `linear-gradient(to right, hsl(var(--border) / 0.5) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border) / 0.5) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

function HeroVisualMock() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:mx-0">
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-violet-500/25 via-primary/15 to-cyan-500/20 blur-2xl" />
      <div className="relative space-y-3 rounded-2xl border border-violet-500/20 bg-card/90 p-4 shadow-2xl shadow-violet-500/10 backdrop-blur-md dark:border-violet-500/30 dark:bg-card/80 dark:shadow-violet-500/20">
        <div className="flex items-center justify-between rounded-xl border border-dashed border-violet-500/35 bg-gradient-to-r from-violet-500/10 via-primary/5 to-cyan-500/10 px-3 py-2 dark:from-violet-500/15">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <span className="text-xs font-semibold text-foreground">AI layer active</span>
          </div>
          <span className="text-[10px] font-medium tracking-wide text-violet-600 dark:text-violet-400">
            {AI_COACH_MODEL_SHORT} + analytics
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
              <LineChart className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">Performance snapshot</p>
              <p className="text-[10px] text-muted-foreground">Model-assisted view</p>
            </div>
          </div>
          <Badge variant="secondary" className="border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-700 dark:text-violet-300">
            At risk
          </Badge>
        </div>
        <div className="flex gap-1.5 pt-1">
          {[45, 72, 38, 88, 55].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-md bg-gradient-to-t from-primary/40 to-primary/80 transition-all dark:from-primary/30 dark:to-primary/70"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div className="rounded-xl border border-border/60 bg-muted/40 p-3 dark:bg-muted/20">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Attendance</p>
            <p className="mt-1 text-lg font-display font-bold text-foreground">84%</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/40 p-3 dark:bg-muted/20">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Coach</p>
            <p className="mt-1 text-[11px] font-semibold leading-tight text-violet-700 dark:text-violet-300">
              {AI_COACH_MODEL_SHORT}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              Active
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground dark:bg-primary/10">
          {AI_COACH_MODEL_LABEL} powers the coach; the same academic signals feed risk insight—aligned guidance.
        </div>
      </div>
    </div>
  );
}

function AiSpotlightSection() {
  const pillars = [
    {
      title: "Conversational coach",
      desc: `Powered by ${AI_COACH_MODEL_LABEL}: supportive, plain-language plans grounded in each student’s risk notes and subjects.`,
      icon: Sparkles,
    },
    {
      title: "LLM & academic analytics",
      desc: "Large language models work with attendance, scores, and completion patterns to surface who may need support before final grades.",
      icon: Brain,
    },
    {
      title: "AI-assisted recommendations",
      desc: "Automated risk summaries and suggested talking points keep instructors and learners aligned on the same signals.",
      icon: TrendingUp,
    },
  ];
  return (
    <div className="relative mb-20 overflow-hidden rounded-3xl border border-violet-500/25 bg-gradient-to-br from-violet-500/10 via-background to-cyan-500/10 p-8 shadow-lg dark:from-violet-500/15 dark:via-background dark:to-cyan-500/15 md:p-10">
      <div className="pointer-events-none absolute -right-24 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-gradient-to-br from-violet-500/20 to-transparent blur-3xl" />
      <div className="relative mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="mb-4 border-violet-500/40 bg-violet-500/5 text-violet-700 dark:text-violet-300">
          Intelligence in EDGE
        </Badge>
        <h2 className="font-display text-2xl font-bold text-foreground md:text-3xl">Artificial intelligence at the core</h2>
        <p className="mt-3 text-sm text-muted-foreground md:text-base">
          EDGE combines <strong className="text-foreground">large language models and academic analytics</strong> for risk detection
          with <strong className="text-foreground">{AI_COACH_MODEL_LABEL}</strong> for the chat coach—so insights become
          dialogue, not just dashboards.
        </p>
      </div>
      <div className="relative mt-10 grid gap-6 md:grid-cols-3">
        {pillars.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl border border-border/80 bg-card/90 p-6 text-center shadow-sm backdrop-blur-sm dark:bg-card/70"
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-primary text-white shadow-md">
              <p.icon className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-foreground">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate("/dashboard");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (user) {
    return null;
  }

  const stats: Array<{
    label: string;
    value: string;
    hint: string;
    highlight?: boolean;
  }> = [
    { label: "Coach model", value: AI_COACH_MODEL_SHORT, hint: "Plus risk intelligence", highlight: true },
    { label: "Risk dimensions", value: "360°", hint: "Attendance, scores, completion" },
    { label: "Roles supported", value: "2", hint: "Students & instructors" },
    { label: "Focus", value: "Early", hint: "Before finals slip" },
  ];

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-background via-background to-secondary/25 dark:from-background dark:via-background dark:to-secondary/20">
      <AmbientBackground />
      <div className="h-1 w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-90" />

      <div className="container relative mx-auto max-w-6xl px-4 py-10 md:py-16">
        {/* Hero */}
        <PopInSection>
          <header className="mb-16 grid items-center gap-12 lg:mb-24 lg:grid-cols-2 lg:gap-10">
            <div className="text-center lg:text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-primary/10 to-cyan-500/10 px-4 py-1.5 text-sm font-medium text-foreground shadow-sm dark:from-violet-500/20 dark:via-primary/15 dark:to-cyan-500/15">
                <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="bg-gradient-to-r from-violet-600 to-primary bg-clip-text text-transparent dark:from-violet-400 dark:to-primary">
                  AI-powered risk insight &amp; coaching
                </span>
              </div>
              <h1 className="font-display text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
                <span className="bg-gradient-to-r from-primary via-violet-600 to-cyan-600 bg-clip-text text-transparent dark:from-primary dark:via-violet-400 dark:to-cyan-400">
                  EDGE
                </span>
              </h1>
              <p className="mt-4 text-xl font-semibold text-foreground sm:text-2xl md:text-[1.35rem] md:leading-snug">
                Student Risk Analysis and{" "}
                <span className="bg-gradient-to-r from-violet-600 to-cyan-600 bg-clip-text text-transparent dark:from-violet-400 dark:to-cyan-400">
                  AI Coaching
                </span>{" "}
                System
              </p>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground lg:mx-0">
                <span className="font-medium text-foreground">Large language models and structured analytics</span> flag patterns early;
                the in-app coach runs on <span className="font-medium text-foreground">{AI_COACH_MODEL_LABEL}</span>—clear,
                supportive next steps for students and instructors.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                <Badge className="rounded-full border-0 bg-gradient-to-r from-violet-600 to-primary px-3 py-1 text-xs font-normal text-primary-foreground shadow-md hover:from-violet-600 hover:to-primary sm:text-sm">
                  <Sparkles className="mr-1 h-3 w-3 shrink-0" />
                  Coach: {AI_COACH_MODEL_SHORT}
                </Badge>
                <Badge variant="secondary" className="rounded-full border border-violet-500/20 px-3 py-1 font-normal">
                  LLM-powered risk insight
                </Badge>
                <Badge variant="secondary" className="rounded-full px-3 py-1 font-normal">
                  Secure access
                </Badge>
              </div>
              <div className="mt-10 flex justify-center lg:justify-start">
                <Button
                  size="lg"
                  className="h-12 min-w-[200px] gap-2 px-10 text-base font-semibold shadow-lg shadow-primary/30"
                  onClick={() => navigate("/login")}
                >
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <HeroVisualMock />
          </header>
        </PopInSection>

        {/* Stats */}
        <PopInSection>
          <div className="mb-20 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className={`group relative overflow-hidden rounded-2xl border p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md dark:bg-card/50 ${
                  s.highlight
                    ? "border-violet-500/40 bg-gradient-to-br from-violet-500/10 via-card/90 to-primary/5 hover:border-violet-500/55 dark:from-violet-500/15 dark:via-card/70"
                    : "border-border/70 bg-card/80 hover:border-primary/25"
                }`}
              >
                <div
                  className={`absolute right-0 top-0 h-16 w-16 translate-x-6 -translate-y-6 rounded-full blur-2xl transition-opacity group-hover:opacity-100 ${
                    s.highlight ? "bg-violet-500/25 dark:bg-violet-400/20" : "bg-primary/10 dark:bg-primary/20"
                  }`}
                />
                {s.highlight ? (
                  <Sparkles className="mb-2 h-4 w-4 text-violet-600 dark:text-violet-400" />
                ) : null}
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p
                  className={`mt-2 font-display font-bold text-foreground ${s.highlight ? "text-xl sm:text-2xl md:text-3xl break-words" : "text-3xl"}`}
                >
                  {s.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
              </div>
            ))}
          </div>
        </PopInSection>

        <PopInSection>
          <AiSpotlightSection />
        </PopInSection>

        {/* Features */}
        <PopInSection>
          <div className="mb-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Capabilities</p>
            <h2 className="mt-2 font-display text-3xl font-bold text-foreground md:text-4xl">What EDGE offers</h2>
            <div className="mx-auto mt-4 h-1 w-20 rounded-full bg-gradient-to-r from-primary to-violet-500" />
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Monitoring, <span className="font-medium text-foreground">AI-driven signals</span>, and guided support in one
              place.
            </p>
          </div>
          <div className="mb-20 grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-2 lg:mx-auto lg:grid-cols-3">
            {[
              {
                icon: Brain,
                title: "LLM-powered analytics",
                body: "Large language models interpret complex academic patterns and help predict performance trends with strong accuracy",
                gradient: "from-blue-500 to-blue-600",
                ring: "ring-blue-500/20",
              },
              {
                icon: TrendingUp,
                title: "Predictive monitoring",
                body: "LLM-assisted signals forecast academic trajectories and highlight at-risk students before grades decline",
                gradient: "from-emerald-500 to-emerald-600",
                ring: "ring-emerald-500/20",
              },
              {
                icon: Users,
                title: "LLM insights",
                body: "AI-powered recommendations for personalized learning paths grounded in language-model pattern analysis",
                gradient: "from-violet-500 to-violet-600",
                ring: "ring-violet-500/20",
              },
              {
                icon: BookOpen,
                title: "Smart Enrollment",
                body: "Intelligent course enrollment system with program and year restrictions for regular students",
                gradient: "from-orange-500 to-amber-600",
                ring: "ring-orange-500/20",
              },
              {
                icon: Activity,
                title: "Continuous improvement",
                body: "LLM guidance refines as new academic signals arrive—sharper risk reads and intervention strategies over time",
                gradient: "from-cyan-500 to-sky-600",
                ring: "ring-cyan-500/20",
              },
              {
                icon: Target,
                title: "Risk Prediction",
                body: "Early warning system identifies students needing intervention before academic performance drops",
                gradient: "from-rose-500 to-pink-600",
                ring: "ring-rose-500/20",
              },
            ].map((f) => (
              <Card
                key={f.title}
                className={`group relative overflow-hidden border-border/60 bg-card/90 shadow-md backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl dark:bg-card/70 ${f.ring} hover:ring-2`}
              >
                <div
                  className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${f.gradient} opacity-90`}
                  aria-hidden
                />
                <CardContent className="p-6 pt-7 text-center">
                  {(f.title.includes("LLM") ||
                    f.title.includes("Predictive") ||
                    f.title.includes("Continuous")) && (
                    <Badge
                      variant="outline"
                      className="mb-3 border-violet-500/35 text-[10px] font-normal text-violet-700 dark:text-violet-300"
                    >
                      Uses LLMs
                    </Badge>
                  )}
                  <div
                    className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${f.gradient} shadow-lg shadow-black/10 ring-4 ring-white/50 dark:ring-black/20`}
                  >
                    <f.icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </PopInSection>

        {/* How it works */}
        <PopInSection>
          <div className="relative mx-auto mb-20 max-w-4xl overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card/95 via-card/90 to-primary/5 p-8 shadow-xl backdrop-blur-md dark:from-card/80 dark:via-card/70 dark:to-primary/10 md:p-12">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl dark:bg-primary/20" />
            <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative text-center">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm dark:bg-background/40">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                How it flows
              </div>
              <h2 className="font-display text-3xl font-bold text-foreground md:text-4xl">How EDGE works</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground">
                From raw academic signals to timely support—in three stages.
              </p>
            </div>
            <div className="relative mt-12 grid gap-10 md:grid-cols-3 md:gap-6">
              <div className="hidden md:block absolute left-[16%] right-[16%] top-8 h-0.5 bg-gradient-to-r from-primary/40 via-primary to-primary/40" aria-hidden />
              {[
                {
                  step: "1",
                  title: "Data collection",
                  text: "System gathers comprehensive academic data including grades, attendance, assignments, and participation patterns",
                },
                {
                  step: "2",
                  title: "AI & LLM analysis",
                  text: `Large language models interpret patterns and anticipate outcomes; ${AI_COACH_MODEL_LABEL} uses that same context so the coach stays aligned with risk signals`,
                },
                {
                  step: "3",
                  title: "Predictive interventions",
                  text: "Early alerts and recommendations help instructors provide targeted support before students struggle",
                },
              ].map((item, i) => (
                <div key={item.step} className="relative text-center">
                  <div className="relative z-10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-2xl font-bold text-primary-foreground shadow-lg shadow-primary/30">
                    {item.step}
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
                  {i < 2 && (
                    <div className="mx-auto my-6 h-px w-12 bg-border md:hidden" aria-hidden />
                  )}
                </div>
              ))}
            </div>
          </div>
        </PopInSection>

        {/* Bottom CTA */}
        <PopInSection className="flex justify-center">
          <div className="container mx-auto max-w-6xl px-4 pb-20 pt-4">
            <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-r from-primary/15 via-violet-500/10 to-cyan-500/10 p-10 text-center shadow-lg dark:from-primary/20 dark:via-violet-500/15 dark:to-cyan-500/15 md:p-14">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white/40 via-transparent to-transparent dark:from-white/5" />
              <div className="relative">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-primary shadow-lg">
                  <Sparkles className="h-7 w-7 text-white" />
                </div>
                <h2 className="font-display text-2xl font-bold text-foreground md:text-3xl">Ready to explore EDGE?</h2>
                <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
                  Create an account or log in to open your dashboard—see <strong className="text-foreground">AI risk insight</strong>{" "}
                  and chat with the <strong className="text-foreground">{AI_COACH_MODEL_LABEL}</strong> coach.
                </p>
                <Button
                  size="lg"
                  className="mt-8 h-12 gap-2 px-10 text-base font-semibold shadow-lg"
                  onClick={() => navigate("/login")}
                >
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </PopInSection>
      </div>
    </div>
  );
}
