import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Megaphone, 
  Plus, 
  Edit, 
  Trash2, 
  Pin, 
  AlertTriangle,
  Calendar,
  Eye,
  Users,
  Clock
} from 'lucide-react';

interface Announcement {
  id: string;
  instructor_id: string;
  subject_id: string;
  title: string;
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  is_pinned: boolean;
  is_published: boolean;
  published_at: string;
  expires_at?: string;
  created_at: string;
  subjects?: {
    code: string;
    name: string;
  };
  instructor?: {
    full_name: string;
    email: string;
  };
  _count?: {
    views: number;
  };
}

export default function AnnouncementSystem() {
  const { user, role } = useAuth();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'normal' as const,
    subject_id: '',
    is_pinned: false,
    expires_at: ''
  });
  const queryClient = useQueryClient();

  // Fetch subjects for instructors
  const { data: subjects = [] } = useQuery({
    queryKey: ['instructor-subjects', user?.id],
    queryFn: async () => {
      if (!user?.id || role !== 'instructor') return [];
      
      const { data, error } = await supabase
        .from('subjects')
        .select('id, code, name')
        .eq('instructor_id', user.id)
        .order('code');

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && role === 'instructor',
  });

  // Fetch announcements
  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      let query = supabase
        .from('announcements')
        .select(`
          *,
          subjects(code, name),
          instructor:profiles!instructor_id(full_name, email),
          announcement_views(count)
        `)
        .eq('is_published', true)
        .or('expires_at.is.null,expires_at.gt.now()')
        .order('is_pinned', { ascending: false })
        .order('priority', { ascending: false })
        .order('published_at', { ascending: false });

      // If student, only show announcements for their enrolled subjects
      if (role === 'student') {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('subject_id')
          .eq('student_id', user.id)
          .eq('status', 'active');

        const subjectIds = enrollments?.map(e => e.subject_id) || [];
        if (subjectIds.length > 0) {
          query = query.in('subject_id', subjectIds);
        } else {
          return [];
        }
      }

      // If instructor, only show their announcements
      if (role === 'instructor') {
        query = query.eq('instructor_id', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Create announcement mutation
  const createAnnouncementMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: result, error } = await supabase
        .from('announcements')
        .insert({
          instructor_id: user!.id,
          subject_id: data.subject_id,
          title: data.title,
          content: data.content,
          priority: data.priority,
          is_pinned: data.is_pinned,
          expires_at: data.expires_at || null,
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', user?.id] });
      setIsCreateDialogOpen(false);
      resetForm();
    },
  });

  // Update announcement mutation
  const updateAnnouncementMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const { data: result, error } = await supabase
        .from('announcements')
        .update({
          title: data.title,
          content: data.content,
          priority: data.priority,
          is_pinned: data.is_pinned,
          expires_at: data.expires_at || null,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', user?.id] });
      setEditingAnnouncement(null);
      resetForm();
    },
  });

  // Delete announcement mutation
  const deleteAnnouncementMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('announcements')
        .update({ is_published: false })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements', user?.id] });
    },
  });

  // Mark announcement as viewed
  const markAsViewed = async (announcementId: string) => {
    await supabase
      .from('announcement_views')
      .upsert({
        announcement_id: announcementId,
        user_id: user!.id,
      });
  };

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      priority: 'normal',
      subject_id: '',
      is_pinned: false,
      expires_at: ''
    });
  };

  const handleSubmit = () => {
    if (editingAnnouncement) {
      updateAnnouncementMutation.mutate({ id: editingAnnouncement.id, data: formData });
    } else {
      createAnnouncementMutation.mutate(formData);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'destructive';
      case 'normal': return 'default';
      case 'low': return 'secondary';
      default: return 'default';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return <AlertTriangle className="h-4 w-4" />;
      case 'high': return <AlertTriangle className="h-4 w-4" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Announcements</h2>
          <p className="text-muted-foreground">
            {role === 'instructor' ? 'Manage course announcements' : 'Stay updated with important notices'}
          </p>
        </div>
        
        {role === 'instructor' && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditingAnnouncement(null)}>
                <Plus className="h-4 w-4 mr-2" />
                New Announcement
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Subject</label>
                  <Select value={formData.subject_id} onValueChange={(value) => setFormData(prev => ({ ...prev, subject_id: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((subject: any) => (
                        <SelectItem key={subject.id} value={subject.id}>
                          {subject.code} - {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter announcement title"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">Content</label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                    placeholder="Enter announcement content"
                    rows={6}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Priority</label>
                    <Select value={formData.priority} onValueChange={(value: any) => setFormData(prev => ({ ...prev, priority: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium">Expires At</label>
                    <Input
                      type="datetime-local"
                      value={formData.expires_at}
                      onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))}
                    />
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="is_pinned"
                    checked={formData.is_pinned}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_pinned: e.target.checked }))}
                  />
                  <label htmlFor="is_pinned" className="text-sm">Pin this announcement</label>
                </div>
                
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleSubmit}
                    disabled={!formData.title || !formData.content || !formData.subject_id}
                  >
                    {editingAnnouncement ? 'Update' : 'Create'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8">Loading announcements...</div>
        ) : announcements.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <Megaphone className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {role === 'instructor' ? 'No announcements yet. Create your first one!' : 'No announcements available.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          announcements.map((announcement: Announcement) => (
            <Card key={announcement.id} className={announcement.is_pinned ? 'border-blue-200 bg-blue-50/50' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {announcement.is_pinned && <Pin className="h-4 w-4 text-blue-600" />}
                      <h3 className="font-semibold">{announcement.title}</h3>
                      <Badge variant={getPriorityColor(announcement.priority)} className="flex items-center gap-1">
                        {getPriorityIcon(announcement.priority)}
                        {announcement.priority}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{announcement.subjects?.code} - {announcement.subjects?.name}</span>
                      <span>By {announcement.instructor?.full_name}</span>
                      <span>{new Date(announcement.published_at).toLocaleDateString()}</span>
                      {announcement.expires_at && (
                        <span>Expires {new Date(announcement.expires_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  
                  {role === 'instructor' && announcement.instructor_id === user?.id && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingAnnouncement(announcement);
                          setFormData({
                            title: announcement.title,
                            content: announcement.content,
                            priority: announcement.priority,
                            subject_id: announcement.subject_id,
                            is_pinned: announcement.is_pinned,
                            expires_at: announcement.expires_at?.split('.')[0] || ''
                          });
                          setIsCreateDialogOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteAnnouncementMutation.mutate(announcement.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="prose max-w-none">
                  <p className="whitespace-pre-wrap">{announcement.content}</p>
                </div>
                
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Eye className="h-4 w-4" />
                      <span>{announcement._count?.views || 0} views</span>
                    </div>
                  </div>
                  
                  {role === 'student' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markAsViewed(announcement.id)}
                    >
                      Mark as Read
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
