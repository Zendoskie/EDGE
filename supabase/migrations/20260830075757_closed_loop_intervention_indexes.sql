-- Cover new foreign keys used by staff ownership and completion audit queries.
CREATE INDEX IF NOT EXISTS engagement_interventions_completed_by_idx
  ON public.engagement_interventions (completed_by)
  WHERE completed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS intervention_staff_outcomes_completed_by_idx
  ON public.intervention_staff_outcomes (completed_by);
