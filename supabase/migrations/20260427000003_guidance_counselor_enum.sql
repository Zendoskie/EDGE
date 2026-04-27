-- Ensure guidance counselor enum value exists before referral policies.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_enum e
    JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role' AND e.enumlabel = 'guidance_counselor'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'guidance_counselor';
  END IF;
END;
$$;
