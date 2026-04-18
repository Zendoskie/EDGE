-- RUN THIS FIRST (one Run in SQL Editor). Wait for success, then open 02-apply-account-approval-schema.sql.
-- Adds the `admin` label to public.app_role (safe if it already exists).

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
