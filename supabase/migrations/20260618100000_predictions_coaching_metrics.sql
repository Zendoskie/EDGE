-- Extended risk-analysis metrics consumed by AI coaching (classification stays rule-based).
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS risk_score numeric,
  ADD COLUMN IF NOT EXISTS activity_average numeric,
  ADD COLUMN IF NOT EXISTS laboratory_exam_average numeric,
  ADD COLUMN IF NOT EXISTS comprehension_rating numeric;

COMMENT ON COLUMN public.predictions.risk_score IS
  'Rule-based risk score from the risk analysis module (higher = more at risk).';
COMMENT ON COLUMN public.predictions.activity_average IS
  'Average percent score on activity-type assessments.';
COMMENT ON COLUMN public.predictions.laboratory_exam_average IS
  'Average percent score on laboratory exam assessments.';
COMMENT ON COLUMN public.predictions.comprehension_rating IS
  'Comprehension rating 1–5 derived from student feedback and performance gaps.';

ALTER TABLE public.predictions DROP CONSTRAINT IF EXISTS predictions_prediction_type_check;
ALTER TABLE public.predictions ADD CONSTRAINT predictions_prediction_type_check
  CHECK (prediction_type IN ('midterm', 'final', 'ai_classification', 'risk_analysis'));
