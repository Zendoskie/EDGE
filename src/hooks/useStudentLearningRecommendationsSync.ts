import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { syncLearningRecommendationsForStudent } from '@/lib/learning-recommendations-sync';

/**
 * Once per mount, sync heuristic study recommendations when the student's latest
 * prediction is Vulnerable/Crucial (at_risk / critical).
 */
export function useStudentLearningRecommendationsSync(studentUserId: string | undefined) {
  const queryClient = useQueryClient();
  const syncAttempted = useRef(false);

  const { data: latestRiskLevel } = useQuery({
    queryKey: ['student-risk-for-recommendations', studentUserId],
    queryFn: async () => {
      if (!studentUserId) return null;
      const { data, error } = await supabase
        .from('predictions')
        .select('risk_level')
        .eq('student_id', studentUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.risk_level ?? null;
    },
    enabled: !!studentUserId,
  });

  useEffect(() => {
    if (!studentUserId || latestRiskLevel == null || syncAttempted.current) return;
    syncAttempted.current = true;
    void syncLearningRecommendationsForStudent(studentUserId, latestRiskLevel).then((result) => {
      if (result.status === 'synced') {
        queryClient.invalidateQueries({ queryKey: ['ai-recommendations', studentUserId] });
      }
    });
  }, [studentUserId, latestRiskLevel, queryClient]);
}
