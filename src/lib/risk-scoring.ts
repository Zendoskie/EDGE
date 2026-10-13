import { canonicalRiskLevel, riskLabel, RISK_LEVEL_ORDER, type CanonicalRiskLevel } from '@/lib/risk-utils';
import { DEFAULT_SUBJECT_GRADING_WEIGHTS, roundGrade2, type SubjectGradingWeights } from '@/lib/weighted-grading';

/**
 * Official risk bands on the two-decimal weighted grade. predict-risk owns the
 * classification (supabase/functions/_shared/risk-scoring.ts); this copy is for
 * display and is parity-tested against it.
 */
export const RISK_BANDS = { excelling: 90, stable: 80, at_risk: 75 } as const;

export function classifyRiskScore(score: number | null): CanonicalRiskLevel {
  if (score == null || !Number.isFinite(score)) return 'stable';
  if (score >= RISK_BANDS.excelling) return 'excelling';
  if (score >= RISK_BANDS.stable) return 'stable';
  if (score >= RISK_BANDS.at_risk) return 'at_risk';
  return 'critical';
}

export type RiskCategory = 'activity' | 'project' | 'attendance' | 'exam';
export const RISK_CATEGORIES: RiskCategory[] = ['activity', 'project', 'attendance', 'exam'];
export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  activity: 'Activities',
  project: 'Project',
  attendance: 'Attendance',
  exam: 'Exams',
};

export type CategoryCoverage = { required: RiskCategory[]; missing: RiskCategory[]; complete: boolean };

export type PredictionEvidenceRow = {
  activity_average?: number | null;
  quiz_average?: number | null;
  project_score?: number | null;
  attendance_rate?: number | null;
  laboratory_exam_average?: number | null;
  midterm_exam_average?: number | null;
  final_exam_average?: number | null;
};

const present = (v: unknown) => v != null && Number.isFinite(Number(v));

/** Coverage from a stored prediction row: every category with weight above 0 needs evidence. */
export function predictionCoverage(
  row: PredictionEvidenceRow,
  weights: SubjectGradingWeights | null | undefined,
): CategoryCoverage {
  const w = weights ?? DEFAULT_SUBJECT_GRADING_WEIGHTS;
  const evidence: Record<RiskCategory, boolean> = {
    activity: present(row.activity_average) || present(row.quiz_average),
    project: present(row.project_score),
    attendance: present(row.attendance_rate),
    exam:
      present(row.laboratory_exam_average) || present(row.midterm_exam_average) || present(row.final_exam_average),
  };
  const weightOf: Record<RiskCategory, number> = {
    activity: Number(w.activity_weight) || 0,
    project: Number(w.project_weight) || 0,
    attendance: Number(w.attendance_weight) || 0,
    exam: Number(w.exam_weight) || 0,
  };
  const required = RISK_CATEGORIES.filter((c) => weightOf[c] > 0);
  const missing = required.filter((c) => !evidence[c]);
  return { required, missing, complete: missing.length === 0 };
}

/** Official label, with the two-decimal score only when it sits in the same band. */
export function formatOfficialRiskLabel(level: unknown, score?: number | null): string {
  const canonical = canonicalRiskLevel(level);
  const label = riskLabel(canonical);
  const rounded = roundGrade2(score);
  if (rounded == null) return label;
  if (classifyRiskScore(rounded) !== canonical) return label;
  return `${label} (${rounded.toFixed(2)})`;
}

/* ------------------------------------------------------------------ risk display status */

/**
 * Prediction columns a view must select to show a risk status honestly. Append them to the
 * view's existing predictions select; never fetch them with a separate request.
 */
export const PREDICTION_EVIDENCE_COLUMNS =
  'risk_score, activity_average, quiz_average, project_score, attendance_rate, laboratory_exam_average, midterm_exam_average, final_exam_average';

const EVIDENCE_KEYS = PREDICTION_EVIDENCE_COLUMNS.split(', ');
const ALL_CATEGORIES_REQUIRED = { activity_weight: 1, project_weight: 1, attendance_weight: 1, exam_weight: 1 };

/**
 * - confirmed: every weighted category has evidence (risk-analysis coverage, not final-grade completeness).
 * - provisional: a weighted category has no evidence yet; the stored label may still move.
 * - insufficient: no weighted grade exists, so the stored label is only a placeholder.
 * - unverified: this view lacks the evidence columns or the weights needed to tell.
 */
export type RiskEvidenceState = 'confirmed' | 'provisional' | 'insufficient' | 'unverified';

export type RiskEvidenceRow = PredictionEvidenceRow & { risk_score?: number | string | null };

export type RiskDisplayStatus = {
  state: RiskEvidenceState;
  /** Stored classification; null only when there is no weighted grade (insufficient). */
  level: CanonicalRiskLevel | null;
  label: string;
  /** Weighted categories without evidence (provisional only). */
  missing: RiskCategory[];
  description: string;
};

export const INSUFFICIENT_DATA_LABEL = 'Insufficient data';
export const PROVISIONAL_SUFFIX = 'Provisional (incomplete data)';
export const UNVERIFIED_SUFFIX = 'Risk status unverified';

/**
 * Display status for a stored prediction. The stored classification is never changed, only
 * qualified. `weights`: the subject's saved weights, `null` when the subject has no saved row
 * (defaults apply), or omitted when this view did not load them.
 */
export function riskDisplayStatus(input: {
  level: unknown;
  evidence?: RiskEvidenceRow | null;
  weights?: SubjectGradingWeights | null;
}): RiskDisplayStatus {
  const level = canonicalRiskLevel(input.level);
  const base = riskLabel(level);
  const row = input.evidence;
  const unverified: RiskDisplayStatus = {
    state: 'unverified',
    level,
    label: `${base} — ${UNVERIFIED_SUFFIX}`,
    missing: [],
    description: 'This view cannot confirm that every weighted grade category has evidence.',
  };
  if (!row || !('risk_score' in row)) return unverified;

  const score = row.risk_score == null || row.risk_score === '' ? null : Number(row.risk_score);
  if (score == null || !Number.isFinite(score)) {
    return {
      state: 'insufficient',
      level: null,
      label: INSUFFICIENT_DATA_LABEL,
      missing: [],
      description: 'No weighted grade can be calculated yet: there are no scores or attendance records.',
    };
  }

  if (!EVIDENCE_KEYS.every((k) => k in row)) return unverified;
  const weightsKnown = input.weights !== undefined;
  const coverage = predictionCoverage(row, weightsKnown ? input.weights : ALL_CATEGORIES_REQUIRED);
  if (coverage.complete) {
    return {
      state: 'confirmed',
      level,
      label: formatOfficialRiskLabel(level, score),
      missing: [],
      description: 'Every weighted grade category has evidence.',
    };
  }
  if (!weightsKnown) return unverified;
  const names = coverage.missing.map((c) => RISK_CATEGORY_LABELS[c]).join(', ');
  return {
    state: 'provisional',
    level,
    label: `${base} — ${PROVISIONAL_SUFFIX}`,
    missing: coverage.missing,
    description: `Provisional: no scores or records yet for ${names}. The classification may change as they are added.`,
  };
}

export type RiskStatusSummary = {
  counts: Record<CanonicalRiskLevel, number>;
  insufficient: number;
  /** Provisional or unverified results among the counted levels. */
  notConfirmed: number;
  total: number;
};

/** Counts for distributions: rows without a weighted grade are not counted as any level. */
export function summarizeRiskStatuses(
  rows: Array<RiskEvidenceRow & { risk_level?: unknown }>,
  weights?: SubjectGradingWeights | null,
): RiskStatusSummary {
  const out: RiskStatusSummary = {
    counts: { critical: 0, at_risk: 0, stable: 0, excelling: 0 },
    insufficient: 0,
    notConfirmed: 0,
    total: rows.length,
  };
  for (const row of rows) {
    const s = riskDisplayStatus({ level: row.risk_level, evidence: row, weights });
    if (s.level == null) {
      out.insufficient += 1;
      continue;
    }
    out.counts[s.level] += 1;
    if (s.state !== 'confirmed') out.notConfirmed += 1;
  }
  return out;
}

/** Counts scores per official band (90/80/75). Missing values are skipped, never bucketed. */
export function officialBandCounts(values: Array<number | null | undefined>): Record<CanonicalRiskLevel, number> {
  const counts: Record<CanonicalRiskLevel, number> = { critical: 0, at_risk: 0, stable: 0, excelling: 0 };
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) counts[classifyRiskScore(v)] += 1;
  }
  return counts;
}

export type RiskChartKey = CanonicalRiskLevel | 'insufficient';
export const INSUFFICIENT_CHART_COLOR = 'hsl(220 9% 60%)';

/** Pie/bar rows in official order, plus an "Insufficient data" slice; empty slices dropped. */
export function riskPieData(s: RiskStatusSummary): Array<{ level: RiskChartKey; name: string; value: number }> {
  const rows: Array<{ level: RiskChartKey; name: string; value: number }> = RISK_LEVEL_ORDER.map((level) => ({
    level,
    name: riskLabel(level),
    value: s.counts[level],
  }));
  rows.push({ level: 'insufficient', name: INSUFFICIENT_DATA_LABEL, value: s.insufficient });
  return rows.filter((r) => r.value > 0);
}

/** One-line caption for distribution charts; null when every counted result is confirmed. */
export function riskSummaryCaption(s: RiskStatusSummary): string | null {
  const parts: string[] = [];
  if (s.notConfirmed > 0) parts.push(`${s.notConfirmed} of ${s.total} result(s) are provisional or unverified (incomplete data)`);
  if (s.insufficient > 0) parts.push(`${s.insufficient} have insufficient data and are not counted as any risk level`);
  return parts.length ? `${parts.join('; ')}.` : null;
}
