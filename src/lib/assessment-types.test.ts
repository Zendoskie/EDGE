import { describe, expect, it } from 'vitest';
import {
  SELECTABLE_ASSESSMENT_TYPES,
  formatAssessmentTypeLabel,
  isCourseworkAssessmentType,
  isExamAssessmentType,
  isFinalExamAssessmentType,
  isMidtermSideAssessmentType,
  isProjectAssessmentType,
  isSelectableAssessmentType,
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

  it('keeps a label for every type allowed by the database', () => {
    for (const t of ['quiz', 'assignment', 'project', 'exam', 'activity', 'laboratory_exam', 'midterm_exam', 'final_exam']) {
      expect(formatAssessmentTypeLabel(t)).not.toBe(t);
    }
  });

  it('offers only Activity, Project, Midterm Exam and Final Exam for new assessments', () => {
    expect(SELECTABLE_ASSESSMENT_TYPES.map((t) => t.value)).toEqual(['activity', 'project', 'midterm_exam', 'final_exam']);
    expect(SELECTABLE_ASSESSMENT_TYPES.map((t) => t.label)).toEqual(['Activity', 'Project', 'Midterm Exam', 'Final Exam']);
    for (const legacy of ['quiz', 'assignment', 'laboratory_exam', 'exam', '', null]) {
      expect(isSelectableAssessmentType(legacy)).toBe(false);
    }
  });

  it('groups types for weighted grading buckets', () => {
    expect(isCourseworkAssessmentType('quiz')).toBe(true);
    expect(isCourseworkAssessmentType('assignment')).toBe(true);
    expect(isProjectAssessmentType('project')).toBe(true);
    expect(isExamAssessmentType('exam')).toBe(true);
    expect(isExamAssessmentType('final_exam')).toBe(true);
    expect(isExamAssessmentType('quiz')).toBe(false);
  });

  it('maps legacy exam types to the Midterm side of the Exam split', () => {
    for (const t of ['midterm_exam', 'exam', 'laboratory_exam']) {
      expect(isMidtermSideAssessmentType(t)).toBe(true);
      expect(isFinalExamAssessmentType(t)).toBe(false);
    }
    expect(isFinalExamAssessmentType('final_exam')).toBe(true);
    expect(isMidtermSideAssessmentType('final_exam')).toBe(false);
  });
});
