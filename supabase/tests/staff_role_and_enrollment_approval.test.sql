-- Phase 8 staff-role and enrollment-approval security: database scenario tests.
--
-- Run as the `postgres` role on a DISPOSABLE database restored from the production-derived
-- schema, AFTER supabase/drafts/phase8_staff_role_and_enrollment_approval.sql is applied.
-- Never run on production. The block always ends with RAISE EXCEPTION, so every user, role,
-- invitation, subject, enrollment and notification it creates is rolled back.
-- Requests are simulated the way PostgREST runs them: SET LOCAL ROLE plus request.jwt.claims.
-- Results are in the error message: one PASS/FAIL line per check.

CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT E'\n' || CASE WHEN COALESCE(p_ok, false) THEN 'PASS ' ELSE 'FAIL ' END || p_name
         || CASE WHEN p_detail IS NOT NULL AND NOT COALESCE(p_ok, false) THEN ' [' || p_detail || ']' ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.roles_of(p_user uuid)
RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(role::text, ',' ORDER BY role::text), '') FROM public.user_roles WHERE user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION pg_temp.signup(p_id uuid, p_email text, p_meta jsonb, p_app_meta jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql AS $$
  INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
  VALUES (p_id, p_email, p_meta, p_app_meta, 'authenticated', 'authenticated');
$$;

DO $test$
DECLARE
  v_out text := '';
  tag text := left(gen_random_uuid()::text, 8);
  adm uuid := gen_random_uuid();
  ins uuid := gen_random_uuid();     -- owns subj
  ins2 uuid := gen_random_uuid();    -- owns subj2, unrelated to subj
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  u uuid;
  subj uuid := gen_random_uuid();
  subj2 uuid := gen_random_uuid();
  v_int int; v_int2 int; v_txt text; v_err text; v_bool boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------------- setup (as postgres) ----------------
  PERFORM pg_temp.signup(adm, 'p8.adm.' || tag || '@test.invalid', jsonb_build_object('full_name', 'P8 Admin'));
  PERFORM pg_temp.signup(ins, 'p8.ins.' || tag || '@test.invalid', jsonb_build_object('full_name', 'P8 Instructor', 'role', 'instructor'));
  PERFORM pg_temp.signup(ins2, 'p8.ins2.' || tag || '@test.invalid', jsonb_build_object('full_name', 'P8 Other Instructor', 'role', 'instructor'));
  PERFORM pg_temp.signup(s1, 'p8.s1.' || tag || '@test.invalid', jsonb_build_object('full_name', 'P8 S1', 'role', 'student'));
  PERFORM pg_temp.signup(s2, 'p8.s2.' || tag || '@test.invalid', jsonb_build_object('full_name', 'P8 S2', 'role', 'student'));
  PERFORM pg_temp.signup(s3, 'p8.s3.' || tag || '@test.invalid', jsonb_build_object('full_name', 'P8 S3', 'role', 'student'));
  -- Fixture staff who were onboarded before this change: roles granted directly by the owner.
  DELETE FROM public.user_roles WHERE user_id IN (adm, ins, ins2);
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin'), (ins, 'instructor'), (ins2, 'instructor');
  UPDATE public.profiles SET account_status = 'approved' WHERE user_id IN (adm, ins, ins2, s1, s2, s3);
  INSERT INTO public.subjects (id, name, code, instructor_id) VALUES
    (subj, 'P8 Subject', 'P8-' || tag, ins),
    (subj2, 'P8 Subject 2', 'P8B-' || tag, ins2);

  -- ---------------- R: staff roles are never granted from signup metadata ----------------
  u := gen_random_uuid();
  PERFORM pg_temp.signup(u, 'p8.r1.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R1', 'role', 'instructor'));
  v_out := v_out || pg_temp.chk('R1 signup claiming instructor gets no role', pg_temp.roles_of(u) = '', pg_temp.roles_of(u));
  v_out := v_out || pg_temp.chk('R1b that account is pending and has_role(instructor) is false',
    (SELECT account_status FROM public.profiles WHERE user_id = u) = 'pending' AND NOT public.has_role(u, 'instructor'));

  u := gen_random_uuid();
  PERFORM pg_temp.signup(u, 'p8.r2.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R2', 'role', 'guidance_counselor'));
  v_out := v_out || pg_temp.chk('R2 signup claiming guidance_counselor gets no role', pg_temp.roles_of(u) = '', pg_temp.roles_of(u));

  v_err := '';
  FOR v_txt IN SELECT unnest(ARRAY['INSTRUCTOR', ' Guidance_Counselor ', 'admin', 'Admin', 'instructor ', 'super_admin', 'guidance-counselor']) LOOP
    u := gen_random_uuid();
    PERFORM pg_temp.signup(u, 'p8.r3.' || md5(v_txt) || '.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R3', 'role', v_txt));
    IF pg_temp.roles_of(u) NOT IN ('', 'student') THEN
      v_err := v_err || '"' || v_txt || '" -> ' || pg_temp.roles_of(u) || '; ';
    END IF;
  END LOOP;
  v_out := v_out || pg_temp.chk('R3 forged role spellings yield no role or student, never a privileged role', v_err = '', v_err);

  u := gen_random_uuid();
  PERFORM pg_temp.signup(u, 'p8.r3b.' || tag || '@test.invalid',
    jsonb_build_object('full_name', 'R3b', 'role', 'student', 'roles', jsonb_build_array('instructor'), 'app_role', 'instructor'),
    jsonb_build_object('role', 'instructor'));
  v_out := v_out || pg_temp.chk('R3b alternate role keys (roles, app_role, app metadata) are ignored',
    pg_temp.roles_of(u) = 'student', pg_temp.roles_of(u));

  -- R4/R5: invited staff obtain the role through complete_staff_invitation (called as anon,
  -- as RequestStaffAccount.tsx does after signing out the fresh session).
  FOR v_txt IN SELECT unnest(ARRAY['instructor', 'guidance_counselor']) LOOP
    u := gen_random_uuid();
    INSERT INTO public.staff_invitations (email, role, token, status, expires_at, created_by)
    VALUES ('p8.inv.' || v_txt || '.' || tag || '@test.invalid', v_txt::public.app_role, 'p8-token-' || v_txt || '-' || tag,
            'pending', now() + interval '7 days', adm);
    PERFORM pg_temp.signup(u, 'p8.inv.' || v_txt || '.' || tag || '@test.invalid', jsonb_build_object('full_name', 'Invited', 'role', v_txt));
    v_bool := pg_temp.roles_of(u) = '';
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM public.complete_staff_invitation('p8-token-' || v_txt || '-' || tag, u);
      v_err := 'ok';
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ' ' || SQLERRM;
    END;
    RESET ROLE;
    v_out := v_out || pg_temp.chk(
      CASE v_txt WHEN 'instructor' THEN 'R4 invited instructor' ELSE 'R5 invited counselor' END
        || ': no role at signup, role + approved after completing the invitation',
      v_bool AND v_err = 'ok' AND pg_temp.roles_of(u) = v_txt
        AND (SELECT account_status FROM public.profiles WHERE user_id = u) = 'approved'
        AND (SELECT status FROM public.staff_invitations WHERE token = 'p8-token-' || v_txt || '-' || tag) = 'accepted',
      v_err || ' roles=' || pg_temp.roles_of(u));
  END LOOP;

  -- R6: an unapproved staff request never becomes a privileged account.
  u := gen_random_uuid();
  INSERT INTO public.staff_registration_requests (full_name, email, role, status)
  VALUES ('R6 Requester', 'p8.r6.' || tag || '@test.invalid', 'instructor', 'pending');
  PERFORM pg_temp.signup(u, 'p8.r6.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R6', 'role', 'instructor'));
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.complete_staff_invitation('p8-no-such-token-' || tag, u);
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('R6 pending staff request: no role, and no invitation token to complete',
    pg_temp.roles_of(u) = '' AND v_err = 'P0002', v_err || ' roles=' || pg_temp.roles_of(u));

  -- Someone else's invitation cannot be redeemed for a different account (email check).
  INSERT INTO public.staff_invitations (email, role, token, status, expires_at, created_by)
  VALUES ('p8.victim.' || tag || '@test.invalid', 'instructor', 'p8-victim-' || tag, 'pending', now() + interval '7 days', adm);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.complete_staff_invitation('p8-victim-' || tag, u);
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('R6b another person''s invitation is rejected (email_mismatch)',
    v_err = 'email_mismatch' AND pg_temp.roles_of(u) = '', v_err);

  -- R7: normal student and parent self-registration still work.
  u := gen_random_uuid();
  PERFORM pg_temp.signup(u, 'p8.r7s.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R7 Student', 'role', 'student', 'student_number', 'P8-' || tag));
  v_out := v_out || pg_temp.chk('R7 student signup gets student role and a pending profile',
    pg_temp.roles_of(u) = 'student' AND (SELECT account_status FROM public.profiles WHERE user_id = u) = 'pending');
  u := gen_random_uuid();
  PERFORM pg_temp.signup(u, 'p8.r7n.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R7 No Role'));
  v_out := v_out || pg_temp.chk('R7b signup without a role claim defaults to student', pg_temp.roles_of(u) = 'student');
  u := gen_random_uuid();
  PERFORM pg_temp.signup(u, 'p8.r7p.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R7 Parent', 'role', 'parent', 'parent_invite', '1'));
  v_out := v_out || pg_temp.chk('R7c parent signup with the invitation marker gets parent role', pg_temp.roles_of(u) = 'parent');
  BEGIN
    PERFORM pg_temp.signup(gen_random_uuid(), 'p8.r7q.' || tag || '@test.invalid', jsonb_build_object('full_name', 'R7 Parent', 'role', 'parent'));
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('R7d parent signup without the marker is still refused', v_err = 'parent_invitation_required', v_err);

  -- R8: ordinary account activity cannot grant a role.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (s1, 'instructor');
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  BEGIN
    UPDATE public.user_roles SET role = 'instructor' WHERE user_id = s1;
    GET DIAGNOSTICS v_int = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_int := 0;
  END;
  UPDATE public.profiles SET full_name = 'P8 S1 renamed' WHERE user_id = s1;
  GET DIAGNOSTICS v_int2 = ROW_COUNT;
  RESET ROLE;
  -- supabase.auth.updateUser({ data: { role } }) and a sign-in both update auth.users.
  UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role":"instructor"}', last_sign_in_at = now() WHERE id = s1;
  v_out := v_out || pg_temp.chk('R8 role self-insert denied, role self-update changes 0 rows, profile/metadata/login updates keep student',
    v_err = '42501' AND v_int = 0 AND v_int2 = 1 AND pg_temp.roles_of(s1) = 'student', v_err || ' upd=' || v_int || ' prof=' || v_int2 || ' roles=' || pg_temp.roles_of(s1));

  -- ---------------- E: student-created enrollments are pending ----------------
  v_out := v_out || pg_temp.chk('E0 trigger function is not executable by anon or authenticated',
    NOT has_function_privilege('anon', 'public.enforce_student_enrollment_pending()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.enforce_student_enrollment_pending()', 'EXECUTE'));

  SELECT count(*) INTO v_int2 FROM public.user_inbox_notifications WHERE user_id = ins AND title = 'Enrollment request';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.enrollments (student_id, subject_id, status) VALUES (s1, subj, 'active');
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E1 student insert with forged status active is stored as pending',
    (SELECT status FROM public.enrollments WHERE student_id = s1 AND subject_id = subj) = 'pending');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.enrollments (student_id, subject_id) VALUES (s2, subj);
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E2 student insert without a status becomes pending',
    (SELECT status FROM public.enrollments WHERE student_id = s2 AND subject_id = subj) = 'pending');

  SELECT count(*) INTO v_int FROM public.user_inbox_notifications WHERE user_id = ins AND title = 'Enrollment request';
  v_out := v_out || pg_temp.chk('E10a each student request notifies the owning instructor once', v_int - v_int2 = 2, (v_int - v_int2)::text);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.enrollments (student_id, subject_id, status) VALUES (s3, subj2, 'active');
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E3a a student cannot insert an enrollment for another student', v_err = '42501', v_err);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO public.enrollments (student_id, subject_id, status) VALUES (s3, subj2, 'active');
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E3b anon cannot insert an enrollment', v_err = '42501', v_err);

  -- Backstop policy on its own (trigger disabled inside a subtransaction).
  BEGIN
    ALTER TABLE public.enrollments DISABLE TRIGGER trg_enforce_student_enrollment_pending;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', s3, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.enrollments (student_id, subject_id) VALUES (s3, subj2);
      v_err := 'ok';
    EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
    END;
    RESET ROLE;
    RAISE EXCEPTION 'undo trigger disable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'undo trigger disable' THEN v_err := SQLSTATE || ' ' || SQLERRM; END IF;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E3c without the trigger, the policy still refuses a defaulted active self-insert', v_err = '42501', v_err);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.enrollments SET status = 'active' WHERE student_id = s1 AND subject_id = subj;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E4 a student cannot update their pending enrollment to active',
    v_int = 0 AND (SELECT status FROM public.enrollments WHERE student_id = s1 AND subject_id = subj) = 'pending');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.enrollments SET status = 'active' WHERE student_id = s1 AND subject_id = subj;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E6 an unrelated instructor cannot approve the enrollment',
    v_int = 0 AND (SELECT status FROM public.enrollments WHERE student_id = s1 AND subject_id = subj) = 'pending');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.enrollments SET status = 'active' WHERE student_id = s1 AND subject_id = subj;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E5 the owning instructor approves: pending becomes active',
    v_int = 1 AND (SELECT status FROM public.enrollments WHERE student_id = s1 AND subject_id = subj) = 'active');

  -- E7: reject, then re-request.
  SELECT count(*) INTO v_int2 FROM public.user_inbox_notifications WHERE user_id = s2 AND title = 'Enrollment request rejected';
  SET LOCAL ROLE authenticated;
  UPDATE public.enrollments SET status = 'rejected' WHERE student_id = s2 AND subject_id = subj;
  RESET ROLE;
  SELECT count(*) INTO v_int FROM public.user_inbox_notifications WHERE user_id = s2 AND title = 'Enrollment request rejected';
  v_out := v_out || pg_temp.chk('E7a the owning instructor rejects and the student is notified',
    (SELECT status FROM public.enrollments WHERE student_id = s2 AND subject_id = subj) = 'rejected' AND v_int - v_int2 = 1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.enrollments SET status = 'active' WHERE student_id = s2 AND subject_id = subj AND status = 'rejected';
    GET DIAGNOSTICS v_int = ROW_COUNT;
    v_err := 'rows=' || v_int;
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E7b a rejected student cannot reopen straight to active',
    v_err IN ('42501', 'rows=0') AND (SELECT status FROM public.enrollments WHERE student_id = s2 AND subject_id = subj) = 'rejected', v_err);

  SELECT count(*) INTO v_int2 FROM public.user_inbox_notifications WHERE user_id = ins AND title = 'Enrollment request';
  SET LOCAL ROLE authenticated;
  UPDATE public.enrollments SET status = 'pending' WHERE student_id = s2 AND subject_id = subj AND status = 'rejected';
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  SELECT count(*) - v_int2 INTO v_int2 FROM public.user_inbox_notifications WHERE user_id = ins AND title = 'Enrollment request';
  v_out := v_out || pg_temp.chk('E7c re-request (rejected to pending) works and notifies the instructor again',
    v_int = 1 AND v_int2 = 1 AND (SELECT status FROM public.enrollments WHERE student_id = s2 AND subject_id = subj) = 'pending');

  -- E8: instructor-added students keep the default active status.
  SELECT count(*) INTO v_int2 FROM public.user_inbox_notifications WHERE user_id = ins;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.enrollments (student_id, subject_id) VALUES (s3, subj);
  RESET ROLE;
  SELECT count(*) - v_int2 INTO v_int2 FROM public.user_inbox_notifications WHERE user_id = ins;
  v_out := v_out || pg_temp.chk('E8 an instructor-added student is active and creates no request notification',
    (SELECT status FROM public.enrollments WHERE student_id = s3 AND subject_id = subj) = 'active' AND v_int2 = 0);

  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.enrollments (student_id, subject_id) VALUES (s3, subj2);
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E8b an instructor cannot add a student to another instructor''s subject', v_err = '42501', v_err);

  -- E9: duplicates.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.enrollments (student_id, subject_id, status) VALUES (s1, subj, 'pending');
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E9a a duplicate request fails with 23505 and leaves the active row unchanged',
    v_err = '23505' AND (SELECT status FROM public.enrollments WHERE student_id = s1 AND subject_id = subj) = 'active', v_err);

  SET LOCAL ROLE authenticated;
  BEGIN
    v_bool := public.enroll_self(subj2);
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  RESET ROLE;
  IF to_regprocedure('public.can_student_enroll(uuid, uuid)') IS NULL THEN
    v_out := v_out || pg_temp.chk('E9b enroll_self fails closed while can_student_enroll is missing (production state)',
      v_err = '42883' AND NOT EXISTS (SELECT 1 FROM public.enrollments WHERE student_id = s1 AND subject_id = subj2), v_err);
  ELSE
    v_out := v_out || pg_temp.chk('E9b enroll_self creates only a pending enrollment',
      v_err <> 'ok' OR COALESCE((SELECT status FROM public.enrollments WHERE student_id = s1 AND subject_id = subj2), 'pending') = 'pending', v_err);
  END IF;

  -- Trusted server-side writes (service role, no user JWT) are unchanged by the trigger.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  INSERT INTO public.enrollments (student_id, subject_id, status) VALUES (s2, subj2, 'active');
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E11 service-role insert keeps its explicit status (server paths must send pending)',
    (SELECT status FROM public.enrollments WHERE student_id = s2 AND subject_id = subj2) = 'active');

  RAISE EXCEPTION 'PHASE8_RESULTS (rolled back):%', v_out;
END
$test$;
