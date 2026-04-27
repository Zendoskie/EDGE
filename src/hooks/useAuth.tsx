import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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

    async function syncFromSession(next: Session | null) {
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
    }

    async function init() {
      const {
        data: { session: initial },
      } = await supabase.auth.getSession();
      if (!cancelled) await syncFromSession(initial);
      if (!cancelled) setLoading(false);
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      void (async () => {
        if (cancelled) return;
        await syncFromSession(next);
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
    }
  ) => {
    const { course, yearLevel, studentNumber, isIrregular, guardianStudentId } = extras || {};

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
        },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('profiles_student_id_unique') || msg.includes('duplicate key value')) {
        throw new Error('This Student ID/No. is already in use. Please use your own unique Student ID.');
      }
      if (msg.includes('student_not_found_for_guardian_link')) {
        throw new Error('No student account matches that Student ID/No. Please check and try again.');
      }
      if (msg.includes('guardian_student_id_required')) {
        throw new Error('Student ID/No. is required for parent/guardian registration.');
      }
      throw error;
    }

    if (data.session) {
      await supabase.auth.signOut();
      return { user: data.user, session: null };
    }

    return data;
  };

  const signOut = async () => {
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
