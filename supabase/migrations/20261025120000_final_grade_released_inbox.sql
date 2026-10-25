-- Student dashboard notification when a final grade is released (or changed while released).

CREATE OR REPLACE FUNCTION public.notify_final_grade_released()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
  v_instructor uuid;
  v_instructor_name text;
  v_dedupe_key text;
  v_grade text;
BEGIN
  IF NEW.student_id IS NULL OR NEW.status <> 'released' OR NEW.final_grade IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'released'
     AND OLD.final_grade IS NOT DISTINCT FROM NEW.final_grade THEN
    RETURN NEW;
  END IF;

  SELECT subject.code, subject.instructor_id
  INTO v_code, v_instructor
  FROM public.subjects subject
  WHERE subject.id = NEW.subject_id;

  SELECT COALESCE(NULLIF(trim(profile.full_name), ''), 'the instructor')
  INTO v_instructor_name
  FROM public.profiles profile
  WHERE profile.user_id = COALESCE(NEW.released_by, v_instructor);

  v_grade := trim(to_char(NEW.final_grade, 'FM999990.00'));
  v_dedupe_key := 'final-grade:' || NEW.subject_id::text || ':' || NEW.student_id::text || ':' || v_grade;

  INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name, dedupe_key)
  VALUES (
    NEW.student_id,
    'Final grade released',
    COALESCE(NULLIF(trim(v_code), ''), 'Your subject')
      || ': your final grade is ' || v_grade || '.',
    COALESCE(v_instructor_name, 'the instructor'),
    v_dedupe_key
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_final_grade_released() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_final_grade_released ON public.final_grade_releases;
CREATE TRIGGER trg_notify_final_grade_released
AFTER INSERT OR UPDATE OF status, final_grade ON public.final_grade_releases
FOR EACH ROW
EXECUTE FUNCTION public.notify_final_grade_released();
