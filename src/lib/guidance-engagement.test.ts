import { describe, expect, it } from 'vitest';
import {
  buildGuidanceEngagementRows,
  studentDisplayName,
} from '@/lib/guidance-engagement';

const summary = {
  engagement_level: 'high',
  engagement_score: 82,
  total_login_count: 14,
  total_time_spent_seconds: 3600,
  last_login_at: '2026-08-31T10:00:00Z',
};

describe('guidance engagement roster', () => {
  it('keeps only summaries with a student profile visible to guidance', () => {
    const rows = buildGuidanceEngagementRows(
      [
        { ...summary, student_id: 'student-1' },
        { ...summary, student_id: 'instructor-1' },
      ],
      [
        {
          user_id: 'student-1',
          full_name: 'Ana Reyes',
          email: 'ana@example.edu',
          student_id: '2026-001',
        },
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentId: 'student-1', fullName: 'Ana Reyes' });
  });

  it('uses student number then email when a full name is unavailable', () => {
    expect(
      studentDisplayName({
        user_id: 'student-1',
        full_name: ' ',
        email: 'ana@example.edu',
        student_id: '2026-001',
      }),
    ).toBe('2026-001');

    expect(
      studentDisplayName({
        user_id: 'student-2',
        full_name: '',
        email: 'ben@example.edu',
        student_id: null,
      }),
    ).toBe('ben@example.edu');
  });
});
