-- Allow students (and all authenticated users) to view instructor profiles
-- so subject pages can display instructor names.

CREATE POLICY "Authenticated can view instructor profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(user_id, 'instructor'));

-- Backfill missing full_name for existing accounts (optional but helps UI)
UPDATE public.profiles
SET full_name = COALESCE(NULLIF(full_name, ''), split_part(email, '@', 1))
WHERE COALESCE(full_name, '') = '';

