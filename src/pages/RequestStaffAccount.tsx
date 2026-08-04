import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Shield, Users, CheckCircle2, ArrowLeft, Loader2,
  Lock, AlertTriangle, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getPublicAppUrl } from '@/lib/app-url';

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
    <div className="app-shell-bg flex min-h-dvh w-full flex-col items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-lg animate-fade-in">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-violet-500 shadow-lg shadow-primary/25 mb-4">
            <Shield className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">EDGE</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Student Risk Analysis and AI Coaching System
          </p>
        </div>
        {children}
      </div>
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
      <Card className="shadow-xl border-border/60 bg-card/92 backdrop-blur-md">
        <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 ring-1 ring-green-500/30">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-display font-bold text-foreground">Request Submitted</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your staff account request has been submitted. An administrator will review it shortly.
              You will be contacted at{' '}
              <span className="font-medium text-foreground">{email}</span> once a decision is made.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sign In
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-xl border-border/60 bg-card/92 backdrop-blur-md">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Request Staff Account</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              For Instructors and Guidance Counselors only. Reviewed by an administrator.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="req-full-name">Full Name <span className="text-destructive">*</span></Label>
            <Input id="req-full-name" value={fullName}
              onChange={(e) => { setFullName(e.target.value); clearError('fullName'); }}
              placeholder="Juan Dela Cruz" aria-invalid={!!errors.fullName} disabled={loading} />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-email">Personal Gmail <span className="text-destructive">*</span></Label>
            <Input id="req-email" type="email" value={email}
              onChange={(e) => { setEmail(e.target.value); clearError('email'); }}
              placeholder="yourname@gmail.com" autoComplete="email"
              aria-invalid={!!errors.email} disabled={loading} />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-department">Department</Label>
            <Input id="req-department" value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. College of Computer Studies" disabled={loading} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-role">Role <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              {(['instructor', 'guidance_counselor'] as StaffRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setRole(r); clearError('role'); }}
                  disabled={loading}
                  className={[
                    'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
                    role === r
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border/60 bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground',
                    errors.role ? 'border-destructive/60' : '',
                  ].join(' ')}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            {errors.role && <p className="text-xs text-destructive">{errors.role}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-remarks">Remarks</Label>
            <Textarea id="req-remarks" value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any additional information for the administrator (optional)"
              rows={3} className="resize-none" disabled={loading} />
          </div>

          <p className="text-xs text-muted-foreground">
            Fields marked <span className="text-destructive">*</span> are required.
          </p>

          <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
            <Button type="submit" className="w-full sm:flex-1" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</> : 'Submit Request'}
            </Button>
            <Button type="button" variant="outline" className="w-full sm:flex-1"
              disabled={loading} onClick={() => navigate('/login')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
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
      <Card className="shadow-xl border-border/60 bg-card/92 backdrop-blur-md">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Validating invitation…</p>
        </CardContent>
      </Card>
    );
  }

  // ── Render: invalid ────────────────────────────────────────────────────────

  if (state.phase === 'invalid') {
    return (
      <Card className="shadow-xl border-border/60 bg-card/92 backdrop-blur-md">
        <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15 ring-1 ring-destructive/30">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-display font-bold text-foreground">Invitation Invalid</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{state.reason}</p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sign In
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Render: success ────────────────────────────────────────────────────────

  if (state.phase === 'success') {
    return (
      <Card className="shadow-xl border-border/60 bg-card/92 backdrop-blur-md">
        <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/15 ring-1 ring-green-500/30">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-display font-bold text-foreground">Account Created</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your EDGE staff account has been created and activated. You can now sign in with{' '}
              <span className="font-medium text-foreground">{state.email}</span>.
            </p>
          </div>
          <Button className="w-full" onClick={() => navigate('/login')}>
            Sign In to EDGE
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Render: registration form ──────────────────────────────────────────────

  const { invitation } = state;
  const roleLabel = ROLE_LABELS[invitation.role] ?? invitation.role;
  const hasPrefilledName = !!invitation.full_name;

  return (
    <Card className="shadow-xl border-border/60 bg-card/92 backdrop-blur-md">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Lock className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Complete Staff Registration</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              You have been invited to create a <strong>{roleLabel}</strong> account on EDGE.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {/* Expiry notice */}
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This invitation expires on{' '}
            <strong>
              {new Date(invitation.expires_at).toLocaleDateString('en-PH', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </strong>
            . It can only be used once.
          </p>
        </div>

        <form onSubmit={handleRegister} noValidate className="space-y-4">

          {/* ── Read-only fields ─────────────────────────────────── */}
          <fieldset className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Account Details — locked by invitation
            </legend>

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

          <p className="text-xs text-muted-foreground">
            Fields marked <span className="text-destructive">*</span> are required.
          </p>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account…</>
              : 'Create Account'}
          </Button>
        </form>
      </CardContent>
    </Card>
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
