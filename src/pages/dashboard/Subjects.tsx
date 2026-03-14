import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, BookOpen, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface SubjectForm {
  name: string;
  code: string;
  semester: string;
  academic_year: string;
  program_id: string;
}

const emptyForm: SubjectForm = { name: '', code: '', semester: '', academic_year: '', program_id: '' };

export default function Subjects() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<SubjectForm>(emptyForm);

  const { data: programs = [] } = useQuery({
    queryKey: ['programs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('programs').select('id, name, code').order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: subjects = [], isLoading } = useQuery({
    queryKey: ['subjects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Course code copied');
  };

  const upsert = useMutation({
    mutationFn: async (form: SubjectForm) => {
      const payload = {
        name: form.name,
        code: form.code,
        semester: form.semester || null,
        academic_year: form.academic_year || null,
        program_id: form.program_id || null,
        instructor_id: user?.id,
      };
      if (editId) {
        const { error } = await supabase.from('subjects').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('subjects').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      toast.success(editId ? 'Subject updated' : 'Subject created');
      closeDialog();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('subjects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      toast.success('Subject deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeDialog = () => { setOpen(false); setEditId(null); setForm(emptyForm); };

  const openEdit = (s: typeof subjects[0], e: React.MouseEvent) => {
    e.stopPropagation();
    setEditId(s.id);
    setForm({
      name: s.name,
      code: s.code,
      semester: s.semester || '',
      academic_year: s.academic_year || '',
      program_id: (s as any).program_id || '',
    });
    setOpen(true);
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground mb-2">Subjects</h1>
          <p className="text-muted-foreground">Manage and organize your academic subjects</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog(); else setOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="btn-primary shadow-lg hover:shadow-xl transition-all duration-200">
              <Plus className="mr-2 h-4 w-4" /> Add Subject
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editId ? 'Edit Subject' : 'New Subject'}</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); upsert.mutate(form); }}>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Subject Code</Label>
                  <Input placeholder="e.g. CS101" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required />
                </div>
                <div className="space-y-2">
                  <Label>Semester</Label>
                  <Select value={form.semester} onValueChange={v => setForm(f => ({ ...f, semester: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1st">1st Semester</SelectItem>
                      <SelectItem value="2nd">2nd Semester</SelectItem>
                      <SelectItem value="summer">Summer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Subject Name</Label>
                <Input placeholder="e.g. Introduction to Computer Science" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Academic Year</Label>
                <Input placeholder="e.g. 2025-2026" value={form.academic_year} onChange={e => setForm(f => ({ ...f, academic_year: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Program (optional)</Label>
                <Select value={form.program_id || 'none'} onValueChange={v => setForm(f => ({ ...f, program_id: v === 'none' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select program" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {programs.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={upsert.isPending}>
                {upsert.isPending ? 'Saving...' : editId ? 'Update' : 'Create'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse-glow">
            <BookOpen className="h-8 w-8 text-muted-foreground/50" />
          </div>
          <p className="text-muted-foreground text-sm ml-3">Loading subjects...</p>
        </div>
      ) : subjects.length === 0 ? (
        <Card className="card-shadow-lg border-dashed">
          <CardContent className="p-16 text-center">
            <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-6">
              <BookOpen className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No subjects yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">Create your first subject to start managing your academic courses.</p>
            <Button className="mt-6 btn-primary" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Subject
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map(s => (
            <Card
              key={s.id}
              className="card-shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group border-0 bg-gradient-to-br from-card to-card/80"
              onClick={() => navigate(`/dashboard/subjects/${s.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-primary font-bold text-xs">{s.code.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground text-base">{s.code}</p>
                        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{s.name}</p>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-1 transition-all duration-200" />
                </div>
                <div className="flex flex-wrap gap-2 items-center justify-between">
                  <div className="flex gap-2">
                    {s.semester && <Badge variant="secondary" className="text-xs">{s.semester}</Badge>}
                    {s.academic_year && <Badge variant="outline" className="text-xs">{s.academic_year}</Badge>}
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity duration-200" 
                    onClick={(e) => { e.stopPropagation(); copyCode(s.code); }} 
                    title="Copy course code"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex gap-1 mt-3 justify-end">
                  <Button variant="ghost" size="icon" onClick={(e) => openEdit(s, e)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); remove.mutate(s.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
