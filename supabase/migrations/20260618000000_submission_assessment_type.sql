-- Assessment type classification on grade records (submissions)
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS assessment_type text;

ALTER TABLE public.submissions
  DROP CONSTRAINT IF EXISTS submissions_assessment_type_check;

ALTER TABLE public.submissions
  ADD CONSTRAINT submissions_assessment_type_check
  CHECK (
    assessment_type IS NULL OR assessment_type IN (
      'activity',
      'quiz',
      'laboratory_exam',
      'midterm_exam',
      'final_exam',
      'project'
    )
  );

COMMENT ON COLUMN public.submissions.assessment_type IS
  'Classification of the assessment when the grade was recorded';
