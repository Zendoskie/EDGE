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
    return "border-transparent bg-amber-500 text-white hover:bg-amber-500/85 dark:bg-amber-500 dark:text-white";
  }
  if (level === "stable") {
    return "border-transparent bg-emerald-600 text-white hover:bg-emerald-600/85 dark:bg-emerald-600 dark:text-white";
  }
  return "border-transparent bg-blue-600 text-white hover:bg-blue-600/85 dark:bg-blue-600 dark:text-white";
}

/** Chart fill colors aligned with badge semantics. */
export function riskChartColor(level: CanonicalRiskLevel): string {
  if (level === "critical") return "hsl(0 72% 51%)";
  if (level === "at_risk") return "hsl(38 92% 50%)";
  if (level === "stable") return "hsl(142 76% 36%)";
  return "hsl(221 76% 48%)";
}

export const RISK_LEVEL_ORDER: CanonicalRiskLevel[] = ["critical", "at_risk", "stable", "excelling"];

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
