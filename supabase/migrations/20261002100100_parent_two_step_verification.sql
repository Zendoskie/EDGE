-- Phase 1: Student & parent account verification.
--
-- A parent/guardian signs up with the student's Student ID. The Student ID only
-- locates the student and creates a request; it never grants access. Access
-- requires the student's approval AND an administrator's approval.
--
-- parent_student_links.status:
--   pending         PENDING_STUDENT_APPROVAL
--   pending_admin   STUDENT_APPROVED -> PENDING_ADMIN_APPROVAL
--   approved        ADMIN_APPROVED -> ACTIVE (the only status that grants data access)
--   rejected        STUDENT_REJECTED
--   admin_rejected  ADMIN_REJECTED
--
-- Links are only mutated through SECURITY DEFINER functions in this file.

-- ---------------------------------------------------------------------------
-- 1. Columns and status constraints
-- ---------------------------------------------------------------------------

ALTER TABLE public.parent_student_links
  ADD COLUMN IF NOT EXISTS admin_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_decided_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.parent_student_links
  DROP CONSTRAINT IF EXISTS parent_student_links_status_check;
ALTER TABLE public.parent_student_links
  ADD CONSTRAINT parent_student_links_status_check
  CHECK (status IN ('pending', 'pending_admin', 'approved', 'rejected', 'admin_rejected'));

ALTER TABLE public.parent_link_request_history
  DROP CONSTRAINT IF EXISTS parent_link_request_history_status_check;
ALTER TABLE public.parent_link_request_history
  ADD CONSTRAINT parent_link_request_history_status_check
  CHECK (status IN ('pending', 'pending_admin', 'approved', 'rejected', 'admin_rejected'));

CREATE INDEX IF NOT EXISTS idx_parent_student_links_status
  ON public.parent_student_links (status);

-- ---------------------------------------------------------------------------
-- 2. History log: notes for the two-step flow
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_parent_link_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_stage boolean := NEW.status IN ('approved', 'admin_rejected') AND NEW.admin_decided_at IS NOT NULL;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
     AND NEW.admin_decided_at IS NOT DISTINCT FROM OLD.admin_decided_at THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.parent_link_request_history (
    link_id,
    parent_user_id,
    student_user_id,
    status,
    requested_at,
    decided_at,
    decided_by,
    note
  )
  VALUES (
    NEW.id,
    NEW.parent_user_id,
    NEW.student_user_id,
    NEW.status,
    NEW.requested_at,
    CASE WHEN v_admin_stage THEN NEW.admin_decided_at ELSE NEW.decided_at END,
    CASE WHEN v_admin_stage THEN NEW.admin_decided_by ELSE NEW.decided_by END,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'Request created; awaiting student approval'
      WHEN NEW.status = 'pending' THEN 'Request re-submitted; awaiting student approval'
      WHEN NEW.status = 'pending_admin' THEN 'Approved by student; awaiting administrator approval'
      WHEN NEW.status = 'rejected' THEN 'Rejected by student'
      WHEN NEW.status = 'approved' THEN 'Approved by administrator; access active'
      WHEN NEW.status = 'admin_rejected' THEN 'Rejected by administrator'
      ELSE NULL
    END
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_log_parent_link_history ON public.parent_student_links;
CREATE TRIGGER trg_log_parent_link_history
  AFTER INSERT OR UPDATE OF status, decided_at, decided_by, admin_decided_at, admin_decided_by
  ON public.parent_student_links
  FOR EACH ROW
  EXECUTE FUNCTION public.log_parent_link_history();

-- ---------------------------------------------------------------------------
-- 3. Durable inbox notifications for each step (reuses user_inbox_notifications)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_parent_link_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_name text;
  v_parent_email text;
  v_student_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email), p.email
  INTO v_parent_name, v_parent_email
  FROM public.profiles p
  WHERE p.user_id = NEW.parent_user_id;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.email)
  INTO v_student_name
  FROM public.profiles p
  WHERE p.user_id = NEW.student_user_id;

  v_parent_name := COALESCE(v_parent_name, 'A parent/guardian');
  v_student_name := COALESCE(v_student_name, 'the student');

  IF NEW.status = 'pending' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES (
      NEW.student_user_id,
      'Parent Access Request',
      format(
        '%s (%s) is requesting parent/guardian access to your academic records. Open Parent Access Requests to approve or reject.',
        v_parent_name,
        COALESCE(v_parent_email, 'no email')
      ),
      v_parent_name
    );

  ELSIF NEW.status = 'pending_admin' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    SELECT
      ur.user_id,
      'Parent/Guardian request awaiting approval',
      format(
        '%s approved the parent/guardian request from %s (%s). Review it in Admin Approvals.',
        v_student_name,
        v_parent_name,
        COALESCE(v_parent_email, 'no email')
      ),
      v_student_name
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::public.app_role;

  ELSIF NEW.status = 'approved' AND TG_OP = 'UPDATE' AND OLD.status = 'pending_admin' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES
      (
        NEW.parent_user_id,
        'Parent/Guardian access approved',
        format('An administrator approved your access to %s''s academic records. Your parent account is now active.', v_student_name),
        'EDGE Administrator'
      ),
      (
        NEW.student_user_id,
        'Parent/Guardian access activated',
        format('An administrator approved %s''s access to your academic records.', v_parent_name),
        'EDGE Administrator'
      );

  ELSIF NEW.status = 'admin_rejected' THEN
    INSERT INTO public.user_inbox_notifications (user_id, title, body, source_name)
    VALUES
      (
        NEW.parent_user_id,
        'Parent/Guardian request rejected',
        format('An administrator did not approve your request to access %s''s academic records.', v_student_name),
        'EDGE Administrator'
      ),
      (
        NEW.student_user_id,
        'Parent/Guardian request rejected by administrator',
        format('An administrator rejected %s''s request to access your academic records.', v_parent_name),
        'EDGE Administrator'
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Legacy data: a link marked approved for a parent whose account is not
--    approved has not passed admin review; send it to the admin queue.
-- ---------------------------------------------------------------------------

UPDATE public.parent_student_links l
SET status = 'pending_admin'
FROM public.profiles p
WHERE p.user_id = l.parent_user_id
  AND l.status = 'approved'
  AND p.account_status IS DISTINCT FROM 'approved';

DROP TRIGGER IF EXISTS trg_notify_parent_link_status_change ON public.parent_student_links;
CREATE TRIGGER trg_notify_parent_link_status_change
  AFTER INSERT OR UPDATE OF status
  ON public.parent_student_links
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_parent_link_status_change();

-- ---------------------------------------------------------------------------
-- 5. Signup: student no longer provides a parent email; parent signup creates
--    a pending request located by Student ID only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_guardian_student_id text;
  v_student_user_id uuid;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'student');
  v_guardian_student_id := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'guardian_student_id', '')), '');

  INSERT INTO public.profiles (user_id, full_name, email, student_id, account_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    CASE
      WHEN v_role = 'parent' THEN NULL
      ELSE NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'student_number', '')), '')
    END,
    'pending'
  );

  IF v_role = 'student' THEN
    BEGIN
      INSERT INTO public.student_programs (student_id, program_id, year_level, is_irregular)
      SELECT
        NEW.id,
        prog.id,
        CASE trim(COALESCE(NEW.raw_user_meta_data->>'year_level', ''))
          WHEN '1st Year' THEN 1
          WHEN '2nd Year' THEN 2
          WHEN '3rd Year' THEN 3
          WHEN '4th Year' THEN 4
          ELSE 1
        END,
        CASE lower(trim(COALESCE(NEW.raw_user_meta_data->>'is_irregular', '')))
          WHEN 'true' THEN true
          WHEN 't' THEN true
          WHEN '1' THEN true
          ELSE false
        END
      FROM public.programs prog
      WHERE NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'course', '')), '') IS NOT NULL
        AND prog.code = trim(NEW.raw_user_meta_data->>'course')
      ON CONFLICT (student_id) DO UPDATE SET
        program_id = EXCLUDED.program_id,
        year_level = EXCLUDED.year_level,
        is_irregular = EXCLUDED.is_irregular,
        updated_at = now();
    EXCEPTION
      WHEN undefined_table THEN
        NULL;
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF v_role = 'parent' THEN
    IF v_guardian_student_id IS NULL THEN
      RAISE EXCEPTION 'guardian_student_id_required' USING ERRCODE = '22023';
    END IF;

    SELECT p.user_id
    INTO v_student_user_id
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.user_id
     AND ur.role = 'student'::app_role
    WHERE lower(trim(p.student_id)) = lower(v_guardian_student_id)
    LIMIT 1;

    IF v_student_user_id IS NULL THEN
      RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.parent_student_links (parent_user_id, student_user_id, student_id_no, status)
    VALUES (NEW.id, v_student_user_id, v_guardian_student_id, 'pending')
    ON CONFLICT (parent_user_id, student_user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- p_parent_email is kept (and now ignored) so existing callers keep working.
CREATE OR REPLACE FUNCTION public.validate_student_signup(p_student_id_no text, p_parent_email text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_student_id text;
BEGIN
  v_student_id := NULLIF(trim(p_student_id_no), '');
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(trim(student_id)) = lower(v_student_id)
  ) THEN
    RAISE EXCEPTION 'student_id_in_use' USING ERRCODE = '23505';
  END IF;
END;
$function$;

-- Pre-signup check for parents. Reveals only whether the Student ID belongs to a
-- student account; never returns student data.
CREATE OR REPLACE FUNCTION public.validate_parent_signup(p_student_id_no text, p_parent_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_student_id text;
  v_email text;
BEGIN
  v_student_id := NULLIF(trim(p_student_id_no), '');
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  v_email := lower(NULLIF(trim(p_parent_email), ''));
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'parent_email_required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE lower(trim(p.email)) = v_email) THEN
    RAISE EXCEPTION 'parent_email_already_registered' USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur
      ON ur.user_id = p.user_id
     AND ur.role = 'student'::app_role
    WHERE lower(trim(p.student_id)) = lower(v_student_id)
  ) THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.validate_student_signup(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_parent_signup(text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Additional link requests from an active parent account
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.parent_request_student_link(p_student_id_no text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_id uuid;
  v_student_id_no text;
  v_student_user_id uuid;
  v_link_id uuid;
  v_status text;
BEGIN
  v_parent_id := auth.uid();
  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_parent_id, 'parent'::app_role) THEN
    RAISE EXCEPTION 'parent_role_required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = v_parent_id AND account_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'account_not_active' USING ERRCODE = '42501';
  END IF;

  v_student_id_no := NULLIF(trim(p_student_id_no), '');
  IF v_student_id_no IS NULL THEN
    RAISE EXCEPTION 'student_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT p.user_id
  INTO v_student_user_id
  FROM public.profiles p
  JOIN public.user_roles ur
    ON ur.user_id = p.user_id
   AND ur.role = 'student'::app_role
  WHERE lower(trim(p.student_id)) = lower(v_student_id_no)
  LIMIT 1;

  IF v_student_user_id IS NULL THEN
    RAISE EXCEPTION 'student_not_found_for_guardian_link' USING ERRCODE = 'P0002';
  END IF;

  IF v_parent_id = v_student_user_id THEN
    RAISE EXCEPTION 'invalid_parent_student_link' USING ERRCODE = '22023';
  END IF;

  SELECT l.id, l.status
  INTO v_link_id, v_status
  FROM public.parent_student_links l
  WHERE l.parent_user_id = v_parent_id
    AND l.student_user_id = v_student_user_id
  FOR UPDATE;

  IF v_link_id IS NOT NULL THEN
    IF v_status IN ('pending', 'pending_admin') THEN
      RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '23505';
    END IF;
    IF v_status = 'approved' THEN
      RAISE EXCEPTION 'already_approved' USING ERRCODE = '23505';
    END IF;

    UPDATE public.parent_student_links
    SET
      status = 'pending',
      student_id_no = v_student_id_no,
      requested_at = now(),
      decided_at = NULL,
      decided_by = NULL,
      admin_decided_at = NULL,
      admin_decided_by = NULL
    WHERE id = v_link_id;
    RETURN v_link_id;
  END IF;

  BEGIN
    INSERT INTO public.parent_student_links (parent_user_id, student_user_id, student_id_no, status)
    VALUES (v_parent_id, v_student_user_id, v_student_id_no, 'pending')
    RETURNING id INTO v_link_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'pending_request_exists' USING ERRCODE = '23505';
  END;

  RETURN v_link_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Student decision (step 1)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_decide_parent_request(p_link_id uuid, p_decision text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_new_status text;
  v_link public.parent_student_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_decision IN ('approve', 'approved') THEN
    v_new_status := 'pending_admin';
  ELSIF v_decision IN ('reject', 'rejected') THEN
    v_new_status := 'rejected';
  ELSE
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link
  FROM public.parent_student_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND OR v_link.student_user_id <> v_uid THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_link.status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = '55000';
  END IF;

  UPDATE public.parent_student_links
  SET status = v_new_status, decided_at = now(), decided_by = v_uid
  WHERE id = p_link_id;

  RETURN v_new_status;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Administrator decision (step 2)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_decide_parent_request(p_link_id uuid, p_decision text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_link public.parent_student_links%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('approve', 'approved', 'reject', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link
  FROM public.parent_student_links
  WHERE id = p_link_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_link.status <> 'pending_admin' THEN
    RAISE EXCEPTION 'request_not_awaiting_admin' USING ERRCODE = '55000';
  END IF;

  IF v_decision IN ('approve', 'approved') THEN
    UPDATE public.parent_student_links
    SET status = 'approved', admin_decided_at = now(), admin_decided_by = v_uid
    WHERE id = p_link_id;

    -- A deactivated account stays deactivated; reactivation is a separate admin action.
    UPDATE public.profiles
    SET account_status = 'approved', updated_at = now()
    WHERE user_id = v_link.parent_user_id
      AND account_status IN ('pending', 'rejected');

    RETURN 'approved';
  END IF;

  UPDATE public.parent_student_links
  SET status = 'admin_rejected', admin_decided_at = now(), admin_decided_by = v_uid
  WHERE id = p_link_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.parent_student_links
    WHERE parent_user_id = v_link.parent_user_id
      AND status = 'approved'
  ) THEN
    UPDATE public.profiles
    SET account_status = 'rejected', updated_at = now()
    WHERE user_id = v_link.parent_user_id
      AND account_status = 'pending';
  END IF;

  RETURN 'admin_rejected';
END;
$function$;

REVOKE ALL ON FUNCTION public.student_decide_parent_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_decide_parent_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parent_request_student_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_decide_parent_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_parent_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_request_student_link(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. The generic account-status RPC cannot activate a parent who has no
--    fully approved link.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_account_status(p_target_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected', 'deactivated') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'approved'
     AND public.has_role(p_target_user_id, 'parent'::app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.parent_student_links
       WHERE parent_user_id = p_target_user_id
         AND status = 'approved'
     ) THEN
    RAISE EXCEPTION 'parent_requires_verified_link' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
  SET account_status = p_status, updated_at = now()
  WHERE user_id = p_target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Links are no longer updated directly by students or parents.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Students can decide parent requests" ON public.parent_student_links;
DROP POLICY IF EXISTS "Parents can re-request rejected links" ON public.parent_student_links;
DROP POLICY IF EXISTS "Parents can insert own link requests" ON public.parent_student_links;

-- ---------------------------------------------------------------------------
-- 11. Parent data access requires an admin-approved link AND an approved
--     parent account.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the profiles policy below can call it without RLS recursion.
CREATE OR REPLACE FUNCTION public.parent_has_active_link(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.parent_student_links l
    JOIN public.profiles pp ON pp.user_id = l.parent_user_id
    WHERE l.parent_user_id = auth.uid()
      AND l.student_user_id = p_student_id
      AND l.status = 'approved'
      AND pp.account_status = 'approved'
  );
$function$;

REVOKE ALL ON FUNCTION public.parent_has_active_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parent_has_active_link(uuid) TO authenticated;

DROP POLICY IF EXISTS "Parents can view approved student attendance" ON public.attendance;
CREATE POLICY "Parents can view approved student attendance"
  ON public.attendance FOR SELECT TO authenticated
  USING (public.parent_has_active_link(attendance.student_id));

DROP POLICY IF EXISTS "Parents view linked student engagement alerts" ON public.engagement_alerts;
CREATE POLICY "Parents view linked student engagement alerts"
  ON public.engagement_alerts FOR SELECT TO authenticated
  USING (public.parent_has_active_link(engagement_alerts.student_id));

DROP POLICY IF EXISTS "Parents can view approved student enrollments" ON public.enrollments;
CREATE POLICY "Parents can view approved student enrollments"
  ON public.enrollments FOR SELECT TO authenticated
  USING (public.parent_has_active_link(enrollments.student_id));

DROP POLICY IF EXISTS "Parents can view approved student interventions" ON public.interventions;
CREATE POLICY "Parents can view approved student interventions"
  ON public.interventions FOR SELECT TO authenticated
  USING (public.parent_has_active_link(interventions.student_id));

DROP POLICY IF EXISTS "Parents can view approved student predictions" ON public.predictions;
CREATE POLICY "Parents can view approved student predictions"
  ON public.predictions FOR SELECT TO authenticated
  USING (public.parent_has_active_link(predictions.student_id));

DROP POLICY IF EXISTS "Parents can view approved student profiles" ON public.profiles;
CREATE POLICY "Parents can view approved student profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.parent_has_active_link(profiles.user_id));

DROP POLICY IF EXISTS "Parents view linked student engagement summary" ON public.student_engagement_summary;
CREATE POLICY "Parents view linked student engagement summary"
  ON public.student_engagement_summary FOR SELECT TO authenticated
  USING (public.parent_has_active_link(student_engagement_summary.student_id));

DROP POLICY IF EXISTS "Parents can view approved student submissions" ON public.submissions;
CREATE POLICY "Parents can view approved student submissions"
  ON public.submissions FOR SELECT TO authenticated
  USING (public.parent_has_active_link(submissions.student_id));

DROP POLICY IF EXISTS "parents can view linked student subject grading system" ON public.subject_grading_systems;
CREATE POLICY "parents can view linked student subject grading system"
  ON public.subject_grading_systems FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.enrollments e
      WHERE e.subject_id = subject_grading_systems.subject_id
        AND COALESCE(e.status, 'active') = 'active'
        AND public.parent_has_active_link(e.student_id)
    )
  );

DROP POLICY IF EXISTS "Parents can view linked student subjects" ON public.subjects;
CREATE POLICY "Parents can view linked student subjects"
  ON public.subjects FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.enrollments e
      WHERE e.subject_id = subjects.id
        AND public.parent_has_active_link(e.student_id)
    )
  );
