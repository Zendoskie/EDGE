import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const subjectDetail = read('src/pages/dashboard/SubjectDetail.tsx');
const attendanceTab = subjectDetail.slice(
  subjectDetail.indexOf('function SubjectAttendance('),
  subjectDetail.indexOf('/* ───── Activities Tab'),
);
const migrationFile = readdirSync(resolve(root, 'supabase/migrations')).find((f) =>
  f.endsWith('_attendance_session_defaults.sql'),
);
const migration = migrationFile ? read(`supabase/migrations/${migrationFile}`) : '';
const fn = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.record_attendance'));

describe('SubjectAttendance client path', () => {
  it('writes attendance only through the record_attendance RPC', () => {
    expect(attendanceTab.length).toBeGreaterThan(1000);
    expect(attendanceTab).toContain("supabase.rpc('record_attendance'");
    expect(attendanceTab).not.toMatch(/from\(['"]attendance['"]\)\s*\.(insert|update|upsert|delete)\(/);
    expect(attendanceTab).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it('no client code writes the attendance table directly', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/from\(['"]attendance['"]\)\s*\.(insert|update|upsert|delete)\(/.test(read(rel))) offenders.push(rel);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });

  it('defaults to the Manila date and blocks future dates', () => {
    expect(attendanceTab).toContain('useState(() => manilaToday())');
    expect(attendanceTab).toContain('max={today}');
    expect(attendanceTab).toContain('clampAttendanceDate(e.target.value, today)');
    expect(attendanceTab).not.toContain("toISOString().split('T')[0]");
  });

  it('updates caches from the RPC result instead of refetching', () => {
    expect(attendanceTab).toContain("setQueryData(['attendance', subjectId, markedDate], rows)");
    expect(attendanceTab).toContain("['attendance-history', subjectId], (old)");
    expect(attendanceTab).not.toContain('refetchAttendance');
    expect(attendanceTab).not.toContain("invalidateQueries({ queryKey: ['attendance-history'");
  });

  it('coalesces risk recalculation and flushes it on unmount', () => {
    expect(attendanceTab).toContain('scheduleSubjectRiskRecalc(subjectId');
    expect(attendanceTab).toContain('useEffect(() => () => flushSubjectRiskRecalc(subjectId), [subjectId])');
    expect(attendanceTab).not.toContain('recalculateSubjectRisk(');
  });

  it('keeps the four attendance statuses', () => {
    expect(attendanceTab).toContain("['present', 'absent', 'late', 'excused']");
  });
});

describe('attendance session migration', () => {
  it('exists', () => {
    expect(migrationFile).toBeTruthy();
  });

  it('aborts on conflicting duplicates before deleting exact ones, then adds the constraint', () => {
    const abort = migration.indexOf('HAVING count(DISTINCT status) > 1');
    const raise = migration.indexOf("RAISE EXCEPTION 'attendance_conflicting_duplicates");
    const del = migration.indexOf('DELETE FROM public.attendance');
    const constraint = migration.indexOf('UNIQUE (student_id, subject_id, date)');
    expect(abort).toBeGreaterThan(-1);
    expect(raise).toBeGreaterThan(abort);
    expect(del).toBeGreaterThan(raise);
    expect(constraint).toBeGreaterThan(del);
    expect(migration).toMatch(/ORDER BY created_at ASC NULLS LAST, id ASC/);
    expect(migration).toMatch(/d\.rn > 1/);
  });

  it('record_attendance is SECURITY INVOKER with an empty search_path, executable only by authenticated', () => {
    expect(fn).toContain('SECURITY INVOKER');
    expect(fn).not.toContain('SECURITY DEFINER');
    expect(fn).toContain("SET search_path = ''");
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.record_attendance(uuid, date, uuid, text) FROM PUBLIC, anon, service_role;',
    );
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.record_attendance(uuid, date, uuid, text) TO authenticated;');
    expect(migration.match(/GRANT /g)).toHaveLength(1);
  });

  it('rejects future Manila dates and checks enrollment before writing', () => {
    expect(fn).toContain("(now() AT TIME ZONE 'Asia/Manila')::date");
    expect(fn).toMatch(/IF p_date > v_today THEN/);
    expect(fn).toContain("e.status = 'active'");
    expect(fn).toContain("(v_enrolled_at AT TIME ZONE 'Asia/Manila')::date > p_date");
    expect(fn).toContain('v_enrolled_at IS NULL');
    expect(fn.indexOf('p_date > v_today')).toBeLessThan(fn.indexOf('INSERT INTO public.attendance'));
    expect(fn.indexOf("e.status = 'active'")).toBeLessThan(fn.indexOf('INSERT INTO public.attendance'));
  });

  it('defaults only on the first mark, never overwrites, and skips unchanged updates', () => {
    expect(fn).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM public\.attendance a\s*WHERE a\.subject_id = p_subject_id AND a\.date = p_date\s*\) THEN/);
    expect(fn).toContain('ON CONFLICT (student_id, subject_id, date) DO NOTHING');
    expect(fn).toContain('AND e.enrolled_at IS NOT NULL');
    expect(fn).toContain("(e.enrolled_at AT TIME ZONE 'Asia/Manila')::date <= p_date");
    expect(fn).toContain('WHERE a.status IS DISTINCT FROM EXCLUDED.status');
  });

  it('adds no session table, trigger or policy change', () => {
    expect(migration).not.toMatch(/CREATE TABLE|CREATE TRIGGER|CREATE POLICY|ALTER POLICY|DROP POLICY/i);
  });
});

describe('attendance percentage convention', () => {
  const attended = /status === ["']present["'] \|\| \w+\.status === ["']late["']/;

  it('predict-risk divides present + late by all recorded rows', () => {
    const src = read('supabase/functions/predict-risk/index.ts');
    expect(src).toMatch(attended);
    expect(src).toContain('const totalClasses = studentAttendance.length;');
    expect(src).toContain('presentCount / totalClasses');
  });

  it('MyScores uses the same formula', () => {
    const src = read('src/pages/dashboard/MyScores.tsx');
    expect(src).toMatch(attended);
    expect(src).toContain('/ attendanceRecords.length) * 100');
  });
});

describe('student attendance realtime notification', () => {
  const src = read('src/hooks/useEdgeRealtimeNotifications.ts');

  it('only receives the signed-in student\'s attendance rows', () => {
    const block = src.slice(src.indexOf('table: "attendance"'), src.indexOf('table: "attendance"') + 120);
    expect(block).toContain('filter: `student_id=eq.${userId}`');
  });

  it('reuses one instructor-name lookup per session and keeps the notification text and key', () => {
    expect(src).toContain('createProfileSourceCache("Course Instructor")');
    expect(src).toContain('await instructorSource(row.recorded_by)');
    expect(src).not.toContain('resolveProfileSource(');
    expect(src).toContain('title: "Attendance updated"');
    expect(src).toContain('dedupeKey: `att:${id}:${date}:${status}`');
  });
});
