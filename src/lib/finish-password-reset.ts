import type { NavigateFunction } from 'react-router-dom';
import { toast } from 'sonner';
import { commitPasswordReset } from '@/lib/apply-password-reset';

/** Save password, verify email/password login, then open the dashboard. */
export async function finishPasswordResetAndGoToDashboard(
  password: string,
  navigate: NavigateFunction,
): Promise<void> {
  await commitPasswordReset(password);
  toast.success('Password updated. You are signed in.');
  navigate('/dashboard', { replace: true });
}
