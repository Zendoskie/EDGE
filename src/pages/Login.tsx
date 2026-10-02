import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { BookOpen, Users } from 'lucide-react';
import { AuthSlider } from '@/components/shell/AuthSlider';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { parentLinkErrorMessage } from '@/lib/parent-link-status';

const DEFAULT_PROGRAMS: Array<{ id: string; code: string; name: string }> = [
  {
    id: 'BSCS',
    code: 'BSCS',
    name: 'Bachelor of Science in Computer Science',
  },
  {
    id: 'BSBA',
    code: 'BSBA',
    name: 'Bachelor of Science in Business Administration',
  },
  {
    id: 'BEED',
    code: 'BEED',
    name: 'Bachelor of Elementary Education',
  },
  {
    id: 'BSED',
    code: 'BSED',
    name: 'Bachelor of Secondary Education',
  },
];

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [tab, setTab] = useState<'login' | 'signup'>('login');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupRole, setSignupRole] = useState<'student' | 'parent'>('student');
  const [signupCourse, setSignupCourse] = useState('');
  const [signupYear, setSignupYear] = useState('');
  const [signupStudentNumber, setSignupStudentNumber] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupGuardianStudentId, setSignupGuardianStudentId] = useState('');
  const [programs, setPrograms] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [programsLoading, setProgramsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadPrograms = async () => {
      setProgramsLoading(true);
      const { data, error } = await supabase
        .from('programs')
        .select('id, code, name')
        .order('name');
      if (cancelled) return;
      if (error) {
        // Non-blocking: allow signup even if programs fail to load.
        console.warn('Failed to load programs', error);
        setPrograms([]);
      } else {
        setPrograms((data ?? []).map(p => ({ id: p.id, code: p.code, name: p.name })));
      }
      setProgramsLoading(false);
    };
    loadPrograms();
    return () => {
      cancelled = true;
    };
  }, []);

  const loginErrorMessage = (err: unknown): string => {
    if (err instanceof Error && err.message.trim()) return err.message;
    return 'Invalid credentials';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(loginEmail, loginPassword);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduceMotion) {
        setLeaving(true);
        await new Promise((resolve) => window.setTimeout(resolve, 420));
      }
      navigate("/dashboard");
    } catch (err: unknown) {
      toast.error(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (signupRole === 'student') {
        if (!signupCourse) {
          toast.error('Please select your course.');
          return;
        }
        if (!signupYear) {
          toast.error('Please select your year level.');
          return;
        }
        const studentNo = signupStudentNumber.trim();
        const studentNoRegex = /^\d{2}-\d-\d-\d{4}$/;
        if (!studentNoRegex.test(studentNo)) {
          toast.error('Student No. must match the format: 22-1-7-0008');
          return;
        }

        // Prevent duplicate Student ID before creating auth user.
        // Runs via a SECURITY DEFINER RPC because anon cannot SELECT profiles (RLS),
        // and GoTrue hides the DB trigger's duplicate error behind a generic message.
        const { error: studentIdCheckError } = await supabase.rpc('validate_student_signup', {
          p_student_id_no: studentNo,
        });
        if (studentIdCheckError) {
          const checkMsg = (studentIdCheckError.message || '').toLowerCase();
          if (checkMsg.includes('student_id_in_use')) {
            toast.error('This Student No. is already registered. Use a unique Student No.');
            return;
          }
          // Unexpected error: let the signup attempt proceed; the DB trigger still enforces the check.
        }
      }
      if (signupRole === 'parent') {
        if (!signupGuardianStudentId.trim()) {
          toast.error("Please enter the student's Student ID.");
          return;
        }
        if (signupPassword !== signupConfirmPassword) {
          toast.error('Passwords do not match.');
          return;
        }
        // The Student ID only locates the student and creates a request; it grants no access.
        // GoTrue hides trigger errors behind a generic message, so surface them here first.
        const { error: parentCheckError } = await supabase.rpc('validate_parent_signup', {
          p_student_id_no: signupGuardianStudentId.trim(),
          p_parent_email: signupEmail.trim(),
        });
        if (parentCheckError) {
          toast.error(parentLinkErrorMessage(parentCheckError.message));
          return;
        }
      }

      // Check if student is irregular based on year selection
      const isIrregular = signupYear === 'Irregular';
      
      // For irregular students, set a default year level for database
      const yearLevelForDb = isIrregular ? '1st Year' : signupYear;

      const extras =
        signupRole === 'student'
          ? {
              course: signupCourse || undefined,
              yearLevel: yearLevelForDb || undefined,
              studentNumber: signupStudentNumber.trim() || undefined,
              isIrregular: isIrregular,
            }
          : signupRole === 'parent'
            ? {
                guardianStudentId: signupGuardianStudentId.trim() || undefined,
              }
          : undefined;

      const result = await signUp(signupEmail, signupPassword, signupName, signupRole, extras);

      setTab('login');
      setLoginEmail(signupEmail);
      setLoginPassword('');

      if (result.user && signupRole === 'parent') {
        toast.success(
          'Request submitted. The student must approve it first, then an administrator. You can sign in after both approvals.'
        );
      } else if (result.user) {
        toast.success(
          'Account submitted. An administrator must approve it before you can sign in. Confirm your email if your organization requires it.'
        );
      } else {
        toast.success('If this email is available, check your inbox to finish signup.');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSlider
      mode={tab}
      onModeChange={setTab}
      leaving={leaving}
      login={
        <>
          <h2>Sign in to EDGE</h2>
          <p className="edge-auth-lead">Enter your university email to open your workspace.</p>
          <form onSubmit={handleLogin} className="edge-auth-fields">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input id="login-email" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required placeholder="you@university.edu" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <PasswordInput
                        id="login-password"
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={e => setLoginPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Signing in...' : 'Sign In'}
                    </Button>
                  </form>

          <p className="edge-auth-switch">
            New to EDGE?{" "}
            <button type="button" aria-label="Switch to sign up" onClick={() => setTab("signup")}>
              Create account
            </button>
          </p>
          <p className="edge-auth-note">
            <Link to="/request-staff-account">Instructor or counselor? Request a staff account</Link>
          </p>
        </>
      }
      signup={
        <>
          <h2>Create your EDGE account</h2>
          <p className="edge-auth-lead">Students and parents can request access. Staff use a separate request.</p>
          <form onSubmit={handleSignup} className="edge-auth-fields">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full Name</Label>
                      <Input id="signup-name" value={signupName} onChange={e => setSignupName(e.target.value)} required placeholder="Juan Dela Cruz" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <Input id="signup-email" type="email" value={signupEmail} onChange={e => setSignupEmail(e.target.value)} required placeholder="you@university.edu" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <PasswordInput
                        id="signup-password"
                        autoComplete="new-password"
                        value={signupPassword}
                        onChange={e => setSignupPassword(e.target.value)}
                        required
                        minLength={6}
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={signupRole} onValueChange={(v: 'student' | 'parent') => setSignupRole(v)}>
                        <SelectTrigger id="signup-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="student">
                            <span className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Student</span>
                          </SelectItem>
                          <SelectItem value="parent">
                            <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Parent / Guardian</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {signupRole === 'student' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="signup-course">Course</Label>
                          <Select value={signupCourse} onValueChange={setSignupCourse} disabled={programsLoading}>
                            <SelectTrigger id="signup-course">
                              <SelectValue placeholder={programsLoading ? 'Loading courses...' : 'Select course'} />
                            </SelectTrigger>
                            <SelectContent>
                              {programsLoading ? (
                                <div className="flex items-center justify-center py-2">
                                  <span className="text-sm text-muted-foreground">Loading courses...</span>
                                </div>
                              ) : (
                                (programs.length > 0 ? programs : DEFAULT_PROGRAMS).map(p => (
                                  <SelectItem key={p.id} value={p.code}>
                                    {p.code} — {p.name}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                          {programs.length === 0 && !programsLoading && (
                            <p className="text-xs text-muted-foreground">
                              Contact an administrator to add academic programs.
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="signup-year">Year level</Label>
                            <Select value={signupYear} onValueChange={setSignupYear}>
                              <SelectTrigger id="signup-year">
                                <SelectValue placeholder="Select year level" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1st Year">1st Year</SelectItem>
                                <SelectItem value="2nd Year">2nd Year</SelectItem>
                                <SelectItem value="3rd Year">3rd Year</SelectItem>
                                <SelectItem value="4th Year">4th Year</SelectItem>
                                <SelectItem value="Irregular">Irregular</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="signup-student-number">Student No.</Label>
                            <Input
                              id="signup-student-number"
                              value={signupStudentNumber}
                              onChange={e => setSignupStudentNumber(e.target.value.replace(/\s+/g, ''))}
                              required
                              placeholder="22-1-7-0008"
                              pattern="^\d{2}-\d-\d-\d{4}$"
                              title="Use format: 22-1-7-0008"
                            />
                          </div>
                        </div>
                      </>
                    )}
                    {signupRole === 'parent' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                          <PasswordInput
                            id="signup-confirm-password"
                            autoComplete="new-password"
                            value={signupConfirmPassword}
                            onChange={e => setSignupConfirmPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder="••••••••"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="signup-guardian-student-id">Student ID</Label>
                          <Input
                            id="signup-guardian-student-id"
                            value={signupGuardianStudentId}
                            onChange={e => setSignupGuardianStudentId(e.target.value)}
                            required
                            placeholder="e.g. 22-1-7-0008"
                          />
                          <p className="text-xs text-muted-foreground">
                            Enter your child&apos;s Student ID. The student must approve your request first, then an administrator. You can sign in only after both approvals.
                          </p>
                        </div>
                      </>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Creating account...' : 'Create Account'}
                    </Button>
                  </form>
          <p className="edge-auth-switch">
            Already have an account?{" "}
            <button type="button" aria-label="Switch to sign in" onClick={() => setTab("login")}>
              Sign in
            </button>
          </p>
        </>
      }
    />
  );
}
