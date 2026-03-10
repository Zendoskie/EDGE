import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Shield, BookOpen } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

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

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupRole, setSignupRole] = useState<'student' | 'instructor'>('student');
  const [signupCourse, setSignupCourse] = useState('');
  const [signupYear, setSignupYear] = useState('');
  const [signupStudentNumber, setSignupStudentNumber] = useState('');
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(loginEmail, loginPassword);
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
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
      }

      const extras =
        signupRole === 'student'
          ? {
              course: signupCourse || undefined,
              yearLevel: signupYear || undefined,
              studentNumber: signupStudentNumber.trim() || undefined,
            }
          : undefined;

      await signUp(signupEmail, signupPassword, signupName, signupRole, extras);
      toast.success('Account created! You can now sign in.');
    } catch (err: any) {
      toast.error(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
            <Shield className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">EDGE</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Early Detection of Grade Evaluation
          </p>
        </div>

        <Card className="shadow-lg border-border/50">
          <Tabs defaultValue="login">
            <CardHeader className="pb-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent>
              <TabsContent value="login" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input id="login-email" type="email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required placeholder="you@university.edu" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input id="login-password" type="password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required placeholder="••••••••" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign In'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-0">
                <form onSubmit={handleSignup} className="space-y-4">
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
                    <Input id="signup-password" type="password" value={signupPassword} onChange={e => setSignupPassword(e.target.value)} required minLength={6} placeholder="••••••••" />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={signupRole} onValueChange={(v: 'student' | 'instructor') => setSignupRole(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">
                          <span className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Student</span>
                        </SelectItem>
                        <SelectItem value="instructor">
                          <span className="flex items-center gap-2"><Shield className="w-4 h-4" /> Instructor</span>
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
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Creating account...' : 'Create Account'}
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
