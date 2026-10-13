import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { studentReleaseKey, subjectReleaseKey } from '@/lib/final-grade-freshness';

/**
 * Approved backstop for source changes no existing signal reports (final_grade_releases is not in
 * Realtime): refetch every 180 s while the tab is visible, and on every return to the tab.
 */
export const RELEASE_QUERY_FRESHNESS = {
  refetchInterval: 180_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: 'always',
} as const;

export type StudentReleaseRow = { subject_id: string; status: string; final_grade: number | null };
export type SubjectReleaseRow = {
  student_id: string;
  status: string;
  final_grade: number | null;
  released_at: string;
  review_reason: string | null;
};

/** One RLS-scoped read of a student's release rows (the student's own, or a linked parent's child). */
export function useStudentFinalGradeReleases(studentId: string | null | undefined) {
  return useQuery({
    queryKey: studentReleaseKey(studentId),
    queryFn: async (): Promise<StudentReleaseRow[]> => {
      const { data, error } = await supabase
        .from('final_grade_releases')
        .select('subject_id, status, final_grade')
        .eq('student_id', studentId!);
      if (error) throw error;
      return (data ?? []) as StudentReleaseRow[];
    },
    enabled: !!studentId,
    ...RELEASE_QUERY_FRESHNESS,
  });
}

/** One RLS-scoped read of a subject's release rows for its owning instructor. */
export function useSubjectFinalGradeReleases(subjectId: string | null | undefined) {
  return useQuery({
    queryKey: subjectReleaseKey(subjectId),
    queryFn: async (): Promise<SubjectReleaseRow[]> => {
      const { data, error } = await supabase
        .from('final_grade_releases')
        .select('student_id, status, final_grade, released_at, review_reason')
        .eq('subject_id', subjectId!);
      if (error) throw error;
      return (data ?? []) as SubjectReleaseRow[];
    },
    enabled: !!subjectId,
    ...RELEASE_QUERY_FRESHNESS,
  });
}
