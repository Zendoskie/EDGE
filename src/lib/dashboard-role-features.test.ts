import { describe, expect, it } from 'vitest';
import { shouldShowHeaderAiCoach } from '@/lib/dashboard-role-features';

describe('shouldShowHeaderAiCoach', () => {
  it('shows the header coach only to students', () => {
    expect(shouldShowHeaderAiCoach('student')).toBe(true);
    expect(shouldShowHeaderAiCoach('parent')).toBe(false);
    expect(shouldShowHeaderAiCoach('instructor')).toBe(false);
    expect(shouldShowHeaderAiCoach('guidance_counselor')).toBe(false);
    expect(shouldShowHeaderAiCoach('admin')).toBe(false);
    expect(shouldShowHeaderAiCoach(null)).toBe(false);
  });
});
