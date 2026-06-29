export type CanonicalEngagementLevel = 'very_high' | 'high' | 'moderate' | 'low';

export function canonicalEngagementLevel(level: unknown): CanonicalEngagementLevel {
  if (typeof level !== 'string') return 'moderate';
  const normalized = level.trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'very_high' || normalized === 'veryhigh') return 'very_high';
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  if (normalized === 'moderate') return 'moderate';
  return 'moderate';
}

export function engagementLabel(level: CanonicalEngagementLevel): string {
  if (level === 'very_high') return 'Very High';
  if (level === 'high') return 'High';
  if (level === 'low') return 'Low';
  return 'Moderate';
}

/** Tailwind classes for color-coded engagement badges. */
export function engagementBadgeClassName(level: CanonicalEngagementLevel): string {
  if (level === 'very_high') {
    return 'border-transparent bg-blue-600 text-white hover:bg-blue-600/85 dark:bg-blue-600 dark:text-white';
  }
  if (level === 'high') {
    return 'border-transparent bg-emerald-600 text-white hover:bg-emerald-600/85 dark:bg-emerald-600 dark:text-white';
  }
  if (level === 'moderate') {
    return 'border-transparent bg-amber-500 text-white hover:bg-amber-500/85 dark:bg-amber-500 dark:text-white';
  }
  return 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85';
}

export function engagementChartColor(level: CanonicalEngagementLevel): string {
  if (level === 'very_high') return 'hsl(221 76% 48%)';
  if (level === 'high') return 'hsl(142 76% 36%)';
  if (level === 'moderate') return 'hsl(38 92% 50%)';
  return 'hsl(0 72% 51%)';
}

export const ENGAGEMENT_LEVEL_ORDER: CanonicalEngagementLevel[] = [
  'low',
  'moderate',
  'high',
  'very_high',
];

export function formatActivityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    view_material: 'Viewed learning material',
    open_module: 'Opened course module',
    read_announcement: 'Read announcement',
    view_file: 'Viewed uploaded file',
    view_subject_page: 'Accessed subject page',
    view_coaching: 'Viewed AI coaching recommendation',
    view_grades: 'Viewed grades',
    view_attendance: 'Viewed attendance records',
    quiz_complete: 'Completed quiz',
    assignment_submit: 'Submitted assignment',
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}
