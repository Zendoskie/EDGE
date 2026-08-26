import { AlertTriangle, Crosshair } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EngagementBadge } from '@/components/EngagementBadge';
import { RiskBadge } from '@/components/RiskBadge';
import type { CanonicalEngagementLevel } from '@/lib/engagement-utils';
import type { CanonicalRiskLevel } from '@/lib/risk-utils';

export type AttentionStudent = {
  studentId: string;
  fullName: string;
  engagementLevel: CanonicalEngagementLevel;
  engagementScore: number;
  riskLevel: CanonicalRiskLevel | null;
  riskScore: number | null;
};

const LOW_ENGAGEMENT = new Set<CanonicalEngagementLevel>(['moderate', 'low']);
const HIGH_RISK = new Set<CanonicalRiskLevel>(['at_risk', 'critical']);

/** Students who need attention: low/inactive engagement AND/OR elevated risk. */
export function pickAttentionStudents(rows: AttentionStudent[], limit = 8): AttentionStudent[] {
  const scored = rows
    .map((row) => {
      const engHit = LOW_ENGAGEMENT.has(row.engagementLevel);
      const riskHit = row.riskLevel != null && HIGH_RISK.has(row.riskLevel);
      if (!engHit && !riskHit) return null;
      const priority =
        (engHit && riskHit ? 4 : 0) +
        (row.engagementLevel === 'low' ? 2 : engHit ? 1 : 0) +
        (row.riskLevel === 'critical' ? 2 : riskHit ? 1 : 0);
      return { row, priority };
    })
    .filter((x): x is { row: AttentionStudent; priority: number } => x != null)
    .sort((a, b) => b.priority - a.priority || a.row.fullName.localeCompare(b.row.fullName));

  return scored.slice(0, limit).map((s) => s.row);
}

type Props = {
  students: AttentionStudent[];
  isLoading?: boolean;
  onOpenStudent: (studentId: string, fullName: string) => void;
};

/**
 * Single place where instructors see engagement × risk together (Priority Action List).
 */
export function EngagementRiskAttentionPanel({ students, isLoading, onOpenStudent }: Props) {
  const attention = pickAttentionStudents(students);

  return (
    <Card className="bg-card/90 border-border/70 border-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Crosshair className="h-5 w-5 text-amber-600" />
          Needs attention: engagement + risk
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Students with low/inactive engagement and/or elevated academic risk — review both signals in one list.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : attention.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 opacity-50" />
            No students currently match low engagement or elevated risk.
          </p>
        ) : (
          <ul className="space-y-2">
            {attention.map((s) => {
              const both =
                LOW_ENGAGEMENT.has(s.engagementLevel) &&
                s.riskLevel != null &&
                HIGH_RISK.has(s.riskLevel);
              return (
                <li
                  key={s.studentId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium truncate">{s.fullName}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <EngagementBadge level={s.engagementLevel} />
                      {s.riskLevel ? (
                        <RiskBadge level={s.riskLevel} score={s.riskScore} />
                      ) : (
                        <span className="text-xs text-muted-foreground">No risk yet</span>
                      )}
                      {both ? (
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          Both signals
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenStudent(s.studentId, s.fullName)}
                  >
                    Open
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
