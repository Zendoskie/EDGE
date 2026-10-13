import type { CategoryCoverage } from "./risk-scoring.ts";

/**
 * Edge Function secret that turns on automatic student risk emails from predict-risk.
 * Off by default: only the exact value "true" enables sending. Absent, empty or any other value keeps it off.
 */
export const RISK_EMAIL_GATE_ENV = "EDGE_RISK_EMAILS_ENABLED";

export function riskEmailsEnabled(value: string | null | undefined): boolean {
  return value === "true";
}

export const RISK_EMAIL_LABELS = { critical: "Crucial", at_risk: "Vulnerable" } as const;
type EmailRiskLevel = keyof typeof RISK_EMAIL_LABELS;

/** Coverage is required so no caller can plan an email without stating whether the evidence is complete. */
export type RiskEmailCandidate = {
  student_id: string;
  risk_level: string;
  risk_score: number | null;
  coverage: CategoryCoverage;
};

function isEmailRiskLevel(level: string): level is EmailRiskLevel {
  return level === "critical" || level === "at_risk";
}

/** A definitive Crucial/Vulnerable result: a recorded score and evidence in every weighted category. */
export function isDefinitiveRiskEmail(c: RiskEmailCandidate): boolean {
  return (
    isEmailRiskLevel(c.risk_level) &&
    c.coverage.complete === true &&
    typeof c.risk_score === "number" &&
    Number.isFinite(c.risk_score)
  );
}

export function riskEmailKey(c: { student_id: string; risk_level: string }): string {
  return `${c.student_id}:${c.risk_level}`;
}

/** Emails to send: none while the gate is off; otherwise definitive results not already sent. */
export function planRiskEmails(input: {
  enabled: boolean;
  candidates: RiskEmailCandidate[];
  alreadySent: Set<string>;
}): RiskEmailCandidate[] {
  if (!input.enabled) return [];
  return input.candidates.filter((c) => isDefinitiveRiskEmail(c) && !input.alreadySent.has(riskEmailKey(c)));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildRiskEmail(input: {
  riskLevel: string;
  studentName: string | null | undefined;
  subjectCode: string;
  subjectName: string | null | undefined;
}): { subject: string; html: string } {
  const label = isEmailRiskLevel(input.riskLevel) ? RISK_EMAIL_LABELS[input.riskLevel] : "Stable";
  const name = escapeHtml(input.studentName?.trim() || "student");
  const code = escapeHtml(input.subjectCode);
  const subjectName = input.subjectName ? ` — ${escapeHtml(input.subjectName)}` : "";
  return {
    subject: `EDGE Alert: ${label} — ${input.subjectCode}`,
    html: `
          <p>Hello ${name},</p>
          <p>The EDGE risk analysis system classified you as <strong>${label}</strong> for <strong>${code}${subjectName}</strong>.</p>
          <p>Log in to EDGE and open the AI Coach for personalized study strategies and improvement actions based on your latest metrics.</p>
        `,
  };
}
