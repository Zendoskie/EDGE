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
import { ShinyText } from "@/components/landing/ShinyText";

const LANDING_HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_105406_16f4600d-7a92-4292-b96e-b19156c7830a.mp4";

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
    <div className="relative mx-auto w-full max-w-lg lg:mx-0">
      <div className="absolute -inset-4 rounded-3xl bg-gradient-to-tr from-violet-500/25 via-primary/15 to-cyan-500/20 blur-2xl" />
      <div className="relative space-y-4 rounded-2xl border border-violet-500/25 bg-card/95 p-5 shadow-2xl shadow-violet-500/10 backdrop-blur-md dark:border-violet-500/40 dark:bg-card/90 dark:shadow-violet-500/20 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-violet-500/35 bg-gradient-to-r from-violet-500/10 via-primary/5 to-cyan-500/10 px-3 py-3 sm:px-4 dark:from-violet-500/15">
          <div className="flex min-w-0 items-center gap-2.5">
            <Sparkles className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
            <span className="text-base font-semibold leading-snug text-foreground md:text-[1.0625rem]">
              AI layer active
            </span>
          </div>
          <span className="shrink-0 text-sm font-medium leading-snug tracking-wide text-violet-700 dark:text-violet-200">
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
              className="h-fit shrink-0 border-violet-500/35 bg-violet-500/15 px-3 py-1 text-sm font-medium text-violet-800 dark:border-violet-500/45 dark:bg-violet-500/25 dark:text-violet-100"
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
            <p className="mt-2 text-sm font-semibold leading-snug text-violet-800 dark:text-violet-100 md:text-base">{AI_COACH_MODEL_SHORT}</p>
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
    "text-sm text-white/80 transition-colors hover:text-white duration-300 whitespace-nowrap";
  const closeMobileAnd = (fn: () => void) => () => {
    setMobileNavOpen(false);
    fn();
  };

  return (
    <section id="landing-hero" className="relative flex min-h-screen flex-col bg-black font-sans text-white">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      >
        <source src={LANDING_HERO_VIDEO_URL} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/65" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="mx-auto w-full max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => scrollToLandingTop()}
              className="shrink-0 text-left transition-opacity hover:opacity-[0.92]"
              aria-label="EDGE home"
            >
              <span className="font-display text-xl font-bold tracking-tight text-transparent sm:text-2xl md:text-[1.65rem] bg-gradient-to-r from-white via-cyan-100 to-violet-200 bg-clip-text drop-shadow-[0_0_24px_rgba(100,206,251,0.35)]">
                EDGE
              </span>
            </button>

            <nav
              aria-label="Primary"
              className="hidden items-center gap-1 rounded-full border border-gray-700 bg-black/25 px-2 py-1.5 backdrop-blur-sm lg:flex"
            >
              <button type="button" onClick={() => scrollToLandingTop()} className={`rounded-full px-3 py-1.5 ${navLinkClass}`}>
                Home
              </button>
              <button
                type="button"
                onClick={() => scrollToSection("capabilities")}
                className={`rounded-full px-3 py-1.5 ${navLinkClass}`}
              >
                Capabilities
              </button>
              <button
                type="button"
                onClick={() => scrollToSection("how-it-works")}
                className={`rounded-full px-3 py-1.5 ${navLinkClass}`}
              >
                How it works
              </button>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className={`group flex items-center gap-1.5 rounded-full px-3 py-1.5 ${navLinkClass}`}
              >
                Get started
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
              </button>
            </nav>

            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-700 text-white lg:hidden"
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
            className={`mt-4 overflow-hidden rounded-2xl border border-gray-700 bg-black/80 backdrop-blur-md transition-[max-height,opacity] duration-300 lg:hidden ${
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

        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pb-16 lg:pt-10">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-12">
            <div className="group relative max-w-xl lg:max-w-xl xl:max-w-2xl">
              <div
                className="pointer-events-none absolute -inset-px rounded-2xl opacity-70 blur-sm transition-opacity group-hover:opacity-100 bg-gradient-to-br from-cyan-500/35 via-transparent to-violet-500/40"
                aria-hidden
              />
              <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] py-6 pl-6 pr-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] backdrop-blur-md before:pointer-events-none before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/[0.06] before:to-transparent before:to-60% md:py-8 md:pl-8 md:pr-7">
                <div
                  className="absolute bottom-5 left-5 top-5 w-[3px] rounded-full bg-gradient-to-b from-cyan-400/95 to-violet-500/95 md:left-6"
                  aria-hidden
                />
                <p className="relative ml-2 text-[1.0625rem] leading-[1.72] tracking-[0.01em] text-white/90 md:ml-3 md:text-xl md:leading-[1.68] xl:text-[1.375rem] xl:leading-relaxed">
                  <span className="block text-balance">
                    <span className="font-semibold text-white">Large language models and structured analytics</span> flag patterns
                    early;
                  </span>
                  <span className="mt-4 block text-balance md:mt-5">
                    the in-app coach runs on{" "}
                    <span className="font-semibold text-cyan-100 [text-shadow:0_0_24px_rgba(165,243,252,0.25)]">{AI_COACH_MODEL_LABEL}</span>
                    —clear, supportive next steps for students and instructors.
                  </span>
                </p>
              </div>
            </div>
            <div className="lg:flex lg:justify-end">
              <HeroVisualMock />
            </div>
          </div>

          <div className="mt-auto flex flex-1 flex-col items-center justify-center pt-12 text-center lg:mt-16 lg:flex-[1.1] lg:pt-8">
            <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/80 sm:text-sm">
              <Brain className="h-3.5 w-3.5 shrink-0 opacity-80 sm:h-4 sm:w-4" aria-hidden />
              AI-powered risk insight &amp; coaching
            </p>

            <h1 className="mt-4 max-w-5xl px-2 text-center text-5xl font-medium leading-[0.85] tracking-tighter sm:px-0 sm:text-6xl md:text-7xl xl:text-8xl 2xl:text-9xl">
              <span className="block text-white">EDGE</span>
              <span className="mt-1 block text-balance">
                <span className="text-white">Student Risk Analysis and </span>
                <ShinyText>AI Coaching</ShinyText>
                <span className="text-white"> System</span>
              </span>
            </h1>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <Badge className="rounded-full border-0 bg-white/15 px-3 py-1 text-xs font-normal text-white shadow-md backdrop-blur-sm hover:bg-white/20 sm:text-sm">
                <Sparkles className="mr-1 h-3 w-3 shrink-0" />
                Coach: {AI_COACH_MODEL_SHORT}
              </Badge>
              <Badge
                variant="secondary"
                className="rounded-full border border-white/25 bg-white/10 px-3 py-1 font-normal text-white hover:bg-white/15"
              >
                LLM-powered risk insight
              </Badge>
              <Badge variant="secondary" className="rounded-full border-0 bg-white/10 px-3 py-1 font-normal text-white/95">
                Secure access
              </Badge>
            </div>

            <button
              type="button"
              onClick={() => navigate("/login")}
              className="group mt-10 inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-base font-medium text-white shadow-lg transition-colors hover:bg-gray-900 md:px-8 md:py-4"
            >
              Get started
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden />
            </button>
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
    <div className="relative min-h-screen">
      <LandingVideoHero navigate={navigate} />
      <div className="relative min-h-screen bg-gradient-to-b from-background via-background to-secondary/25 dark:from-background dark:via-background dark:to-secondary/20">
        <AmbientBackground />
        <div className="h-1 w-full bg-gradient-to-r from-transparent via-primary to-transparent opacity-90" />

        <div className="container relative mx-auto max-w-6xl px-4 py-10 md:py-16">
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
          <div id="capabilities" className="mb-4 scroll-mt-28 text-center">
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
          <div
            id="how-it-works"
            className="relative mx-auto mb-20 max-w-4xl scroll-mt-28 overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card/95 via-card/90 to-primary/5 p-8 shadow-xl backdrop-blur-md dark:from-card/80 dark:via-card/70 dark:to-primary/10 md:p-12"
          >
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
          <div id="bottom-cta" className="container mx-auto max-w-6xl scroll-mt-28 px-4 pb-20 pt-4">
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
    </div>
  );
}
