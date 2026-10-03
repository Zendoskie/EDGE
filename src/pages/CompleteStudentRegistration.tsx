import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, Lock, UserCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getPublicAppUrl } from '@/lib/app-url';
import { AuthFrame } from '@/components/shell/AuthSlider';

type Invitation = {
  email: string;
  full_name: string | null;
  student_id: string;
  course: string;
  year_level: string;
  is_irregular: boolean;
  status: string;
  expires_at: string;
};

type TokenState =
  | { phase: 'loading' }
  | { phase: 'invalid'; reason: string }
  | { phase: 'form'; invitation: Invitation }
  | { phase: 'success'; email: string };

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export default function CompleteStudentRegistration() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<TokenState>({ phase: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) {
      setState({ phase: 'invalid', reason: 'This page opens from the approval email. Use the Complete Registration link.' });
      return;
    }

    let cancelled = false;
    async function validate() {
      const { data, error } = await (supabase as any).rpc('get_student_invitation_by_token', { p_token: token });
      if (cancelled) return;
      if (error || !data?.length) {
        setState({ phase: 'invalid', reason: 'This invitation link is invalid or has expired.' });
        return;
      }
      const inv = data[0] as Invitation;
      if (inv.status === 'accepted') {
        setState({ phase: 'invalid', reason: 'This invitation has already been used. Sign in with the password you created.' });
        return;
      }
      if (inv.status === 'revoked') {
        setState({ phase: 'invalid', reason: 'This invitation has been cancelled by an administrator.' });
        return;
      }
      if (inv.status === 'expired' || new Date(inv.expires_at) < new Date()) {
        setState({ phase: 'invalid', reason: 'This invitation has expired. Ask an administrator to approve a new request.' });
        return;
      }
      setState({ phase: 'form', invitation: inv });
    }
    void validate();
    return () => { cancelled = true; };
  }, [token]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.phase !== 'form' || !token) return;
    const inv = state.invitation;
    const errs: Record<string, string> = {};
    if (!password) errs.password = 'Password is required.';
    else if (password.length < 8) errs.password = 'Password must be at least 8 characters.';
    if (!confirmPassword) errs.confirmPassword = 'Please confirm your password.';
    else if (password !== confirmPassword) errs.confirmPassword = 'Passwords do not match.';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setErrors({});
    setSubmitting(true);
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: inv.email,
        password,
        options: {
          data: {
            full_name: inv.full_name ?? '',
            role: 'student',
            course: inv.course,
            year_level: inv.year_level === 'Irregular' ? '1st Year' : inv.year_level,
            student_number: inv.student_id,
            is_irregular: inv.is_irregular || inv.year_level === 'Irregular',
          },
          emailRedirectTo: getPublicAppUrl() || window.location.origin,
        },
      });

      if (signUpError) {
        const msg = (signUpError.message || '').toLowerCase();
        const code = (signUpError as { code?: string }).code ?? '';
        if (code === 'user_already_exists' || msg.includes('user already registered')) {
          throw new Error('An account with this email already exists. Sign in, or contact an administrator.');
        }
        throw signUpError;
      }
      if (!signUpData.user) {
        throw new Error('Sign-up did not return a user. Please try again.');
      }

      if (signUpData.session) {
        await supabase.auth.signOut();
      }

      const { error: completeError } = await (supabase as any).rpc('complete_student_invitation', {
        p_token: token,
        p_user_id: signUpData.user.id,
      });
      if (completeError) {
        const cm = (completeError.message || '').toLowerCase();
        if (cm.includes('invitation_already_accepted')) {
          throw new Error('This invitation has already been used.');
        }
        if (cm.includes('invitation_expired') || cm.includes('invitation_not_valid')) {
          throw new Error('This invitation has expired or been cancelled.');
        }
        if (cm.includes('email_mismatch')) {
          throw new Error('The invitation email does not match this account.');
        }
        throw completeError;
      }

      setState({ phase: 'success', email: inv.email });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  let body: React.ReactNode;
  if (state.phase === 'loading') {
    body = (
      <div className="edge-auth-status">
        <Loader2 className="animate-spin" aria-hidden />
        <p className="edge-auth-lead">Checking your invitation…</p>
      </div>
    );
  } else if (state.phase === 'invalid') {
    body = (
      <div className="edge-auth-status">
        <XCircle aria-hidden />
        <h2>Invitation unavailable</h2>
        <p className="edge-auth-lead">{state.reason}</p>
        <Button type="button" className="w-full" onClick={() => navigate('/login')}>Back to sign in</Button>
      </div>
    );
  } else if (state.phase === 'success') {
    body = (
      <div className="edge-auth-status">
        <CheckCircle2 aria-hidden />
        <h2>Account active</h2>
        <p className="edge-auth-lead">Sign in with {state.email} and the password you just created.</p>
        <Button type="button" className="w-full" onClick={() => navigate('/login')}>Sign in to EDGE</Button>
      </div>
    );
  } else {
    const inv = state.invitation;
    body = (
      <>
        <h2>Create your password</h2>
        <p className="edge-auth-lead">Your student request was approved. This link works once.</p>
        <form onSubmit={handleRegister} noValidate className="edge-auth-fields">
          <div className="edge-auth-notice">
            <AlertTriangle aria-hidden />
            <p>
              Expires on{' '}
              <strong>
                {new Date(inv.expires_at).toLocaleDateString('en-PH', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </strong>
              . It cannot be reused.
            </p>
          </div>
          <fieldset className="edge-auth-locked">
            <legend>Approved account</legend>
            <ReadonlyField label="Name" value={inv.full_name || '—'} />
            <ReadonlyField label="Email" value={inv.email} />
            <ReadonlyField label="Student ID" value={inv.student_id} />
            <ReadonlyField label="Course" value={inv.course} />
            <ReadonlyField label="Year" value={inv.year_level} />
            <ReadonlyField label="Role" value="Student" />
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="student-password">Password <span className="text-destructive">*</span></Label>
            <PasswordInput
              id="student-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((p) => { const n = { ...p }; delete n.password; return n; }); }}
              placeholder="••••••••"
              minLength={8}
              disabled={submitting}
            />
            {errors.password
              ? <p className="edge-auth-error">{errors.password}</p>
              : <p className="text-xs text-muted-foreground">Minimum 8 characters. This password is not emailed.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="student-confirm-password">Confirm password <span className="text-destructive">*</span></Label>
            <PasswordInput
              id="student-confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setErrors((p) => { const n = { ...p }; delete n.confirmPassword; return n; }); }}
              placeholder="••••••••"
              minLength={8}
              disabled={submitting}
            />
            {errors.confirmPassword && <p className="edge-auth-error">{errors.confirmPassword}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Activating account…</> : 'Complete registration'}
          </Button>
        </form>
        <p className="edge-auth-switch">
          <button type="button" onClick={() => navigate('/login')}>Back to sign in</button>
        </p>
      </>
    );
  }

  return (
    <div className="edge-auth-staff">
      <AuthFrame
        headline="Finish your student account"
        sub="An administrator approved your request. Create a password to activate it."
        steps={[
          { title: 'Request submitted', body: 'Your Student ID was included in the request.', icon: ClipboardList },
          { title: 'Administrator approved', body: 'This link was sent to your email.', icon: Lock },
          { title: 'Sign in', body: 'Use the password you create here.', icon: UserCheck },
        ]}
      >
        {body}
      </AuthFrame>
    </div>
  );
}
