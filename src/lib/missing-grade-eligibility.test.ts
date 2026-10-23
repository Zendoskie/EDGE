import { describe, expect, it } from 'vitest';
import { activityIdsWithAtLeastOneRecordedScore } from '@/lib/missing-grade-eligibility';
import { missingGradeAlertAllowed } from '../../supabase/functions/_shared/missing-grade.ts';

describe('activityIdsWithAtLeastOneRecordedScore', () => {
  it('excludes activities with no recorded scores', () => {
    expect(
      activityIdsWithAtLeastOneRecordedScore([
        { activity_id: 'a1', score: null },
        { activity_id: 'a2', score: null },
      ]),
    ).toEqual([]);
  });

  it('includes an activity after any student has a recorded score', () => {
    expect(
      activityIdsWithAtLeastOneRecordedScore([
        { activity_id: 'a1', score: null },
        { activity_id: 'a2', score: 85 },
        { activity_id: 'a2', score: null },
      ]),
    ).toEqual(['a2']);
  });

  it('treats a score of zero as recorded, not missing', () => {
    expect(activityIdsWithAtLeastOneRecordedScore([{ activity_id: 'a1', score: 0 }])).toEqual(['a1']);
  });
});

describe('missingGradeAlertAllowed (edge publish guard)', () => {
  it('matches the recorded-score eligibility rule', () => {
    expect(missingGradeAlertAllowed({ assessmentType: 'activity', scoredSubmissionCount: 0 })).toBe(false);
    expect(missingGradeAlertAllowed({ assessmentType: 'activity', scoredSubmissionCount: 1 })).toBe(true);
  });
});
