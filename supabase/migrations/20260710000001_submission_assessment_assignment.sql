-- Allow assignment as a submission assessment_type value
ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_assessment_type_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_assessment_type_check
  CHECK (
    assessment_type IS NULL OR assessment_type IN (
      'activity',
      'assignment',
      'quiz',
      'laboratory_exam',
      'midterm_exam',
      'final_exam',
      'project'
    )
  );
