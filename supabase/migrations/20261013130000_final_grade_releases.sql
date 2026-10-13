-- Phase 3B: final-grade release backend.
--
-- 1. final_grade_releases: one row per (subject, student). Clients can only SELECT it; the
--    release-final-grades Edge Function writes it through commit_final_grade_releases().
-- 2. final_grade_input_versions: a per-subject counter of grade-input changes. Every relevant
--    change to submissions, attendance, activities or subject_grading_systems bumps it in the
--    same transaction as the change and holds its row lock until that transaction ends.
-- 3. commit_final_grade_releases(): locks the version row, rejects the batch when the version
--    differs from the one the Edge Function read before its other reads, and otherwise upserts.
--    A stale grade therefore cannot be committed as released.
-- 4. Review triggers: bump the version FIRST, then flag released rows as needs_review with
--    final_grade cleared. Bumping first makes an edit that starts while a commit holds the lock
--    wait for that commit, so its flag statement sees (and flags) the rows just released.
--
-- The grade itself is computed only in TypeScript (Phase 1); nothing here recalculates it.
-- Neither table is added to supabase_realtime.

CREATE TABLE public.final_grade_releases (
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  final_grade numeric(5,2) CHECK (final_grade BETWEEN 0 AND 100),
  weights jsonb NOT NULL CHECK (jsonb_typeof(weights) = 'object'),
  status text NOT NULL CHECK (status IN ('released', 'needs_review')),
  released_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_reason text,
  review_flagged_at timestamptz,
  PRIMARY KEY (subject_id, student_id),
  CONSTRAINT final_grade_releases_state_check CHECK (
    (status = 'released' AND final_grade IS NOT NULL AND review_reason IS NULL AND review_flagged_at IS NULL)
    OR (status = 'needs_review' AND final_grade IS NULL AND review_reason IS NOT NULL AND review_flagged_at IS NOT NULL)
  )
);

CREATE INDEX final_grade_releases_student_idx ON public.final_grade_releases (student_id);

ALTER TABLE public.final_grade_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own final grades" ON public.final_grade_releases
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

CREATE POLICY "Parents can view linked student final grades" ON public.final_grade_releases
  FOR SELECT TO authenticated
  USING (public.parent_has_active_link(student_id));

CREATE POLICY "Instructors can view own subject final grades" ON public.final_grade_releases
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'instructor'::public.app_role) AND public.instructor_owns_subject(subject_id));

REVOKE ALL ON public.final_grade_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.final_grade_releases TO authenticated;

COMMENT ON TABLE public.final_grade_releases IS
  'Released final grades. needs_review rows have final_grade NULL so a stale value is never readable. Written only by commit_final_grade_releases (service role) and the review triggers.';

CREATE TABLE public.final_grade_input_versions (
  subject_id uuid PRIMARY KEY REFERENCES public.subjects(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0,
  last_txid xid8
);

ALTER TABLE public.final_grade_input_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.final_grade_input_versions FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.final_grade_input_versions IS
  'Per-subject grade-input version. A missing row means version 0. No client access.';

-- Bump, then flag. p_student_id NULL flags the whole subject; p_weights limits flagging to rows
-- released with different effective weights.
CREATE FUNCTION public.final_grade_inputs_changed(
  p_subject_id uuid,
  p_student_id uuid,
  p_reason text,
  p_weights jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A cascaded delete of the subject itself: its rows are being removed, and inserting a version
  -- row would violate the foreign key.
  IF p_subject_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = p_subject_id) THEN
    RETURN;
  END IF;

  -- ON CONFLICT DO UPDATE locks the row even when its WHERE is false, so later rows of the same
  -- transaction keep the lock without writing again.
  INSERT INTO public.final_grade_input_versions AS v (subject_id, version, last_txid)
  VALUES (p_subject_id, 1, pg_current_xact_id())
  ON CONFLICT (subject_id) DO UPDATE
    SET version = v.version + 1,
        last_txid = EXCLUDED.last_txid
    WHERE v.last_txid IS DISTINCT FROM EXCLUDED.last_txid;

  UPDATE public.final_grade_releases r
  SET status = 'needs_review',
      final_grade = NULL,
      review_reason = p_reason,
      review_flagged_at = now()
  WHERE r.subject_id = p_subject_id
    AND r.status = 'released'
    AND (p_student_id IS NULL OR r.student_id = p_student_id)
    AND (p_weights IS NULL OR r.weights IS DISTINCT FROM p_weights);
END;
$$;

CREATE FUNCTION public.final_grade_review_submissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_subject uuid;
  v_old_type text;
  v_new_subject uuid;
  v_new_type text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT a.subject_id, a.type INTO v_old_subject, v_old_type FROM public.activities a WHERE a.id = OLD.activity_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT a.subject_id, a.type INTO v_new_subject, v_new_type FROM public.activities a WHERE a.id = NEW.activity_id;
  END IF;

  -- A blank row whose category equals the activity type is the same as no row for grading and completeness.
  IF TG_OP = 'INSERT' THEN
    IF NEW.student_id IS NOT NULL
       AND (NEW.score IS NOT NULL OR COALESCE(NEW.assessment_type, v_new_type) IS DISTINCT FROM v_new_type) THEN
      PERFORM public.final_grade_inputs_changed(v_new_subject, NEW.student_id, 'score_added');
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    -- When the activity itself is deleted, v_old_subject is NULL; the activities trigger covers it.
    IF OLD.student_id IS NOT NULL
       AND (OLD.score IS NOT NULL OR COALESCE(OLD.assessment_type, v_old_type) IS DISTINCT FROM v_old_type) THEN
      PERFORM public.final_grade_inputs_changed(v_old_subject, OLD.student_id, 'score_removed');
    END IF;
  ELSIF OLD.activity_id IS DISTINCT FROM NEW.activity_id OR OLD.student_id IS DISTINCT FROM NEW.student_id THEN
    IF OLD.student_id IS NOT NULL THEN
      PERFORM public.final_grade_inputs_changed(v_old_subject, OLD.student_id, 'score_changed');
    END IF;
    IF NEW.student_id IS NOT NULL THEN
      PERFORM public.final_grade_inputs_changed(v_new_subject, NEW.student_id, 'score_changed');
    END IF;
  ELSIF NEW.student_id IS NOT NULL
        AND (OLD.score IS DISTINCT FROM NEW.score
             OR COALESCE(OLD.assessment_type, v_old_type) IS DISTINCT FROM COALESCE(NEW.assessment_type, v_new_type)) THEN
    PERFORM public.final_grade_inputs_changed(v_new_subject, NEW.student_id, 'score_changed');
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.final_grade_review_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.student_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.student_id IS DISTINCT FROM NEW.student_id OR OLD.subject_id IS DISTINCT FROM NEW.subject_id) THEN
    PERFORM public.final_grade_inputs_changed(OLD.subject_id, OLD.student_id, 'attendance_changed');
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.student_id IS NOT NULL THEN
    PERFORM public.final_grade_inputs_changed(NEW.subject_id, NEW.student_id, 'attendance_changed');
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.final_grade_review_activities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.final_grade_inputs_changed(NEW.subject_id, NULL, 'assessment_added');
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.final_grade_inputs_changed(OLD.subject_id, NULL, 'assessment_removed');
  ELSE
    IF OLD.subject_id IS DISTINCT FROM NEW.subject_id THEN
      PERFORM public.final_grade_inputs_changed(OLD.subject_id, NULL, 'assessment_changed');
    END IF;
    PERFORM public.final_grade_inputs_changed(NEW.subject_id, NULL, 'assessment_changed');
  END IF;
  RETURN NULL;
END;
$$;

-- Effective weights are the saved row or, without one, the column defaults of
-- subject_grading_systems (DEFAULT_SUBJECT_GRADING_WEIGHTS in the Edge code).
CREATE FUNCTION public.final_grade_review_weights()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default jsonb := jsonb_build_object('activity_weight', 25, 'project_weight', 25, 'attendance_weight', 15, 'exam_weight', 35);
  v_old jsonb := v_default;
  v_new jsonb := v_default;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := jsonb_build_object('activity_weight', OLD.activity_weight, 'project_weight', OLD.project_weight,
                                'attendance_weight', OLD.attendance_weight, 'exam_weight', OLD.exam_weight);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := jsonb_build_object('activity_weight', NEW.activity_weight, 'project_weight', NEW.project_weight,
                                'attendance_weight', NEW.attendance_weight, 'exam_weight', NEW.exam_weight);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.subject_id IS DISTINCT FROM NEW.subject_id THEN
    IF v_old IS DISTINCT FROM v_default THEN
      PERFORM public.final_grade_inputs_changed(OLD.subject_id, NULL, 'weights_changed', v_default);
    END IF;
    IF v_new IS DISTINCT FROM v_default THEN
      PERFORM public.final_grade_inputs_changed(NEW.subject_id, NULL, 'weights_changed', v_new);
    END IF;
  ELSIF v_old IS DISTINCT FROM v_new THEN
    PERFORM public.final_grade_inputs_changed(COALESCE(NEW.subject_id, OLD.subject_id), NULL, 'weights_changed', v_new);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.final_grade_inputs_changed(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.final_grade_review_submissions(), public.final_grade_review_attendance(),
  public.final_grade_review_activities(), public.final_grade_review_weights() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.final_grade_review_submissions(), public.final_grade_review_attendance(),
  public.final_grade_review_activities(), public.final_grade_review_weights() TO service_role;

CREATE TRIGGER final_grade_review_insert AFTER INSERT ON public.submissions
  FOR EACH ROW WHEN (NEW.score IS NOT NULL OR NEW.assessment_type IS NOT NULL)
  EXECUTE FUNCTION public.final_grade_review_submissions();
CREATE TRIGGER final_grade_review_delete AFTER DELETE ON public.submissions
  FOR EACH ROW WHEN (OLD.score IS NOT NULL OR OLD.assessment_type IS NOT NULL)
  EXECUTE FUNCTION public.final_grade_review_submissions();
CREATE TRIGGER final_grade_review_update AFTER UPDATE OF score, assessment_type, activity_id, student_id ON public.submissions
  FOR EACH ROW WHEN (OLD.score IS DISTINCT FROM NEW.score OR OLD.assessment_type IS DISTINCT FROM NEW.assessment_type
                     OR OLD.activity_id IS DISTINCT FROM NEW.activity_id OR OLD.student_id IS DISTINCT FROM NEW.student_id)
  EXECUTE FUNCTION public.final_grade_review_submissions();

CREATE TRIGGER final_grade_review_insert_delete AFTER INSERT OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.final_grade_review_attendance();
CREATE TRIGGER final_grade_review_update AFTER UPDATE OF status, student_id, subject_id ON public.attendance
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.student_id IS DISTINCT FROM NEW.student_id
                     OR OLD.subject_id IS DISTINCT FROM NEW.subject_id)
  EXECUTE FUNCTION public.final_grade_review_attendance();

CREATE TRIGGER final_grade_review_insert_delete AFTER INSERT OR DELETE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.final_grade_review_activities();
CREATE TRIGGER final_grade_review_update AFTER UPDATE OF type, max_score, subject_id ON public.activities
  FOR EACH ROW WHEN (OLD.type IS DISTINCT FROM NEW.type OR OLD.max_score IS DISTINCT FROM NEW.max_score
                     OR OLD.subject_id IS DISTINCT FROM NEW.subject_id)
  EXECUTE FUNCTION public.final_grade_review_activities();

CREATE TRIGGER final_grade_review AFTER INSERT OR DELETE OR UPDATE OF activity_weight, project_weight, attendance_weight, exam_weight, subject_id
  ON public.subject_grading_systems
  FOR EACH ROW EXECUTE FUNCTION public.final_grade_review_weights();

-- The only write path for releases. SECURITY INVOKER and executable only by service_role (which
-- bypasses RLS); the Edge Function verifies the caller and passes it as p_released_by.
CREATE FUNCTION public.commit_final_grade_releases(
  p_subject_id uuid,
  p_expected_version bigint,
  p_released_by uuid,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_version bigint;
  v_written int;
BEGIN
  IF p_subject_id IS NULL OR p_expected_version IS NULL OR p_released_by IS NULL
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'commit_final_grade_releases: invalid arguments' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subjects s WHERE s.id = p_subject_id AND s.instructor_id = p_released_by
  ) THEN
    RAISE EXCEPTION 'commit_final_grade_releases: caller does not own the subject' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.final_grade_input_versions (subject_id)
  VALUES (p_subject_id)
  ON CONFLICT (subject_id) DO NOTHING;

  -- Waits for any open transaction that changed this subject's grade inputs; under READ COMMITTED
  -- the row returned after the wait is the latest committed version.
  SELECT v.version INTO v_version
  FROM public.final_grade_input_versions v
  WHERE v.subject_id = p_subject_id
  FOR UPDATE;

  IF v_version <> p_expected_version THEN
    RETURN jsonb_build_object('committed', false, 'version', v_version, 'written', 0);
  END IF;

  INSERT INTO public.final_grade_releases AS r (subject_id, student_id, final_grade, weights, status, released_at, released_by)
  SELECT p_subject_id, x.student_id, x.final_grade, x.weights, 'released', now(), p_released_by
  FROM jsonb_to_recordset(p_rows) AS x(student_id uuid, final_grade numeric, weights jsonb)
  ON CONFLICT (subject_id, student_id) DO UPDATE
    SET final_grade = EXCLUDED.final_grade,
        weights = EXCLUDED.weights,
        status = 'released',
        released_at = EXCLUDED.released_at,
        released_by = EXCLUDED.released_by,
        review_reason = NULL,
        review_flagged_at = NULL
    WHERE r.status <> 'released'
       OR r.final_grade IS DISTINCT FROM EXCLUDED.final_grade
       OR r.weights IS DISTINCT FROM EXCLUDED.weights;
  GET DIAGNOSTICS v_written = ROW_COUNT;

  RETURN jsonb_build_object('committed', true, 'version', v_version, 'written', v_written);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_final_grade_releases(uuid, bigint, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_final_grade_releases(uuid, bigint, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.commit_final_grade_releases(uuid, bigint, uuid, jsonb) IS
  'Version-checked release commit. Returns {committed:false} and writes nothing when the subject''s grade inputs changed since p_expected_version was read.';
