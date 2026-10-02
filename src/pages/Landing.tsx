import { useEffect, useState, useRef, type ReactNode } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
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
  Menu,
  X,
} from "lucide-react";
import { AI_COACH_MODEL_LABEL, AI_COACH_MODEL_SHORT } from "@/lib/ai-model";
import { AcademicDisclaimer } from "@/components/AcademicDisclaimer";

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function scrollToLandingTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

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
    <div className="pointer-events-none fixed inset-0 -z-10 bg-background" aria-hidden>
      <div className="absolute inset-x-0 top-0 h-px bg-border" />
    </div>
  );
}

function HeroVisualMock() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:mx-0">
      <div className="relative space-y-4 rounded-[20px] border border-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Brain className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            <span className="text-base font-semibold leading-snug text-foreground md:text-[1.0625rem]">
              AI layer active
            </span>
          </div>
          <span className="shrink-0 text-sm font-medium leading-snug tracking-wide text-muted-foreground">
            {AI_COACH_MODEL_SHORT} + analytics
          </span>
        </div>

        <div className="space-y-3 border-b border-border/60 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 md:h-12 md:w-12">
                <LineChart className="h-5 w-5 text-primary md:h-6 md:w-6" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-base font-semibold leading-snug text-foreground md:text-lg">Performance snapshot</p>
                <p className="text-sm leading-snug text-foreground/85 md:text-base">Model-assisted view</p>
              </div>
            </div>
            <Badge
              variant="secondary"
              className="h-fit shrink-0 px-3 py-1 text-sm font-medium"
            >
              At risk
            </Badge>
          </div>
        </div>

        <div className="flex gap-2 pt-0.5">
          {[45, 72, 38, 88, 55].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-md bg-gradient-to-t from-primary/40 to-primary/80 transition-all dark:from-primary/30 dark:to-primary/70"
              style={{ height: `${h + 6}px` }}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="rounded-xl border border-border/60 bg-muted/45 p-3.5 md:p-4 dark:bg-muted/25">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80 md:text-[0.8125rem]">Attendance</p>
            <p className="mt-2 text-2xl font-display font-bold leading-none text-foreground md:text-[1.75rem]">84%</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/45 p-3.5 md:p-4 dark:bg-muted/25">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80 md:text-[0.8125rem]">Coach</p>
            <p className="mt-2 text-sm font-semibold leading-snug text-foreground md:text-base">{AI_COACH_MODEL_SHORT}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-primary md:text-base">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              Active
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-primary/35 bg-primary/5 p-4 text-sm leading-relaxed text-foreground/90 md:text-base dark:bg-primary/10 dark:text-white/95">
          {AI_COACH_MODEL_LABEL} powers the coach; the same academic signals feed risk insight—aligned guidance.
        </div>
      </div>
    </div>
  );
}

function LandingVideoHero({ navigate }: { navigate: NavigateFunction }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navLinkClass =
    "text-sm text-muted-foreground transition-colors hover:text-foreground duration-200 whitespace-nowrap";
  const closeMobileAnd = (fn: () => void) => () => {
    setMobileNavOpen(false);
    fn();
  };

  return (
    <section id="landing-hero" className="relative flex min-h-screen flex-col bg-background font-sans text-foreground">
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => scrollToLandingTop()}
              className="shrink-0 text-left transition-opacity hover:opacity-[0.92]"
              aria-label="EDGE home"
            >
              <span className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                EDGE
              </span>
            </button>

            <nav
              aria-label="Primary"
              className="hidden items-center gap-1 lg:flex"
            >
              <button type="button" onClick={() => scrollToLandingTop()} className={`rounded-[12px] px-3 py-1.5 ${navLinkClass}`}>
                Home
              </button>
              <button
                type="button"
                onClick={() => scrollToSection("capabilities")}
                className={`rounded-[12px] px-3 py-1.5 ${navLinkClass}`}
              >
                Capabilities
              </button>
              <button
                type="button"
                onClick={() => scrollToSection("how-it-works")}
                className={`rounded-[12px] px-3 py-1.5 ${navLinkClass}`}
              >
                How it works
              </button>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className={`group flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 ${navLinkClass}`}
              >
                Get started
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
              </button>
            </nav>

            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-border text-foreground lg:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls="landing-mobile-nav"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          <div
            id="landing-mobile-nav"
            className={`mt-4 overflow-hidden rounded-[20px] border border-border bg-card transition-[max-height,opacity] duration-300 lg:hidden ${
              mobileNavOpen
                ? "max-h-[24rem] border-opacity-100 py-4 opacity-100"
                : "pointer-events-none max-h-0 border-opacity-0 py-0 opacity-0"
            }`}
          >
            <div className="flex flex-col gap-2 px-4">
              <button type="button" className={`py-2 text-left ${navLinkClass}`} onClick={closeMobileAnd(scrollToLandingTop)}>
                Home
              </button>
              <button
                type="button"
                className={`py-2 text-left ${navLinkClass}`}
                onClick={closeMobileAnd(() => scrollToSection("capabilities"))}
              >
                Capabilities
              </button>
              <button
                type="button"
                className={`py-2 text-left ${navLinkClass}`}
                onClick={closeMobileAnd(() => scrollToSection("how-it-works"))}
              >
                How it works
              </button>
              <button
                type="button"
                className={`group flex items-center gap-2 py-2 text-left ${navLinkClass}`}
                onClick={closeMobileAnd(() => navigate("/login"))}
              >
                Get started
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pb-12 pt-10 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-xl">
              <h1 className="text-4xl font-semibold leading-[1.15] text-foreground sm:text-5xl lg:text-[60px] lg:leading-[1.2]">
                Student Risk Analysis and AI Coaching
              </h1>
              <p className="mt-6 max-w-md text-lg leading-8 text-muted-foreground">
                Structured academic analytics flag patterns early. The in-app coach runs on {AI_COACH_MODEL_LABEL} and gives students and instructors clear next steps.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge variant="outline">Coach: {AI_COACH_MODEL_SHORT}</Badge>
                <Badge variant="secondary">Secure institutional access</Badge>
              </div>
              <Button type="button" size="lg" className="mt-8" onClick={() => navigate("/login")}>
                Get started
              </Button>
            </div>
            <div className="lg:flex lg:justify-end">
              <HeroVisualMock />
            </div>
          </div>
        </div>
      </div>
    </section>
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
    <div className="relative mb-20 rounded-lg border border-border bg-card p-8 md:p-10">
      <div className="relative mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="mb-4">
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
            <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
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
    <div className="relative min-h-screen">
      <LandingVideoHero navigate={navigate} />
      <div className="relative min-h-screen bg-background">
        <AmbientBackground />
        <div className="h-px w-full bg-border" />

        <div className="container relative mx-auto max-w-6xl px-4 py-10 md:py-16">
        {/* Stats */}
        <PopInSection>
          <div className="mb-20 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-border bg-card p-5"
              >
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
          <div id="capabilities" className="mb-4 scroll-mt-28 text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Capabilities</p>
            <h2 className="mt-2 font-display text-3xl font-bold text-foreground md:text-4xl">What EDGE offers</h2>
            <div className="mx-auto mt-4 h-px w-16 bg-border" />
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
                body: "LLM-assisted signals forecast academic trajectories and highlight vulnerable students before grades decline",
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
                className="border-border bg-card"
              >
                <CardContent className="p-6 text-center">
                  {(f.title.includes("LLM") ||
                    f.title.includes("Predictive") ||
                    f.title.includes("Continuous")) && (
                    <Badge variant="outline" className="mb-3 text-[10px] font-normal">
                      Uses LLMs
                    </Badge>
                  )}
                  <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-primary">
                    <f.icon className="h-5 w-5 text-primary-foreground" />
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
          <div
            id="how-it-works"
            className="relative mx-auto mb-20 max-w-4xl scroll-mt-28 rounded-lg border border-border bg-card p-8 md:p-12"
          >
            <div className="relative text-center">
              <div className="mb-2 inline-flex items-center gap-2 rounded-[12px] border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
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
                  <div className="relative z-10 mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
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
          <div id="bottom-cta" className="container mx-auto max-w-6xl scroll-mt-28 px-4 pb-20 pt-4">
            <div className="relative rounded-lg border border-border bg-card p-10 text-center md:p-14">
              <div className="relative">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-primary">
                  <GraduationCap className="h-6 w-6 text-primary-foreground" />
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

        <footer className="border-t border-border/70 bg-muted/20">
          <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-10">
            <AcademicDisclaimer variant="footer" className="mt-0 max-w-4xl mx-auto" />
            <p className="mt-6 text-center text-xs text-muted-foreground">
              EDGE — Student Risk Analysis and AI Coaching System
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
