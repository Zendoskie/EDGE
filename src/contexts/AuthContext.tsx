import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { User, Session, type AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  finalizeStudentSessionOnSignOut,
  trackStudentLoginOnSignIn,
  trackStudentLogoutOnSignOut,
} from '@/lib/auth-tracking';
import { notifyStudentOnParentRegistrationBestEffort } from '@/lib/invoke-parent-email';
import { getPublicAppUrl } from '@/lib/app-url';
import { parentLinkErrorMessage, parentLoginBlockedMessage } from '@/lib/parent-link-status';

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

/**
 * Parents need both the student's and an administrator's approval. Returns the reason a
 * parent cannot sign in yet, or null when they have an active (admin-approved) link.
 */
async function getParentLoginBlock(userId: string, accountStatus: string | null | undefined): Promise<string | null> {
  const { data, error } = await supabase
    .from('parent_student_links')
    .select('status')
    .eq('parent_user_id', userId)
    .order('requested_at', { ascending: false });
  if (error) {
    console.error('parent link lookup at sign-in:', error);
    return 'Could not verify your parent/guardian request status. Please try again.';
  }
  return parentLoginBlockedMessage(accountStatus, (data ?? []).map((l) => l.status));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const signInHandledUserIdRef = useRef<string | null>(null);
  const syncedUserIdRef = useRef<string | null>(null);
  const roleRef = useRef<AppRole | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncFromSession(next: Session | null, authEvent?: AuthChangeEvent) {
      if (!next?.user) {
        syncedUserIdRef.current = null;
        signInHandledUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setRole(null);
        roleRef.current = null;
        return;
      }

      // Token refresh only updates the session — no profile/role round-trips.
      if (authEvent === 'TOKEN_REFRESHED') {
        setSession(next);
        setUser(next.user);
        return;
      }

      const userId = next.user.id;

      // signIn() already validated and set state; avoid duplicate DB work on SIGNED_IN.
      if (authEvent === 'SIGNED_IN' && signInHandledUserIdRef.current === userId) {
        signInHandledUserIdRef.current = null;
        setSession(next);
        setUser(next.user);
        syncedUserIdRef.current = userId;
        return;
      }

      // Already synced for this user (e.g. spurious SIGNED_IN during navigation).
      if (syncedUserIdRef.current === userId && roleRef.current !== null) {
        setSession(next);
        setUser(next.user);
        return;
      }

      const [{ data: prof, error: profErr }, r] = await Promise.all([
        supabase.from('profiles').select('account_status').eq('user_id', userId).maybeSingle(),
        loadRole(userId),
      ]);

      if (profErr) {
        console.error('profiles lookup after session:', profErr);
        await supabase.auth.signOut();
        syncedUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setRole(null);
        roleRef.current = null;
        return;
      }

      if (prof?.account_status !== 'approved') {
        await supabase.auth.signOut();
        syncedUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setRole(null);
        roleRef.current = null;
        return;
      }

      if (r === 'parent' && (await getParentLoginBlock(userId, prof.account_status))) {
        await supabase.auth.signOut();
        syncedUserIdRef.current = null;
        setSession(null);
        setUser(null);
        setRole(null);
        roleRef.current = null;
        return;
      }

      setSession(next);
      setUser(next.user);
      if (!cancelled) {
        setRole(r);
        roleRef.current = r;
      }
      syncedUserIdRef.current = userId;

      // Student login tracking only on explicit sign-in; session resume is handled in DashboardLayout.
      if (!cancelled && r === 'student' && authEvent === 'SIGNED_IN') {
        void trackStudentLoginOnSignIn(next);
      }
    }

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

    const [{ data: prof, error: profErr }, r] = await Promise.all([
      supabase.from('profiles').select('account_status').eq('user_id', uid).maybeSingle(),
      loadRole(uid),
    ]);

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

    if (r === 'parent') {
      const blocked = await getParentLoginBlock(uid, prof.account_status);
      if (blocked) {
        await supabase.auth.signOut();
        throw new Error(blocked);
      }
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

    signInHandledUserIdRef.current = uid;
    syncedUserIdRef.current = uid;
    setSession(data.session);
    setUser(data.user);
    setRole(r);
    roleRef.current = r;
    setLoading(false);

    if (r === 'student' && data.session) {
      void trackStudentLoginOnSignIn(data.session);
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
        emailRedirectTo: getPublicAppUrl() || window.location.origin,
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
      if (signupRole === 'parent') {
        if (
          msg.includes('student_not_found_for_guardian_link') ||
          msg.includes('guardian_student_id_required')
        ) {
          throw new Error(parentLinkErrorMessage(msg));
        }
        // GoTrue hides trigger errors behind a generic message.
        if (msg.includes('database error saving new user')) {
          throw new Error('We could not create your parent account. Check the Student ID and try again.');
        }
      }
      throw error;
    }

    // Email the student about the new parent request. The in-app notification is written
    // to the student's durable inbox by the database when the request is created.
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
