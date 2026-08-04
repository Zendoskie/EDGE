import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { subscribeEngagementInvalidation } from '@/lib/engagement-cache';
import type {
  EngagementAlert,
  EngagementIntervention,
  EngagementInterventionAction,
} from '@/lib/engagement-alerts';
import type { Json } from '@/integrations/supabase/types';

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
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
    refetchInterval: 30_000,
  });
}

export function useEngagementInterventions(studentId: string | undefined | null) {
  return useQuery({
    queryKey: ['engagement-interventions', studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('engagement_interventions')
        .select('*')
        .eq('student_id', studentId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as EngagementIntervention[];
    },
    enabled: !!studentId,
    refetchInterval: 30_000,
  });
}

type LogInterventionInput = {
  studentId: string;
  actionType: EngagementInterventionAction;
  note?: string;
  alertId?: string | null;
  metadata?: Record<string, unknown>;
  /** When true, attempt email via send-notification edge function. */
  sendEmail?: boolean;
  studentEmail?: string | null;
  subjectId?: string | null;
};

export function useLogEngagementIntervention() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LogInterventionInput) => {
      if (!user?.id) throw new Error('Missing instructor session');

      if (input.sendEmail && input.studentEmail) {
        const { error: emailError } = await supabase.functions.invoke('send-notification', {
          body: {
            to: input.studentEmail,
            student_id: input.studentId,
            subject_id: input.subjectId ?? undefined,
            risk_level: 'stable',
            subject_code: 'EDGE',
            subject_name: 'Engagement follow-up',
            body:
              input.note?.trim() ||
              'Your instructor sent an engagement reminder via EDGE. Please log in and check your courses.',
          },
        });
        if (emailError) throw new Error(emailError.message || 'Failed to send email');
      }

      const { data, error } = await supabase.rpc('log_engagement_intervention', {
        p_student_id: input.studentId,
        p_action_type: input.actionType,
        p_note: input.note?.trim() || null,
        p_alert_id: input.alertId ?? null,
        p_metadata: (input.metadata ?? {}) as Json,
        p_notify_student: input.actionType !== 'add_note',
      });
      if (error) throw error;

      return { id: data as string } as Pick<EngagementIntervention, 'id'>;
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
