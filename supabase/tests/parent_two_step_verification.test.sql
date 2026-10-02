-- Phase 1 parent/guardian two-step verification: database scenario tests A-N.
--
-- Run as the `postgres` role AFTER the 20261002100100 migration is applied
-- (e.g. SQL editor). The block always ends with RAISE EXCEPTION, so every test
-- user, link and notification it creates is rolled back. Results are in the
-- error message: one PASS/FAIL line per check.

CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT E'\n' || CASE WHEN COALESCE(p_ok, false) THEN 'PASS ' ELSE 'FAIL ' END || p_name
         || CASE WHEN p_detail IS NOT NULL AND NOT COALESCE(p_ok, false) THEN ' [' || p_detail || ']' ELSE '' END;
$$;

DO $test$
DECLARE
  v_out text := '';
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid();
  p2 uuid := gen_random_uuid();
  p3 uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  ins uuid := gen_random_uuid();
  sid1 text := '99-9-9-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
  sid2 text := '98-9-9-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
  l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  v_txt text; v_txt2 text; v_int int; v_bool boolean; v_err text;
  v_legacy_approved int;
BEGIN
  SELECT count(*) INTO v_legacy_approved FROM public.parent_student_links WHERE status = 'approved';

  -- ---------------- setup (as postgres) ----------------
  PERFORM set_config('request.jwt.claims', '', true);

  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (s1, 'phase1.s1.' || s1 || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Student One', 'role', 'student', 'student_number', sid1,
                        'parent_email', 'legacy.parent@test.invalid', 'course', 'BSCS', 'year_level', '1st Year'),
     'authenticated', 'authenticated'),
    (s2, 'phase1.s2.' || s2 || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Student Two', 'role', 'student', 'student_number', sid2),
     'authenticated', 'authenticated'),
    (adm, 'phase1.adm.' || adm || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Admin', 'role', 'admin'),
     'authenticated', 'authenticated'),
    (ins, 'phase1.ins.' || ins || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Instructor', 'role', 'instructor'),
     'authenticated', 'authenticated');

  -- N1: 'admin' can never be self-assigned at signup.
  SELECT string_agg(role::text, ',') INTO v_txt FROM public.user_roles WHERE user_id = adm;
  v_out := v_out || pg_temp.chk('N1 signup cannot self-assign admin (got ' || COALESCE(v_txt, 'none') || ')', v_txt = 'student');

  DELETE FROM public.user_roles WHERE user_id = adm;
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin');
  UPDATE public.profiles SET account_status = 'approved' WHERE user_id IN (s1, s2, adm);

  -- A: student signup no longer stores a parent email.
  SELECT parent_email INTO v_txt FROM public.profiles WHERE user_id = s1;
  v_out := v_out || pg_temp.chk('A1 student profile has no parent_email', v_txt IS NULL, v_txt);
  BEGIN
    PERFORM public.validate_student_signup('97-9-9-0001');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('A2 validate_student_signup works without parent email', v_err IS NULL, v_err);

  -- B: parent signup with Student ID creates a pending request.
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (p1, 'phase1.p1.' || p1 || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Parent One', 'role', 'parent', 'guardian_student_id', sid1),
     'authenticated', 'authenticated');
  SELECT id, status INTO l1, v_txt FROM public.parent_student_links WHERE parent_user_id = p1 AND student_user_id = s1;
  v_out := v_out || pg_temp.chk('B1 parent signup created a pending link', v_txt = 'pending', v_txt);
  SELECT account_status INTO v_txt FROM public.profiles WHERE user_id = p1;
  v_out := v_out || pg_temp.chk('B2 parent account is pending', v_txt = 'pending', v_txt);
  SELECT count(*) INTO v_int FROM public.user_inbox_notifications WHERE user_id = s1 AND title = 'Parent Access Request';
  v_out := v_out || pg_temp.chk('B3 student got request-received inbox notification', v_int = 1, v_int::text);
  SELECT count(*) INTO v_int FROM public.parent_link_request_history WHERE link_id = l1 AND status = 'pending';
  v_out := v_out || pg_temp.chk('B4 request history recorded', v_int = 1, v_int::text);

  -- C: parent cannot access anything yet.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_bool := public.parent_has_active_link(s1);
  SELECT count(*) INTO v_int FROM public.profiles WHERE user_id = s1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C1 pending parent has no active link', v_bool = false);
  v_out := v_out || pg_temp.chk('C2 pending parent cannot read student profile', v_int = 0, v_int::text);

  -- D: student sees the parent's name and email.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.parent_student_links WHERE id = l1;
  SELECT full_name, email INTO v_txt, v_txt2 FROM public.profiles WHERE user_id = p1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D1 student sees the request', v_int = 1, v_int::text);
  v_out := v_out || pg_temp.chk('D2 student sees parent name and email',
                                v_txt = 'Phase1 Parent One' AND v_txt2 LIKE 'phase1.p1.%', COALESCE(v_txt, 'null'));

  -- E: student approval moves the request to the admin.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.parent_student_links SET status = 'approved' WHERE id = l1;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E0 student cannot update link status directly', v_int = 0, v_int::text);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.student_decide_parent_request(l1, 'approve');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E1 parent cannot approve on the student''s behalf', v_err = 'request_not_found', v_err);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := public.student_decide_parent_request(l1, 'approve');
  BEGIN
    PERFORM public.student_decide_parent_request(l1, 'approve');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  BEGIN
    PERFORM public.admin_decide_parent_request(l1, 'approve');
    v_txt2 := 'no error';
  EXCEPTION WHEN OTHERS THEN v_txt2 := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E2 student approval -> pending_admin', v_txt = 'pending_admin', v_txt);
  v_out := v_out || pg_temp.chk('E3 student cannot decide twice', v_err = 'request_not_pending', v_err);
  v_out := v_out || pg_temp.chk('E4 student cannot perform the admin step', v_txt2 = 'forbidden', v_txt2);

  SELECT account_status INTO v_txt FROM public.profiles WHERE user_id = p1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_bool := public.parent_has_active_link(s1);
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E5 after student approval parent is still blocked', v_txt = 'pending' AND v_bool = false, v_txt);

  -- F: request appears for the admin.
  SELECT count(*) INTO v_int FROM public.user_inbox_notifications
  WHERE user_id = adm AND title = 'Parent/Guardian request awaiting approval';
  v_out := v_out || pg_temp.chk('F1 admin got awaiting-approval inbox notification', v_int = 1, v_int::text);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.parent_student_links WHERE id = l1 AND status = 'pending_admin';
  RESET ROLE;
  v_out := v_out || pg_temp.chk('F2 admin sees the student-approved request', v_int = 1, v_int::text);

  -- G: admin approval activates the parent.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := public.admin_decide_parent_request(l1, 'approve');
  RESET ROLE;
  v_out := v_out || pg_temp.chk('G1 admin approval -> approved', v_txt = 'approved', v_txt);
  SELECT status INTO v_txt FROM public.parent_student_links WHERE id = l1 AND admin_decided_by = adm AND admin_decided_at IS NOT NULL;
  v_out := v_out || pg_temp.chk('G2 link records the admin decision', v_txt = 'approved', v_txt);
  SELECT account_status INTO v_txt FROM public.profiles WHERE user_id = p1;
  v_out := v_out || pg_temp.chk('G3 parent account approved', v_txt = 'approved', v_txt);
  SELECT count(*) INTO v_int FROM public.user_inbox_notifications WHERE user_id = p1 AND title = 'Parent/Guardian access approved';
  v_out := v_out || pg_temp.chk('G4 parent got approval inbox notification', v_int = 1, v_int::text);
  SELECT count(*) INTO v_int FROM public.parent_link_request_history WHERE link_id = l1;
  v_out := v_out || pg_temp.chk('G5 history has created/student-approved/admin-approved', v_int = 3, v_int::text);

  -- H: parent can now access the linked student.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_bool := public.parent_has_active_link(s1);
  SELECT count(*) INTO v_int FROM public.profiles WHERE user_id = s1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('H1 approved parent has an active link', v_bool = true);
  v_out := v_out || pg_temp.chk('H2 approved parent can read linked student profile', v_int = 1, v_int::text);

  -- I: student rejection blocks access.
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (p2, 'phase1.p2.' || p2 || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Parent Two', 'role', 'parent', 'guardian_student_id', sid1),
     'authenticated', 'authenticated');
  SELECT id INTO l2 FROM public.parent_student_links WHERE parent_user_id = p2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := public.student_decide_parent_request(l2, 'reject');
  RESET ROLE;
  v_out := v_out || pg_temp.chk('I1 student rejection -> rejected', v_txt = 'rejected', v_txt);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_decide_parent_request(l2, 'approve');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('I2 admin cannot approve a student-rejected request', v_err = 'request_not_awaiting_admin', v_err);
  SELECT account_status INTO v_txt FROM public.profiles WHERE user_id = p2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_bool := public.parent_has_active_link(s1);
  SELECT count(*) INTO v_int FROM public.profiles WHERE user_id = s1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('I3 student-rejected parent stays inactive with no access',
                                v_txt <> 'approved' AND v_bool = false AND v_int = 0, v_txt);

  -- J: admin rejection blocks access.
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
    (p3, 'phase1.p3.' || p3 || '@test.invalid',
     jsonb_build_object('full_name', 'Phase1 Parent Three', 'role', 'parent', 'guardian_student_id', sid1),
     'authenticated', 'authenticated');
  SELECT id INTO l3 FROM public.parent_student_links WHERE parent_user_id = p3;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.student_decide_parent_request(l3, 'approve');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_txt := public.admin_decide_parent_request(l3, 'reject');
  BEGIN
    PERFORM public.admin_set_account_status(p3, 'approved');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('J1 admin rejection -> admin_rejected', v_txt = 'admin_rejected', v_txt);
  SELECT account_status INTO v_txt FROM public.profiles WHERE user_id = p3;
  v_out := v_out || pg_temp.chk('J2 admin-rejected parent account is rejected', v_txt = 'rejected', v_txt);
  v_out := v_out || pg_temp.chk('J3 generic approve cannot bypass link approval', v_err = 'parent_requires_verified_link', v_err);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p3, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_bool := public.parent_has_active_link(s1);
  SELECT count(*) INTO v_int FROM public.profiles WHERE user_id = s1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('J4 admin-rejected parent has no access', v_bool = false AND v_int = 0, v_int::text);
  SELECT count(*) INTO v_int FROM public.user_inbox_notifications WHERE user_id = p3 AND title = 'Parent/Guardian request rejected';
  v_out := v_out || pg_temp.chk('J5 parent got admin-rejected inbox notification', v_int = 1, v_int::text);

  -- K: invalid Student ID handled safely.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.validate_parent_signup('00-0-0-0000', 'phase1.k@test.invalid');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('K1 pre-check rejects unknown Student ID', v_err = 'student_not_found_for_guardian_link', v_err);
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
      (gen_random_uuid(), 'phase1.k2@test.invalid',
       jsonb_build_object('full_name', 'Bad Id Parent', 'role', 'parent', 'guardian_student_id', '00-0-0-0000'),
       'authenticated', 'authenticated');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('K2 signup with unknown Student ID is refused', v_err = 'student_not_found_for_guardian_link', v_err);
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role) VALUES
      (gen_random_uuid(), 'phase1.k3@test.invalid',
       jsonb_build_object('full_name', 'No Id Parent', 'role', 'parent'),
       'authenticated', 'authenticated');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('K3 signup without Student ID is refused', v_err = 'guardian_student_id_required', v_err);
  BEGIN
    PERFORM public.validate_parent_signup(sid1, 'phase1.p1.' || p1 || '@test.invalid');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('K4 duplicate email is refused', v_err = 'parent_email_already_registered', v_err);
  BEGIN
    PERFORM public.validate_parent_signup(sid1, 'phase1.new.parent@test.invalid');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('K5 valid Student ID + new email passes pre-check', v_err IS NULL, v_err);

  -- L: a Student ID alone never authorizes access.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.parent_request_student_link(sid1);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  BEGIN
    INSERT INTO public.parent_student_links (parent_user_id, student_user_id, student_id_no, status)
    VALUES (p2, s2, sid2, 'approved');
    v_txt := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
  END;
  UPDATE public.parent_student_links SET status = 'approved' WHERE id = l2;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('L1 inactive parent cannot create requests', v_err = 'account_not_active', v_err);
  v_out := v_out || pg_temp.chk('L2 parent cannot insert an approved link', v_txt <> 'inserted', v_txt);
  v_out := v_out || pg_temp.chk('L3 parent cannot self-approve a link', v_int = 0, v_int::text);

  -- M: a parent cannot access another student's data.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_bool := public.parent_has_active_link(s2);
  SELECT count(*) INTO v_int FROM public.profiles WHERE user_id = s2;
  SELECT count(*) INTO v_txt FROM public.parent_student_links WHERE parent_user_id <> p1;
  l4 := public.parent_request_student_link(sid2);
  BEGIN
    PERFORM public.parent_request_student_link(sid2);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  BEGIN
    PERFORM public.parent_request_student_link(sid1);
    v_txt2 := 'no error';
  EXCEPTION WHEN OTHERS THEN v_txt2 := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('M1 parent cannot read an unlinked student', v_bool = false AND v_int = 0, v_int::text);
  v_out := v_out || pg_temp.chk('M2 parent cannot see other parents'' links', v_txt = '0', v_txt);
  v_out := v_out || pg_temp.chk('M3 active parent request for 2nd student is pending',
                                (SELECT status FROM public.parent_student_links WHERE id = l4) = 'pending');
  v_out := v_out || pg_temp.chk('M4 duplicate pending request refused', v_err = 'pending_request_exists', v_err);
  v_out := v_out || pg_temp.chk('M5 already-linked request refused', v_txt2 = 'already_approved', v_txt2);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.profiles WHERE user_id = s2;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('M6 pending 2nd-student request grants nothing', v_int = 0, v_int::text);

  -- N: staff and admin account handling still works.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.admin_set_account_status(ins, 'approved');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  SELECT account_status INTO v_txt FROM public.profiles WHERE user_id = ins;
  v_out := v_out || pg_temp.chk('N2 admin can still approve an instructor', v_err IS NULL AND v_txt = 'approved', COALESCE(v_err, v_txt));
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET account_status = 'rejected' WHERE user_id = s1;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  UPDATE public.profiles SET account_status = 'approved' WHERE user_id = p2;
  GET DIAGNOSTICS v_int = ROW_COUNT;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('N3 users cannot change account_status themselves', v_err = 'account_status_change_forbidden', v_err);
  v_out := v_out || pg_temp.chk('N4 student cannot activate a parent account', v_int = 0, v_int::text);
  SELECT count(*) INTO v_int FROM public.parent_student_links
  WHERE status = 'approved' AND parent_user_id NOT IN (p1, p2, p3);
  v_out := v_out || pg_temp.chk('N5 existing approved links untouched', v_int = v_legacy_approved, v_int::text);

  RAISE EXCEPTION 'PHASE1_RESULTS (rolled back):%', v_out;
END
$test$;
