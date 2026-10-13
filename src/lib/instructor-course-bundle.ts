import { supabase } from '@/integrations/supabase/client';
import { PREDICTION_EVIDENCE_COLUMNS } from '@/lib/risk-scoring';

export type InstructorCourseBundle = {
  enrollments: Array<{
    student_id: string | null;
    subject_id: string | null;
    status: string | null;
  }>;
  predictions: Array<Record<string, unknown>>;
};

export function instructorCourseBundleKey(userId: string, subjectIds: string[]) {
  return ['instructor-course-bundle', userId, [...subjectIds].sort().join(',')] as const;
}

/** One enrollments read and one predictions read, shared by every instructor dashboard section. */
export async function fetchInstructorCourseBundle(subjectIds: string[]): Promise<InstructorCourseBundle> {
  if (subjectIds.length === 0) return { enrollments: [], predictions: [] };

  const [enrollmentsRes, predictionsRes] = await Promise.all([
    supabase
      .from('enrollments')
      .select('student_id, subject_id, status')
      .in('subject_id', subjectIds),
    supabase
      .from('predictions')
      .select(
        `id, risk_level, recommendation, student_id, subject_id, assignment_average, created_at, subjects(id, code, name), ${PREDICTION_EVIDENCE_COLUMNS}`,
      )
      .in('subject_id', subjectIds)
      .order('created_at', { ascending: false }),
  ]);

  if (enrollmentsRes.error) throw enrollmentsRes.error;
  if (predictionsRes.error) throw predictionsRes.error;

  return {
    enrollments: enrollmentsRes.data ?? [],
    predictions: (predictionsRes.data ?? []) as Array<Record<string, unknown>>,
  };
}
