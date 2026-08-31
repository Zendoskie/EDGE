import { canonicalEngagementLevel } from '@/lib/engagement-utils';

export type GuidanceEngagementRow = {
  studentId: string;
  fullName: string;
  engagementLevel: string;
  engagementScore: number;
  totalLogins: number;
  totalTime: number;
  lastLoginAt: string | null;
};

export type GuidanceStudentProfile = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  student_id: string | null;
};

type EngagementSummary = {
  student_id: string;
  engagement_level: string;
  engagement_score: number;
  total_login_count: number;
  total_time_spent_seconds: number;
  last_login_at: string | null;
};

export function studentDisplayName(profile: GuidanceStudentProfile): string | null {
  return (
    profile.full_name?.trim() ||
    profile.student_id?.trim() ||
    profile.email?.trim() ||
    null
  );
}

export function buildGuidanceEngagementRows(
  summaries: EngagementSummary[],
  profiles: GuidanceStudentProfile[],
): GuidanceEngagementRow[] {
  const nameById = new Map(
    profiles
      .map((profile) => [profile.user_id, studentDisplayName(profile)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );

  return summaries
    .filter((summary) => nameById.has(summary.student_id))
    .map((summary) => ({
      studentId: summary.student_id,
      fullName: nameById.get(summary.student_id)!,
      engagementLevel: canonicalEngagementLevel(summary.engagement_level),
      engagementScore: Number(summary.engagement_score ?? 0),
      totalLogins: summary.total_login_count ?? 0,
      totalTime: summary.total_time_spent_seconds ?? 0,
      lastLoginAt: summary.last_login_at,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
