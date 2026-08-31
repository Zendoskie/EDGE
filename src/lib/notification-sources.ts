import { supabase } from '@/integrations/supabase/client';

export const EDGE_SYSTEM_SOURCE = 'EDGE System';

export async function resolveProfileSource(
  userId: string | null | undefined,
  fallback = EDGE_SYSTEM_SOURCE,
): Promise<string> {
  if (!userId) return fallback;

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return fallback;
  return data?.full_name?.trim() || data?.email?.trim() || fallback;
}

export async function resolveSubjectInstructorSource(
  subjectId: string | null | undefined,
  fallback = EDGE_SYSTEM_SOURCE,
): Promise<string> {
  if (!subjectId) return fallback;

  const { data, error } = await supabase
    .from('subjects')
    .select('instructor_id')
    .eq('id', subjectId)
    .maybeSingle();

  if (error || !data?.instructor_id) return fallback;
  return resolveProfileSource(data.instructor_id, fallback);
}

export async function resolveActivitySource(
  activityId: string | null | undefined,
  fallback = EDGE_SYSTEM_SOURCE,
): Promise<string> {
  if (!activityId) return fallback;

  const { data, error } = await supabase
    .from('activities')
    .select('grades_published_by, subject_id')
    .eq('id', activityId)
    .maybeSingle();

  if (error || !data) return fallback;
  if (data.grades_published_by) {
    return resolveProfileSource(data.grades_published_by, fallback);
  }
  return resolveSubjectInstructorSource(data.subject_id, fallback);
}
