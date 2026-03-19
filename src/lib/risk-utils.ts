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
  if (level === "critical") return "Critical";
  if (level === "at_risk") return "At Risk";
  if (level === "excelling") return "Excelling";
  return "Stable";
}

export function riskVariant(level: CanonicalRiskLevel): "destructive" | "default" | "secondary" {
  if (level === "critical" || level === "at_risk") return "destructive";
  if (level === "excelling") return "default";
  return "secondary";
}

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
