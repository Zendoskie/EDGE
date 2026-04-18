-- Step 1 of 2: add enum label only (must commit before any use of 'admin'::app_role).
-- Paired with 20260418000001_account_approval_profiles_functions_rls.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role' AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'admin';
  END IF;
END;
$$;
