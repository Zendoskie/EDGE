-- Backfill missing prediction.subject_id values from interventions when available.

UPDATE public.predictions p
SET subject_id = i.subject_id
FROM (
  SELECT DISTINCT ON (prediction_id) prediction_id, subject_id
  FROM public.interventions
  WHERE prediction_id IS NOT NULL
    AND subject_id IS NOT NULL
  ORDER BY prediction_id, sent_at DESC NULLS LAST, id DESC
) i
WHERE p.id = i.prediction_id
  AND p.subject_id IS NULL;
