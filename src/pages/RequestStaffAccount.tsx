import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2, Loader2, AlertTriangle, XCircle, ClipboardList, Shield, UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getPublicAppUrl } from '@/lib/app-url';
import { AuthFrame } from '@/components/shell/AuthSlider';

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

type StaffRole = 'instructor' | 'guidance_counselor';

const ROLE_LABELS: Record<StaffRole, string> = {
  instructor:        'Instructor',
  guidance_counselor: 'Guidance Counselor',
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared layout wrapper
// ─────────────────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="edge-auth-staff">
      <AuthFrame
        headline="Request a staff account"
        sub="Instructors and guidance counselors ask an administrator to review access."
        steps={[
          { title: "Submit your details", body: "Share your name, email, and role.", icon: ClipboardList },
          { title: "Wait for review", body: "An administrator approves or declines the request.", icon: Shield },
          { title: "Sign in after approval", body: "Use the account only once access is granted.", icon: UserCheck },
        ]}
      >
        {children}
      </AuthFrame>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── MODE A: PUBLIC REQUEST FORM  (no ?token)
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RequestForm() {
  const navigate = useNavigate();

  const [fullName,   setFullName]   = useState('');
  const [email,      setEmail]      = useState('');
  const [department, setDepartment] = useState('');
  const [role,       setRole]       = useState<StaffRole | ''>('');
  const [remarks,    setRemarks]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [errors,     setErrors]     = useState<Record<string, string>>({});

  function clearError(field: string) {
    setErrors((prev) => { const n = { ...prev }; delete n[field]; return n; });
  }

  function validateAll() {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Full Name is required.';
    if (!email.trim())    errs.email    = 'Gmail is required.';
    else if (!EMAIL_REGEX.test(email.trim())) errs.email = 'Please enter a valid Gmail address.';
    if (!role)            errs.role     = 'Please select a role.';
    return errs;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clientErrors = validateAll();
    if (Object.keys(clientErrors).length > 0) { setErrors(clientErrors); return; }

    setLoading(true);
    setErrors({});
    try {
      const { data: checkData, error: checkError } = await supabase
        .rpc('check_staff_request_status', { p_email: email.trim().toLowerCase() });

      if (!checkError && checkData?.length > 0) {
        const { has_pending_request, email_is_registered } = checkData[0] as {
          has_pending_request: boolean; email_is_registered: boolean;
        };
        if (email_is_registered) {
          setErrors({ email: 'This email already has an account. Please sign in instead.' });
          return;
        }
        if (has_pending_request) {
          setErrors({ email: 'A pending request already exists for this email.' });
          return;
        }
      }

      const { error: insertError } = await (supabase as any)
        .from('staff_registration_requests')
        .insert({
          full_name:  fullName.trim(),
          email:      email.trim().toLowerCase(),
          department: department.trim() || null,
          role:       role as StaffRole,
          remarks:    remarks.trim() || null,
          status:     'pending',
        });
      if (insertError) throw insertError;
      setSubmitted(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="edge-auth-status">
        <CheckCircle2 aria-hidden />
        <h2>Request submitted</h2>
        <p className="edge-auth-lead">
          An administrator will review it and contact you at {email}.
        </p>
        <Button type="button" className="w-full" onClick={() => navigate('/login')}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <>
      <h2>Request staff access</h2>
      <p className="edge-auth-lead">
        Instructors and guidance counselors. An administrator reviews each request.
      </p>
      <form onSubmit={handleSubmit} noValidate className="edge-auth-fields">
        <div className="space-y-2">
          <Label htmlFor="req-full-name">Full name <span className="text-destructive">*</span></Label>
          <Input id="req-full-name" value={fullName}
            onChange={(e) => { setFullName(e.target.value); clearError('fullName'); }}
            placeholder="Juan Dela Cruz" aria-invalid={!!errors.fullName} disabled={loading} />
          {errors.fullName && <p className="edge-auth-error">{errors.fullName}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="req-email">Personal Gmail <span className="text-destructive">*</span></Label>
          <Input id="req-email" type="email" value={email}
            onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
            placeholder="yourname@gmail.com" autoComplete="email"
            aria-invalid={!!errors.email} disabled={loading} />
          {errors.email && <p className="edge-auth-error">{errors.email}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="req-department">Department</Label>
          <Input id="req-department" value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="College of Computer Studies" disabled={loading} />
        </div>

        <div className="space-y-2">
          <Label id="req-role-label">Role <span className="text-destructive">*</span></Label>
          <div className="edge-role-row" role="group" aria-labelledby="req-role-label">
            {(['instructor', 'guidance_counselor'] as StaffRole[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => { setRole(r); clearError('role'); }}
                disabled={loading}
                aria-pressed={role === r}
                className={role === r ? 'edge-role is-selected' : 'edge-role'}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          {errors.role && <p className="edge-auth-error">{errors.role}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="req-remarks">Remarks</Label>
          <Textarea id="req-remarks" value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Anything the administrator should know"
            rows={3} className="resize-none" disabled={loading} />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : 'Submit request'}
        </Button>
      </form>
      <p className="edge-auth-switch">
        <button type="button" onClick={() => navigate('/login')}>Back to sign in</button>
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── MODE B: INVITATION REGISTRATION FORM  (?token=…)
// ─────────────────────────────────────────────────────────────────────────────

type InvitationData = {
  id:         string;
  email:      string;
  full_name:  string | null;
  department: string | null;
  role:       StaffRole;
  status:     string;
  expires_at: string;
};

type TokenState =
  | { phase: 'loading' }
  | { phase: 'invalid'; reason: string }
  | { phase: 'form';    invitation: InvitationData }
  | { phase: 'success'; email: string };

function InvitationForm({ token }: { token: string }) {
  const navigate = useNavigate();

  const [state, setState] = useState<TokenState>({ phase: 'loading' });

  // Editable fields
  const [fullName,         setFullName]         = useState('');
  const [password,         setPassword]         = useState('');
  const [confirmPassword,  setConfirmPassword]  = useState('');
  const [submitting,       setSubmitting]       = useState(false);
  const [errors,           setErrors]           = useState<Record<string, string>>({});

  // ── Validate token on mount ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function validate() {
      try {
        const { data, error } = await supabase
          .rpc('get_staff_invitation_by_token', { p_token: token });

        if (cancelled) return;

        if (error || !data?.length) {
          setState({ phase: 'invalid', reason: 'This invitation link is invalid or has expired.' });
          return;
        }

        const inv = data[0] as InvitationData;

        if (inv.status === 'accepted') {
          setState({ phase: 'invalid', reason: 'This invitation has already been used. Please sign in.' });
          return;
        }
        if (inv.status === 'revoked') {
          setState({ phase: 'invalid', reason: 'This invitation has been cancelled by an administrator.' });
          return;
        }
        if (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) {
          setState({ phase: 'invalid', reason: 'This invitation has expired. Please contact an administrator to request a new one.' });
          return;
        }

        // Prefill full name if available from the request
        if (inv.full_name) setFullName(inv.full_name);
        setState({ phase: 'form', invitation: inv });
      } catch {
        if (!cancelled) setState({ phase: 'invalid', reason: 'Could not validate this invitation. Please try again.' });
      }
    }
    void validate();
    return () => { cancelled = true; };
  }, [token]);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.phase !== 'form') return;

    const inv = state.invitation;
    const errs: Record<string, string> = {};

    if (!fullName.trim())   errs.fullName = 'Full Name is required.';
    if (!password)          errs.password = 'Password is required.';
    else if (password.length < 8) errs.password = 'Password must be at least 8 characters.';
    if (!confirmPassword)   errs.confirmPassword = 'Please confirm your password.';
    else if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';

    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);

    try {
      // 1. Create the Supabase Auth account.
      //    The DB triggers (handle_new_user + handle_new_user_role) will insert
      //    profiles (account_status='pending') and user_roles automatically.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email:    inv.email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role:      inv.role,
          },
          emailRedirectTo: getPublicAppUrl() || window.location.origin,
        },
      });

      if (signUpError) {
        const msg = (signUpError.message || '').toLowerCase();
        const code = (signUpError as { code?: string }).code ?? '';
        if (code === 'user_already_exists' || msg.includes('user already registered')) {
          throw new Error('An account with this email already exists. Please sign in.');
        }
        throw signUpError;
      }

      if (!signUpData.user) {
        throw new Error('Sign-up did not return a user. Please try again.');
      }

      const userId = signUpData.user.id;

      // Sign out any session that was immediately granted (email confirmation disabled).
      if (signUpData.session) {
        await supabase.auth.signOut();
      }

      // 2. Complete the invitation: validates token + email match,
      //    marks invitation accepted, and sets account_status to 'approved'.
      const { error: completeError } = await supabase.rpc(
        'complete_staff_invitation' as any,
        { p_token: token, p_user_id: userId },
      );

      if (completeError) {
        const cm = (completeError.message || '').toLowerCase();
        if (cm.includes('invitation_expired') || cm.includes('invitation_not_valid')) {
          throw new Error('This invitation has expired or been cancelled. Contact an administrator.');
        }
        if (cm.includes('email_mismatch')) {
          throw new Error('The invitation email does not match your account email.');
        }
        if (cm.includes('invitation_already_accepted')) {
          throw new Error('This invitation has already been used.');
        }
        throw completeError;
      }

      // 3. Done.
      setState({ phase: 'success', email: inv.email });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render: loading ────────────────────────────────────────────────────────

  if (state.phase === 'loading') {
    return (
      <div className="edge-auth-status">
        <Loader2 className="animate-spin" aria-hidden />
        <p className="edge-auth-lead">Validating invitation…</p>
      </div>
    );
  }

  // ── Render: invalid ────────────────────────────────────────────────────────

  if (state.phase === 'invalid') {
    return (
      <div className="edge-auth-status">
        <XCircle aria-hidden />
        <h2>Invitation invalid</h2>
        <p className="edge-auth-lead">{state.reason}</p>
        <Button type="button" className="w-full" onClick={() => navigate('/login')}>
          Back to sign in
        </Button>
      </div>
    );
  }

  // ── Render: success ────────────────────────────────────────────────────────

  if (state.phase === 'success') {
    return (
      <div className="edge-auth-status">
        <CheckCircle2 aria-hidden />
        <h2>Account created</h2>
        <p className="edge-auth-lead">
          Your staff account is active. Sign in with {state.email}.
        </p>
        <Button type="button" className="w-full" onClick={() => navigate('/login')}>
          Sign in to EDGE
        </Button>
      </div>
    );
  }

  // ── Render: registration form ──────────────────────────────────────────────

  const { invitation } = state;
  const roleLabel = ROLE_LABELS[invitation.role] ?? invitation.role;
  const hasPrefilledName = !!invitation.full_name;

  return (
    <>
      <h2>Complete registration</h2>
      <p className="edge-auth-lead">
        You were invited to create a {roleLabel} account.
      </p>
      <form onSubmit={handleRegister} noValidate className="edge-auth-fields">
        <div className="edge-auth-notice">
          <AlertTriangle aria-hidden />
          <p>
            This invitation expires on{' '}
            <strong>
              {new Date(invitation.expires_at).toLocaleDateString('en-PH', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </strong>
            . It can only be used once.
          </p>
        </div>

          <fieldset className="edge-auth-locked">
            <legend>Locked by invitation</legend>

            <ReadonlyField label="Email"      value={invitation.email} />
            <ReadonlyField label="Role"       value={roleLabel} />
            <ReadonlyField label="Department" value={invitation.department || '—'} />
          </fieldset>

          {/* ── Full Name ────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-full-name">
              Full Name <span className="text-destructive">*</span>
            </Label>
            {hasPrefilledName ? (
              /* Readonly when sourced from the original request */
              <div className="relative">
                <Input
                  id="reg-full-name"
                  value={fullName}
                  readOnly
                  tabIndex={-1}
                  className="cursor-default select-none bg-muted/40 text-muted-foreground focus-visible:ring-0"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  locked
                </span>
              </div>
            ) : (
              <Input
                id="reg-full-name"
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); setErrors((p) => { const n={...p}; delete n.fullName; return n; }); }}
                placeholder="Juan Dela Cruz"
                aria-invalid={!!errors.fullName}
                disabled={submitting}
              />
            )}
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
          </div>

          {/* ── Password ─────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-password">
              Password <span className="text-destructive">*</span>
            </Label>
            <PasswordInput
              id="reg-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((p) => { const n={...p}; delete n.password; return n; }); }}
              placeholder="••••••••"
              minLength={8}
              aria-invalid={!!errors.password}
              disabled={submitting}
            />
            {errors.password
              ? <p className="text-xs text-destructive">{errors.password}</p>
              : <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
            }
          </div>

          {/* ── Confirm Password ──────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-confirm-password">
              Confirm Password <span className="text-destructive">*</span>
            </Label>
            <PasswordInput
              id="reg-confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setErrors((p) => { const n={...p}; delete n.confirmPassword; return n; }); }}
              placeholder="••••••••"
              minLength={8}
              aria-invalid={!!errors.confirmPassword}
              disabled={submitting}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</>
              : 'Create account'}
          </Button>
        </form>
      <p className="edge-auth-switch">
        <button type="button" onClick={() => navigate('/login')}>Back to sign in</button>
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: readonly display field
// ─────────────────────────────────────────────────────────────────────────────

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export: reads ?token and delegates to the right mode
// ─────────────────────────────────────────────────────────────────────────────

export default function RequestStaffAccount() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <PageShell>
      {token ? <InvitationForm token={token} /> : <RequestForm />}
    </PageShell>
  );
}
