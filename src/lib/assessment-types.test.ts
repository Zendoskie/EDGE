import { describe, expect, it } from 'vitest';
import {
  formatAssessmentTypeLabel,
  isCourseworkAssessmentType,
  isExamAssessmentType,
  isProjectAssessmentType,
  isValidAssessmentType,
} from './assessment-types';

describe('assessment-types', () => {
  it('labels stored activity types including legacy exam', () => {
    expect(formatAssessmentTypeLabel('quiz')).toBe('Quiz');
    expect(formatAssessmentTypeLabel('midterm_exam')).toBe('Midterm Exam');
    expect(formatAssessmentTypeLabel('exam')).toBe('Exam');
    expect(isValidAssessmentType('laboratory_exam')).toBe(true);
    expect(isValidAssessmentType('exam')).toBe(false);
  });

  it('groups types for weighted grading buckets', () => {
    expect(isCourseworkAssessmentType('quiz')).toBe(true);
    expect(isCourseworkAssessmentType('assignment')).toBe(true);
    expect(isProjectAssessmentType('project')).toBe(true);
    expect(isExamAssessmentType('exam')).toBe(true);
    expect(isExamAssessmentType('final_exam')).toBe(true);
    expect(isExamAssessmentType('quiz')).toBe(false);
  });
});
