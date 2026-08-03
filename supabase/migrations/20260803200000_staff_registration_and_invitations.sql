-- ─────────────────────────────────────────────────────────────────────────────
-- Staff Registration Request + Invitation workflow
--
-- Phase 2: Database layer only — no UI connected.
--
-- Flow:
--   1. An instructor or guidance counselor visits /request-staff-account and
--      submits their details (public, no auth required).
--   2. The request lands in staff_registration_requests (status = 'pending').
--   3. An admin reviews the request in the admin dashboard.
--      • Approve → admin_review_staff_request() creates a staff_invitation
--        row with a secure token and 7-day expiry.
--      • Reject  → request is marked rejected with an optional reason.
--   4. The admin sends the invitation link (token) to the applicant.
--   5. The applicant visits /request-staff-account?token=<token>, the UI
--      calls get_staff_invitation_by_token() to validate, then walks them
--      through account creation (Phase 3).
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: staff_registration_requests
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_registration_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text        NOT NULL,
  email            text        NOT NULL,
  department       text,
  role             app_role    NOT NULL
                               CHECK (role IN ('instructor', 'guidance_counselor')),
  remarks          text,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Admin queue: filter by status, ordered most-recent-first.
CREATE INDEX IF NOT EXISTS idx_staff_reg_requests_status_submitted
  ON public.staff_registration_requests (status, submitted_at DESC);

-- Lookup by email (case-insensitive).
CREATE INDEX IF NOT EXISTS idx_staff_reg_requests_email
  ON public.staff_registration_requests (lower(email));

-- Filter queue by role + status (admin view grouping).
CREATE INDEX IF NOT EXISTS idx_staff_reg_requests_role_status
  ON public.staff_registration_requests (role, status);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.staff_registration_requests ENABLE ROW LEVEL SECURITY;

-- Public (unauthenticated) users may submit a request.
-- Only 'instructor' and 'guidance_counselor' are permitted by the CHECK above;
-- the WITH CHECK here adds a defence-in-depth guard at the policy layer.
DROP POLICY IF EXISTS "Anyone can submit a staff registration request"
  ON public.staff_registration_requests;
CREATE POLICY "Anyone can submit a staff registration request"
ON public.staff_registration_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (role IN ('instructor'::app_role, 'guidance_counselor'::app_role));

-- Admins can view all requests.
DROP POLICY IF EXISTS "Admins can view all staff registration requests"
  ON public.staff_registration_requests;
CREATE POLICY "Admins can view all staff registration requests"
ON public.staff_registration_requests
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Admins can approve / reject requests.
DROP POLICY IF EXISTS "Admins can review staff registration requests"
  ON public.staff_registration_requests;
CREATE POLICY "Admins can review staff registration requests"
ON public.staff_registration_requests
FOR UPDATE
TO authenticated
USING  (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: staff_invitations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- May be NULL when an admin creates a direct invitation (no prior request).
  request_id  uuid        REFERENCES public.staff_registration_requests(id)
                          ON DELETE SET NULL,

  email       text        NOT NULL,
  department  text,
  role        app_role    NOT NULL
                          CHECK (role IN ('instructor', 'guidance_counselor')),

  -- Cryptographically random 64-char hex token (two concatenated UUID v4s).
  token       text        NOT NULL UNIQUE
                          DEFAULT replace(
                            gen_random_uuid()::text || gen_random_uuid()::text,
                            '-', ''
                          ),

  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),

  -- Default: 7 days from creation.
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),

  created_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Primary lookup path for the invitation-acceptance page (token → record).
CREATE INDEX IF NOT EXISTS idx_staff_invitations_token
  ON public.staff_invitations (token);

-- Look up by email (case-insensitive) to check for duplicates.
CREATE INDEX IF NOT EXISTS idx_staff_invitations_email
  ON public.staff_invitations (lower(email));

-- Join back to the originating request.
CREATE INDEX IF NOT EXISTS idx_staff_invitations_request_id
  ON public.staff_invitations (request_id);

-- Admin dashboard: filter by status and expiry.
CREATE INDEX IF NOT EXISTS idx_staff_invitations_status_expires
  ON public.staff_invitations (status, expires_at);

-- Admin dashboard: sort by creator + creation time.
CREATE INDEX IF NOT EXISTS idx_staff_invitations_created_by
  ON public.staff_invitations (created_by, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- Admins can view all invitations.
DROP POLICY IF EXISTS "Admins can view all staff invitations"
  ON public.staff_invitations;
CREATE POLICY "Admins can view all staff invitations"
ON public.staff_invitations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Admins can create invitations; created_by must equal the caller.
DROP POLICY IF EXISTS "Admins can create staff invitations"
  ON public.staff_invitations;
CREATE POLICY "Admins can create staff invitations"
ON public.staff_invitations
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  AND auth.uid() = created_by
);

-- Admins can update invitation status (expire, revoke, re-issue).
DROP POLICY IF EXISTS "Admins can manage staff invitations"
  ON public.staff_invitations;
CREATE POLICY "Admins can manage staff invitations"
ON public.staff_invitations
FOR UPDATE
TO authenticated
USING  (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: admin_review_staff_request
--
-- Atomically approves or rejects a pending staff registration request.
-- On approval, a linked staff_invitation row is created automatically.
-- Returns the new invitation id on approval, NULL on rejection.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_review_staff_request(
  p_request_id       uuid,
  p_status           text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_req      public.staff_registration_requests%ROWTYPE;
  v_inv_id   uuid;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin_role_required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status: must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  -- Lock the row to prevent concurrent review races.
  SELECT * INTO v_req
  FROM public.staff_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'request_already_reviewed' USING ERRCODE = '23505';
  END IF;

  -- Update the request.
  UPDATE public.staff_registration_requests
  SET
    status           = p_status,
    reviewed_at      = now(),
    reviewed_by      = v_admin_id,
    rejection_reason = CASE
                         WHEN p_status = 'rejected' THEN p_rejection_reason
                         ELSE NULL
                       END
  WHERE id = p_request_id;

  -- On approval: create a linked invitation (7-day expiry by default).
  IF p_status = 'approved' THEN
    INSERT INTO public.staff_invitations (
      request_id,
      email,
      department,
      role,
      created_by
    )
    VALUES (
      v_req.id,
      v_req.email,
      v_req.department,
      v_req.role,
      v_admin_id
    )
    RETURNING id INTO v_inv_id;

    RETURN v_inv_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_staff_request(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_staff_request(uuid, text, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: get_staff_invitation_by_token
--
-- Token-based lookup used by the /request-staff-account?token=<token> page.
-- Callable by anon so the acceptance page works before the user has an
-- account.  Only non-sensitive fields are returned; the token itself is
-- never echoed back.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_staff_invitation_by_token(p_token text)
RETURNS TABLE (
  id          uuid,
  email       text,
  department  text,
  role        app_role,
  status      text,
  expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.department,
    i.role,
    i.status,
    i.expires_at
  FROM public.staff_invitations i
  WHERE i.token = p_token
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_staff_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_staff_invitation_by_token(text) TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: mark_staff_invitation_accepted
--
-- Called during the account-creation flow to flip the invitation to
-- 'accepted' and record the timestamp.  Validates the token is still
-- pending and not expired before accepting.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_staff_invitation_accepted(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv
  FROM public.staff_invitations
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RAISE EXCEPTION 'invitation_already_accepted' USING ERRCODE = '23505';
  END IF;

  IF v_inv.status IN ('expired', 'revoked') THEN
    RAISE EXCEPTION 'invitation_not_valid' USING ERRCODE = '23514';
  END IF;

  IF v_inv.expires_at < now() THEN
    -- Auto-expire and surface a clear error.
    UPDATE public.staff_invitations
    SET status = 'expired'
    WHERE token = p_token;
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '23514';
  END IF;

  UPDATE public.staff_invitations
  SET
    status      = 'accepted',
    accepted_at = now()
  WHERE token = p_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_staff_invitation_accepted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_staff_invitation_accepted(text) TO anon, authenticated;
