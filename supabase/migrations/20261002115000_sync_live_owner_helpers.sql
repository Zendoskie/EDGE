-- Owner-scoped RLS helpers and login-history guard that exist on the live project but were
-- never captured in earlier repository migrations. Idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.instructor_owns_subject(p_subject_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = p_subject_id AND s.instructor_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.instructor_owns_activity(p_activity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.activities a
    JOIN public.subjects s ON s.id = a.subject_id
    WHERE a.id = p_activity_id AND s.instructor_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.instructor_can_view_student_subject(
  p_student_id uuid,
  p_subject_id uuid
)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments e
    JOIN public.subjects s ON s.id = e.subject_id
    WHERE e.student_id = p_student_id
      AND e.status = 'active'
      AND s.instructor_id = auth.uid()
      AND (p_subject_id IS NULL OR s.id = p_subject_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_login_history_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.has_role(auth.uid(), 'admin'::public.app_role)
     OR (
       NEW.student_id IS NOT DISTINCT FROM OLD.student_id
       AND NEW.login_time IS NOT DISTINCT FROM OLD.login_time
       AND NEW.counts_as_login IS NOT DISTINCT FROM OLD.counts_as_login
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'login_history_update_forbidden' USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_login_history_update ON public.student_login_history;
CREATE TRIGGER trg_guard_login_history_update
  BEFORE UPDATE ON public.student_login_history
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_login_history_update();
