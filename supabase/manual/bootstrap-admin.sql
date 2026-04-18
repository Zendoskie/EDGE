-- Default admin account (local / dev). Password is never stored in the web app — only in Supabase Auth.
--
-- 0) If `account_status` is missing: run `01-add-admin-enum-value.sql`, then `02-apply-account-approval-schema.sql`
--    as TWO separate runs in the SQL Editor (see `00-RUN-IN-THIS-ORDER.txt`).
--
-- Intended credentials:
--   Login email: Admin@edge.local   (email is required; "Admin" is the part before @)
--   Password:    Admin123
--   Display name is set to "Admin" below.
--
-- Steps:
-- 1) Supabase Dashboard → Authentication → Users → Add user
--      Email:     Admin@edge.local
--      Password:  Admin123
--      Turn on "Auto Confirm User" (or confirm email) so sign-in works immediately.
-- 2) Run this entire script in the Supabase SQL Editor (postgres role).
--    Supabase may warn about "destructive operations" because of UPDATE + DELETE below.
--    That is expected for this script; choose "Run this query" if the email matches your Auth user.
--
-- For production, change the email and use a strong unique password, then delete or edit this file.

UPDATE public.profiles
SET
  account_status = 'approved',
  full_name = 'Admin',
  updated_at = now()
WHERE lower(email) = lower('Admin@edge.local');

DELETE FROM public.user_roles
WHERE user_id = (SELECT user_id FROM public.profiles WHERE lower(email) = lower('Admin@edge.local'));

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin'::public.app_role
FROM public.profiles
WHERE lower(email) = lower('Admin@edge.local');

-- If login still fails in the app:
-- • Use the full email (e.g. Admin@edge.local), not only "Admin".
-- • Run all migrations so `profiles.account_status` exists; existing rows should be `approved` after migration.
-- • This script must find a row in `public.profiles` for that email (created by the auth trigger when the Auth user was added).
