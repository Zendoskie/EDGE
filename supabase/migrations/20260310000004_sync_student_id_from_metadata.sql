-- Ensure new users' student IDs from auth metadata are copied into profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, student_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'student_number', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Backfill existing profiles with student_id from auth metadata where available
UPDATE public.profiles p
SET student_id = NULLIF(u.raw_user_meta_data->>'student_number', '')
FROM auth.users u
WHERE p.user_id = u.id
  AND p.student_id IS NULL
  AND COALESCE(NULLIF(u.raw_user_meta_data->>'student_number', ''), '') <> '';

