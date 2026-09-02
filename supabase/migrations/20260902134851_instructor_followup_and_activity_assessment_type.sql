-- 1) Allow the assessment types chosen at activity creation to be stored on activities.
--    Keep legacy 'exam' so existing rows remain valid.
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_type_check
  CHECK (type IN (
    'quiz',
    'assignment',
    'project',
    'exam',
    'activity',
    'laboratory_exam',
    'midterm_exam',
    'final_exam'
  ));

ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_assessment_type_check;
ALTER TABLE public.submissions ADD CONSTRAINT submissions_assessment_type_check
  CHECK (
    assessment_type IS NULL OR assessment_type IN (
      'activity',
      'assignment',
      'quiz',
      'laboratory_exam',
      'midterm_exam',
      'final_exam',
      'project',
      'exam'
    )
  );

-- 2) Shared helpers so follow-up notices always name the staff member and student.
CREATE OR REPLACE FUNCTION public.profile_display_name(p_user_id uuid, p_fallback text DEFAULT 'Unknown')
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT COALESCE(
        NULLIF(trim(profile.full_name), ''),
        NULLIF(trim(profile.email), '')
      )
      FROM public.profiles profile
      WHERE profile.user_id = p_user_id
      LIMIT 1
    ),
    p_fallback
  );
$$;

REVOKE ALL ON FUNCTION public.profile_display_name(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_display_name(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.engagement_actor_role_label(p_actor_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_actor_role
    WHEN 'guidance_counselor' THEN 'Guidance Counselor'
    WHEN 'admin' THEN 'Administrator'
    ELSE 'Instructor'
  END;
$$;

REVOKE ALL ON FUNCTION public.engagement_actor_role_label(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.engagement_actor_role_label(text) TO service_role;

CREATE OR REPLACE FUNCTION public.format_engagement_followup_notice(
  p_actor_role text,
  p_actor_id uuid,
  p_student_id uuid,
  p_completed boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_actor text;
  v_student text;
BEGIN
  v_role := public.engagement_actor_role_label(p_actor_role);
  v_actor := public.profile_display_name(p_actor_id, 'Staff');
  v_student := public.profile_display_name(p_student_id, 'the student');

  IF p_completed THEN
    RETURN format('%s %s completed an engagement follow-up for %s.', v_role, v_actor, v_student);
  END IF;

  RETURN format('%s %s sent an engagement follow-up for %s.', v_role, v_actor, v_student);
END;
$$;

REVOKE ALL ON FUNCTION public.format_engagement_followup_notice(text, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_engagement_followup_notice(text, uuid, uuid, boolean)
  TO service_role;

-- 3) Student inbox: name the instructor (or other staff actor) on follow-up actions.
CREATE OR REPLACE FUNCTION public.log_engagement_intervention(
  p_student_id uuid,
  p_action_type text,
  p_note text DEFAULT NULL,
  p_alert_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_notify_student boolean DEFAULT true,
  p_subject_id uuid DEFAULT NULL,
  p_referral_id uuid DEFAULT NULL,
  p_follow_up_due_at timestamptz DEFAULT (now() + interval '7 days')
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_actor_role text;
  v_is_admin boolean;
  v_is_guidance boolean;
  v_summary public.student_engagement_summary%ROWTYPE;
  v_prediction public.predictions%ROWTYPE;
  v_title text;
  v_body text;
  v_status text;
  v_note text;
  v_source_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);
  v_is_guidance := public.has_role(auth.uid(), 'guidance_counselor'::public.app_role);

  IF v_is_admin THEN
    v_actor_role := 'admin';
  ELSIF v_is_guidance THEN
    v_actor_role := 'guidance_counselor';
  ELSIF public.has_role(auth.uid(), 'instructor'::public.app_role) THEN
    v_actor_role := 'instructor';
  ELSE
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_action_type NOT IN (
    'send_reminder',
    'send_email_reminder',
    'schedule_consultation',
    'add_note',
    'mark_contacted',
    'guidance_counseling',
    'parent_contact',
    'provide_learning_materials'
  ) THEN
    RAISE EXCEPTION 'invalid action_type';
  END IF;

  IF v_is_guidance THEN
    IF p_action_type <> 'guidance_counseling' OR p_referral_id IS NULL THEN
      RAISE EXCEPTION 'approved_referral_required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.counseling_referrals referral
      WHERE referral.id = p_referral_id
        AND referral.student_id = p_student_id
        AND referral.status = 'approved'
        AND (p_subject_id IS NULL OR referral.subject_id = p_subject_id)
    ) THEN
      RAISE EXCEPTION 'approved_referral_required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT v_is_admin THEN
    IF NOT public.instructor_can_view_student(p_student_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF p_subject_id IS NOT NULL
       AND NOT public.instructor_can_view_student_subject(p_student_id, p_subject_id) THEN
      RAISE EXCEPTION 'forbidden_subject' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_alert_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.engagement_alerts alert
    WHERE alert.id = p_alert_id
      AND alert.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'invalid_alert';
  END IF;

  SELECT *
  INTO v_summary
  FROM public.student_engagement_summary
  WHERE student_id = p_student_id;

  SELECT prediction.*
  INTO v_prediction
  FROM public.predictions prediction
  WHERE prediction.student_id = p_student_id
    AND (p_subject_id IS NULL OR prediction.subject_id = p_subject_id)
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

  v_status := CASE WHEN p_action_type = 'add_note' THEN 'completed' ELSE 'open' END;

  INSERT INTO public.engagement_interventions (
    alert_id,
    student_id,
    instructor_id,
    action_type,
    note,
    metadata,
    subject_id,
    referral_id,
    actor_role,
    status,
    follow_up_due_at,
    completed_at,
    completed_by,
    baseline_engagement_score,
    baseline_engagement_level,
    baseline_risk_score,
    baseline_risk_level,
    baseline_assignments_submitted,
    baseline_login_count
  ) VALUES (
    p_alert_id,
    p_student_id,
    auth.uid(),
    p_action_type,
    NULLIF(trim(COALESCE(p_note, '')), ''),
    COALESCE(p_metadata, '{}'::jsonb),
    p_subject_id,
    p_referral_id,
    v_actor_role,
    v_status,
    CASE WHEN p_action_type = 'add_note' THEN NULL ELSE p_follow_up_due_at END,
    CASE WHEN p_action_type = 'add_note' THEN now() ELSE NULL END,
    CASE WHEN p_action_type = 'add_note' THEN auth.uid() ELSE NULL END,
    v_summary.engagement_score,
    v_summary.engagement_level,
    v_prediction.risk_score,
    v_prediction.risk_level,
    v_summary.assignments_submitted,
    v_summary.total_login_count
  )
  RETURNING id INTO v_id;

  IF p_action_type = 'mark_contacted' AND p_alert_id IS NOT NULL THEN
    UPDATE public.engagement_alerts
    SET
      status = 'acknowledged',
      acknowledged_by = auth.uid(),
      acknowledged_at = now(),
      updated_at = now()
    WHERE id = p_alert_id
      AND student_id = p_student_id;
  END IF;

  IF p_notify_student AND p_action_type IN (
    'send_reminder',
    'send_email_reminder',
    'schedule_consultation',
    'guidance_counseling',
    'parent_contact',
    'provide_learning_materials'
  ) THEN
    v_title := 'Engagement follow-up';
    v_body := public.format_engagement_followup_notice(
      v_actor_role,
      auth.uid(),
      p_student_id,
      false
    );
    v_note := NULLIF(trim(COALESCE(p_note, '')), '');
    IF v_note IS NOT NULL THEN
      v_body := v_body || E'\n\n' || v_note;
    END IF;
    v_source_name := public.engagement_actor_role_label(v_actor_role)
      || ' '
      || public.profile_display_name(auth.uid(), 'Staff');

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (p_student_id, v_title, v_body, v_source_name);
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_engagement_intervention(
  uuid, text, text, uuid, jsonb, boolean, uuid, uuid, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_engagement_intervention(
  uuid, text, text, uuid, jsonb, boolean, uuid, uuid, timestamptz
) TO authenticated, service_role;

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

  INSERT INTO public.intervention_staff_outcomes (
    intervention_id,
    outcome_note,
    completed_by
  ) VALUES (
    p_intervention_id,
    NULLIF(trim(COALESCE(p_outcome_note, '')), ''),
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

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
  VALUES (
    v_intervention.student_id,
    'Engagement follow-up completed',
    public.format_engagement_followup_notice(
      v_intervention.actor_role,
      auth.uid(),
      v_intervention.student_id,
      true
    ),
    v_source_name
  );

  RETURN p_intervention_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_engagement_intervention(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_engagement_intervention(uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.scan_due_intervention_followups()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intervention record;
  v_count integer := 0;
  v_student_name text;
  v_role_label text;
BEGIN
  FOR v_intervention IN
    SELECT
      intervention.id,
      intervention.instructor_id,
      intervention.student_id,
      intervention.actor_role
    FROM public.engagement_interventions intervention
    WHERE intervention.status IN ('open', 'follow_up_due')
      AND intervention.follow_up_due_at IS NOT NULL
      AND intervention.follow_up_due_at <= now()
      AND intervention.follow_up_notified_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    v_student_name := public.profile_display_name(v_intervention.student_id, 'a student');
    v_role_label := public.engagement_actor_role_label(v_intervention.actor_role);

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      v_intervention.instructor_id,
      'Engagement follow-up due',
      format(
        '%s follow-up for %s is due for outcome review.',
        v_role_label,
        v_student_name
      ),
      'EDGE System'
    );

    UPDATE public.engagement_interventions
    SET
      status = 'follow_up_due',
      follow_up_notified_at = now(),
      updated_at = now()
    WHERE id = v_intervention.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_due_intervention_followups()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_due_intervention_followups()
  TO service_role;
