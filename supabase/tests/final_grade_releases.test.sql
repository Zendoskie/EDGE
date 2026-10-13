-- Phase 3B final-grade release backend: single-session database tests.
--
-- Run as the `postgres` role on a disposable database restored from a schema-only snapshot, AFTER
-- 20261013120000_attendance_session_defaults.sql and 20261013130000_final_grade_releases.sql.
-- Never run on production. The block always ends with RAISE EXCEPTION, so everything it creates is
-- rolled back. Results are in the error message: one PASS/FAIL line per check.
--
-- The whole block is one transaction, and a version bump happens at most once per transaction.
-- pg_temp.newtx() clears last_txid to simulate the next transaction before each trigger check.
-- Real multi-transaction and multi-session behaviour is covered by
-- final_grade_release_concurrency.test.mjs.

CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT E'\n' || CASE WHEN COALESCE(p_ok, false) THEN 'PASS ' ELSE 'FAIL ' END || p_name
         || CASE WHEN p_detail IS NOT NULL AND NOT COALESCE(p_ok, false) THEN ' [' || p_detail || ']' ELSE '' END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.ver(p_subject uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT COALESCE((SELECT v.version FROM public.final_grade_input_versions v WHERE v.subject_id = p_subject), 0);
$$;

CREATE OR REPLACE FUNCTION pg_temp.newtx(p_subject uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.final_grade_input_versions SET last_txid = NULL WHERE subject_id = p_subject;
$$;

CREATE OR REPLACE FUNCTION pg_temp.st(p_subject uuid, p_student uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE((
    SELECT r.status || ':' || COALESCE(r.final_grade::text, 'null') || ':' || COALESCE(r.review_reason, '')
    FROM public.final_grade_releases r WHERE r.subject_id = p_subject AND r.student_id = p_student
  ), 'none');
$$;

CREATE OR REPLACE FUNCTION pg_temp.release(p_subject uuid, p_by uuid, p_rows jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.commit_final_grade_releases(p_subject, pg_temp.ver(p_subject), p_by, p_rows);
$$;

DO $test$
DECLARE
  v_out text := '';
  ins uuid := gen_random_uuid();    -- owning instructor
  ins2 uuid := gen_random_uuid();   -- other instructor
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  par uuid := gen_random_uuid();    -- approved parent linked to s1
  par2 uuid := gen_random_uuid();   -- approved parent, no link
  subj uuid := gen_random_uuid();
  subj2 uuid := gen_random_uuid();  -- owned by ins2
  subj3 uuid := gen_random_uuid();  -- no grade inputs, no version row
  subj4 uuid := gen_random_uuid();  -- deleted in E27
  a_act uuid := gen_random_uuid();
  a_proj uuid := gen_random_uuid();
  a_mid uuid := gen_random_uuid();
  a_fin uuid := gen_random_uuid();
  a_extra uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  w_def jsonb := '{"activity_weight": 25, "project_weight": 25, "attendance_weight": 15, "exam_weight": 35}';
  w_alt jsonb := '{"activity_weight": 40, "project_weight": 20, "attendance_weight": 10, "exam_weight": 30}';
  v_rows jsonb;
  v_res jsonb;
  v_v bigint;
  v_int int;
  v_int2 int;
  v_err text;
  v_txt text;
  v_bool boolean;
  v_ctid tid;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------------- setup (as postgres) ----------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  SELECT u.id, 'p3b.' || u.id || '@test.invalid',
         jsonb_build_object('full_name', u.name, 'role', u.role) || u.extra, 'authenticated', 'authenticated'
  FROM (VALUES
    (ins, 'P3B Instructor', 'instructor', '{}'::jsonb), (ins2, 'P3B Other Instructor', 'instructor', '{}'::jsonb),
    (s1, 'P3B S1', 'student', '{}'::jsonb), (s2, 'P3B S2', 'student', '{}'::jsonb), (s3, 'P3B S3', 'student', '{}'::jsonb),
    (par, 'P3B Parent', 'parent', '{"parent_invite": "1"}'::jsonb),
    (par2, 'P3B Other Parent', 'parent', '{"parent_invite": "1"}'::jsonb)
  ) AS u(id, name, role, extra);
  UPDATE public.profiles SET account_status = 'approved' WHERE user_id IN (par, par2);
  -- trg_enforce_parent_link_email_match requires the student's registered parent email to match the
  -- parent's account email. It is written the way complete_student_invitation does, under the
  -- transaction-local edge.allow_parent_email_write setting, which is then cleared again.
  PERFORM set_config('edge.allow_parent_email_write', '1', true);
  UPDATE public.profiles SET parent_email = (SELECT p.email FROM public.profiles p WHERE p.user_id = par)
  WHERE user_id = s1;
  PERFORM set_config('edge.allow_parent_email_write', '', true);
  INSERT INTO public.parent_student_links (parent_user_id, student_user_id, student_id_no, status)
  VALUES (par, s1, 'P3B-S1', 'approved');

  INSERT INTO public.subjects (id, name, code, instructor_id) VALUES
    (subj, 'P3B Subject', 'P3B-' || left(subj::text, 8), ins),
    (subj2, 'P3B Other', 'P3B-' || left(subj2::text, 8), ins2),
    (subj3, 'P3B Empty', 'P3B-' || left(subj3::text, 8), ins),
    (subj4, 'P3B Doomed', 'P3B-' || left(subj4::text, 8), ins);
  INSERT INTO public.enrollments (student_id, subject_id, status, enrolled_at) VALUES
    (s1, subj, 'active', now() - interval '30 days'),
    (s2, subj, 'active', now() - interval '30 days'),
    (s3, subj, 'active', now() - interval '30 days'),
    (s1, subj2, 'active', now() - interval '30 days');
  INSERT INTO public.activities (id, subject_id, title, type, max_score) VALUES
    (a_act, subj, 'Act 1', 'activity', 50), (a_proj, subj, 'Project', 'project', 100),
    (a_mid, subj, 'Midterm', 'midterm_exam', 100), (a_fin, subj, 'Final', 'final_exam', 100),
    (a_extra, subj, 'Extra', 'activity', 100);
  INSERT INTO public.submissions (activity_id, student_id, score, assessment_type)
  SELECT a.id, s.id, 40, a.type
  FROM (VALUES (a_act, 'activity'), (a_proj, 'project'), (a_mid, 'midterm_exam'), (a_fin, 'final_exam')) AS a(id, type)
  CROSS JOIN (VALUES (s1), (s2)) AS s(id);
  INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES
    (s1, subj, v_today - 5, 'present'), (s2, subj, v_today - 5, 'present');

  v_rows := jsonb_build_array(
    jsonb_build_object('student_id', s1, 'final_grade', 85.5, 'weights', w_def),
    jsonb_build_object('student_id', s2, 'final_grade', 70, 'weights', w_def));

  -- ---------------- A: schema, RLS and grants ----------------
  v_out := v_out || pg_temp.chk('A1 RLS enabled on both new tables',
    (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE oid IN ('public.final_grade_releases'::regclass, 'public.final_grade_input_versions'::regclass)));

  SELECT count(*), count(*) FILTER (WHERE cmd = 'SELECT' AND roles = '{authenticated}'::name[])
  INTO v_int, v_int2 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'final_grade_releases';
  v_out := v_out || pg_temp.chk('A2 final_grade_releases has exactly 3 policies, all SELECT TO authenticated',
    v_int = 3 AND v_int2 = 3, v_int || '/' || v_int2);

  v_out := v_out || pg_temp.chk('A3 authenticated: SELECT only on final_grade_releases',
    has_table_privilege('authenticated', 'public.final_grade_releases', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_releases', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_releases', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_releases', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_releases', 'TRUNCATE'));

  v_out := v_out || pg_temp.chk('A4 anon: no privileges on final_grade_releases',
    NOT has_table_privilege('anon', 'public.final_grade_releases', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.final_grade_releases', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.final_grade_releases', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.final_grade_releases', 'DELETE'));

  v_out := v_out || pg_temp.chk('A5 final_grade_input_versions: no policies, no anon/authenticated privileges',
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'final_grade_input_versions')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_input_versions', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_input_versions', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.final_grade_input_versions', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.final_grade_input_versions', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.final_grade_input_versions', 'UPDATE'));

  SELECT NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
  INTO v_bool FROM pg_proc p WHERE p.oid = 'public.commit_final_grade_releases(uuid, bigint, uuid, jsonb)'::regprocedure;
  v_out := v_out || pg_temp.chk('A6 commit RPC: SECURITY INVOKER, empty search_path, executable only by service_role', v_bool);

  SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
         AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
  INTO v_bool FROM pg_proc p WHERE p.oid = 'public.final_grade_inputs_changed(uuid, uuid, text, jsonb)'::regprocedure;
  v_out := v_out || pg_temp.chk('A7 bump-and-flag helper: SECURITY DEFINER, executable by no API role', v_bool);

  SELECT count(*) FILTER (WHERE p.prosecdef AND p.proconfig = ARRAY['search_path=""']
                            AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                            AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
  INTO v_int FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN
    ('final_grade_review_submissions', 'final_grade_review_attendance', 'final_grade_review_activities', 'final_grade_review_weights');
  v_out := v_out || pg_temp.chk('A8 four trigger functions: SECURITY DEFINER, empty search_path, not client-executable',
    v_int = 4, v_int::text);

  SELECT string_agg(tgrelid::regclass::text || '.' || tgname, ',' ORDER BY tgrelid::regclass::text, tgname) INTO v_txt
  FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'final_grade_review%';
  v_out := v_out || pg_temp.chk('A9 eight review triggers on the four source tables',
    v_txt = 'activities.final_grade_review_insert_delete,activities.final_grade_review_update,attendance.final_grade_review_insert_delete,attendance.final_grade_review_update,subject_grading_systems.final_grade_review,submissions.final_grade_review_delete,submissions.final_grade_review_insert,submissions.final_grade_review_update',
    v_txt);

  SELECT string_agg(tablename, ',' ORDER BY tablename) INTO v_txt FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
    AND tablename IN ('final_grade_releases', 'final_grade_input_versions');
  v_out := v_out || pg_temp.chk('A10 neither final_grade_releases nor final_grade_input_versions is in supabase_realtime',
    v_txt IS NULL, v_txt);

  -- ---------------- B: commit RPC ----------------
  v_v := pg_temp.ver(subj);
  v_res := public.commit_final_grade_releases(subj, v_v + 1, ins, v_rows);
  v_out := v_out || pg_temp.chk('B1 stale version: committed=false, written=0, nothing inserted',
    v_res = jsonb_build_object('committed', false, 'version', v_v, 'written', 0)
    AND NOT EXISTS (SELECT 1 FROM public.final_grade_releases WHERE subject_id = subj), v_res::text);

  BEGIN
    PERFORM public.commit_final_grade_releases(subj, v_v, ins2, v_rows);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('B2 non-owner p_released_by rejected',
    v_err LIKE '%caller does not own the subject%'
    AND NOT EXISTS (SELECT 1 FROM public.final_grade_releases WHERE subject_id = subj), v_err);

  BEGIN
    PERFORM public.commit_final_grade_releases(subj, v_v, ins, '{}'::jsonb);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('B3 non-array p_rows rejected', v_err LIKE '%invalid arguments%', v_err);

  v_res := public.commit_final_grade_releases(subj, v_v, ins, v_rows);
  v_out := v_out || pg_temp.chk('B4 matching version: both rows released with the given grades',
    v_res = jsonb_build_object('committed', true, 'version', v_v, 'written', 2)
    AND pg_temp.st(subj, s1) = 'released:85.50:' AND pg_temp.st(subj, s2) = 'released:70.00:'
    AND (SELECT bool_and(released_by = ins AND weights = w_def) FROM public.final_grade_releases WHERE subject_id = subj),
    v_res::text || ' ' || pg_temp.st(subj, s1) || ' ' || pg_temp.st(subj, s2));

  v_out := v_out || pg_temp.chk('B5 a release does not bump the input version', pg_temp.ver(subj) = v_v);

  SELECT ctid INTO v_ctid FROM public.final_grade_releases WHERE subject_id = subj AND student_id = s1;
  v_res := public.commit_final_grade_releases(subj, v_v, ins, v_rows);
  v_out := v_out || pg_temp.chk('B6 identical repeat writes 0 rows (row not rewritten)',
    v_res = jsonb_build_object('committed', true, 'version', v_v, 'written', 0)
    AND (SELECT ctid FROM public.final_grade_releases WHERE subject_id = subj AND student_id = s1) = v_ctid, v_res::text);

  v_bool := NOT EXISTS (SELECT 1 FROM public.final_grade_input_versions WHERE subject_id = subj3);
  v_res := public.commit_final_grade_releases(subj3, 0, ins,
    jsonb_build_array(jsonb_build_object('student_id', s3, 'final_grade', 90, 'weights', w_def)));
  v_out := v_out || pg_temp.chk('B7 missing version row counts as 0; the commit creates it',
    v_bool AND (v_res ->> 'committed')::boolean AND (v_res ->> 'written')::int = 1
    AND (SELECT version FROM public.final_grade_input_versions WHERE subject_id = subj3) = 0, v_res::text);

  BEGIN
    PERFORM pg_temp.release(subj, ins, jsonb_build_array(jsonb_build_object('student_id', s3, 'final_grade', NULL, 'weights', w_def)));
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('B8 a released row without a grade is rejected by the state CHECK',
    v_err LIKE '%final_grade_releases_state_check%' AND pg_temp.st(subj, s3) = 'none', v_err);

  BEGIN
    PERFORM pg_temp.release(subj, ins, jsonb_build_array(jsonb_build_object('student_id', s3, 'final_grade', 120, 'weights', w_def)));
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('B9 a grade above 100 is rejected', v_err LIKE '%final_grade_check%', v_err);

  -- ---------------- C: RLS reads ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE student_id = s1) INTO v_int, v_int2 FROM public.final_grade_releases;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C1 student sees only own rows', v_int = 1 AND v_int2 = 1, v_int || '/' || v_int2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE student_id = s1) INTO v_int, v_int2 FROM public.final_grade_releases;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C2 another student cannot see s1', v_int = 1 AND v_int2 = 0, v_int || '/' || v_int2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', par, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE student_id = s1) INTO v_int, v_int2 FROM public.final_grade_releases;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C3 linked parent sees only the linked student', v_int = 1 AND v_int2 = 1, v_int || '/' || v_int2);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', par2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.final_grade_releases;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C4 unlinked parent sees nothing', v_int = 0, v_int::text);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.final_grade_releases;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C5 owning instructor sees own subjects'' rows (subj 2 + subj3 1)', v_int = 3, v_int::text);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.final_grade_releases;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C6 other instructor sees nothing', v_int = 0, v_int::text);

  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_int FROM public.final_grade_releases;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C7 anon cannot read final_grade_releases', v_err LIKE 'permission denied%', v_err);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_int FROM public.final_grade_input_versions;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C8 authenticated cannot read final_grade_input_versions', v_err LIKE 'permission denied%', v_err);

  -- ---------------- D: client writes rejected ----------------
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.final_grade_releases (subject_id, student_id, final_grade, weights, status)
    VALUES (subj, s3, 99, w_def, 'released');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D1 owner instructor cannot INSERT releases', v_err LIKE 'permission denied%', v_err);

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.final_grade_releases SET final_grade = 99 WHERE subject_id = subj;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D2 owner instructor cannot UPDATE releases', v_err LIKE 'permission denied%', v_err);

  BEGIN
    SET LOCAL ROLE authenticated;
    DELETE FROM public.final_grade_releases WHERE subject_id = subj;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D3 owner instructor cannot DELETE releases', v_err LIKE 'permission denied%', v_err);

  v_v := pg_temp.ver(subj);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.commit_final_grade_releases(subj, v_v, ins, v_rows);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D4 authenticated cannot execute the commit RPC',
    v_err LIKE 'permission denied for function commit_final_grade_releases%', v_err);

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.final_grade_inputs_changed(subj, s1, 'forged');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D5 authenticated cannot execute the bump-and-flag helper',
    v_err LIKE 'permission denied for function final_grade_inputs_changed%', v_err);

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.final_grade_input_versions SET version = 0;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D6 authenticated cannot write final_grade_input_versions', v_err LIKE 'permission denied%', v_err);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.final_grade_releases SET final_grade = 100 WHERE student_id = s1;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D7 student cannot UPDATE own release', v_err LIKE 'permission denied%', v_err);

  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.commit_final_grade_releases(subj, v_v, ins, v_rows);
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('D8 anon cannot execute the commit RPC',
    v_err LIKE 'permission denied for function commit_final_grade_releases%', v_err);

  -- ---------------- E: review triggers (bump, then flag) ----------------
  -- E1: a client grade edit through RLS, as the owning instructor.
  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.submissions SET score = 45 WHERE activity_id = a_act AND student_id = s1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E1 instructor score edit: version +1, only that student flagged, grade cleared',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:score_changed'
    AND pg_temp.st(subj, s2) = 'released:70.00:',
    format('v %s->%s s1=%s s2=%s', v_v, pg_temp.ver(subj), pg_temp.st(subj, s1), pg_temp.st(subj, s2)));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT status || ':' || COALESCE(final_grade::text, 'null') INTO v_txt FROM public.final_grade_releases WHERE subject_id = subj;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E1b the student sees needs_review with no grade value', v_txt = 'needs_review:null', v_txt);

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.submissions SET score = 45 WHERE activity_id = a_act AND student_id = s1;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E2 score saved unchanged: no bump, no flag',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:',
    format('v %s->%s s1=%s', v_v, pg_temp.ver(subj), pg_temp.st(subj, s1)));

  PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  INSERT INTO public.submissions (activity_id, student_id, score, assessment_type) VALUES (a_extra, s1, NULL, 'activity');
  DELETE FROM public.submissions WHERE activity_id = a_extra AND student_id = s1;
  v_out := v_out || pg_temp.chk('E3 blank row of the activity''s own type inserted and deleted: no bump, no flag',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:',
    format('v %s->%s s1=%s', v_v, pg_temp.ver(subj), pg_temp.st(subj, s1)));

  PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  INSERT INTO public.submissions (activity_id, student_id, score, assessment_type) VALUES (a_extra, s2, NULL, 'project');
  v_out := v_out || pg_temp.chk('E4 blank row that changes the category: flagged score_added',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s2) = 'needs_review:null:score_added' AND pg_temp.st(subj, s1) = 'released:85.50:',
    format('v %s->%s s1=%s s2=%s', v_v, pg_temp.ver(subj), pg_temp.st(subj, s1), pg_temp.st(subj, s2)));
  DELETE FROM public.submissions WHERE activity_id = a_extra AND student_id = s2;

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  INSERT INTO public.submissions (activity_id, student_id, score, assessment_type) VALUES (a_extra, s1, 10, 'activity');
  v_out := v_out || pg_temp.chk('E5 scored row inserted: flagged score_added',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:score_added', pg_temp.st(subj, s1));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  DELETE FROM public.submissions WHERE activity_id = a_extra AND student_id = s1;
  v_out := v_out || pg_temp.chk('E6 scored row deleted: flagged score_removed',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:score_removed', pg_temp.st(subj, s1));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  UPDATE public.submissions SET assessment_type = 'activity' WHERE activity_id = a_proj AND student_id = s1;
  v_out := v_out || pg_temp.chk('E7 assessment_type changed: flagged score_changed',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:score_changed', pg_temp.st(subj, s1));
  UPDATE public.submissions SET assessment_type = 'project' WHERE activity_id = a_proj AND student_id = s1;

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES (s1, subj, v_today - 4, 'present');
  v_out := v_out || pg_temp.chk('E8 attendance row inserted: flagged attendance_changed',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:attendance_changed'
    AND pg_temp.st(subj, s2) = 'released:70.00:', pg_temp.st(subj, s1));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  UPDATE public.attendance SET status = 'present' WHERE student_id = s1 AND subject_id = subj AND date = v_today - 4;
  v_out := v_out || pg_temp.chk('E9 attendance status saved unchanged: no bump, no flag',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:', pg_temp.st(subj, s1));

  PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  UPDATE public.attendance SET status = 'late' WHERE student_id = s1 AND subject_id = subj AND date = v_today - 5;
  v_out := v_out || pg_temp.chk('E10 attendance status changed: flagged',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:attendance_changed', pg_temp.st(subj, s1));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  DELETE FROM public.attendance WHERE student_id = s1 AND subject_id = subj AND date = v_today - 4;
  v_out := v_out || pg_temp.chk('E11 attendance row deleted: flagged',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:attendance_changed', pg_temp.st(subj, s1));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES (NULL, subj, v_today - 4, 'present');
  v_out := v_out || pg_temp.chk('E12 attendance row without a student: no bump, nobody flagged',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:' AND pg_temp.st(subj, s2) = 'released:70.00:',
    format('v %s->%s', v_v, pg_temp.ver(subj)));

  UPDATE public.activities SET title = 'Extra renamed' WHERE id = a_extra;
  v_out := v_out || pg_temp.chk('E13 activity title change: no bump, no flag',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:', pg_temp.st(subj, s1));

  UPDATE public.activities SET max_score = 50 WHERE id = a_extra;
  v_out := v_out || pg_temp.chk('E14 activity max_score change: whole subject flagged assessment_changed',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:assessment_changed'
    AND pg_temp.st(subj, s2) = 'needs_review:null:assessment_changed', pg_temp.st(subj, s2));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  INSERT INTO public.activities (subject_id, title, type, max_score) VALUES (subj, 'Quiz 9', 'quiz', 10);
  v_out := v_out || pg_temp.chk('E15 activity added: whole subject flagged assessment_added',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:assessment_added'
    AND pg_temp.st(subj, s2) = 'needs_review:null:assessment_added', pg_temp.st(subj, s2));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  DELETE FROM public.activities WHERE id = a_act;
  v_out := v_out || pg_temp.chk('E16 activity deleted with cascaded scores: whole subject flagged once, version +1 exactly',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:assessment_removed'
    AND pg_temp.st(subj, s2) = 'needs_review:null:assessment_removed'
    AND NOT EXISTS (SELECT 1 FROM public.submissions WHERE activity_id = a_act),
    format('v %s->%s s1=%s', v_v, pg_temp.ver(subj), pg_temp.st(subj, s1)));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.subject_grading_systems (subject_id, activity_weight, project_weight, attendance_weight, exam_weight)
  VALUES (subj, 25, 25, 15, 35);
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E17 weights saved equal to the defaults: no bump, no flag',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:', format('v %s->%s', v_v, pg_temp.ver(subj)));

  SET LOCAL ROLE authenticated;
  UPDATE public.subject_grading_systems SET activity_weight = 40, project_weight = 20, attendance_weight = 10, exam_weight = 30
  WHERE subject_id = subj;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E18 weights changed: whole subject flagged weights_changed',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:weights_changed'
    AND pg_temp.st(subj, s2) = 'needs_review:null:weights_changed', pg_temp.st(subj, s2));

  v_rows := jsonb_build_array(
    jsonb_build_object('student_id', s1, 'final_grade', 85.5, 'weights', w_alt),
    jsonb_build_object('student_id', s2, 'final_grade', 70, 'weights', w_def));
  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  SET LOCAL ROLE authenticated;
  UPDATE public.subject_grading_systems SET activity_weight = 40, project_weight = 20, attendance_weight = 10, exam_weight = 30,
    updated_at = now() WHERE subject_id = subj;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E19 weights saved unchanged: no bump, no flag',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:', format('v %s->%s', v_v, pg_temp.ver(subj)));

  SET LOCAL ROLE authenticated;
  DELETE FROM public.subject_grading_systems WHERE subject_id = subj;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('E20 weights deleted (back to defaults): only rows released with other weights flagged',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:weights_changed'
    AND pg_temp.st(subj, s2) = 'released:70.00:', pg_temp.st(subj, s1) || ' ' || pg_temp.st(subj, s2));

  v_rows := jsonb_build_array(
    jsonb_build_object('student_id', s1, 'final_grade', 85.5, 'weights', w_def),
    jsonb_build_object('student_id', s2, 'final_grade', 70, 'weights', w_def));
  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  UPDATE public.submissions SET score = 41 WHERE activity_id = a_mid AND student_id = s1;
  UPDATE public.submissions SET score = 41 WHERE activity_id = a_mid AND student_id = s2;
  v_out := v_out || pg_temp.chk('E21 two statements in one transaction: version +1 once, both flagged',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:score_changed'
    AND pg_temp.st(subj, s2) = 'needs_review:null:score_changed', format('v %s->%s', v_v, pg_temp.ver(subj)));

  PERFORM pg_temp.release(subj, ins, v_rows); PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  UPDATE public.submissions SET score = score + 1 WHERE activity_id = a_fin;
  v_out := v_out || pg_temp.chk('E22 one multi-row statement: version +1 once, both flagged',
    pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:score_changed'
    AND pg_temp.st(subj, s2) = 'needs_review:null:score_changed', format('v %s->%s', v_v, pg_temp.ver(subj)));

  SELECT ctid INTO v_ctid FROM public.final_grade_releases WHERE subject_id = subj AND student_id = s1;
  PERFORM pg_temp.newtx(subj);
  INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES (s1, subj, v_today - 3, 'absent');
  v_out := v_out || pg_temp.chk('E23 a further change to a needs_review row bumps but does not rewrite the row',
    pg_temp.ver(subj) = v_v + 2 AND pg_temp.st(subj, s1) = 'needs_review:null:score_changed'
    AND (SELECT ctid FROM public.final_grade_releases WHERE subject_id = subj AND student_id = s1) = v_ctid,
    pg_temp.st(subj, s1));

  v_res := pg_temp.release(subj, ins, v_rows);
  v_out := v_out || pg_temp.chk('E24 re-release clears the review fields and restores the grade',
    (v_res ->> 'written')::int = 2 AND pg_temp.st(subj, s1) = 'released:85.50:'
    AND (SELECT review_flagged_at IS NULL FROM public.final_grade_releases WHERE subject_id = subj AND student_id = s1),
    v_res::text);

  PERFORM pg_temp.newtx(subj); v_v := pg_temp.ver(subj);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.record_attendance(subj, v_today - 1, s1, 'present');
  RESET ROLE;
  SELECT count(*) INTO v_int FROM public.attendance WHERE subject_id = subj AND date = v_today - 1;
  v_out := v_out || pg_temp.chk('E25 3A first mark (3 roster rows): version +1 once, released students flagged',
    v_int = 3 AND pg_temp.ver(subj) = v_v + 1 AND pg_temp.st(subj, s1) = 'needs_review:null:attendance_changed'
    AND pg_temp.st(subj, s2) = 'needs_review:null:attendance_changed',
    format('rows=%s v %s->%s', v_int, v_v, pg_temp.ver(subj)));

  v_bool := NOT EXISTS (SELECT 1 FROM public.final_grade_input_versions WHERE subject_id = subj4);
  INSERT INTO public.activities (subject_id, title, type, max_score) VALUES (subj4, 'Doomed quiz', 'quiz', 10);
  v_out := v_out || pg_temp.chk('E26 a change with no release rows still bumps (new-row protection)',
    v_bool AND pg_temp.ver(subj4) = 1 AND NOT EXISTS (SELECT 1 FROM public.final_grade_releases WHERE subject_id = subj4));

  BEGIN
    DELETE FROM public.subjects WHERE id = subj4;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('E27 deleting a subject cascades cleanly through the triggers',
    v_err = 'no error' AND NOT EXISTS (SELECT 1 FROM public.final_grade_input_versions WHERE subject_id = subj4), v_err);

  BEGIN
    DELETE FROM auth.users WHERE id = s3;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('E28 deleting a user cascades cleanly through the triggers',
    v_err = 'no error' AND pg_temp.st(subj3, s3) = 'none', v_err);

  PERFORM pg_temp.release(subj, ins, v_rows);
  BEGIN
    UPDATE public.final_grade_releases SET status = 'needs_review' WHERE subject_id = subj AND student_id = s2;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  v_out := v_out || pg_temp.chk('E29 state CHECK rejects needs_review with a grade',
    pg_temp.st(subj, s2) = 'released:70.00:' AND v_err LIKE '%final_grade_releases_state_check%', v_err);

  v_v := pg_temp.ver(subj);
  INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES (s1, subj2, v_today - 2, 'present');
  v_out := v_out || pg_temp.chk('E30 a change in another subject neither bumps nor flags this subject',
    pg_temp.ver(subj) = v_v AND pg_temp.st(subj, s1) = 'released:85.50:' AND pg_temp.ver(subj2) >= 1,
    format('v %s->%s s1=%s', v_v, pg_temp.ver(subj), pg_temp.st(subj, s1)));

  RAISE EXCEPTION 'PHASE3B_RESULTS (rolled back):%', v_out;
END
$test$;
