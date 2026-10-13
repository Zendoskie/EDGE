// Phase 3B concurrency tests: real interleavings across separate PostgreSQL sessions.
//
// Run by a harness against a disposable local database that has the schema snapshot and both the
// 20261013120000 and 20261013130000 migrations applied. Never run on production: the function
// refuses unless the server is on loopback and its system identifier differs from production.
//
// `connect()` must return a new connected node-postgres Client logged in as a superuser (needed for
// pg_control_system() and SET ROLE). The release sessions run as service_role and the edit session
// as the owning instructor under `authenticated`, the same roles the Edge Function and the app use.
// Fixtures are committed (other sessions must see them) and removed in `finally`.
//
// A release payload's grade is arbitrary: the property under test is that a payload computed
// before a concurrent input change can never end up stored as `released`.

export async function runFinalGradeReleaseConcurrencyTests({ connect, prodSystemId, log = console.log }) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
  };
  const info = (msg) => log(`INFO ${msg}`);

  const admin = await connect();
  const guard = (await admin.query(
    `SELECT (SELECT system_identifier::text FROM pg_control_system()) sysid, host(inet_server_addr()) addr`,
  )).rows[0];
  if (!prodSystemId || guard.sysid === prodSystemId || !['127.0.0.1', '::1'].includes(guard.addr)) {
    await admin.end();
    throw new Error(`Refusing to run: target is not a local disposable database (${JSON.stringify(guard)})`);
  }

  const ids = (await admin.query(`SELECT gen_random_uuid() ins, gen_random_uuid() x, gen_random_uuid() y,
      gen_random_uuid() s, gen_random_uuid() s2`)).rows[0];
  const { ins, x: X, y: Y, s: S, s2: S2 } = ids;
  const W_DEF = { activity_weight: 25, project_weight: 25, attendance_weight: 15, exam_weight: 35 };
  const W_ALT = { activity_weight: 40, project_weight: 20, attendance_weight: 10, exam_weight: 30 };

  const sessions = [];
  const open = async (setup) => {
    const c = await connect();
    await c.query(`SET statement_timeout = '20s'`);
    c.pid = (await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    if (setup) await setup(c);
    sessions.push(c);
    return c;
  };

  let act;
  let d0;
  try {
    // ---------------- committed fixtures ----------------
    await admin.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
       SELECT u.id, 'p3bc.' || u.id || '@test.invalid', jsonb_build_object('full_name', u.n, 'role', u.r), 'authenticated', 'authenticated'
       FROM (VALUES ($1::uuid, 'P3BC Instructor', 'instructor'), ($2::uuid, 'P3BC X', 'student'), ($3::uuid, 'P3BC Y', 'student')) u(id, n, r)`,
      [ins, X, Y],
    );
    // Signup metadata never grants a staff role; staff roles come from a trusted path.
    await admin.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'instructor') ON CONFLICT (user_id, role) DO NOTHING`, [ins]);
    await admin.query(
      `INSERT INTO public.subjects (id, name, code, instructor_id) VALUES ($1, 'P3BC Subject', 'P3BC-1', $3), ($2, 'P3BC Other', 'P3BC-2', $3)`,
      [S, S2, ins],
    );
    await admin.query(
      `INSERT INTO public.enrollments (student_id, subject_id, status, enrolled_at)
       SELECT st, sub, 'active', now() - interval '30 days' FROM unnest($1::uuid[]) st CROSS JOIN unnest($2::uuid[]) sub`,
      [[X, Y], [S, S2]],
    );
    const acts = (await admin.query(
      `INSERT INTO public.activities (subject_id, title, type, max_score)
       VALUES ($1, 'Act', 'activity', 100), ($1, 'Proj', 'project', 100), ($1, 'Mid', 'midterm_exam', 100),
              ($1, 'Fin', 'final_exam', 100), ($2, 'Other act', 'activity', 100)
       RETURNING id, subject_id, type`,
      [S, S2],
    )).rows;
    act = acts.find((a) => a.subject_id === S && a.type === 'activity').id;
    const otherAct = acts.find((a) => a.subject_id === S2).id;
    await admin.query(
      `INSERT INTO public.submissions (activity_id, student_id, score, assessment_type)
       SELECT a.id, st, 80, a.type FROM public.activities a CROSS JOIN unnest($2::uuid[]) st WHERE a.subject_id = ANY($1::uuid[])`,
      [[S, S2], [X, Y]],
    );
    d0 = (await admin.query(`SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - 5)::text d`)).rows[0].d;
    await admin.query(
      `INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES ($1, $3, $4, 'present'), ($2, $3, $4, 'present')`,
      [X, Y, S, d0],
    );
    await admin.query(
      `INSERT INTO public.subject_grading_systems (subject_id, activity_weight, project_weight, attendance_weight, exam_weight, created_by)
       VALUES ($1, 25, 25, 15, 35, $2)`,
      [S, ins],
    );

    // ---------------- sessions ----------------
    const asService = async (c) => c.query('SET ROLE service_role');
    const relA = await open(asService);
    const relB = await open(asService);
    const edit = await open(async (c) => {
      await c.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: ins, role: 'authenticated' })]);
      await c.query('SET ROLE authenticated');
    });

    const readVersion = async (c) =>
      Number((await c.query(
        `SELECT COALESCE((SELECT version FROM public.final_grade_input_versions WHERE subject_id = $1), 0) v`,
        [S],
      )).rows[0].v);
    const commit = async (c, version, rows) =>
      (await c.query(`SELECT public.commit_final_grade_releases($1, $2, $3, $4::jsonb) r`, [S, version, ins, JSON.stringify(rows)]))
        .rows[0].r;
    const payload = (gx, gy, weights = W_DEF) => [
      { student_id: X, final_grade: gx, weights },
      { student_id: Y, final_grade: gy, weights },
    ];
    const state = async () => {
      const rows = (await admin.query(
        `SELECT student_id::text, status, final_grade::text grade, review_reason FROM public.final_grade_releases WHERE subject_id = $1`,
        [S],
      )).rows;
      return Object.fromEntries(rows.map((r) => [r.student_id, r]));
    };
    const fmt = (st) => JSON.stringify(Object.fromEntries(Object.entries(st).map(([k, v]) => [k === X ? 'X' : 'Y', `${v.status}:${v.grade}:${v.review_reason ?? ''}`])));
    const reset = async () => admin.query('DELETE FROM public.final_grade_releases WHERE subject_id = $1', [S]);
    const waitForLock = async (pid, timeoutMs = 5000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const r = (await admin.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid])).rows[0];
        if (r?.wait_event_type === 'Lock') return true;
        await new Promise((res) => setTimeout(res, 25));
      }
      return false;
    };
    // Issued together: a session blocked behind another only finishes once that one rolls back.
    const settle = () => Promise.all([relA, relB, edit].map((c) => c.query('ROLLBACK').catch(() => {})));
    // A blocked statement may reject after its case has already failed; never leave it unhandled.
    const track = (p) => {
      p.catch(() => {});
      return p;
    };

    let scoreBump = 0;
    let attendanceStatus = 'present';
    const nextAttendance = () => (attendanceStatus = attendanceStatus === 'absent' ? 'late' : 'absent');
    let weightsNow = W_DEF;
    const edits = {
      score: () => edit.query('UPDATE public.submissions SET score = $3 WHERE activity_id = $1 AND student_id = $2', [act, X, 50 + (++scoreBump % 40)]),
      attendance: () => edit.query('SELECT count(*) FROM public.record_attendance($1, $2::date, $3, $4)', [S, d0, X, nextAttendance()]),
      weights: () => {
        weightsNow = weightsNow === W_DEF ? W_ALT : W_DEF;
        return edit.query(
          'UPDATE public.subject_grading_systems SET activity_weight = $2, project_weight = $3, attendance_weight = $4, exam_weight = $5 WHERE subject_id = $1',
          [S, weightsNow.activity_weight, weightsNow.project_weight, weightsNow.attendance_weight, weightsNow.exam_weight],
        );
      },
      activityInsert: () => edit.query(`INSERT INTO public.activities (subject_id, title, type, max_score) VALUES ($1, 'Late quiz', 'quiz', 10)`, [S]),
      activityDelete: () => edit.query(`DELETE FROM public.activities WHERE subject_id = $1 AND title = 'Doomed'`, [S]),
    };
    const prepare = {
      activityDelete: () => admin.query(`INSERT INTO public.activities (subject_id, title, type, max_score) VALUES ($1, 'Doomed', 'quiz', 10)`, [S]),
    };
    const wholeSubject = { weights: true, activityInsert: true, activityDelete: true };

    const runCase = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        check(name, false, `threw: ${e.message}`);
      } finally {
        await settle();
      }
    };

    // ---------------- C0: one bump per committed transaction ----------------
    await runCase('C0 version bumps once per committed transaction', async () => {
      const v0 = await readVersion(relA);
      await edits.score();
      const v1 = await readVersion(relA);
      await edit.query('BEGIN');
      await edits.score();
      await edits.attendance();
      await edit.query('COMMIT');
      const v2 = await readVersion(relA);
      await edit.query('BEGIN');
      await edits.score();
      await edit.query('ROLLBACK');
      const v3 = await readVersion(relA);
      check('C0 version bumps once per committed transaction (autocommit +1, two-statement tx +1, rollback +0)',
        v1 === v0 + 1 && v2 === v1 + 1 && v3 === v2, `${v0},${v1},${v2},${v3}`);
    });

    // ---------------- per source: edit committed before / open during / started after the commit ----------------
    const sources = ['score', 'attendance', 'weights', 'activityInsert', 'activityDelete'];
    for (const src of sources) {
      await runCase(`C1 ${src}: edit committed between read and commit`, async () => {
        await reset();
        if (prepare[src]) await prepare[src]();
        const v = await readVersion(relA);
        await edits[src]();
        const r = await commit(relA, v, payload(88, 77, weightsNow));
        const st = await state();
        check(`C1 ${src}: edit committed between version read and commit -> stale, nothing written`,
          r.committed === false && r.written === 0 && Object.keys(st).length === 0, JSON.stringify(r) + fmt(st));
      });

      await runCase(`C2 ${src}: edit open while the commit runs`, async () => {
        await reset();
        if (prepare[src]) await prepare[src]();
        const v = await readVersion(relA);
        await edit.query('BEGIN');
        await edits[src]();
        const pending = track(commit(relA, v, payload(88, 77, weightsNow)));
        const waited = await waitForLock(relA.pid);
        await edit.query('COMMIT');
        const r = await pending;
        const st = await state();
        check(`C2 ${src}: commit waits for the open edit, then is rejected`,
          waited && r.committed === false && Object.keys(st).length === 0, `waited=${waited} ${JSON.stringify(r)}${fmt(st)}`);
      });

      await runCase(`C4 ${src}: edit starts while the commit holds the lock (new rows)`, async () => {
        await reset();
        if (prepare[src]) await prepare[src]();
        const v = await readVersion(relA);
        const releasedWeights = weightsNow;
        await relA.query('BEGIN');
        const r = await commit(relA, v, payload(88, 77, releasedWeights));
        const pending = track(edits[src]());
        const waited = await waitForLock(edit.pid);
        await relA.query('COMMIT');
        await pending;
        const st = await state();
        const yOk = wholeSubject[src] ? st[Y]?.status === 'needs_review' : st[Y]?.status === 'released';
        check(`C4 ${src}: new rows committed first are flagged needs_review by the waiting edit`,
          r.committed === true && r.written === 2 && waited && st[X]?.status === 'needs_review' && st[X]?.grade === null && yOk,
          `waited=${waited} ${JSON.stringify(r)} ${fmt(st)}`);
      });

      await runCase(`C5 ${src}: edit starts while the commit updates existing rows`, async () => {
        await reset();
        if (prepare[src]) await prepare[src]();
        const r0 = await commit(relA, await readVersion(relA), payload(60, 60, weightsNow));
        const v = await readVersion(relA);
        await relA.query('BEGIN');
        const r = await commit(relA, v, payload(88, 77, weightsNow));
        const pending = track(edits[src]());
        const waited = await waitForLock(edit.pid);
        await relA.query('COMMIT');
        await pending;
        const st = await state();
        check(`C5 ${src}: existing rows re-released first are flagged needs_review by the waiting edit`,
          r0.committed && r.committed === true && r.written === 2 && waited && st[X]?.status === 'needs_review' && st[X]?.grade === null,
          `waited=${waited} ${JSON.stringify(r)} ${fmt(st)}`);
      });
    }

    await runCase('C3 edit rolled back', async () => {
      await reset();
      const v = await readVersion(relA);
      await edit.query('BEGIN');
      await edits.score();
      const pending = track(commit(relA, v, payload(88, 77, weightsNow)));
      const waited = await waitForLock(relA.pid);
      await edit.query('ROLLBACK');
      const r = await pending;
      const st = await state();
      check('C3 edit rolled back: the waiting commit succeeds with unchanged inputs',
        waited && r.committed === true && r.written === 2 && st[X]?.status === 'released' && st[X]?.grade === '88.00',
        `waited=${waited} ${JSON.stringify(r)} ${fmt(st)}`);
    });

    // ---------------- overlapping releases ----------------
    await runCase('C10 overlapping releases, same version', async () => {
      await reset();
      const vA = await readVersion(relA);
      const vB = await readVersion(relB);
      await relA.query('BEGIN');
      const rA = await commit(relA, vA, payload(88, 77, weightsNow));
      const pendingB = track(commit(relB, vB, payload(88, 77, weightsNow)));
      const waited = await waitForLock(relB.pid);
      await relA.query('COMMIT');
      const rB = await pendingB;
      const st = await state();
      check('C10 overlapping releases with the same version serialise; the second writes 0 rows',
        vA === vB && rA.committed && rA.written === 2 && waited && rB.committed && rB.written === 0 && st[X]?.grade === '88.00',
        `waited=${waited} A=${JSON.stringify(rA)} B=${JSON.stringify(rB)} ${fmt(st)}`);
    });

    await runCase('C11 overlapping releases with an edit between their reads', async () => {
      await reset();
      const vA = await readVersion(relA);
      await edits.score();
      const vB = await readVersion(relB);
      const rA = await commit(relA, vA, payload(88, 77, weightsNow));
      const rB = await commit(relB, vB, payload(90, 77, weightsNow));
      const st = await state();
      check('C11 the release that read before the edit is rejected; the later one commits',
        vB === vA + 1 && rA.committed === false && rB.committed === true && st[X]?.status === 'released' && st[X]?.grade === '90.00',
        `A=${JSON.stringify(rA)} B=${JSON.stringify(rB)} ${fmt(st)}`);
    });

    await runCase('C12 lock is per subject', async () => {
      await reset();
      const v = await readVersion(relA);
      await relA.query('BEGIN');
      await commit(relA, v, payload(88, 77, weightsNow));
      const t0 = Date.now();
      const done = edit.query('UPDATE public.submissions SET score = score + 1 WHERE activity_id = $1 AND student_id = $2', [otherAct, X])
        .then(() => true);
      const finished = await Promise.race([done, new Promise((res) => setTimeout(() => res(false), 3000))]);
      const ms = Date.now() - t0;
      await relA.query('COMMIT');
      await done.catch(() => {});
      check('C12 an edit in another subject is not blocked by a commit holding this subject\'s lock', finished === true, `${ms} ms`);
    });

    // ---------------- local timing (informational, not production numbers) ----------------
    await runCase('T timing', async () => {
      const n = 30;
      let t = Date.now();
      for (let i = 0; i < n; i++) await edits.score();
      const editMs = (Date.now() - t) / n;
      t = Date.now();
      for (let i = 0; i < n; i++) {
        await reset();
        await commit(relA, await readVersion(relA), payload(80 + (i % 10), 77, weightsNow));
      }
      const commitMs = (Date.now() - t) / n;
      info(`local averages over ${n} runs: single-score edit incl. triggers ${editMs.toFixed(2)} ms; version read + commit of 2 rows ${commitMs.toFixed(2)} ms (includes a reset DELETE)`);
    });
  } finally {
    for (const c of sessions) {
      await c.query('ROLLBACK').catch(() => {});
      await c.end().catch(() => {});
    }
    await admin.query('DELETE FROM public.subjects WHERE id = ANY($1::uuid[])', [[S, S2]]).catch(() => {});
    await admin.query(`DELETE FROM auth.users WHERE email LIKE 'p3bc.%'`).catch(() => {});
    const left = (await admin.query(
      `SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'p3bc.%')::int + (SELECT count(*) FROM public.subjects WHERE id = ANY($1::uuid[]))::int n`,
      [[S, S2]],
    )).rows[0].n;
    check('CLEANUP concurrency fixtures removed', left === 0, String(left));
    await admin.end();
  }
  return results;
}
