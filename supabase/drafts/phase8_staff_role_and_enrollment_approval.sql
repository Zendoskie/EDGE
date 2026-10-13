-- Phase 8 security remediation: FORWARD-ONLY DRAFT. Not a migration.
--
-- Kept outside supabase/migrations because the production migration history has not been
-- reconciled with this repository yet (see the Phase 7 audit). Do not apply to production
-- without separate approval. Run as one transaction (it contains no BEGIN/COMMIT).
-- Test: supabase/tests/staff_role_and_enrollment_approval.test.sql.
--
-- Written against the production-derived schema (Phase 7 catalog reference). Every statement is
-- idempotent: CREATE OR REPLACE for functions, DROP ... IF EXISTS before triggers and policies.
-- Function owners and EXECUTE grants survive CREATE OR REPLACE.
--
-- Existing data: no row is inserted, updated or deleted. Existing active, pending and rejected
-- enrollments keep their status, and existing user_roles rows are untouched. The rules below
-- apply only to rows written after the script runs.

-- 1. Privileged staff roles are never granted from signup metadata.
--    raw_user_meta_data is client-controlled (supabase.auth.signUp options.data). Staff roles are
--    granted only by complete_staff_invitation(), which checks the invitation token, status,
--    expiry and email. Student and parent defaults are unchanged; any other claim becomes student.
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claimed_role text;
  v_role public.app_role;
BEGIN
  v_claimed_role := lower(trim(COALESCE(NEW.raw_user_meta_data->>'role', 'student')));

  -- Staff roles are granted only by complete_staff_invitation() after token and email checks.
  IF v_claimed_role IN ('instructor', 'guidance_counselor') THEN
    RETURN NEW;
  END IF;

  -- 'admin' is never self-service: it can only be granted by an administrator.
  IF v_claimed_role NOT IN ('student', 'parent') THEN
    v_role := 'student'::public.app_role;
  ELSE
    v_role := v_claimed_role::public.app_role;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 2. A student-created enrollment is always pending.
--    enrollments.status keeps its 'active' default because instructor-added students
--    (SubjectDetail.tsx) rely on it. When the caller is the enrolled student, the trigger
--    overrides whatever status the client sent, so the database never trusts it.
--    Service-role and owner writes (auth.uid() IS NULL) are not affected.
CREATE OR REPLACE FUNCTION public.enforce_student_enrollment_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.student_id = auth.uid() THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_student_enrollment_pending() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_student_enrollment_pending ON public.enrollments;
CREATE TRIGGER trg_enforce_student_enrollment_pending
  BEFORE INSERT ON public.enrollments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_enrollment_pending();

-- Backstop if the trigger is ever missing: a student self-insert must be pending.
-- Instructors still insert through "Instructors can manage enrollments" (owner-scoped).
DROP POLICY IF EXISTS "Students can insert own enrollment" ON public.enrollments;
CREATE POLICY "Students can insert own enrollment" ON public.enrollments
  AS PERMISSIVE FOR INSERT TO anon, authenticated
  WITH CHECK ((auth.uid() = student_id) AND (status = 'pending'::text));

-- 3. enroll_self(uuid) inserts a pending request instead of an active enrollment.
--    Unchanged otherwise. It still calls public.can_student_enroll(uuid, uuid), which does not
--    exist in production (Phase 7), so the RPC keeps failing there until that function is
--    restored or the eligibility rule is decided. No frontend code calls this RPC.
CREATE OR REPLACE FUNCTION public.enroll_self(subject_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_role(v_uid, 'student'::public.app_role) THEN
    RAISE EXCEPTION 'student_role_required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_student_enroll(subject_id, v_uid) THEN
    RAISE EXCEPTION 'enrollment_not_allowed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.enrollments (student_id, subject_id, status)
  VALUES (v_uid, enroll_self.subject_id, 'pending')
  ON CONFLICT (student_id, subject_id) DO NOTHING
  RETURNING true INTO v_inserted;

  RETURN COALESCE(v_inserted, false);
END;
$function$;
