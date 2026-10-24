import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { AuthFrame } from '@/components/shell/AuthSlider';
import { finishPasswordResetAndGoToDashboard } from '@/lib/finish-password-reset';
import { urlIndicatesPasswordRecovery } from '@/lib/auth-recovery-url';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [canReset, setCanReset] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setCanReset(true);
        setChecking(false);
      }
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (urlIndicatesPasswordRecovery() && session) {
        setCanReset(true);
      }
      setChecking(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await finishPasswordResetAndGoToDashboard(password, navigate);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="edge-auth-staff">
        <AuthFrame headline="Reset password" sub="Confirming your reset link…" steps={[]}>
          <div className="edge-auth-status">
            <Loader2 className="animate-spin" aria-hidden />
            <p className="edge-auth-lead">Loading…</p>
          </div>
        </AuthFrame>
      </div>
    );
  }

  if (!canReset) {
    return (
      <div className="edge-auth-staff">
        <AuthFrame headline="Reset password" sub="This link is invalid or has expired." steps={[]}>
          <p className="edge-auth-lead text-pretty">
            Open the reset link from your email in this same browser. Links expire quickly. If you already
            updated your password, try signing in. Otherwise request a new link below.
          </p>
          <Button type="button" className="mt-4 w-full" onClick={() => navigate('/forgot-password')}>
            Request new link
          </Button>
          <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </AuthFrame>
      </div>
    );
  }

  return (
    <div className="edge-auth-staff">
      <AuthFrame headline="Choose a new password" sub="You opened a valid reset link." steps={[]}>
        <form onSubmit={(e) => void handleSubmit(e)} className="edge-auth-fields">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm password</Label>
            <PasswordInput
              id="confirm-new-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Saving…' : 'Update password'}
          </Button>
        </form>
      </AuthFrame>
    </div>
  );
}
