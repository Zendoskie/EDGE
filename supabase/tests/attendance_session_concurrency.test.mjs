// Phase 3A concurrency tests for record_attendance: real interleavings across separate sessions.
//
// Run by a harness against a disposable local database with the schema snapshot and the
// 20261013120000 migration applied (20261013130000 optional). Never run on production: the function
// refuses unless the server is on loopback and its system identifier differs from production.
//
// `connect()` must return a new connected node-postgres Client logged in as a superuser. The marking
// sessions run as the owning instructor under `authenticated`, as the app does. Fixtures are
// committed (other sessions must see them) and removed in `finally`; the failure-injection trigger
// exists only for the duration of its case.
//
// Root cause under test: the first mark of a (subject, date) inserts Present defaults for every
// other eligible student, then the clicked student. Two first marks for different students X and Y
// each take the other's row before their own, so without serialization they deadlock (40P01).

export async function runAttendanceSessionConcurrencyTests({ connect, prodSystemId, rounds = 50, log = console.log }) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
  };

  const admin = await connect();
  const guard = (await admin.query(
    `SELECT (SELECT system_identifier::text FROM pg_control_system()) sysid, host(inet_server_addr()) addr`,
  )).rows[0];
  if (!prodSystemId || guard.sysid === prodSystemId || !['127.0.0.1', '::1'].includes(guard.addr)) {
    await admin.end();
    throw new Error(`Refusing to run: target is not a local disposable database (${JSON.stringify(guard)})`);
  }
  const has3B = (await admin.query(`SELECT to_regclass('public.final_grade_releases') IS NOT NULL b`)).rows[0].b;

  // Roster ids sorted and enrolled in that order, so X, Y and Z are the first three students the
  // default insert reaches whatever plan it uses (heap order and uuid order agree).
  const N = 12;
  const ids = (await admin.query(`SELECT array_agg(gen_random_uuid()::text) a FROM generate_series(1, $1)`, [N + 4])).rows[0].a;
  const [ins, ins2, S, S2] = ids.slice(0, 4);
  const roster = ids.slice(4).sort();
  const [X, Y, Z, W] = roster;
  const PENDING = (await admin.query('SELECT gen_random_uuid()::text u')).rows[0].u;
  const GATE_KEY = 7716230001;

  const sessions = [];
  const open = async (uid) => {
    const c = await connect();
    await c.query(`SET statement_timeout = '20s'`);
    c.pid = (await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    if (uid) {
      await c.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await c.query('SET ROLE authenticated');
    }
    sessions.push(c);
    return c;
  };
  const day = async (n) => (await admin.query(`SELECT ((now() AT TIME ZONE 'Asia/Manila')::date - $1::int)::text d`, [n])).rows[0].d;
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const rpcSql = (subj, date, sid, status) =>
    `SELECT count(*) FROM public.record_attendance(${lit(subj)}::uuid, ${lit(date)}::date, ${lit(sid)}::uuid, ${lit(status)})`;
  // One transaction per request, like a PostgREST RPC call. Errors roll the whole request back.
  const request = async (c, sql) => {
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('COMMIT');
      return 'ok';
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      return e.code ?? e.message;
    }
  };
  const waitFor = async (pid, timeoutMs = 5000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const r = (await admin.query(`SELECT wait_event_type t, wait_event e FROM pg_stat_activity WHERE pid = $1`, [pid])).rows[0];
      if (r?.t === 'Lock') return r.e;
      await new Promise((res) => setTimeout(res, 10));
    }
    return null;
  };
  const rowsFor = async (subj, date) => (await admin.query(
    `SELECT student_id::text sid, status FROM public.attendance WHERE subject_id = $1 AND date = $2::date`, [subj, date],
  )).rows;
  const statusOf = (rows, sid) => rows.find((r) => r.sid === sid)?.status;
  const unique = (rows) => new Set(rows.map((r) => r.sid)).size === rows.length;
  const fullRoster = (rows) => rows.length === N && unique(rows);

  let gate;
  let A;
  let B;
  try {
    // ---------------- committed fixtures ----------------
    await admin.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
       SELECT u.id, 'p3ac.' || u.id || '@test.invalid', jsonb_build_object('role', u.r), 'authenticated', 'authenticated'
       FROM unnest($1::uuid[], $2::text[]) u(id, r)`,
      [[ins, ins2, ...roster, PENDING], ['instructor', 'instructor', ...roster.map(() => 'student'), 'student']],
    );
    // Signup metadata never grants a staff role; staff roles come from a trusted path.
    await admin.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'instructor'), ($2, 'instructor') ON CONFLICT (user_id, role) DO NOTHING`, [ins, ins2]);
    await admin.query(`INSERT INTO public.subjects (id, name, code, instructor_id) VALUES ($1, 'P3AC Subject', 'P3AC-1', $3), ($2, 'P3AC Other', 'P3AC-2', $3)`, [S, S2, ins]);
    for (const subj of [S, S2]) {
      for (const sid of roster) {
        await admin.query(`INSERT INTO public.enrollments (student_id, subject_id, status, enrolled_at) VALUES ($1, $2, 'active', now() - interval '400 days')`, [sid, subj]);
      }
    }
    await admin.query(`INSERT INTO public.enrollments (student_id, subject_id, status, enrolled_at) VALUES ($1, $2, 'pending', now() - interval '400 days')`, [PENDING, S]);

    gate = await open(null);
    A = await open(ins);
    B = await open(ins);
    const other = await open(ins2);
    let n = 0;
    const freshDate = () => day(++n);

    // ---------------- K1: deterministic interleaving ----------------
    // A third session holds an uncommitted row for Z. Both first marks stop at Z after reaching each
    // other's clicked student; releasing Z then forces the lock-order inversion every time.
    {
      const d = await freshDate();
      await gate.query('BEGIN');
      await gate.query(`INSERT INTO public.attendance (student_id, subject_id, date, status) VALUES ($1, $2, $3::date, 'present')`, [Z, S, d]);
      const pa = request(A, rpcSql(S, d, X, 'absent'));
      const waitA = await waitFor(A.pid);
      const pb = request(B, rpcSql(S, d, Y, 'late'));
      const waitB = await waitFor(B.pid);
      await gate.query('ROLLBACK');
      const [ra, rb] = await Promise.all([pa, pb]);
      const rows = await rowsFor(S, d);
      log(`INFO K1 waits: A=${waitA} B=${waitB}; results A=${ra} B=${rb}`);
      check('K1 deterministic interleaving: both first marks for different students commit (no 40P01)', ra === 'ok' && rb === 'ok', `A=${ra} B=${rb}`);
      check('K1 both intended statuses committed (X absent, Y late), roster complete and unique',
        statusOf(rows, X) === 'absent' && statusOf(rows, Y) === 'late' && fullRoster(rows)
        && rows.filter((r) => r.sid !== X && r.sid !== Y).every((r) => r.status === 'present'), JSON.stringify(rows.length));
      check('K1 the second request waits on the session lock before touching any attendance row', waitB === 'advisory', `B waited on ${waitB}`);
    }

    // ---------------- K2: repeated simultaneous first marks behind a start barrier ----------------
    // Both requests block on a shared advisory gate inside their transaction and are released together;
    // the record_attendance call is in the same simple-query message, so no client round-trip separates them.
    const tally = {};
    const failures = [];
    for (let i = 0; i < rounds; i++) {
      const d = await freshDate();
      await gate.query('SELECT pg_advisory_lock($1::bigint)', [GATE_KEY]);
      const barrier = `SELECT pg_advisory_xact_lock_shared(${GATE_KEY}::bigint);`;
      const pa = request(A, `${barrier} ${rpcSql(S, d, X, 'absent')}`);
      const pb = request(B, `${barrier} ${rpcSql(S, d, Y, 'late')}`);
      const both = (await waitFor(A.pid)) === 'advisory' && (await waitFor(B.pid)) === 'advisory';
      await gate.query('SELECT pg_advisory_unlock($1::bigint)', [GATE_KEY]);
      const res = await Promise.all([pa, pb]);
      for (const r of res) tally[r] = (tally[r] ?? 0) + 1;
      const rows = await rowsFor(S, d);
      if (!both || res.some((r) => r !== 'ok') || statusOf(rows, X) !== 'absent' || statusOf(rows, Y) !== 'late' || !fullRoster(rows)) {
        failures.push({ i, both, res, rows: rows.length });
      }
    }
    log(`INFO K2 outcomes over ${rounds} rounds: ${JSON.stringify(tally)}`);
    check(`K2 ${rounds} barrier-released rounds: every request commits (no 40P01), both statuses saved, roster unique`,
      failures.length === 0 && tally.ok === 2 * rounds, JSON.stringify({ tally, firstFailures: failures.slice(0, 3) }));

    // ---------------- K3: same student twice ----------------
    {
      const d = await freshDate();
      await gate.query('SELECT pg_advisory_lock($1::bigint)', [GATE_KEY]);
      const barrier = `SELECT pg_advisory_xact_lock_shared(${GATE_KEY}::bigint);`;
      const pa = request(A, `${barrier} ${rpcSql(S, d, X, 'absent')}`);
      const pb = request(B, `${barrier} ${rpcSql(S, d, X, 'absent')}`);
      await waitFor(A.pid);
      await waitFor(B.pid);
      await gate.query('SELECT pg_advisory_unlock($1::bigint)', [GATE_KEY]);
      const res = await Promise.all([pa, pb]);
      const rows = await rowsFor(S, d);
      check('K3 simultaneous identical marks for the same student: both commit, one row each, X absent',
        res.every((r) => r === 'ok') && fullRoster(rows) && statusOf(rows, X) === 'absent', JSON.stringify(res));
    }

    // ---------------- K4: other subjects and dates are not serialized by the session lock ----------------
    {
      const d1 = await freshDate();
      const d2 = await freshDate();
      await A.query('BEGIN');
      await A.query(rpcSql(S, d1, X, 'absent'));
      const t0 = Date.now();
      const otherSubject = await request(B, rpcSql(S2, d1, X, 'absent'));
      const msSubject = Date.now() - t0;
      const pDate = request(B, rpcSql(S, d2, X, 'absent'));
      const dateFinished = await Promise.race([pDate.then(() => true), new Promise((res) => setTimeout(() => res(false), 1500))]);
      const dateWait = dateFinished ? null : (await admin.query(`SELECT wait_event e FROM pg_stat_activity WHERE pid = $1`, [B.pid])).rows[0]?.e;
      await A.query('COMMIT');
      const otherDate = await pDate;
      check('K4 same date, other subject: not blocked by an open first mark', otherSubject === 'ok' && msSubject < 1500, `${otherSubject} ${msSubject} ms`);
      // With 3B installed every attendance write in a subject also bumps that subject's version row,
      // which serializes by design; the session lock itself must never be the wait.
      check(`K4 same subject, other date: ${has3B ? 'never waits on the session lock (3B version row may serialize)' : 'not blocked'}`,
        otherDate === 'ok' && (has3B ? dateWait !== 'advisory' : dateFinished), `finished=${dateFinished} wait=${dateWait} ${otherDate}`);
    }

    // ---------------- K5: an initializer that arrives after an explicit mark keeps it ----------------
    {
      const d = await freshDate();
      await A.query('BEGIN');
      await A.query(rpcSql(S, d, X, 'absent'));
      const pb = request(B, rpcSql(S, d, Y, 'excused'));
      const waitB = await waitFor(B.pid);
      await A.query('COMMIT');
      const rb = await pb;
      const rows = await rowsFor(S, d);
      check('K5 second request waits, then keeps the committed explicit Absent and saves its own Excused',
        waitB === 'advisory' && rb === 'ok' && statusOf(rows, X) === 'absent' && statusOf(rows, Y) === 'excused' && fullRoster(rows),
        `wait=${waitB} ${rb}`);
    }

    // ---------------- K6: failure during initialization rolls back and releases the lock ----------------
    {
      const d = await freshDate();
      await admin.query(`CREATE FUNCTION public.p3ac_fail_on_student() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF NEW.student_id::text = current_setting('edge_test.fail_student', true) THEN
            RAISE EXCEPTION 'p3ac injected failure';
          END IF;
          RETURN NEW;
        END $f$`);
      await admin.query(`CREATE TRIGGER p3ac_fail BEFORE INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.p3ac_fail_on_student()`);
      try {
        await A.query('BEGIN');
        await A.query(`SELECT set_config('edge_test.fail_student', $1, true)`, [W]);
        const ra = await A.query(rpcSql(S, d, X, 'absent')).then(() => 'ok', (e) => e.message);
        // PostgreSQL aborts the transaction at the error (the client's ROLLBACK only ends the block),
        // so its locks, including the session lock, are already released here.
        const visibleWhileFailed = (await rowsFor(S, d)).length;
        const heldAfterError = (await admin.query(`SELECT count(*)::int n FROM pg_locks WHERE pid = $1 AND locktype = 'advisory'`, [A.pid])).rows[0].n;
        const rb = await request(B, rpcSql(S, d, Y, 'late'));
        await A.query('ROLLBACK');
        const rows = await rowsFor(S, d);
        check('K6 injected failure mid-initialization aborts the request; none of its rows exist',
          ra.includes('p3ac injected failure') && visibleWhileFailed === 0, `${ra} visible=${visibleWhileFailed}`);
        check('K6 the failed request holds no session lock; the next request initializes the full roster (X Present, not the failed Absent)',
          heldAfterError === 0 && rb === 'ok' && fullRoster(rows) && statusOf(rows, X) === 'present' && statusOf(rows, Y) === 'late' && statusOf(rows, W) === 'present',
          `held=${heldAfterError} ${rb} rows=${rows.length}`);
      } finally {
        await A.query('ROLLBACK').catch(() => {});
        await admin.query('DROP TRIGGER IF EXISTS p3ac_fail ON public.attendance');
        await admin.query('DROP FUNCTION IF EXISTS public.p3ac_fail_on_student()');
      }
    }

    // ---------------- K7: refused requests take no lock and write nothing ----------------
    {
      const d = await freshDate();
      const future = await day(-1);
      await A.query('BEGIN');
      await A.query(rpcSql(S, d, X, 'absent'));
      const refused = {};
      const timed = async (key, c, sql) => {
        const t0 = Date.now();
        const r = await Promise.race([request(c, sql), new Promise((res) => setTimeout(() => res('blocked'), 1500))]);
        refused[key] = { r, ms: Date.now() - t0 };
      };
      await timed('nonOwner', other, rpcSql(S, d, Y, 'late'));
      await timed('future', B, rpcSql(S, future, Y, 'late'));
      await timed('pending', B, rpcSql(S, d, PENDING, 'late'));
      await timed('badStatus', B, rpcSql(S, d, Y, 'sick'));
      await A.query('COMMIT');
      const rows = await rowsFor(S, d);
      const msgs = {
        nonOwner: await other.query(rpcSql(S, d, Y, 'late')).then(() => 'ok', (e) => e.message),
        future: await B.query(rpcSql(S, future, Y, 'late')).then(() => 'ok', (e) => e.message),
        pending: await B.query(rpcSql(S, d, PENDING, 'late')).then(() => 'ok', (e) => e.message),
      };
      check('K7 non-owner, future-date, pending-enrollment and invalid-status requests fail immediately, without waiting on the open session',
        Object.values(refused).every((x) => x.r !== 'ok' && x.r !== 'blocked'), JSON.stringify(refused));
      check('K7 their messages are the existing guard errors',
        msgs.nonOwner.includes('Not allowed to record attendance') && msgs.future.includes('future date') && msgs.pending.includes('not actively enrolled'),
        JSON.stringify(msgs));
      check('K7 refused requests wrote nothing (only the owner\'s roster exists, Y still Present)',
        fullRoster(rows) && statusOf(rows, Y) === 'present' && statusOf(rows, X) === 'absent', String(rows.length));
    }

    // ---------------- K8: unique constraint still the last line of defence ----------------
    {
      const dup = await admin.query(`INSERT INTO public.attendance (student_id, subject_id, date, status) SELECT student_id, subject_id, date, 'late'
        FROM public.attendance WHERE subject_id = $1 LIMIT 1`, [S]).then(() => 'inserted', (e) => `${e.code} ${e.constraint ?? ''}`.trim());
      const groups = (await admin.query(`SELECT count(*)::int n FROM (SELECT 1 FROM public.attendance WHERE subject_id = ANY($1::uuid[])
        GROUP BY student_id, subject_id, date HAVING count(*) > 1) g`, [[S, S2]])).rows[0].n;
      check('K8 direct duplicate insert still fails on attendance_student_subject_date_key; 0 duplicate groups overall',
        dup === '23505 attendance_student_subject_date_key' && groups === 0, `${dup} groups=${groups}`);
    }
  } finally {
    for (const c of sessions) {
      await c.query('ROLLBACK').catch(() => {});
      await c.end().catch(() => {});
    }
    await admin.query('DROP TRIGGER IF EXISTS p3ac_fail ON public.attendance').catch(() => {});
    await admin.query('DROP FUNCTION IF EXISTS public.p3ac_fail_on_student()').catch(() => {});
    await admin.query('DELETE FROM public.subjects WHERE id = ANY($1::uuid[])', [[S, S2]]).catch(() => {});
    await admin.query(`DELETE FROM auth.users WHERE email LIKE 'p3ac.%'`).catch(() => {});
    const left = (await admin.query(
      `SELECT (SELECT count(*) FROM auth.users WHERE email LIKE 'p3ac.%')::int + (SELECT count(*) FROM public.subjects WHERE id = ANY($1::uuid[]))::int
        + (SELECT count(*) FROM pg_trigger WHERE tgname = 'p3ac_fail')::int n`,
      [[S, S2]],
    )).rows[0].n;
    check('CLEANUP attendance concurrency fixtures removed', left === 0, String(left));
    await admin.end();
  }
  return results;
}
