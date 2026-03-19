import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'student' | 'instructor';

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
    role: AppRole,
    extras?: { course?: string; yearLevel?: string; studentNumber?: string; isIrregular?: boolean },
    autoSignIn?: boolean
  ) => Promise<{ user: User | null; session: Session | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRole = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    setRole(data?.role ?? null);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => fetchRole(session.user.id), 0);
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    role: AppRole,
    extras?: { course?: string; yearLevel?: string; studentNumber?: string; isIrregular?: boolean },
    autoSignIn: boolean = true
  ) => {
    const { course, yearLevel, studentNumber, isIrregular } = extras || {};

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
          course,
          year_level: yearLevel,
          student_number: studentNumber,
        },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;

    const newUserId = data.user?.id;
    if (newUserId && studentNumber) {
      // Update profiles table
      await supabase
        .from('profiles')
        .update({ student_id: studentNumber })
        .eq('user_id', newUserId);
      
      // Create student_programs record for students
      if (role === 'student' && course && yearLevel) {
        await supabase
          .from('enrollments')
          .insert({
            student_id: newUserId,
            subject_id: course, // This might need adjustment based on schema
            status: 'active',
          });
      }
    }

    // Create user role record
    if (newUserId) {
      await supabase
        .from('user_roles')
        .insert({ user_id: newUserId, role });
    }

    // Auto sign-in if requested and user was created (not email confirmation required)
    if (autoSignIn && data.user && !data.user.email_confirmed_at) {
      // User needs email confirmation, don't auto sign-in
      return data;
    }
    
    if (autoSignIn && data.user) {
      // Sign in the user immediately
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        console.warn('Auto sign-in failed:', signInError);
        // Don't throw error, user can manually sign in
      }
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
