
-- Create trigger function to auto-assign role from user metadata on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::app_role,
      'student'::app_role
    )
  )
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- Also fix existing users who signed up but have no roles
-- Insert roles for users who exist but have no role entry
INSERT INTO public.user_roles (user_id, role)
SELECT id, COALESCE((raw_user_meta_data->>'role')::app_role, 'student'::app_role)
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.user_roles)
ON CONFLICT (user_id, role) DO NOTHING;
