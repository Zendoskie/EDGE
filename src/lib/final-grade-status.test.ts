import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { finalGradeStatus, missingItemLabel, reviewReasonLabel } from '@/lib/final-grade-status';
import {
  invalidateStudentReleases,
  isReleaseRelevantInboxTitle,
  isReleaseRelevantRealtime,
  studentReleaseKey,
  subjectReleaseKey,
} from '@/lib/final-grade-freshness';
import { RELEASE_CONFLICT_FALLBACK, invokeReleaseFinalGrades } from '@/lib/invoke-release-final-grades';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

describe('finalGradeStatus', () => {
  it('no row is Provisional', () => {
    expect(finalGradeStatus(null)).toEqual({ kind: 'provisional' });
    expect(finalGradeStatus(undefined)).toEqual({ kind: 'provisional' });
  });

  it('Final only for a released row with a grade between 0 and 100', () => {
    expect(finalGradeStatus({ status: 'released', final_grade: 88.5 })).toEqual({ kind: 'final', grade: 88.5 });
    expect(finalGradeStatus({ status: 'released', final_grade: '0' })).toEqual({ kind: 'final', grade: 0 });
    expect(finalGradeStatus({ status: 'released', final_grade: 100 })).toEqual({ kind: 'final', grade: 100 });
  });

  it('needs_review, an invalid grade or an unknown status is Under review, never Final', () => {
    for (const row of [
      { status: 'needs_review', final_grade: null },
      { status: 'needs_review', final_grade: 88.5 },
      { status: 'released', final_grade: null },
      { status: 'released', final_grade: '' },
      { status: 'released', final_grade: 'abc' },
      { status: 'released', final_grade: 100.01 },
      { status: 'released', final_grade: -1 },
      { status: 'draft', final_grade: 90 },
      { status: null, final_grade: 90 },
    ]) {
      expect(finalGradeStatus(row)).toEqual({ kind: 'under_review' });
    }
  });
});

describe('labels', () => {
  it('maps every backend review reason and falls back for unknown ones', () => {
    expect(reviewReasonLabel('score_changed')).toBe('A score changed');
    expect(reviewReasonLabel('weights_changed')).toBe('Grading weights changed');
    expect(reviewReasonLabel('attendance_changed')).toBe('Attendance changed');
    expect(reviewReasonLabel(null)).toBe('Grading inputs changed');
    expect(reviewReasonLabel('something_new')).toBe('Grading inputs changed');
  });

  it('describes each missing item kind', () => {
    expect(missingItemLabel({ kind: 'category_empty', category: 'exam_final' })).toBe('No Final Exam assessment yet');
    expect(
      missingItemLabel({ kind: 'assessment_unscored', category: 'activity', activity_id: 'a', title: 'Quiz 2', type: 'quiz', reason: 'null_score' }),
    ).toBe('Quiz 2 (Quiz): no score');
    expect(
      missingItemLabel({ kind: 'assessment_unscored', category: 'activity', activity_id: 'a', title: 'Lab', type: 'activity', reason: 'invalid_max_score' }),
    ).toBe('Lab: invalid max score');
    expect(missingItemLabel({ kind: 'attendance_missing' })).toBe('No attendance recorded');
    expect(missingItemLabel({ kind: 'attendance_all_excused' })).toBe('All attendance is excused');
  });
});

describe('release-status freshness signals', () => {
  it('keys are per student and per subject under one prefix', () => {
    expect(studentReleaseKey('u1')).toEqual(['final-grade-releases', 'student', 'u1']);
    expect(subjectReleaseKey('s1')).toEqual(['final-grade-releases', 'subject', 's1']);
  });

  it('only attendance and prediction writes count as relevant Realtime events', () => {
    expect(isReleaseRelevantRealtime('attendance', 'INSERT')).toBe(true);
    expect(isReleaseRelevantRealtime('attendance', 'UPDATE')).toBe(true);
    expect(isReleaseRelevantRealtime('predictions', 'UPDATE')).toBe(true);
    expect(isReleaseRelevantRealtime('attendance', 'DELETE')).toBe(false);
    expect(isReleaseRelevantRealtime('student_engagement_summary', 'UPDATE')).toBe(false);
    expect(isReleaseRelevantRealtime('interventions', 'INSERT')).toBe(false);
  });

  it('only grade inbox titles count', () => {
    expect(isReleaseRelevantInboxTitle('Grade posted')).toBe(true);
    expect(isReleaseRelevantInboxTitle('Missing grade')).toBe(true);
    expect(isReleaseRelevantInboxTitle('Final grade released')).toBe(true);
    expect(isReleaseRelevantInboxTitle('Account approved')).toBe(false);
    expect(isReleaseRelevantInboxTitle(null)).toBe(false);
  });

  it('invalidates only that student release query', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    invalidateStudentReleases(qc, 'u1');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['final-grade-releases', 'student', 'u1'] });
  });
});

describe('invokeReleaseFinalGrades', () => {
  beforeEach(() => invoke.mockReset());

  const okBody = {
    subject_id: 'sub-1',
    outcome: 'partial',
    released: 2,
    unchanged: 1,
    incomplete: [{ student_id: 's3', missing: [{ kind: 'attendance_missing' }] }],
    not_enrolled: [],
  };
  const httpError = (status: number, body: unknown) =>
    Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    });

  it('sends only the subject id, once', async () => {
    invoke.mockResolvedValue({ data: okBody, error: null });
    const res = await invokeReleaseFinalGrades('sub-1');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('release-final-grades', { body: { subject_id: 'sub-1' } });
    expect(res).toEqual({ kind: 'ok', body: okBody });
  });

  it('409 inputs_changed is a conflict with the server message and no retry', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: 'inputs_changed', retry: true, message: 'Inputs changed. Nothing was released.', subject_id: 'sub-1' }),
    });
    expect(await invokeReleaseFinalGrades('sub-1')).toEqual({ kind: 'conflict', message: 'Inputs changed. Nothing was released.' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('409 without a message uses the fallback text', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(409, { error: 'inputs_changed' }) });
    expect(await invokeReleaseFinalGrades('sub-1')).toEqual({ kind: 'conflict', message: RELEASE_CONFLICT_FALLBACK });
  });

  it('other HTTP errors, unreadable error bodies and thrown errors are errors', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(403, { error: 'Not the subject instructor' }) });
    expect(await invokeReleaseFinalGrades('sub-1')).toEqual({ kind: 'error', message: 'Not the subject instructor' });
    invoke.mockResolvedValueOnce({ data: null, error: httpError(409, { error: 'other' }) });
    expect((await invokeReleaseFinalGrades('sub-1')).kind).toBe('error');
    invoke.mockResolvedValueOnce({ data: null, error: httpError(500, '<html>oops</html>') });
    expect(await invokeReleaseFinalGrades('sub-1')).toEqual({
      kind: 'error',
      message: 'Edge Function returned a non-2xx status code',
    });
    invoke.mockRejectedValueOnce(new Error('Failed to fetch'));
    expect(await invokeReleaseFinalGrades('sub-1')).toEqual({ kind: 'error', message: 'Failed to fetch' });
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('a malformed 200 body is an error, never a success', async () => {
    for (const data of [
      null,
      'ok',
      { ...okBody, outcome: 'done' },
      { ...okBody, released: '2' },
      { ...okBody, unchanged: Number.NaN },
      { ...okBody, incomplete: null },
      { ...okBody, incomplete: [{ student_id: 1, missing: [] }] },
      { ...okBody, not_enrolled: [5] },
    ]) {
      invoke.mockResolvedValueOnce({ data, error: null });
      const res = await invokeReleaseFinalGrades('sub-1');
      expect(res.kind).toBe('error');
    }
  });
});
