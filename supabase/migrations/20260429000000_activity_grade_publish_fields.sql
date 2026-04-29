-- Add explicit grade publish/finalize signal per activity.
-- Used to notify enrolled students who are missing a recorded score when grades are published.

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS grades_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grades_published_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_activities_grades_published_at
  ON public.activities (grades_published_at);

