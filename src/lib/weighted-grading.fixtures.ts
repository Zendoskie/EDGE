import type { GradeItem, SubjectGradingWeights } from '@/lib/weighted-grading';

export type GradeCase = {
  name: string;
  items: GradeItem[];
  attendance: { present: number; absent: number } | null;
  weights: SubjectGradingWeights | null;
  expected: number | null;
};

export function attendancePercentOf(attendance: GradeCase['attendance']): number | null {
  if (!attendance) return null;
  const total = attendance.present + attendance.absent;
  return total > 0 ? (attendance.present / total) * 100 : null;
}

const item = (type: string, score: number | null, maxScore = 100, assessmentType: string | null = type): GradeItem => ({
  type,
  assessmentType,
  score,
  maxScore,
});

// Transmuted activity percents 95, 90, 85 → activity average 90.
const ACTIVITIES = [item('activity', 45, 50), item('activity', 8, 10), item('activity', 70, 100)];
// Transmuted project percents 100, 90 → project average 95.
const PROJECTS = [item('project', 100), item('project', 80)];
const FULL_ATTENDANCE = { present: 4, absent: 0 };
const BASE = [...ACTIVITIES, ...PROJECTS];

/** Default weights 25/25/15/35 unless stated. Expectations use base-50 transmutation on activity/project/exams. */
export const GRADE_CASES: GradeCase[] = [
  {
    name: 'three Activity assessments share the Activity weight',
    items: [...BASE, item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'a fourth Activity does not add Activity weight',
    items: [...BASE, item('activity', 80), item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'legacy quiz and assignment count as Activity',
    items: [
      item('quiz', 45, 50),
      item('assignment', 8, 10),
      item('activity', 70, 100),
      ...PROJECTS,
      item('midterm_exam', 80),
      item('final_exam', 60),
    ],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 89.75,
  },
  {
    name: 'a third Project does not add Project weight',
    items: [...BASE, item('project', 90), item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'Midterm carries the full Exam weight before a Final score',
    items: [...BASE, item('midterm_exam', 80)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 92.75,
  },
  {
    name: 'a blank Final score does not trigger the split',
    items: [...BASE, item('midterm_exam', 80), item('final_exam', null)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 92.75,
  },
  {
    name: 'a zero Final score triggers the split',
    items: [...BASE, item('midterm_exam', 80), item('final_exam', 0)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 85.75,
  },
  {
    name: 'two Midterms and one Final stay within their halves',
    items: [...BASE, item('midterm_exam', 90), item('midterm_exam', 70), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'a Final with a blank Midterm carries the full Exam weight',
    items: [...BASE, item('midterm_exam', null), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 89.25,
  },
  {
    name: 'legacy exam counts on the Midterm side',
    items: [...BASE, item('exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'legacy laboratory exam counts on the Midterm side',
    items: [...BASE, item('laboratory_exam', 80)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 92.75,
  },
  {
    name: 'the submission type is missing, so the activity type is used',
    items: [...BASE, item('midterm_exam', 80), item('final_exam', 60, 100, null)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'saved weights equal to the defaults give the same grade',
    items: [...BASE, item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: { activity_weight: 25, project_weight: 25, attendance_weight: 15, exam_weight: 35 },
    expected: 91,
  },
  {
    name: 'custom instructor weights are respected',
    items: [...BASE, item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: { activity_weight: 40, project_weight: 20, attendance_weight: 10, exam_weight: 30 },
    expected: 90.5,
  },
  {
    name: 'a blank Activity score is left out',
    items: [...BASE, item('activity', null), item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'a zero Activity score is a recorded grade',
    items: [...BASE, item('activity', 0), item('midterm_exam', 80), item('final_exam', 60)],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 88.5,
  },
  {
    name: 'invalid max scores and non-finite scores are ignored',
    items: [
      ...BASE,
      item('activity', 50, 0),
      item('activity', 50, -10),
      item('activity', Number.NaN),
      item('activity', Number.POSITIVE_INFINITY),
      item('midterm_exam', 80),
      item('final_exam', 60),
    ],
    attendance: FULL_ATTENDANCE,
    weights: null,
    expected: 91,
  },
  {
    name: 'attendance alone gives the attendance percentage',
    items: [item('activity', null)],
    attendance: { present: 3, absent: 1 },
    weights: null,
    expected: 75,
  },
  {
    name: 'nothing graded and no attendance gives no grade',
    items: [item('activity', null), item('final_exam', null)],
    attendance: null,
    weights: null,
    expected: null,
  },
];
