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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4">
        <h1 className="text-2xl font-display font-bold">Settings</h1>
      </div>

      <Card className="bg-card/90">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SettingsIcon className="h-5 w-5" />
            Appearance
          </CardTitle>
          <p className="text-muted-foreground text-sm">Choose light, dark, or match your device.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-md">
            <Label>Theme</Label>
            <Select value={(theme as string) || 'light'} onValueChange={v => setTheme(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light mode</SelectItem>
                <SelectItem value="dark">Dark mode</SelectItem>
                <SelectItem value="system">Match device</SelectItem>
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
