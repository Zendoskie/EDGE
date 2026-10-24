import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles().map((path) => ({
  rel: relative(SRC, path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));
const read = (rel: string) => files.find((f) => f.rel === rel)!.text;
const count = (pattern: RegExp) => files.reduce((n, f) => n + (f.text.match(pattern)?.length ?? 0), 0);

describe('Phase 3C load and security guards', () => {
  it('refetchInterval is used only by the approved release hook and the four existing 180 s views', () => {
    expect(files.filter((f) => f.text.includes('refetchInterval')).map((f) => f.rel).sort()).toEqual([
      'hooks/useAdminEngagementAnalytics.ts',
      'hooks/useEngagementAlerts.ts',
      'hooks/useFinalGradeReleases.ts',
      'pages/dashboard/GuidanceEngagement.tsx',
      'pages/dashboard/StudentEngagementMonitoring.tsx',
    ]);
    const hook = read('hooks/useFinalGradeReleases.ts');
    expect(hook.match(/refetchInterval: 180_000/g)).toHaveLength(1);
    expect(hook).toContain('refetchIntervalInBackground: false');
    expect(hook).toContain("refetchOnWindowFocus: 'always'");
    expect(hook.match(/\.\.\.RELEASE_QUERY_FRESHNESS/g)).toHaveLength(2);
  });

  it('adds no Realtime channel, binding or timer', () => {
    expect(count(/\.channel\(/g)).toBe(6);
    expect(count(/postgres_changes/g)).toBe(13);
    expect(count(/setInterval\(/g)).toBe(8);
    expect(files.some((f) => /final_grade_releases/.test(f.text) && /\.channel\(/.test(f.text))).toBe(false);
  });

  it('App query defaults are unchanged', () => {
    const app = read('App.tsx');
    expect(app).toContain('staleTime: 60_000');
    expect(app).toContain('refetchOnWindowFocus: false');
    expect(app).toContain('retry: 1');
  });

  it('the client only reads final_grade_releases, from the release hook', () => {
    const readers = files.filter((f) => /from\(\s*['"]final_grade_releases['"]\s*\)/.test(f.text)).map((f) => f.rel);
    expect(readers).toEqual(['hooks/useFinalGradeReleases.ts']);
    const hook = read('hooks/useFinalGradeReleases.ts');
    expect(hook).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(files.filter((f) => /rpc\(\s*['"](commit_final_grade_releases|final_grade_inputs_changed)/.test(f.text))).toHaveLength(0);
  });

  it('release-final-grades is called from one place; the UI reuses the shared completeness and grade helpers', () => {
    expect(files.filter((f) => f.text.includes("'release-final-grades'")).map((f) => f.rel)).toEqual([
      'lib/invoke-release-final-grades.ts',
    ]);
    const gradebook = read('components/GradebookTable.tsx');
    expect(gradebook).toContain("from '../../supabase/functions/_shared/final-grade-release.ts'");
    expect(gradebook).toContain('evaluateGradeCompleteness(');
    expect(gradebook).toContain('computeReleaseGrade(');
    expect(files.filter((f) => /function evaluateGradeCompleteness|function computeReleaseGrade/.test(f.text))).toHaveLength(0);
  });

  it('the attendance save keeps its cache writes and refreshes the subject release query', () => {
    const detail = read('pages/dashboard/SubjectDetail.tsx');
    const start = detail.indexOf('const markAttendance = useMutation(');
    const slice = detail.slice(start, detail.indexOf('onError', start));
    expect(slice).toContain("queryClient.setQueryData(['attendance', subjectId, markedDate], rows)");
    expect(slice).toContain("queryClient.setQueryData<typeof attendanceHistory>(['attendance-history', subjectId]");
    expect(slice).toContain('queryClient.invalidateQueries({ queryKey: subjectReleaseKey(subjectId) })');
  });

  it('student and parent pages label grades through FinalGradeBadge with one release query each', () => {
    for (const rel of ['pages/dashboard/MyScores.tsx', 'pages/dashboard/ParentPerformance.tsx']) {
      const page = read(rel);
      expect(page.match(/useStudentFinalGradeReleases\(/g)).toHaveLength(1);
      expect(page).toContain('<FinalGradeBadge');
      expect(page).not.toMatch(/Official weighted|Final grade:/);
    }
  });
});
