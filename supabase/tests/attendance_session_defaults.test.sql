-- Phase 3A attendance session defaults: database scenario tests.
--
-- Run as the `postgres` role on a STAGING project restored from a live schema dump, AFTER
-- 20261013120000_attendance_session_defaults.sql is applied. Never run on production.
-- The block always ends with RAISE EXCEPTION, so every user, subject, enrollment and
-- attendance row it creates (and the temporary constraint drop in section G) is rolled back.
-- Results are in the error message: one PASS/FAIL line per check.

CREATE OR REPLACE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT E'\n' || CASE WHEN COALESCE(p_ok, false) THEN 'PASS ' ELSE 'FAIL ' END || p_name
         || CASE WHEN p_detail IS NOT NULL AND NOT COALESCE(p_ok, false) THEN ' [' || p_detail || ']' ELSE '' END;
$$;

DO $test$
DECLARE
  v_out text := '';
  ins uuid := gen_random_uuid();   -- owning instructor
  ins2 uuid := gen_random_uuid();  -- other instructor
  s1 uuid := gen_random_uuid();    -- eligible
  s2 uuid := gen_random_uuid();    -- eligible
  s6 uuid := gen_random_uuid();    -- eligible
  s7 uuid := gen_random_uuid();    -- eligible
  s3 uuid := gen_random_uuid();    -- enrolled after the session date
  s4 uuid := gen_random_uuid();    -- pending (not active)
  s5 uuid := gen_random_uuid();    -- active, enrolled_at NULL
  subj uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  d1 date := v_today - 3;
  d2 date := v_today - 2;
  d3 date := v_today - 10;
  v_int int; v_int2 int; v_txt text; v_err text; v_bool boolean;
  v_ctid tid; v_ctid2 tid; v_keep uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);

  -- ---------------- setup (as postgres) ----------------
  INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
  SELECT u.id, 'p3a.' || u.id || '@test.invalid',
         jsonb_build_object('full_name', u.name, 'role', u.role), 'authenticated', 'authenticated'
  FROM (VALUES
    (ins, 'P3A Instructor', 'instructor'), (ins2, 'P3A Other Instructor', 'instructor'),
    (s1, 'P3A S1', 'student'), (s2, 'P3A S2', 'student'), (s3, 'P3A S3', 'student'),
    (s4, 'P3A S4', 'student'), (s5, 'P3A S5', 'student'), (s6, 'P3A S6', 'student'),
    (s7, 'P3A S7', 'student')
  ) AS u(id, name, role);
  -- Signup metadata never grants a staff role; staff roles come from a trusted path.
  INSERT INTO public.user_roles (user_id, role) VALUES (ins, 'instructor'), (ins2, 'instructor')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.subjects (id, name, code, instructor_id)
  VALUES (subj, 'P3A Subject', 'P3A-' || left(subj::text, 8), ins);

  INSERT INTO public.enrollments (student_id, subject_id, status, enrolled_at) VALUES
    (s1, subj, 'active', now() - interval '30 days'),
    (s2, subj, 'active', now() - interval '30 days'),
    (s6, subj, 'active', now() - interval '30 days'),
    (s7, subj, 'active', now() - interval '30 days'),
    (s3, subj, 'active', now()),
    (s4, subj, 'pending', now() - interval '30 days'),
    (s5, subj, 'active', NULL);

  -- ---------------- A: grants ----------------
  v_out := v_out || pg_temp.chk('A1 anon cannot execute record_attendance',
    NOT has_function_privilege('anon', 'public.record_attendance(uuid, date, uuid, text)', 'EXECUTE'));
  v_out := v_out || pg_temp.chk('A2 authenticated can execute record_attendance',
    has_function_privilege('authenticated', 'public.record_attendance(uuid, date, uuid, text)', 'EXECUTE'));
  SELECT p.prosecdef INTO v_bool FROM pg_proc p WHERE p.oid = 'public.record_attendance(uuid, date, uuid, text)'::regprocedure;
  v_out := v_out || pg_temp.chk('A3 record_attendance is SECURITY INVOKER', v_bool = false);

  -- ---------------- B: rejections ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, v_today + 1, s1, 'present');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('B1 future Manila date rejected',
    v_err = 'Attendance cannot be recorded for a future date.', v_err);

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, d1, s1, 'sick');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('B2 invalid status rejected', v_err = 'Invalid attendance status.', v_err);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins2, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, d1, s1, 'present');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  BEGIN
    INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES (s1, subj, d1, 'present');
    v_txt := 'inserted';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('B3 non-owner instructor rejected by record_attendance',
    v_err = 'Not allowed to record attendance for this subject.', v_err);
  v_out := v_out || pg_temp.chk('B4 non-owner direct insert still blocked by RLS', v_txt <> 'inserted', v_txt);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, d1, s1, 'present');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('B5 student cannot record attendance',
    v_err = 'Not allowed to record attendance for this subject.', v_err);

  SELECT count(*) INTO v_int FROM public.attendance WHERE subject_id = subj;
  v_out := v_out || pg_temp.chk('B6 rejected calls wrote nothing', v_int = 0, v_int::text);

  -- ---------------- C: first mark creates Present defaults for eligible students only ----------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ins, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.record_attendance(subj, d1, s1, 'absent');
  RESET ROLE;
  v_out := v_out || pg_temp.chk('C1 first mark returns the date''s rows (s1, s2, s6, s7)', v_int = 4, v_int::text);
  SELECT status INTO v_txt FROM public.attendance WHERE subject_id = subj AND date = d1 AND student_id = s1;
  v_out := v_out || pg_temp.chk('C2 clicked student gets the requested status', v_txt = 'absent', v_txt);
  SELECT count(*) INTO v_int FROM public.attendance
  WHERE subject_id = subj AND date = d1 AND student_id IN (s2, s6, s7) AND status = 'present' AND recorded_by = ins;
  v_out := v_out || pg_temp.chk('C3 eligible students defaulted to present', v_int = 3, v_int::text);
  SELECT count(*) INTO v_int FROM public.attendance WHERE subject_id = subj AND student_id IN (s3, s4, s5);
  v_out := v_out || pg_temp.chk('C4 no rows for later-enrolled, pending or unknown-date students', v_int = 0, v_int::text);

  -- ---------------- D: defaults never overwrite existing absent / late / excused ----------------
  INSERT INTO public.attendance (student_id, subject_id, date, status, recorded_by) VALUES
    (s2, subj, d2, 'absent', ins), (s6, subj, d2, 'late', ins), (s7, subj, d2, 'excused', ins);
  -- d2 already has rows, so this is not a first mark: only s1 is written.
  SET LOCAL ROLE authenticated;
  PERFORM public.record_attendance(subj, d2, s1, 'present');
  RESET ROLE;
  SELECT string_agg(status, ',' ORDER BY status) INTO v_txt FROM public.attendance
  WHERE subject_id = subj AND date = d2 AND student_id IN (s2, s6, s7);
  v_out := v_out || pg_temp.chk('D1 existing absent/late/excused kept', v_txt = 'absent,excused,late', v_txt);

  DELETE FROM public.attendance WHERE subject_id = subj AND date = d2 AND student_id = s1;
  DELETE FROM public.attendance WHERE subject_id = subj AND date = d2 AND student_id = s2;
  -- A partial pre-existing session (s6 late, s7 excused) followed by a mark on a date with rows.
  SET LOCAL ROLE authenticated;
  PERFORM public.record_attendance(subj, d2, s2, 'present');
  RESET ROLE;
  SELECT string_agg(student_id::text || ':' || status, ',') INTO v_txt FROM public.attendance
  WHERE subject_id = subj AND date = d2 AND student_id IN (s6, s7);
  v_out := v_out || pg_temp.chk('D2 late and excused untouched on a later mark',
    v_txt LIKE '%' || s6 || ':late%' AND v_txt LIKE '%' || s7 || ':excused%', v_txt);

  -- ---------------- E: idempotency and minimal writes ----------------
  SELECT ctid INTO v_ctid FROM public.attendance WHERE subject_id = subj AND date = d1 AND student_id = s1;
  SELECT ctid INTO v_ctid2 FROM public.attendance WHERE subject_id = subj AND date = d1 AND student_id = s2;
  SELECT count(*) INTO v_int FROM public.attendance WHERE subject_id = subj;
  SET LOCAL ROLE authenticated;
  PERFORM public.record_attendance(subj, d1, s1, 'absent');
  PERFORM public.record_attendance(subj, d1, s1, 'absent');
  RESET ROLE;
  SELECT count(*) INTO v_int2 FROM public.attendance WHERE subject_id = subj;
  v_out := v_out || pg_temp.chk('E1 repeated identical call adds no rows', v_int2 = v_int, v_int || ' -> ' || v_int2);
  v_out := v_out || pg_temp.chk('E2 repeated identical call does not rewrite the clicked row',
    (SELECT ctid FROM public.attendance WHERE subject_id = subj AND date = d1 AND student_id = s1) = v_ctid);

  SET LOCAL ROLE authenticated;
  PERFORM public.record_attendance(subj, d1, s1, 'late');
  RESET ROLE;
  SELECT status INTO v_txt FROM public.attendance WHERE subject_id = subj AND date = d1 AND student_id = s1;
  v_out := v_out || pg_temp.chk('E3 status change updates the clicked row', v_txt = 'late', v_txt);
  v_out := v_out || pg_temp.chk('E4 status change leaves other students'' rows untouched',
    (SELECT ctid FROM public.attendance WHERE subject_id = subj AND date = d1 AND student_id = s2) = v_ctid2);
  SELECT count(*) INTO v_int FROM public.attendance WHERE subject_id = subj AND date = d1;
  v_out := v_out || pg_temp.chk('E5 still one row per student for the date', v_int = 4, v_int::text);

  -- ---------------- F: enrollment checks for the clicked student ----------------
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, d1, s3, 'present');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('F1 student enrolled after the date rejected',
    v_err = 'Student was not yet enrolled on this date.', v_err);

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, d1, s5, 'present');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('F2 NULL enrolled_at is not assumed enrolled',
    v_err = 'Student enrollment date is unknown; attendance cannot be created for this date.', v_err);

  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_attendance(subj, d1, s4, 'present');
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('F3 non-active enrollment rejected',
    v_err = 'Student is not actively enrolled in this subject.', v_err);

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_int FROM public.record_attendance(subj, v_today, s3, 'present');
  RESET ROLE;
  SELECT count(*) INTO v_int2 FROM public.attendance WHERE subject_id = subj AND date = v_today AND student_id = s3;
  v_out := v_out || pg_temp.chk('F4 student enrolled today can be marked today', v_int2 = 1, v_int2::text);
  SELECT count(*) INTO v_int2 FROM public.attendance WHERE subject_id = subj AND date = v_today AND student_id IN (s4, s5);
  v_out := v_out || pg_temp.chk('F5 today''s defaults skip pending and unknown-date students', v_int2 = 0, v_int2::text);

  -- ---------------- U: uniqueness ----------------
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.attendance (student_id, subject_id, date, status, recorded_by) VALUES (s2, subj, d1, 'absent', ins);
    v_err := 'no error';
  EXCEPTION WHEN unique_violation THEN v_err := 'unique_violation';
            WHEN OTHERS THEN v_err := SQLERRM;
  END;
  RESET ROLE;
  v_out := v_out || pg_temp.chk('U1 duplicate (student, subject, date) rejected', v_err = 'unique_violation', v_err);

  -- ---------------- P: attendance percentage convention unchanged ----------------
  -- Scoped to d1/d2: F4 recorded a session for today, which defaulted s1 and s7 to present.
  -- s7: d1 present, d2 excused -> (present + late) / rows = 1 / 2 (excused stays in the denominator).
  SELECT round(100.0 * count(*) FILTER (WHERE status IN ('present', 'late')) / count(*), 2) INTO v_txt
  FROM public.attendance WHERE subject_id = subj AND student_id = s7 AND date IN (d1, d2);
  v_out := v_out || pg_temp.chk('P1 excused counts in denominator only (50.00)', v_txt = '50.00', v_txt);
  -- s1: d1 late, d2 deleted earlier -> 1 / 1.
  SELECT round(100.0 * count(*) FILTER (WHERE status IN ('present', 'late')) / count(*), 2) INTO v_txt
  FROM public.attendance WHERE subject_id = subj AND student_id = s1 AND date IN (d1, d2);
  v_out := v_out || pg_temp.chk('P2 late counts as attended (100.00)', v_txt = '100.00', v_txt);
  -- s7 including today's default Present: present, excused, present -> 2 / 3.
  SELECT round(100.0 * count(*) FILTER (WHERE status IN ('present', 'late')) / count(*), 2) INTO v_txt
  FROM public.attendance WHERE subject_id = subj AND student_id = s7;
  v_out := v_out || pg_temp.chk('P3 default Present rows count like any recorded present (66.67)', v_txt = '66.67', v_txt);

  -- ---------------- G: migration duplicate handling (copy of the migration's steps 1-3) ----------------
  BEGIN
    ALTER TABLE public.attendance DROP CONSTRAINT attendance_student_subject_date_key;
    INSERT INTO public.attendance (student_id, subject_id, date, status, created_at) VALUES
      (s1, subj, d3, 'present', now() - interval '2 seconds'),
      (s1, subj, d3, 'present', now() - interval '1 second'),
      (s2, subj, d3, 'present', now() - interval '2 seconds'),
      (s2, subj, d3, 'absent', now() - interval '1 second');
    SELECT id INTO v_keep FROM public.attendance
    WHERE subject_id = subj AND date = d3 AND student_id = s1 ORDER BY created_at LIMIT 1;

    BEGIN
      DECLARE v_conflicts int;
      BEGIN
        SELECT count(*) INTO v_conflicts FROM (
          SELECT 1 FROM public.attendance
          WHERE student_id IS NOT NULL AND subject_id IS NOT NULL
          GROUP BY student_id, subject_id, date
          HAVING count(DISTINCT status) > 1
        ) c;
        IF v_conflicts > 0 THEN
          RAISE EXCEPTION 'attendance_conflicting_duplicates: % (student, subject, date) group(s) have different statuses; resolve them manually before applying this migration', v_conflicts;
        END IF;
      END;
      v_err := 'no error';
    EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
    END;
    v_out := v_out || pg_temp.chk('G1 conflicting statuses abort the migration',
      v_err LIKE 'attendance_conflicting_duplicates: 1 %', v_err);

    DELETE FROM public.attendance WHERE subject_id = subj AND date = d3 AND student_id = s2 AND status = 'absent';
    DELETE FROM public.attendance a
    USING (
      SELECT id, row_number() OVER (PARTITION BY student_id, subject_id, date ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
      FROM public.attendance
      WHERE student_id IS NOT NULL AND subject_id IS NOT NULL
    ) d
    WHERE a.id = d.id AND d.rn > 1;
    SELECT count(*) INTO v_int FROM public.attendance WHERE subject_id = subj AND date = d3 AND student_id = s1;
    v_out := v_out || pg_temp.chk('G2 exact duplicates reduced to one row', v_int = 1, v_int::text);
    v_out := v_out || pg_temp.chk('G3 earliest duplicate kept',
      EXISTS (SELECT 1 FROM public.attendance WHERE id = v_keep));

    ALTER TABLE public.attendance
      ADD CONSTRAINT attendance_student_subject_date_key UNIQUE (student_id, subject_id, date);
    v_out := v_out || pg_temp.chk('G4 unique constraint re-applies after cleanup', true);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || pg_temp.chk('G duplicate-handling section', false, SQLERRM);
  END;

  RAISE EXCEPTION 'PHASE3A_RESULTS (rolled back):%', v_out;
END
$test$;
