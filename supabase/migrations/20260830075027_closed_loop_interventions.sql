-- Closed-loop intervention tracking
-- Extends engagement actions into follow-up cases with immutable baseline/outcome snapshots.

ALTER TABLE public.engagement_interventions
  ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_id uuid REFERENCES public.counseling_referrals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor_role text NOT NULL DEFAULT 'instructor',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS follow_up_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS baseline_engagement_score numeric,
  ADD COLUMN IF NOT EXISTS baseline_engagement_level text,
  ADD COLUMN IF NOT EXISTS baseline_risk_score numeric,
  ADD COLUMN IF NOT EXISTS baseline_risk_level text,
  ADD COLUMN IF NOT EXISTS baseline_assignments_submitted integer,
  ADD COLUMN IF NOT EXISTS baseline_login_count integer,
  ADD COLUMN IF NOT EXISTS outcome_engagement_score numeric,
  ADD COLUMN IF NOT EXISTS outcome_engagement_level text,
  ADD COLUMN IF NOT EXISTS outcome_risk_score numeric,
  ADD COLUMN IF NOT EXISTS outcome_risk_level text,
  ADD COLUMN IF NOT EXISTS outcome_assignments_submitted integer,
  ADD COLUMN IF NOT EXISTS outcome_login_count integer,
  ADD COLUMN IF NOT EXISTS engagement_score_delta numeric,
  ADD COLUMN IF NOT EXISTS risk_score_delta numeric,
  ADD COLUMN IF NOT EXISTS assignments_submitted_delta integer,
  ADD COLUMN IF NOT EXISTS login_count_delta integer,
  ADD COLUMN IF NOT EXISTS outcome_rating text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.engagement_interventions
  DROP CONSTRAINT IF EXISTS engagement_interventions_action_type_check,
  DROP CONSTRAINT IF EXISTS engagement_interventions_actor_role_check,
  DROP CONSTRAINT IF EXISTS engagement_interventions_status_check,
  DROP CONSTRAINT IF EXISTS engagement_interventions_outcome_rating_check;

ALTER TABLE public.engagement_interventions
  ADD CONSTRAINT engagement_interventions_action_type_check
    CHECK (action_type IN (
      'send_reminder',
      'send_email_reminder',
      'schedule_consultation',
      'add_note',
      'mark_contacted',
      'guidance_counseling',
      'parent_contact',
      'provide_learning_materials'
    )),
  ADD CONSTRAINT engagement_interventions_actor_role_check
    CHECK (actor_role IN ('instructor', 'guidance_counselor', 'admin')),
  ADD CONSTRAINT engagement_interventions_status_check
    CHECK (status IN ('open', 'follow_up_due', 'completed', 'cancelled')),
  ADD CONSTRAINT engagement_interventions_outcome_rating_check
    CHECK (outcome_rating IS NULL OR outcome_rating IN ('improved', 'no_change', 'declined'));

CREATE INDEX IF NOT EXISTS engagement_interventions_follow_up_idx
  ON public.engagement_interventions (status, follow_up_due_at)
  WHERE status IN ('open', 'follow_up_due');

CREATE INDEX IF NOT EXISTS engagement_interventions_subject_idx
  ON public.engagement_interventions (subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS engagement_interventions_referral_idx
  ON public.engagement_interventions (referral_id, created_at DESC);

DROP TRIGGER IF EXISTS update_engagement_interventions_updated_at
  ON public.engagement_interventions;
CREATE TRIGGER update_engagement_interventions_updated_at
  BEFORE UPDATE ON public.engagement_interventions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Outcome notes can contain sensitive staff observations. Keep them outside the
-- student-readable intervention row and expose them only to authorized staff.
CREATE TABLE IF NOT EXISTS public.intervention_staff_outcomes (
  intervention_id uuid PRIMARY KEY
    REFERENCES public.engagement_interventions(id) ON DELETE CASCADE,
  outcome_note text,
  completed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intervention_staff_outcomes ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_intervention_staff_outcomes_updated_at
  ON public.intervention_staff_outcomes;
CREATE TRIGGER update_intervention_staff_outcomes_updated_at
  BEFORE UPDATE ON public.intervention_staff_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Authorized staff view intervention outcomes"
  ON public.intervention_staff_outcomes;
CREATE POLICY "Authorized staff view intervention outcomes"
  ON public.intervention_staff_outcomes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.engagement_interventions intervention
      WHERE intervention.id = intervention_staff_outcomes.intervention_id
        AND (
          intervention.instructor_id = auth.uid()
          OR public.instructor_can_view_student(intervention.student_id)
          OR public.has_role(auth.uid(), 'guidance_counselor'::public.app_role)
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
        )
    )
  );

DROP POLICY IF EXISTS "Admins manage intervention outcomes"
  ON public.intervention_staff_outcomes;
CREATE POLICY "Admins manage intervention outcomes"
  ON public.intervention_staff_outcomes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT ON public.intervention_staff_outcomes TO authenticated;
GRANT ALL ON public.intervention_staff_outcomes TO service_role;

-- Direct writes are no longer needed for instructors; guarded RPCs below
-- preserve enrollment/referral checks and snapshot integrity.
DROP POLICY IF EXISTS "Instructors manage engagement interventions"
  ON public.engagement_interventions;
DROP POLICY IF EXISTS "Instructors view engagement interventions"
  ON public.engagement_interventions;
CREATE POLICY "Instructors view engagement interventions"
  ON public.engagement_interventions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'instructor'::public.app_role)
    AND (
      instructor_id = auth.uid()
      OR public.instructor_can_view_student(student_id)
    )
  );

DROP FUNCTION IF EXISTS public.log_engagement_intervention(
  uuid, text, text, uuid, jsonb, boolean
);

CREATE FUNCTION public.log_engagement_intervention(
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
    IF p_action_type IN ('schedule_consultation', 'guidance_counseling') THEN
      v_title := 'Support follow-up scheduled';
      v_body := COALESCE(
        NULLIF(trim(COALESCE(p_note, '')), ''),
        'A staff member scheduled a support follow-up. Please check EDGE.'
      );
    ELSE
      v_title := 'Engagement support update';
      v_body := COALESCE(
        NULLIF(trim(COALESCE(p_note, '')), ''),
        'A staff member recorded an engagement support action for you.'
      );
    END IF;

    INSERT INTO public.user_inbox_notifications (user_id, title, body)
    VALUES (p_student_id, v_title, v_body);
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

  INSERT INTO public.user_inbox_notifications (user_id, title, body)
  VALUES (
    v_intervention.student_id,
    'Engagement support follow-up completed',
    'A staff member completed a follow-up and reviewed your current engagement progress.'
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
BEGIN
  FOR v_intervention IN
    SELECT intervention.id, intervention.instructor_id, intervention.student_id
    FROM public.engagement_interventions intervention
    WHERE intervention.status IN ('open', 'follow_up_due')
      AND intervention.follow_up_due_at IS NOT NULL
      AND intervention.follow_up_due_at <= now()
      AND intervention.follow_up_notified_at IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.user_inbox_notifications (user_id, title, body)
    VALUES (
      v_intervention.instructor_id,
      'Intervention follow-up due',
      'An engagement intervention is ready for outcome review. Open the student engagement panel to complete it.'
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
