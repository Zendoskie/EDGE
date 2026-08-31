import type { AppRole } from '@/hooks/useAuth';

export function shouldShowHeaderAiCoach(role: AppRole | null): boolean {
  return role === 'student';
}
