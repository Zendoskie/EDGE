import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchActiveEnrolledSubjectIds } from '@/lib/student-performance-scope';

/** Shared cache for active enrollment subject IDs (dedupes parallel dashboard queries). */
export function useStudentEnrolledSubjectIds(studentId: string | undefined) {
  return useQuery({
    queryKey: ['student-enrolled-subject-ids', studentId],
    queryFn: () => fetchActiveEnrolledSubjectIds(supabase, studentId!),
    enabled: !!studentId,
    staleTime: 60_000,
  });
}
