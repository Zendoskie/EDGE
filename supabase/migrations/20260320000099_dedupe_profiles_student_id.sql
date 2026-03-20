-- Before enforcing unique student_id, resolve existing duplicates.
-- Keeps one profile per trimmed student_id (earliest created_at, then smallest user_id).
-- Clears student_id on the other rows so instructors can re-enter the correct ID in Settings if needed.

WITH ranked AS (
  SELECT
    user_id,
    ROW_NUMBER() OVER (
      PARTITION BY btrim(student_id)
      ORDER BY created_at ASC NULLS LAST, user_id ASC
    ) AS rn
  FROM public.profiles
  WHERE student_id IS NOT NULL
    AND btrim(student_id) <> ''
)
UPDATE public.profiles p
SET
  student_id = NULL,
  updated_at = now()
FROM ranked r
WHERE p.user_id = r.user_id
  AND r.rn > 1;
