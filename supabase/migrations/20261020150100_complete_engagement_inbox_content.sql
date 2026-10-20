-- Include persisted follow-up note and improvement outcome in the student inbox
-- when an engagement intervention is completed.

CREATE OR REPLACE FUNCTION public.engagement_outcome_rating_label(p_rating text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_rating
    WHEN 'improved' THEN 'Improved'
    WHEN 'no_change' THEN 'No meaningful change'
    WHEN 'declined' THEN 'Declined'
    ELSE 'Not evaluated'
  END;
$$;

CREATE OR REPLACE FUNCTION public.complete_engagement_intervention(
  p_intervention_id uuid,
  p_outcome_rating text,
  p_outcome_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intervention public.engagement_interventions%ROWTYPE;
  v_summary public.student_engagement_summary%ROWTYPE;
  v_prediction public.predictions%ROWTYPE;
  v_is_admin boolean;
  v_is_guidance boolean;
  v_source_name text;
  v_body text;
  v_outcome_note text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_outcome_rating NOT IN ('improved', 'no_change', 'declined') THEN
    RAISE EXCEPTION 'invalid_outcome_rating';
  END IF;

  SELECT *
  INTO v_intervention
  FROM public.engagement_interventions
  WHERE id = p_intervention_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'intervention_not_found';
  END IF;

  IF v_intervention.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'intervention_already_closed';
  END IF;

  v_is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_is_guidance := public.has_role(auth.uid(), 'guidance_counselor'::public.app_role);

  IF NOT v_is_admin AND v_intervention.instructor_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_intervention.actor_role = 'guidance_counselor'
     AND NOT v_is_admin
     AND (
       NOT v_is_guidance
       OR v_intervention.instructor_id <> auth.uid()
       OR v_intervention.referral_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.counseling_referrals referral
         WHERE referral.id = v_intervention.referral_id
           AND referral.status = 'approved'
       )
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_summary
  FROM public.student_engagement_summary
  WHERE student_id = v_intervention.student_id;

  SELECT prediction.*
  INTO v_prediction
  FROM public.predictions prediction
  WHERE prediction.student_id = v_intervention.student_id
    AND (
      v_intervention.subject_id IS NULL
      OR prediction.subject_id = v_intervention.subject_id
    )
  ORDER BY
    CASE lower(replace(prediction.risk_level, ' ', '_'))
      WHEN 'critical' THEN 4
      WHEN 'at_risk' THEN 3
      WHEN 'stable' THEN 2
      WHEN 'excelling' THEN 1
      ELSE 0
    END DESC,
    prediction.created_at DESC NULLS LAST
  LIMIT 1;

  UPDATE public.engagement_interventions
  SET
    status = 'completed',
    completed_at = now(),
    completed_by = auth.uid(),
    outcome_rating = p_outcome_rating,
    outcome_engagement_score = v_summary.engagement_score,
    outcome_engagement_level = v_summary.engagement_level,
    outcome_risk_score = v_prediction.risk_score,
    outcome_risk_level = v_prediction.risk_level,
    outcome_assignments_submitted = v_summary.assignments_submitted,
    outcome_login_count = v_summary.total_login_count,
    engagement_score_delta =
      CASE
        WHEN v_summary.engagement_score IS NULL OR baseline_engagement_score IS NULL THEN NULL
        ELSE v_summary.engagement_score - baseline_engagement_score
      END,
    risk_score_delta =
      CASE
        WHEN v_prediction.risk_score IS NULL OR baseline_risk_score IS NULL THEN NULL
        ELSE v_prediction.risk_score - baseline_risk_score
      END,
    assignments_submitted_delta =
      CASE
        WHEN v_summary.assignments_submitted IS NULL
          OR baseline_assignments_submitted IS NULL THEN NULL
        ELSE v_summary.assignments_submitted - baseline_assignments_submitted
      END,
    login_count_delta =
      CASE
        WHEN v_summary.total_login_count IS NULL OR baseline_login_count IS NULL THEN NULL
        ELSE v_summary.total_login_count - baseline_login_count
      END,
    updated_at = now()
  WHERE id = p_intervention_id;

  v_outcome_note := NULLIF(trim(COALESCE(p_outcome_note, '')), '');

  INSERT INTO public.intervention_staff_outcomes (
    intervention_id,
    outcome_note,
    completed_by
  ) VALUES (
    p_intervention_id,
    v_outcome_note,
    auth.uid()
  )
  ON CONFLICT (intervention_id) DO UPDATE
  SET
    outcome_note = EXCLUDED.outcome_note,
    completed_by = EXCLUDED.completed_by,
    updated_at = now();

  IF v_intervention.alert_id IS NOT NULL THEN
    UPDATE public.engagement_alerts
    SET status = 'resolved', updated_at = now()
    WHERE id = v_intervention.alert_id
      AND student_id = v_intervention.student_id;
  END IF;

  v_source_name := public.engagement_actor_role_label(v_intervention.actor_role)
    || ' '
    || public.profile_display_name(auth.uid(), 'Staff');

  v_body := public.format_engagement_followup_notice(
    v_intervention.actor_role,
    auth.uid(),
    v_intervention.student_id,
    true
  );

  IF NULLIF(trim(COALESCE(v_intervention.note, '')), '') IS NOT NULL THEN
    v_body := v_body || E'\n\n' || trim(v_intervention.note);
  END IF;

  v_body := v_body || E'\n\nImprovement status: '
    || public.engagement_outcome_rating_label(p_outcome_rating);

  IF v_outcome_note IS NOT NULL THEN
    v_body := v_body || E'\n\nOutcome note: ' || v_outcome_note;
  END IF;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    v_intervention.student_id,
    'Engagement follow-up completed',
    v_body,
    v_source_name
  );

  RETURN p_intervention_id;
END;
$$;
