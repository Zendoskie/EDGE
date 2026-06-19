-- Rule-based risk score: 50% academic + 20% attendance + 30% exams (0–100, higher = better).
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS midterm_exam_average numeric,
  ADD COLUMN IF NOT EXISTS final_exam_average numeric,
  ADD COLUMN IF NOT EXISTS exam_average numeric,
  ADD COLUMN IF NOT EXISTS academic_performance numeric;

COMMENT ON COLUMN public.predictions.risk_score IS
  'Rule-based performance score 0–100: 50% academic (activity/quiz/project) + 20% attendance + 30% exams. Higher = better.';
COMMENT ON COLUMN public.predictions.midterm_exam_average IS
  'Average percent score on midterm exam assessments.';
COMMENT ON COLUMN public.predictions.final_exam_average IS
  'Average percent score on final exam assessments.';
COMMENT ON COLUMN public.predictions.exam_average IS
  'Average percent score across laboratory, midterm, and final exams.';
COMMENT ON COLUMN public.predictions.academic_performance IS
  'Average percent score across activity, quiz, and project assessments.';
