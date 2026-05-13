-- Remove prediction rows when enrollment is deleted so unenrolled subjects
-- cannot affect dashboards, analytics, or AI summaries.
-- Interventions referencing predictions use ON DELETE CASCADE on prediction_id.

CREATE OR REPLACE FUNCTION public.delete_predictions_on_enrollment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.predictions
  WHERE student_id = OLD.student_id
    AND subject_id = OLD.subject_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_predictions_on_enrollment_delete ON public.enrollments;
CREATE TRIGGER trg_delete_predictions_on_enrollment_delete
  AFTER DELETE ON public.enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_predictions_on_enrollment_delete();

-- One-time cleanup: predictions with no matching enrollment row (historical orphans)
DELETE FROM public.predictions p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.enrollments e
  WHERE e.student_id = p.student_id
    AND e.subject_id = p.subject_id
);
