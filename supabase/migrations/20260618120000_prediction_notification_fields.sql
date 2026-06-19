-- Prior values for in-app notification dedupe (risk change, attendance threshold, instructor alerts).
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS previous_risk_level text,
  ADD COLUMN IF NOT EXISTS previous_attendance_rate numeric;

COMMENT ON COLUMN public.predictions.previous_risk_level IS
  'Risk level from the prior risk-analysis run for this student/subject (used for change notifications).';
COMMENT ON COLUMN public.predictions.previous_attendance_rate IS
  'Attendance rate from the prior risk-analysis run (0–1), used for threshold-crossing notifications.';
