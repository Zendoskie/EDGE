import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function StudentProfileSetup() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [programId, setProgramId] = useState('');
  const [yearLevel, setYearLevel] = useState('');
  const [isIrregular, setIsIrregular] = useState(false);

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('programs').select('id, code, name').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: currentProfile } = useQuery({
    queryKey: ['student-program', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('student_programs')
        .select('program_id, year_level, programs(code, name)')
        .eq('student_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const saveProfile = useMutation({
    mutationFn: async ({ programId, yearLevel, isIrregular }: { programId: string; yearLevel: string; isIrregular: boolean }) => {
      if (!user?.id) throw new Error('User not authenticated');
      
      const payload = {
        student_id: user.id,
        program_id: programId || null,
        year_level: yearLevel ? parseInt(yearLevel) : null,
        is_irregular: isIrregular,
      };

      if (currentProfile) {
        const { error } = await supabase
          .from('student_programs')
          .update(payload)
          .eq('student_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('student_programs').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-program', user?.id] });
      toast.success('Profile updated successfully');
      setProgramId('');
      setYearLevel('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!isIrregular && (!programId || !yearLevel)) {
      toast.error('Please select both program and year level, or mark as irregular student');
      return;
    }
    saveProfile.mutate({ programId, yearLevel, isIrregular });
  };

  if (currentProfile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Academic Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">Program</Label>
                <p className="font-medium">
                  {currentProfile.is_irregular ? 'Irregular Student (No Restrictions)' : `${currentProfile.programs?.code} — ${currentProfile.programs?.name}`}
                </p>
              </div>
              {!currentProfile.is_irregular && (
                <div>
                  <Label className="text-sm text-muted-foreground">Year Level</Label>
                  <p className="font-medium">Year {currentProfile.year_level}</p>
                </div>
              )}
            </div>
            <div className="border rounded-lg p-4 bg-amber-50 border-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-amber-800">Enrollment Restrictions</p>
                  <p className="text-amber-700 mt-1">
                    {currentProfile.is_irregular 
                      ? 'As an irregular student, you can enroll in any course regardless of program or year restrictions.'
                      : 'Some courses may be restricted to specific programs and year levels. Your current information will be used to verify eligibility when enrolling.'
                    }
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setProgramId(currentProfile.program_id || '');
                  setYearLevel(currentProfile.year_level?.toString() || '');
                  setIsIrregular(currentProfile.is_irregular || false);
                }}
              >
                Update Information
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5" />
          Complete Your Academic Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Please provide your academic information to enroll in courses with restrictions.
          </p>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Student Status</Label>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="regular"
                    checked={!isIrregular}
                    onChange={() => setIsIrregular(false)}
                    className="text-primary"
                  />
                  <Label htmlFor="regular" className="text-sm font-medium cursor-pointer">
                    Regular Student
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    id="irregular"
                    checked={isIrregular}
                    onChange={() => setIsIrregular(true)}
                    className="text-primary"
                  />
                  <Label htmlFor="irregular" className="text-sm font-medium cursor-pointer">
                    Irregular Student
                  </Label>
                </div>
              </div>
              {isIrregular && (
                <p className="text-xs text-muted-foreground mt-2">
                  Irregular students can enroll in any course regardless of program or year restrictions.
                </p>
              )}
            </div>

            {!isIrregular && (
              <>
                <div className="space-y-2">
                  <Label>Program</Label>
                  <Select value={programId} onValueChange={setProgramId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select your program" />
                    </SelectTrigger>
                    <SelectContent>
                      {programs.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Year Level</Label>
                  <Select value={yearLevel} onValueChange={setYearLevel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select your year level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1st Year</SelectItem>
                      <SelectItem value="2">2nd Year</SelectItem>
                      <SelectItem value="3">3rd Year</SelectItem>
                      <SelectItem value="4">4th Year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <Button 
              onClick={handleSave} 
              disabled={saveProfile.isPending || (!isIrregular && (!programId || !yearLevel))}
              className="w-full"
            >
              {saveProfile.isPending ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
