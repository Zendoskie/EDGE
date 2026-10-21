-- Round 2: student enrollment approval inbox + linked-parent inbox for grades/attendance/risk/referrals.
-- Email delivery remains via send-notification (client/edge); this migration adds durable inbox rows only.

CREATE OR REPLACE FUNCTION public.notify_enrollment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_instructor uuid;
  v_student_name text;
  v_instructor_name text;
BEGIN
  SELECT subject.code, subject.instructor_id
  INTO v_code, v_instructor
  FROM public.subjects subject
  WHERE subject.id = NEW.subject_id;

  IF NEW.status = 'pending'
     AND v_instructor IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'A student')
    INTO v_student_name
    FROM public.profiles profile
    WHERE profile.user_id = NEW.student_id;

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      v_instructor,
      'Enrollment request',
      v_student_name || ' requested to enroll in ' || COALESCE(v_code, 'a subject') || '.',
      v_student_name
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status = 'active'
        AND OLD.status IS DISTINCT FROM 'active' THEN
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
    INTO v_instructor_name
    FROM public.profiles profile
    WHERE profile.user_id = v_instructor;

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      NEW.student_id,
      'Enrollment approved',
      'Your enrollment request for ' || COALESCE(v_code, 'a subject')
        || ' was approved by ' || COALESCE(v_instructor_name, 'the instructor') || '.',
      COALESCE(v_instructor_name, 'the instructor')
    );
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status = 'rejected'
        AND OLD.status IS DISTINCT FROM 'rejected' THEN
    SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
    INTO v_instructor_name
    FROM public.profiles profile
    WHERE profile.user_id = v_instructor;

    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      NEW.student_id,
      'Enrollment request rejected',
      'Your enrollment request for ' || COALESCE(v_code, 'a subject')
        || ' was rejected by ' || COALESCE(v_instructor_name, 'the instructor') || '.',
      COALESCE(v_instructor_name, 'the instructor')
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_linked_parents_inbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student uuid;
  v_parent uuid;
  v_title text;
  v_body text;
  v_source text;
BEGIN
  IF TG_TABLE_NAME = 'submissions' THEN
    IF NEW.student_id IS NULL OR NEW.score IS NULL THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.score IS NOT NULL THEN
      RETURN NEW;
    END IF;
    v_student := NEW.student_id;
    SELECT activity.title || ' in ' || COALESCE(subject.code, 'a course'),
           COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
    INTO v_body, v_source
    FROM public.activities activity
    LEFT JOIN public.subjects subject ON subject.id = activity.subject_id
    LEFT JOIN public.profiles profile ON profile.user_id = COALESCE(NEW.graded_by, subject.instructor_id)
    WHERE activity.id = NEW.activity_id;
    v_title := 'Grade update for your student';
    v_body := COALESCE(v_body, 'An activity') || ' was graded ' || NEW.score::text || '.';
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    v_student := NEW.student_id;
    SELECT 'Attendance update for your student',
           COALESCE(subject.code, 'A course') || ' on ' || NEW.date::text || ': ' || COALESCE(NEW.status, 'recorded'),
           'EDGE'
    INTO v_title, v_body, v_source
    FROM public.subjects subject
    WHERE subject.id = NEW.subject_id;
  ELSIF TG_TABLE_NAME = 'predictions' THEN
    v_student := NEW.student_id;
    v_title := 'Risk status update for your student';
    v_body := 'Risk classification is now ' || COALESCE(NEW.risk_level, 'updated') || '.';
    v_source := 'EDGE';
    IF TG_OP = 'UPDATE' AND OLD.risk_level IS NOT DISTINCT FROM NEW.risk_level THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'counseling_referrals' THEN
    v_student := NEW.student_id;
    v_title := 'Counseling referral update';
    v_body := 'A counseling referral was ' || COALESCE(NEW.status, 'updated') || ' for your student.';
    v_source := 'EDGE';
  ELSE
    RETURN NEW;
  END IF;

  FOR v_parent IN
    SELECT link.parent_user_id
    FROM public.parent_student_links link
    WHERE link.student_user_id = v_student
      AND link.status = 'approved'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_inbox_notifications notification
      WHERE notification.user_id = v_parent
        AND notification.title = v_title
        AND notification.body = v_body
    ) THEN
      INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
      VALUES (v_parent, v_title, v_body, v_source);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_linked_parents_inbox() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_linked_parents_submissions ON public.submissions;
CREATE TRIGGER trg_notify_linked_parents_submissions
AFTER INSERT OR UPDATE OF score ON public.submissions
FOR EACH ROW
EXECUTE FUNCTION public.notify_linked_parents_inbox();

DROP TRIGGER IF EXISTS trg_notify_linked_parents_attendance ON public.attendance;
CREATE TRIGGER trg_notify_linked_parents_attendance
AFTER INSERT OR UPDATE OF status ON public.attendance
FOR EACH ROW
EXECUTE FUNCTION public.notify_linked_parents_inbox();

DROP TRIGGER IF EXISTS trg_notify_linked_parents_predictions ON public.predictions;
CREATE TRIGGER trg_notify_linked_parents_predictions
AFTER INSERT OR UPDATE OF risk_level ON public.predictions
FOR EACH ROW
EXECUTE FUNCTION public.notify_linked_parents_inbox();

DROP TRIGGER IF EXISTS trg_notify_linked_parents_referrals ON public.counseling_referrals;
CREATE TRIGGER trg_notify_linked_parents_referrals
AFTER INSERT OR UPDATE OF status ON public.counseling_referrals
FOR EACH ROW
EXECUTE FUNCTION public.notify_linked_parents_inbox();

-- Persist heuristic recommendations for the signed-in student (no duplicate within 7 days).
CREATE OR REPLACE FUNCTION public.sync_learning_recommendations_for_student(p_student_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inserted integer := 0;
  rec record;
BEGIN
  IF v_caller IS NULL OR v_caller IS DISTINCT FROM p_student_id THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  FOR rec IN
    SELECT *
    FROM public.generate_learning_recommendations(p_student_id, NULL)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.learning_recommendations existing
      WHERE existing.student_id = p_student_id
        AND existing.title = rec.title
        AND existing.created_at > now() - interval '7 days'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.learning_recommendations (
      student_id,
      recommendation_type,
      title,
      description,
      priority,
      confidence_score,
      is_actioned
    )
    VALUES (
      p_student_id,
      rec.recommendation_type,
      rec.title,
      rec.description,
      rec.priority,
      rec.confidence_score,
      false
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_learning_recommendations_for_student(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_learning_recommendations_for_student(uuid) TO authenticated;
