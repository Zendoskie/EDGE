import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session, type AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  bootstrapStudentSession,
  finalizeStudentSessionOnSignOut,
  trackStudentLoginOnSignIn,
  trackStudentLogoutOnSignOut,
} from '@/lib/auth-tracking';
import {
  notifyParentOnRegistrationBestEffort,
  notifyStudentOnParentRegistrationBestEffort,
} from '@/lib/invoke-parent-email';

export type AppRole = 'student' | 'instructor' | 'admin' | 'parent' | 'guidance_counselor';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role: Exclude<AppRole, 'admin'>,
    extras?: {
      course?: string;
      yearLevel?: string;
      studentNumber?: string;
      isIrregular?: boolean;
      guardianStudentId?: string;
      parentEmail?: string;
    }
  ) => Promise<{ user: User | null; session: Session | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadRole(userId: string): Promise<AppRole | null> {
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  if (error || !data?.length) return null;
  const roles = data.map((r) => r.role);
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('guidance_counselor')) return 'guidance_counselor';
  if (roles.includes('parent')) return 'parent';
  if (roles.includes('instructor')) return 'instructor';
  return 'student';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function syncFromSession(next: Session | null, authEvent?: AuthChangeEvent) {
      if (!next?.user) {
        setSession(null);
        setUser(null);
        setRole(null);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('account_status')
        .eq('user_id', next.user.id)
        .maybeSingle();

      if (profErr) {
        console.error('profiles lookup after session:', profErr);
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setRole(null);
        return;
      }

      if (prof?.account_status !== 'approved') {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setRole(null);
        return;
      }

      setSession(next);
      setUser(next.user);
      const r = await loadRole(next.user.id);
      if (!cancelled) setRole(r);

      if (!cancelled && r === 'student' && next) {
        if (authEvent === 'SIGNED_IN') {
          await trackStudentLoginOnSignIn(next);
        } else if (authEvent === 'INITIAL_SESSION') {
          await bootstrapStudentSession(next);
        }
      }
    }

    async function init() {
      const {
        data: { session: initial },
      } = await supabase.auth.getSession();
      if (!cancelled) {
        await syncFromSession(initial, initial ? 'INITIAL_SESSION' : undefined);
      }
      if (!cancelled) setLoading(false);
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      void (async () => {
        if (cancelled) return;
        if (event === 'SIGNED_OUT') {
          await finalizeStudentSessionOnSignOut();
        }
        await syncFromSession(next, event);
        if (!cancelled) setLoading(false);
      })();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const normalizedEmail = email.trim();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) {
      const em = (error.message || '').toLowerCase();
      if (em.includes('email not confirmed') || em.includes('confirm your email')) {
        throw new Error('Please confirm your email before signing in.');
      }
      if (
        em.includes('invalid login') ||
        em.includes('invalid email or password') ||
        em.includes('invalid credentials')
      ) {
        throw new Error('Invalid credentials');
      }
      throw new Error('Invalid credentials');
    }

    const uid = data.user?.id;
    if (!uid) throw new Error('Invalid credentials');

    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('account_status')
      .eq('user_id', uid)
      .maybeSingle();

    if (profErr) {
      console.error('profiles lookup at sign-in:', profErr);
      await supabase.auth.signOut();
      const hint = (profErr.message || '').toLowerCase();
      if (hint.includes('account_status') || hint.includes('column') || profErr.code === '42703') {
        throw new Error(
          'Database is missing the approval column. Apply the latest Supabase migrations (account_status on profiles), then try again.'
        );
      }
      throw new Error('Could not verify your account status. Check your connection and try again.');
    }

    if (!prof) {
      await supabase.auth.signOut();
      throw new Error(
        'No profile row for this login. Sign up through the app first, or in Supabase run the bootstrap SQL after the user exists in Authentication.'
      );
    }
    if (prof.account_status === 'pending') {
      await supabase.auth.signOut();
      throw new Error('Account pending approval');
    }
    if (prof.account_status === 'rejected') {
      await supabase.auth.signOut();
      throw new Error('Account not approved');
    }
    if (prof.account_status !== 'approved') {
      await supabase.auth.signOut();
      throw new Error('Invalid credentials');
    }

    const r = await loadRole(uid);
    setSession(data.session);
    setUser(data.user);
    setRole(r);
    setLoading(false);

    if (r === 'student' && data.session) {
      await trackStudentLoginOnSignIn(data.session);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    signupRole: Exclude<AppRole, 'admin'>,
    extras?: {
      course?: string;
      yearLevel?: string;
      studentNumber?: string;
      isIrregular?: boolean;
      guardianStudentId?: string;
      parentEmail?: string;
    }
  ) => {
    const { course, yearLevel, studentNumber, isIrregular, guardianStudentId, parentEmail } = extras || {};

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: signupRole,
          course,
          year_level: yearLevel,
          student_number: studentNumber,
          is_irregular: isIrregular ?? false,
          guardian_student_id: guardianStudentId,
          parent_email: parentEmail,
        },
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
      const code = (error as { code?: string }).code ?? '';
      if (msg.includes('profiles_student_id_unique') || msg.includes('duplicate key value')) {
        throw new Error('This Student ID/No. is already in use. Please use your own unique Student ID.');
      }
      // Email already has an account — give an actionable message instead of the raw Supabase string.
      if (code === 'user_already_exists' || msg.includes('user already registered')) {
        throw new Error(
          'This email already has an account. If you registered before, please sign in. Contact an administrator if you need help accessing your account.'
        );
      }
      // For parent registration, surface one generic message for all credential-mismatch errors.
      if (signupRole === 'parent' && (
        msg.includes('student_not_found_for_guardian_link') ||
        msg.includes('guardian_student_id_required') ||
        msg.includes('parent_email_not_set') ||
        msg.includes('parent_email_mismatch')
      )) {
        throw new Error('Student ID or Parent Gmail does not match our records.');
      }
      throw error;
    }

    // Send parent invitation email to parent immediately after successful student registration.
    if (signupRole === 'student' && parentEmail?.trim()) {
      notifyParentOnRegistrationBestEffort({
        student_email: email,
        parent_email: parentEmail.trim(),
        student_name: fullName || undefined,
        student_id_no: studentNumber?.trim() || undefined,
      });
    }

    // Notify the student by email when a parent registers against their account.
    // The in-app notification is handled automatically by Supabase Realtime (useParentLinkRealtime).
    if (signupRole === 'parent' && email?.trim()) {
      notifyStudentOnParentRegistrationBestEffort({ parent_email: email.trim() });
    }

    if (data.session) {
      await supabase.auth.signOut();
      return { user: data.user, session: null };
    }

    return data;
  };

  const signOut = async () => {
    if (role === 'student') {
      await trackStudentLogoutOnSignOut();
    }
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
