export type CanonicalRiskLevel = "critical" | "at_risk" | "stable" | "excelling";

export function canonicalRiskLevel(level: unknown): CanonicalRiskLevel {
  if (typeof level !== "string") return "stable";
  const normalized = level.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "critical") return "critical";
  if (normalized === "at_risk" || normalized === "at-risk" || normalized === "atrisk") return "at_risk";
  if (normalized === "excelling") return "excelling";
  if (normalized === "stable") return "stable";
  return "stable";
}

export function riskLabel(level: CanonicalRiskLevel): string {
  if (level === "critical") return "Crucial";
  if (level === "at_risk") return "Vulnerable";
  if (level === "excelling") return "Excelling";
  return "Stable";
}

export function riskVariant(level: CanonicalRiskLevel): "destructive" | "default" | "secondary" {
  if (level === "critical") return "destructive";
  if (level === "at_risk") return "destructive";
  if (level === "excelling") return "default";
  return "secondary";
}

/** Tailwind classes for color-coded risk badges. */
export function riskBadgeClassName(level: CanonicalRiskLevel): string {
  if (level === "critical") {
    return "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85";
  }
  if (level === "at_risk") {
    return "border-transparent bg-warning text-warning-foreground";
  }
  if (level === "stable") {
    return "border-transparent bg-success text-success-foreground";
  }
  return "border-transparent bg-primary text-primary-foreground";
}

/** Chart fill colors aligned with badge semantics. */
export function riskChartColor(level: CanonicalRiskLevel): string {
  if (level === "critical") return "hsl(0 58% 58%)";
  if (level === "at_risk") return "hsl(36 72% 52%)";
  if (level === "stable") return "hsl(152 28% 48%)";
  return "hsl(43 70% 62%)";
}

/** Ordered from lowest academic risk to highest academic risk. */
export const RISK_LEVEL_ORDER: CanonicalRiskLevel[] = ["excelling", "stable", "at_risk", "critical"];

export function safeString(s: unknown): string | null {
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

export function sanitizeMessage(message: string): string {
  return message
    .trim()
    .slice(0, 1000) // Limit message length
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove potential JS URLs
    .replace(/data:/gi, ''); // Remove potential data URLs
}
