import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import StudentProfileSetup from '@/components/StudentProfileSetup';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function Settings() {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [studentId, setStudentId] = useState('');
  const { theme, setTheme } = useTheme();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? '');
      setStudentId(profile.student_id ?? '');
    }
  }, [profile]);

  const updateProfile = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName, student_id: studentId || null })
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
      toast.success('Profile updated');
    },
    onError: (e: Error) => {
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('profiles_student_id_unique') || msg.includes('duplicate key value')) {
        toast.error('This Student ID is already used by another account.');
        return;
      }
      toast.error(e.message);
    },
  });

  const { data: parentRequests = [], isLoading: parentRequestsLoading } = useQuery({
    queryKey: ['student-parent-requests', user?.id],
    enabled: role === 'student' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select('id, status, requested_at, parent_user_id, student_id_no')
        .eq('student_user_id', user!.id)
        .order('requested_at', { ascending: false });
      if (error) throw error;
      const parentIds = Array.from(new Set((data ?? []).map((r: any) => r.parent_user_id).filter(Boolean)));
      if (parentIds.length === 0) return [];
      const { data: parentProfiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', parentIds);
      if (profileError) throw profileError;
      const parentMap = new Map((parentProfiles ?? []).map((p: any) => [p.user_id, p]));
      return (data ?? []).map((row: any) => ({
        ...row,
        parent_name: parentMap.get(row.parent_user_id)?.full_name ?? 'Unknown',
        parent_email: parentMap.get(row.parent_user_id)?.email ?? '',
      }));
    },
  });

  const { data: myParentLinks = [], isLoading: myParentLinksLoading } = useQuery({
    queryKey: ['parent-my-links', user?.id],
    enabled: role === 'parent' && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select('id, status, requested_at, student_user_id, student_id_no')
        .eq('parent_user_id', user!.id)
        .order('requested_at', { ascending: false });
      if (error) throw error;
      const studentIds = Array.from(new Set((data ?? []).map((r: any) => r.student_user_id).filter(Boolean)));
      if (studentIds.length === 0) return [];
      const { data: studentProfiles, error: profileError } = await supabase
        .from('profiles')
        .select('user_id, full_name, student_id')
        .in('user_id', studentIds);
      if (profileError) throw profileError;
      const studentMap = new Map((studentProfiles ?? []).map((p: any) => [p.user_id, p]));
      return (data ?? []).map((row: any) => ({
        ...row,
        student_name: studentMap.get(row.student_user_id)?.full_name ?? 'Unknown',
        student_id: studentMap.get(row.student_user_id)?.student_id ?? row.student_id_no,
      }));
    },
  });

  const decideParentRequest = useMutation({
    mutationFn: async ({ linkId, status }: { linkId: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase
        .from('parent_student_links')
        .update({
          status,
          decided_at: new Date().toISOString(),
          decided_by: user!.id,
        })
        .eq('id', linkId)
        .eq('student_user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['student-parent-requests', user?.id] });
      toast.success(vars.status === 'approved' ? 'Parent request approved' : 'Parent request rejected');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Control account profile and app appearance preferences.</p>
          </div>
        </div>
      </section>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SettingsIcon className="h-5 w-5" />
            Appearance
          </CardTitle>
          <p className="text-muted-foreground text-sm">Choose light or dark. New visitors default to dark mode.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-md">
            <Label>Theme</Label>
            <Select value={(theme as string) || 'dark'} onValueChange={v => setTheme(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light mode</SelectItem>
                <SelectItem value="dark">Dark mode</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SettingsIcon className="h-5 w-5" />
            Profile
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {role === 'student'
              ? 'Update your name and optional student ID (e.g. school ID number).'
              : 'Update your name.'}
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : !profile ? (
            <CreateProfileForm user={user!} onCreated={() => queryClient.invalidateQueries({ queryKey: ['profile', user?.id] })} />
          ) : (
            <form className="space-y-4 max-w-md" onSubmit={e => { e.preventDefault(); updateProfile.mutate(); }}>
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" value={fullName} onChange={e => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={profile?.email ?? user?.email ?? ''} disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">Email is managed by your account and cannot be changed here.</p>
              </div>
              {role === 'student' && (
                <div className="space-y-2">
                  <Label htmlFor="student_id">Student ID (optional)</Label>
                  <Input
                    id="student_id"
                    placeholder="e.g. 2024-001"
                    value={studentId}
                    onChange={e => setStudentId(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your school or institution student number. Visible to instructors.
                  </p>
                </div>
              )}
              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {role === 'student' && (
        <StudentProfileSetup />
      )}

      {role === 'student' && (
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SettingsIcon className="h-5 w-5" />
              Parent/Guardian approvals
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Parents register using your Student ID/No. You control whether they can view your performance.
            </p>
          </CardHeader>
          <CardContent>
            {parentRequestsLoading ? (
              <p className="text-sm text-muted-foreground">Loading parent requests…</p>
            ) : parentRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No parent/guardian requests yet.</p>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Parent / Guardian</TableHead>
                      <TableHead>Student ID used</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parentRequests.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.parent_name}</div>
                          <div className="text-xs text-muted-foreground">{r.parent_email}</div>
                        </TableCell>
                        <TableCell>{r.student_id_no}</TableCell>
                        <TableCell className="capitalize">{r.status}</TableCell>
                        <TableCell className="text-right">
                          {r.status === 'pending' ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                onClick={() => decideParentRequest.mutate({ linkId: r.id, status: 'approved' })}
                                disabled={decideParentRequest.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => decideParentRequest.mutate({ linkId: r.id, status: 'rejected' })}
                                disabled={decideParentRequest.isPending}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No action needed</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {role === 'parent' && (
        <Card className="bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SettingsIcon className="h-5 w-5" />
              Student link status
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Your request must be approved by the student before you can view performance.
            </p>
          </CardHeader>
          <CardContent>
            {myParentLinksLoading ? (
              <p className="text-sm text-muted-foreground">Loading link status…</p>
            ) : myParentLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No student link request found.</p>
            ) : (
              <div className="space-y-2">
                {myParentLinks.map((link: any) => (
                  <div key={link.id} className="rounded-lg border p-3">
                    <p className="font-medium">{link.student_name}</p>
                    <p className="text-xs text-muted-foreground">Student ID/No.: {link.student_id}</p>
                    <p className="text-xs text-muted-foreground capitalize mt-1">Status: {link.status}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CreateProfileForm({ user, onCreated }: { user: { id: string; email?: string }; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profiles').insert({
        user_id: user.id,
        full_name: fullName || 'User',
        email: user.email ?? '',
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Profile created'); onCreated(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form className="space-y-4 max-w-md" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
      <p className="text-sm text-muted-foreground">Complete your profile.</p>
      <div className="space-y-2">
        <Label htmlFor="create_full_name">Full name</Label>
        <Input id="create_full_name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" required />
      </div>
      <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating...' : 'Create profile'}</Button>
    </form>
  );
}
