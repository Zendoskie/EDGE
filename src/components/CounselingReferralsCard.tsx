import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReferralStatusBadge } from "@/components/ReferralStatusBadge";
import type { CounselingReferralRow } from "@/hooks/useCounselingReferrals";
import { normalizeReferralStatus } from "@/lib/referral-utils";
import { UserCheck } from "lucide-react";

type Props = {
  referrals: CounselingReferralRow[];
  loading?: boolean;
  compact?: boolean;
  showStudent?: boolean;
  showInstructor?: boolean;
  linkSubjects?: boolean;
  title?: string;
  description?: string;
};

export function CounselingReferralsCard({
  referrals,
  loading = false,
  compact = false,
  showStudent = false,
  showInstructor = false,
  linkSubjects = false,
  title = "Counseling referrals",
  description = "Status of guidance counseling requests for your courses.",
}: Props) {
  const pendingCount = referrals.filter((r) => normalizeReferralStatus(r.status) === "pending").length;
  const display = compact ? referrals.slice(0, 5) : referrals;

  return (
    <Card className="bg-card/90 w-full min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <UserCheck className="h-5 w-5 shrink-0" />
          {title}
          {pendingCount > 0 ? (
            <span className="text-sm font-normal text-muted-foreground">
              ({pendingCount} pending)
            </span>
          ) : null}
        </CardTitle>
        {!compact && description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading referrals…</p>
        ) : display.length === 0 ? (
          <p className="text-sm text-muted-foreground">No counseling referrals yet.</p>
        ) : (
          <div className="space-y-3">
            {display.map((r) => {
              const subjectLabel = r.subject?.code
                ? `${r.subject.code}${r.subject.name ? ` — ${r.subject.name}` : ""}`
                : "Subject";
              const subjectInner =
                linkSubjects && r.subject_id ? (
                  <Link
                    to={`/dashboard/subjects/${r.subject_id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {subjectLabel}
                  </Link>
                ) : (
                  <p className="font-medium">{subjectLabel}</p>
                );

              return (
                <div
                  key={r.id}
                  className="min-w-0 rounded-xl border border-border/60 p-3 sm:p-4 space-y-2"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      {subjectInner}
                      {showStudent ? (
                        <p className="text-xs text-muted-foreground truncate">
                          Student: {r.student?.full_name ?? r.student?.email ?? r.student_id}
                        </p>
                      ) : null}
                      {showInstructor ? (
                        <p className="text-xs text-muted-foreground truncate">
                          Referred by: {r.instructor?.full_name ?? r.instructor?.email ?? "—"}
                        </p>
                      ) : null}
                      {!compact && r.recommendation_message ? (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {r.recommendation_message}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                        {r.reviewed_at
                          ? ` · Reviewed ${new Date(r.reviewed_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <ReferralStatusBadge status={r.status} className="shrink-0 self-start" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
