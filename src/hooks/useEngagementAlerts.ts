import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';
import {
  type EngagementAlert,
  type EngagementIntervention,
  type EngagementInterventionAction,
  type EngagementOutcomeRating,
} from '@/lib/engagement-alerts';
import type { Json } from '@/integrations/supabase/types';
import { recordCounselingOutcome } from '@/lib/counseling-outcome-notification';
import { emailCounselorFollowup, emailEngagementIntervention } from '@/lib/intervention-notification';
import { shouldEmailEngagementIntervention } from '../../supabase/functions/_shared/notification-channels';

export function useInstructorEngagementAlerts(enabled = true) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['instructor-engagement-alerts', user?.id],
    queryFn: async () => {
      // Refresh inactivity-based alerts when the monitoring page loads.
      await supabase.rpc('scan_engagement_inactivity_alerts');

      const { data: subjects, error: subjectsError } = await supabase
        .from('subjects')
        .select('id')
        .eq('instructor_id', user!.id);
      if (subjectsError) throw subjectsError;
      const subjectIds = (subjects ?? []).map((s) => s.id);
      if (subjectIds.length === 0) return [] as EngagementAlert[];

      const { data: enrollments, error: enrollError } = await supabase
        .from('enrollments')
        .select('student_id')
        .in('subject_id', subjectIds)
        .eq('status', 'active');
      if (enrollError) throw enrollError;

      const studentIds = [
        ...new Set(
          (enrollments ?? [])
            .map((e) => e.student_id)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      if (studentIds.length === 0) return [] as EngagementAlert[];

      const { data, error } = await supabase
        .from('engagement_alerts')
        .select('*')
        .in('student_id', studentIds)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as EngagementAlert[];
    },
    enabled: enabled && !!user?.id && role === 'instructor',
    staleTime: 120_000,
    refetchInterval: 180_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    return subscribeEngagementInvalidation(() => {
      void queryClient.invalidateQueries({ queryKey: ['instructor-engagement-alerts', user?.id] });
    });
  }, [queryClient, user?.id]);

  return query;
}

export function useStudentEngagementAlerts(studentId: string | undefined | null) {
  return useQuery({
    queryKey: ['student-engagement-alerts', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('engagement_alerts')
        .select('*')
        .eq('student_id', studentId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as EngagementAlert[];
    },
    enabled: !!studentId,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

export function useEngagementInterventions(studentId: string | undefined | null) {
  return useQuery({
    queryKey: ['engagement-interventions', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('engagement_interventions')
        .select('*, intervention_staff_outcomes(outcome_note, completed_by)')
        .eq('student_id', studentId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as EngagementIntervention[];
    },
    enabled: !!studentId,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
}

type LogInterventionInput = {
  studentId: string;
  actionType: EngagementInterventionAction;
  note?: string;
  alertId?: string | null;
  metadata?: Record<string, unknown>;
  subjectId?: string | null;
  referralId?: string | null;
  followUpDueAt?: string | null;
};

export function useLogEngagementIntervention() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LogInterventionInput) => {
      if (!user?.id) throw new Error('Missing instructor session');

      const { data, error } = await supabase.rpc('log_engagement_intervention', {
        p_student_id: input.studentId,
        p_action_type: input.actionType,
        p_note: input.note?.trim() || null,
        p_alert_id: input.alertId ?? null,
        p_metadata: (input.metadata ?? {}) as Json,
        p_notify_student: input.actionType !== 'add_note',
        p_subject_id: input.subjectId ?? undefined,
        p_referral_id: input.referralId ?? undefined,
        p_follow_up_due_at: input.followUpDueAt ?? undefined,
      });
      if (error) throw error;

      const id = data as string;
      if (input.actionType === 'guidance_counseling') {
        const email = await emailCounselorFollowup(id);
        return { id, emailError: email.emailError };
      }
      if (!shouldEmailEngagementIntervention(input.actionType)) {
        return { id, emailError: null as string | null };
      }
      const email = await emailEngagementIntervention(id);
      return { id, emailError: email.emailError };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['engagement-interventions', variables.studentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['student-engagement-alerts', variables.studentId],
      });
      void queryClient.invalidateQueries({ queryKey: ['instructor-engagement-alerts'] });
    },
  });
}

type CompleteInterventionInput = {
  interventionId: string;
  studentId: string;
  outcomeRating: EngagementOutcomeRating;
  outcomeNote?: string;
  actionType: string;
  actorRole: string;
};

export function useCompleteEngagementIntervention() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CompleteInterventionInput) =>
      recordCounselingOutcome({
        interventionId: input.interventionId,
        outcomeRating: input.outcomeRating,
        outcomeNote: input.outcomeNote,
        actionType: input.actionType,
        actorRole: input.actorRole,
      }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['engagement-interventions', variables.studentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['student-engagement-alerts', variables.studentId],
      });
      void queryClient.invalidateQueries({ queryKey: ['instructor-engagement-alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-engagement-analytics'] });
    },
  });
}
