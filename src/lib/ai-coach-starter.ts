import { RISK_BANDS } from '@/lib/risk-scoring';
import { riskLabel, type CanonicalRiskLevel } from '@/lib/risk-utils';
import {
  coachingRiskLabel,
  formatCoachingMetricsBlock,
  type SubjectCoachingMetrics,
} from '@/lib/coaching-context';

export type CoachStarterMsg = { role: 'assistant'; content: string; ts?: number };

function riskBandExplanation(): string {
  return [
    'How the system classifies risk (from your weighted risk score — not the coach’s opinion):',
    `• Excelling: ${RISK_BANDS.excelling}% and above`,
    `• Stable: ${RISK_BANDS.stable}% up to below ${RISK_BANDS.excelling}%`,
    `• Vulnerable: ${RISK_BANDS.at_risk}% up to below ${RISK_BANDS.stable}%`,
    `• Crucial: below ${RISK_BANDS.at_risk}%`,
  ].join('\n');
}

export function buildContextualStarter(
  canonical: CanonicalRiskLevel,
  metrics?: SubjectCoachingMetrics | null,
  subjectLabel?: string | null,
  atRiskMetrics?: SubjectCoachingMetrics[],
): CoachStarterMsg[] {
  const status = metrics ? coachingRiskLabel(metrics) : riskLabel(canonical);
  const subj = subjectLabel?.trim();
  const atRisk = atRiskMetrics?.filter(
    (m) => m.riskClassification === 'critical' || m.riskClassification === 'at_risk',
  ) ?? [];

  const atRiskBlocks =
    atRisk.length > 0
      ? atRisk.map((m) => formatCoachingMetricsBlock(m)).join('\n\n')
      : metrics
        ? formatCoachingMetricsBlock(metrics)
        : null;

  const recommendations = atRisk
    .map((m) => m.systemRecommendation?.trim())
    .filter(Boolean)
    .map((rec, i) => `${atRisk[i]?.subjectCode ?? 'Subject'}: ${rec}`);

  const isAtRisk = canonical === 'critical' || canonical === 'at_risk' || atRisk.length > 0;

  const lines: string[] = [];

  if (isAtRisk) {
    lines.push(
      `Hi—I've loaded your latest risk analysis. Your highest-priority status is ${status}${subj ? ` (${subj})` : ''}.`,
      '',
      riskBandExplanation(),
    );
    if (atRiskBlocks) {
      lines.push('', 'Subjects flagged Crucial or Vulnerable:', '', atRiskBlocks);
    }
    if (recommendations.length > 0) {
      lines.push('', 'System recommendations:', ...recommendations.map((r) => `• ${r}`));
    }
    lines.push(
      '',
      'I am preparing a personalized explanation of where your scores are low and a 7-day study plan based on your official records (no need to type anything).',
    );
  } else if (atRiskBlocks && subj) {
    lines.push(
      `Hi—I've loaded your latest risk analysis for ${subj}. Your system-computed status is ${status}.`,
      '',
      atRiskBlocks,
      '',
      'Ask me for coaching recommendations, study strategies, or a concrete plan for the next week.',
    );
  } else if (atRiskBlocks) {
    lines.push(`Hi—I've loaded your latest risk analysis (${status}).`, '', atRiskBlocks, '', 'Ask me for study strategies or a plan for the next week.');
  } else if (subj) {
    lines.push(
      `Hi—your risk analysis marks you as ${status} in ${subj}. I provide coaching based on computed results only. What would you like to work on first?`,
    );
  } else {
    lines.push(
      `Hi—your current risk classification is ${status} (computed by the risk analysis system). I can help with study strategies and improvement actions. What would help most right now?`,
    );
  }

  return [{ role: 'assistant', content: lines.join('\n'), ts: Date.now() }];
}
