import type { ReactNode } from "react";
import { BarChart3, BookOpen, GraduationCap, Sparkles } from "lucide-react";

type AuthMode = "login" | "signup";

type AuthSliderProps = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  login: ReactNode;
  signup: ReactNode;
  leaving?: boolean;
};

type AuthStep = { title: string; body: string; icon: typeof BookOpen };

export function AuthFrame({
  headline,
  sub,
  steps,
  children,
  leaving,
}: {
  headline: string;
  sub: string;
  steps: AuthStep[];
  children: ReactNode;
  leaving?: boolean;
}) {
  return (
    <div className={leaving ? "edge-auth is-leaving" : "edge-auth"}>
      <div className="edge-auth-layout">
        <aside className="edge-auth-panel">
          <div className="edge-auth-panel-copy">
          <div className="edge-auth-brand">
            <span className="edge-auth-mark" aria-hidden>
              <GraduationCap className="h-5 w-5" />
            </span>
            <span>EDGE</span>
          </div>
          <h1 className="edge-auth-headline">{headline}</h1>
          <p className="edge-auth-sub">{sub}</p>
          <ol className="edge-auth-steps">
            {steps.map((step) => (
              <li key={step.title} className="edge-auth-step">
                <span className="edge-auth-rail" aria-hidden>
                  <span className="edge-auth-dot" />
                </span>
                <div className="edge-auth-card">
                  <p className="edge-auth-card-title">
                    <step.icon className="h-4 w-4" aria-hidden />
                    {step.title}
                  </p>
                  <p className="edge-auth-card-body">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          </div>
        </aside>
        <div className="edge-auth-form">
          <div className="edge-auth-form-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}

const steps = [
  {
    title: "Open your workspace",
    body: "Sign in to grades, attendance, and subject records.",
    icon: BookOpen,
  },
  {
    title: "Review performance",
    body: "Follow assessments, engagement, and subject progress.",
    icon: BarChart3,
  },
  {
    title: "Use academic support",
    body: "See risk classification and coaching from available student data.",
    icon: Sparkles,
  },
];

export function AuthSlider({ mode, login, signup, leaving }: AuthSliderProps) {
  const signupActive = mode === "signup";

  return (
    <AuthFrame
      headline="Get started with EDGE"
      sub="Student Risk Analysis and AI Coaching for the academic community."
      steps={steps}
      leaving={leaving}
    >
            <section
              className={signupActive ? "edge-auth-view" : "edge-auth-view is-active"}
              aria-hidden={signupActive || undefined}
              {...(signupActive ? { inert: "" } : {})}
            >
              {login}
            </section>
            <section
              className={signupActive ? "edge-auth-view is-active" : "edge-auth-view"}
              aria-hidden={!signupActive || undefined}
              {...(!signupActive ? { inert: "" } : {})}
            >
              {signup}
            </section>
    </AuthFrame>
  );
}
