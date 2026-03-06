-- Allow risk_level and prediction_type values used by the predict-risk edge function
ALTER TABLE public.predictions DROP CONSTRAINT IF EXISTS predictions_risk_level_check;
ALTER TABLE public.predictions ADD CONSTRAINT predictions_risk_level_check
  CHECK (risk_level IN ('at_risk', 'stable', 'excelling', 'Excelling', 'Stable', 'At Risk'));

ALTER TABLE public.predictions DROP CONSTRAINT IF EXISTS predictions_prediction_type_check;
ALTER TABLE public.predictions ADD CONSTRAINT predictions_prediction_type_check
  CHECK (prediction_type IN ('midterm', 'final', 'ai_classification'));

-- Allow 'exam' activity type used in the UI
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_type_check
  CHECK (type IN ('quiz', 'assignment', 'project', 'exam'));
