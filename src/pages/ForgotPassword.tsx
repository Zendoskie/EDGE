import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { requestPasswordResetEmail } from '@/lib/request-password-reset';
import { AuthFrame } from '@/components/shell/AuthSlider';
import { KeyRound, Mail, LogIn } from 'lucide-react';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Enter your account email.');
      return;
    }
    setLoading(true);
    try {
      const result = await requestPasswordResetEmail(trimmed);
      if (!result.ok) {
        throw new Error(result.message);
      }
      setSent(true);
      toast.success('If an account exists for this email, we sent a reset link. Check your inbox and spam.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset email. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="edge-auth-staff">
      <AuthFrame
        headline="Reset your password"
        sub="We will email a one-time link so you can choose a new password."
        steps={[
          { title: 'Enter email', body: 'Use the same address as your EDGE account.', icon: Mail },
          { title: 'Open the link', body: 'The email link expires after a short time.', icon: KeyRound },
          { title: 'Sign in', body: 'Use your new password on the sign-in page.', icon: LogIn },
        ]}
      >
        {sent ? (
          <div className="space-y-4">
            <h2>Check your email</h2>
            <p className="edge-auth-lead text-pretty">
              If <strong>{email.trim()}</strong> has an EDGE account, you will receive a password reset link shortly.
            </p>
            <Button type="button" className="w-full" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <>
            <h2>Forgot password</h2>
            <p className="edge-auth-lead">Students, parents, and staff can reset the password for their sign-in email.</p>
            <form onSubmit={(e) => void handleSubmit(e)} className="edge-auth-fields">
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@university.edu"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
            <p className="edge-auth-switch">
              <Link to="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </AuthFrame>
    </div>
  );
}
