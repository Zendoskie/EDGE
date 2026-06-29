import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { EngagementActivityType } from '@/lib/engagement-config';
import { trackStudentActivity } from '@/lib/track-activity';

export function useTrackPageView(
  activityType: EngagementActivityType,
  subjectId?: string | null,
  description?: string | null,
  enabled = true,
) {
  const { user, role } = useAuth();

  useEffect(() => {
    if (!enabled || !user?.id || role !== 'student') return;
    void trackStudentActivity({
      activityType,
      subjectId,
      description,
    });
  }, [activityType, subjectId, description, enabled, user?.id, role]);
}
