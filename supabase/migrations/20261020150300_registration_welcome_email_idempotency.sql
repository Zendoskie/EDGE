-- Concurrency-safe idempotency for registration_access_activated welcome emails only.
-- Does not alter email_notifications constraints used by other notification types.

CREATE TABLE IF NOT EXISTS public.registration_welcome_email_deliveries (
  parent_registration_request_id uuid NOT NULL
    REFERENCES public.parent_registration_requests(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delivery_status text NOT NULL
    CHECK (delivery_status IN ('claimed', 'sent', 'failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_registration_request_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS registration_welcome_email_deliveries_student_idx
  ON public.registration_welcome_email_deliveries (student_id);

ALTER TABLE public.registration_welcome_email_deliveries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_claim_registration_welcome_email(
  p_request_id uuid,
  p_dedupe_key text,
  p_student_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.registration_welcome_email_deliveries%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_request_id IS NULL OR NULLIF(trim(p_dedupe_key), '') IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'invalid_claim_arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.registration_welcome_email_deliveries (
    parent_registration_request_id,
    dedupe_key,
    student_id,
    delivery_status
  )
  VALUES (p_request_id, trim(p_dedupe_key), p_student_id, 'claimed')
  ON CONFLICT (parent_registration_request_id, dedupe_key) DO NOTHING
  RETURNING parent_registration_request_id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT *
  INTO v_row
  FROM public.registration_welcome_email_deliveries
  WHERE parent_registration_request_id = p_request_id
    AND dedupe_key = trim(p_dedupe_key)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'in_flight';
  END IF;

  IF v_row.delivery_status = 'sent' THEN
    RETURN 'duplicate';
  END IF;

  IF v_row.delivery_status = 'failed' THEN
    UPDATE public.registration_welcome_email_deliveries
    SET
      delivery_status = 'claimed',
      claimed_at = now(),
      updated_at = now()
    WHERE parent_registration_request_id = p_request_id
      AND dedupe_key = trim(p_dedupe_key)
      AND delivery_status = 'failed'
    RETURNING parent_registration_request_id INTO v_id;

    IF v_id IS NOT NULL THEN
      RETURN 'claimed';
    END IF;
    RETURN 'in_flight';
  END IF;

  IF v_row.delivery_status = 'claimed'
     AND v_row.claimed_at < now() - interval '15 minutes' THEN
    UPDATE public.registration_welcome_email_deliveries
    SET
      claimed_at = now(),
      updated_at = now()
    WHERE parent_registration_request_id = p_request_id
      AND dedupe_key = trim(p_dedupe_key)
      AND delivery_status = 'claimed'
      AND claimed_at < now() - interval '15 minutes'
    RETURNING parent_registration_request_id INTO v_id;

    IF v_id IS NOT NULL THEN
      RETURN 'claimed';
    END IF;
  END IF;

  RETURN 'in_flight';
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_registration_welcome_email(
  p_request_id uuid,
  p_dedupe_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.registration_welcome_email_deliveries
  SET
    delivery_status = 'sent',
    sent_at = now(),
    updated_at = now()
  WHERE parent_registration_request_id = p_request_id
    AND dedupe_key = trim(p_dedupe_key)
    AND delivery_status = 'claimed';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_registration_welcome_email(
  p_request_id uuid,
  p_dedupe_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.registration_welcome_email_deliveries
  SET
    delivery_status = 'failed',
    updated_at = now()
  WHERE parent_registration_request_id = p_request_id
    AND dedupe_key = trim(p_dedupe_key)
    AND delivery_status = 'claimed';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.try_claim_registration_welcome_email(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_registration_welcome_email(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_registration_welcome_email(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.try_claim_registration_welcome_email(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_registration_welcome_email(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_registration_welcome_email(uuid, text) TO service_role;
