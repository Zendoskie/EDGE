import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  MessageSquare, 
  Plus, 
  Reply, 
  Lock, 
  Pin,
  Users,
  Clock,
  Search,
  Filter
} from 'lucide-react';

interface DiscussionThread {
  id: string;
  subject_id: string;
  author_id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  is_locked: boolean;
  reply_count: number;
  last_reply_at: string;
  created_at: string;
  subjects?: {
    code: string;
    name: string;
  };
  author?: {
    full_name: string;
    email: string;
  };
}

interface DiscussionReply {
  id: string;
  thread_id: string;
  author_id: string;
  content: string;
  parent_reply_id?: string;
  is_deleted: boolean;
  created_at: string;
  author?: {
    full_name: string;
    email: string;
  };
  replies?: DiscussionReply[];
}

export default function DiscussionForum() {
  const { user, role } = useAuth();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    subject_id: ''
  });
  const queryClient = useQueryClient();

  // Fetch subjects for filtering
  const { data: subjects = [] } = useQuery({
    queryKey: ['enrolled-subjects', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      let query = supabase.from('subjects').select('id, code, name');
      
      if (role === 'student') {
        const { data: enrollments } = await supabase
          .from('enrollments')
          .select('subject_id')
          .eq('student_id', user.id)
          .eq('status', 'active');
        
        const subjectIds = enrollments?.map(e => e.subject_id) || [];
        if (subjectIds.length > 0) {
          query = query.in('id', subjectIds);
        } else {
          return [];
        }
      } else if (role === 'instructor') {
        query = query.eq('instructor_id', user.id);
      }

      const { data, error } = await query.order('code');
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Fetch discussion threads
  const { data: threads = [], isLoading: threadsLoading } = useQuery({
    queryKey: ['discussion-threads', user?.id, selectedSubject, searchQuery],
    queryFn: async () => {
      if (!user?.id) return [];

      let query = supabase
        .from('discussion_threads')
        .select(`
          *,
          subjects(code, name),
          author:profiles!author_id(full_name, email)
        `)
        .order('is_pinned', { ascending: false })
        .order('last_reply_at', { ascending: false });

      // Filter by subject if selected
      if (selectedSubject) {
        query = query.eq('subject_id', selectedSubject);
      }

      // Search functionality
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Fetch thread replies
  const { data: replies = [], isLoading: repliesLoading } = useQuery({
    queryKey: ['discussion-replies', selectedThread],
    queryFn: async () => {
      if (!selectedThread) return [];
      
      const { data, error } = await supabase
        .from('discussion_replies')
        .select(`
          *,
          author:profiles!author_id(full_name, email)
        `)
        .eq('thread_id', selectedThread)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Organize replies hierarchically
      const replyMap = new Map<string, DiscussionReply>();
      const rootReplies: DiscussionReply[] = [];
      
      data.forEach((reply: any) => {
        replyMap.set(reply.id, { ...reply, replies: [] });
      });
      
      data.forEach((reply: any) => {
        if (reply.parent_reply_id) {
          const parent = replyMap.get(reply.parent_reply_id);
          if (parent) {
            parent.replies!.push(replyMap.get(reply.id)!);
          }
        } else {
          rootReplies.push(replyMap.get(reply.id)!);
        }
      });
      
      return rootReplies;
    },
    enabled: !!selectedThread,
  });

  // Create thread mutation
  const createThreadMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: result, error } = await supabase
        .from('discussion_threads')
        .insert({
          subject_id: data.subject_id,
          author_id: user!.id,
          title: data.title,
          content: data.content,
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discussion-threads', user?.id] });
      setIsCreateDialogOpen(false);
      resetForm();
    },
  });

  // Create reply mutation
  const createReplyMutation = useMutation({
    mutationFn: async ({ content, threadId, parentReplyId }: { 
      content: string; 
      threadId: string; 
      parentReplyId?: string | null 
    }) => {
      const { data: result, error } = await supabase
        .from('discussion_replies')
        .insert({
          thread_id: threadId,
          author_id: user!.id,
          content,
          parent_reply_id: parentReplyId,
        })
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discussion-replies', selectedThread] });
      queryClient.invalidateQueries({ queryKey: ['discussion-threads', user?.id] });
      setReplyContent('');
      setReplyingTo(null);
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      content: '',
      subject_id: ''
    });
  };

  const handleCreateThread = () => {
    createThreadMutation.mutate(formData);
  };

  const handleReply = (threadId: string, parentReplyId?: string | null) => {
    if (replyContent.trim()) {
      createReplyMutation.mutate({
        content: replyContent.trim(),
        threadId,
        parentReplyId
      });
    }
  };

  const selectedThreadData = threads.find((t: DiscussionThread) => t.id === selectedThread);

  const renderReplies = (replies: DiscussionReply[], depth = 0) => {
    return replies.map((reply) => (
      <div key={reply.id} className={`${depth > 0 ? 'ml-8' : ''}`}>
        <div className="border rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <Avatar>
              <AvatarImage src={undefined} />
              <AvatarFallback>
                {reply.author?.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium">{reply.author?.full_name}</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(reply.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{reply.content}</p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReplyingTo(reply.id)}
                >
                  <Reply className="h-4 w-4 mr-1" />
                  Reply
                </Button>
              </div>
              
              {replyingTo === reply.id && (
                <div className="mt-4 p-4 border rounded-lg bg-muted/50">
                  <Textarea
                    placeholder="Write your reply..."
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      onClick={() => handleReply(selectedThread!, reply.id)}
                      disabled={!replyContent.trim() || createReplyMutation.isPending}
                    >
                      Post Reply
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReplyingTo(null);
                        setReplyContent('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {reply.replies && reply.replies.length > 0 && renderReplies(reply.replies, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Threads List */}
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Discussion Forum
            </CardTitle>
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search discussions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                <option value="">All Subjects</option>
                {subjects.map((subject: any) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code} - {subject.name}
                  </option>
                ))}
              </select>
            </div>
            {role !== 'student' && (
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    New Discussion
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Discussion</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Subject</label>
                      <select
                        value={formData.subject_id}
                        onChange={(e) => setFormData(prev => ({ ...prev, subject_id: e.target.value }))}
                        className="w-full p-2 border rounded-md"
                      >
                        <option value="">Select a subject</option>
                        {subjects.map((subject: any) => (
                          <option key={subject.id} value={subject.id}>
                            {subject.code} - {subject.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Title</label>
                      <Input
                        value={formData.title}
                        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="Enter discussion title"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Content</label>
                      <Textarea
                        value={formData.content}
                        onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                        placeholder="Start the discussion..."
                        rows={6}
                      />
                    </div>
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleCreateThread}
                        disabled={!formData.title || !formData.content || !formData.subject_id}
                      >
                        Create Discussion
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              {threadsLoading ? (
                <div className="p-4 text-center">Loading discussions...</div>
              ) : threads.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  {searchQuery || selectedSubject ? 'No discussions found' : 'No discussions yet'}
                </div>
              ) : (
                <div className="space-y-2">
                  {threads.map((thread: DiscussionThread) => (
                    <div
                      key={thread.id}
                      onClick={() => setSelectedThread(thread.id)}
                      className={`p-4 cursor-pointer hover:bg-accent transition-colors border-b ${
                        selectedThread === thread.id ? 'bg-accent' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {thread.is_pinned && <Pin className="h-4 w-4 text-blue-600 mt-1" />}
                        {thread.is_locked && <Lock className="h-4 w-4 text-muted-foreground mt-1" />}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">{thread.title}</h4>
                          <p className="text-sm text-muted-foreground truncate">{thread.content}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>{thread.subjects?.code}</span>
                            <span>{thread.author?.full_name}</span>
                            <span>{thread.reply_count} replies</span>
                            <span>{new Date(thread.last_reply_at || thread.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Thread Detail */}
      <div className="lg:col-span-2">
        {selectedThreadData ? (
          <Card>
            <CardHeader>
              <div className="flex items-start gap-2">
                {selectedThreadData.is_pinned && <Pin className="h-5 w-5 text-blue-600" />}
                {selectedThreadData.is_locked && <Lock className="h-5 w-5 text-muted-foreground" />}
                <div className="flex-1">
                  <h2 className="text-xl font-bold">{selectedThreadData.title}</h2>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                    <span>{selectedThreadData.subjects?.code} - {selectedThreadData.subjects?.name}</span>
                    <span>By {selectedThreadData.author?.full_name}</span>
                    <span>{new Date(selectedThreadData.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Original Post */}
                <div className="border rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Avatar>
                      <AvatarImage src={undefined} />
                      <AvatarFallback>
                        {selectedThreadData.author?.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium">{selectedThreadData.author?.full_name}</span>
                        <Badge variant="outline">Original Poster</Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(selectedThreadData.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{selectedThreadData.content}</p>
                    </div>
                  </div>
                </div>

                {/* Replies */}
                {repliesLoading ? (
                  <div className="text-center">Loading replies...</div>
                ) : replies.length > 0 ? (
                  <div className="space-y-4">
                    <h3 className="font-semibold">Replies ({replies.length})</h3>
                    {renderReplies(replies)}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground">No replies yet. Be the first to reply!</p>
                )}

                {/* Reply Form */}
                {!selectedThreadData.is_locked && (
                  <div className="border rounded-lg p-4 bg-muted/50">
                    <h4 className="font-medium mb-2">Add Reply</h4>
                    <Textarea
                      placeholder="Share your thoughts..."
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      rows={4}
                    />
                    <div className="flex gap-2 mt-2">
                      <Button
                        onClick={() => handleReply(selectedThread!)}
                        disabled={!replyContent.trim() || createReplyMutation.isPending}
                      >
                        Post Reply
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setReplyContent('')}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
                
                {selectedThreadData.is_locked && (
                  <div className="text-center p-4 border rounded-lg bg-muted/50">
                    <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-muted-foreground">This discussion has been locked and no longer accepts replies.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex items-center justify-center h-96">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Select a discussion to view details</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
