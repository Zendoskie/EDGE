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
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [tab, setTab] = useState<'login' | 'signup'>('login');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupRole, setSignupRole] = useState<'student' | 'parent'>('student');
  const [signupCourse, setSignupCourse] = useState('');
  const [signupYear, setSignupYear] = useState('');
  const [signupStudentNumber, setSignupStudentNumber] = useState('');
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

        const { error: requestError } = await (supabase as any).rpc('submit_student_registration_request', {
          p_full_name: signupName.trim(),
          p_email: signupEmail.trim(),
          p_student_id: studentNo,
          p_course: signupCourse,
          p_year_level: signupYear,
          p_is_irregular: signupYear === 'Irregular',
        });
        if (requestError) {
          const checkMsg = (requestError.message || '').toLowerCase();
          if (checkMsg.includes('student_id_in_use') || checkMsg.includes('student_id_invalid')) {
            toast.error(checkMsg.includes('student_id_invalid')
              ? 'Student No. must match the format: 22-1-7-0008'
              : 'This Student No. is already registered. Use a unique Student No.');
          } else if (checkMsg.includes('email_already_registered') || checkMsg.includes('request_already_pending')) {
            toast.error('This email already has a request or an account. Sign in after your account is activated, or use a different email.');
          } else {
            toast.error(requestError.message || 'Could not submit the student request.');
          }
          return;
        }

        setTab('login');
        setLoginEmail(signupEmail);
        setLoginPassword('');
        toast.success(
          'Request submitted and pending approval. You cannot sign in yet. After an administrator approves it, check your email for a link to create your password.'
        );
        return;
      }
      if (signupRole === 'parent') {
        if (!signupGuardianStudentId.trim()) {
          toast.error("Please enter the student's Student ID.");
          return;
        }
        const { error: requestError } = await (supabase as any).rpc('submit_parent_registration_request', {
          p_full_name: signupName.trim(),
          p_email: signupEmail.trim(),
          p_student_id: signupGuardianStudentId.trim(),
        });
        if (requestError) {
          toast.error(parentLinkErrorMessage(requestError.message));
          return;
        }
        setTab('login');
        setLoginEmail(signupEmail);
        setLoginPassword('');
        toast.success(
          'Request submitted. The student must approve it before an administrator can. You cannot sign in yet. After both approvals, check your email for a link to create your password.'
        );
        return;
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
          <p className="edge-auth-lead">Students request access with their Student ID. Parents can request a linked account. Staff use a separate request.</p>
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
                            <p className="text-xs text-muted-foreground">
                              Required on this request. You will create your password from the email sent after approval.
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                    {signupRole === 'parent' && (
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
                          Required on this request. It only asks to link that student. The student approves first, then an administrator. You create your password from the email sent after both approvals.
                        </p>
                      </div>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Submitting request...' : 'Submit request'}
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
