import { useState, useEffect, useRef } from 'react';
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
import { 
  Send, 
  Search, 
  MessageCircle, 
  Users, 
  Bell,
  Check,
  CheckCheck,
  Reply,
  MoreVertical,
  Paperclip
} from 'lucide-react';

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  message_type: string;
  is_read: boolean;
  created_at: string;
  sender?: {
    full_name: string;
    email: string;
  };
  receiver?: {
    full_name: string;
    email: string;
  };
}

interface Conversation {
  user_id: string;
  full_name: string;
  email: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
}

interface MessagingSystemProps {
  onUnreadChange?: (count: number) => void;
}

export default function MessagingSystem({ onUnreadChange }: MessagingSystemProps) {
  const { user } = useAuth();
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [messageContent, setMessageContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch conversations
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ['conversations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          content,
          created_at,
          is_read,
          sender_id,
          receiver_id,
          sender:profiles!sender_id(full_name, email),
          receiver:profiles!receiver_id(full_name, email)
        `)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group messages by conversation partner
      const conversationMap = new Map<string, Conversation>();
      
      data.forEach((message: any) => {
        const partnerId = message.sender_id === user.id ? message.receiver_id : message.sender_id;
        const partner = message.sender_id === user.id ? message.receiver : message.sender;
        
        if (!conversationMap.has(partnerId) || new Date(message.created_at) > new Date(conversationMap.get(partnerId)!.last_message_time)) {
          conversationMap.set(partnerId, {
            user_id: partnerId,
            full_name: partner.full_name,
            email: partner.email,
            last_message: message.content,
            last_message_time: message.created_at,
            unread_count: message.sender_id !== user.id && !message.is_read ? 1 : 0
          });
        } else if (message.sender_id !== user.id && !message.is_read) {
          const conv = conversationMap.get(partnerId)!;
          conv.unread_count += 1;
        }
      });

      const list = Array.from(conversationMap.values()).sort((a, b) => 
        new Date(b.last_message_time).getTime() - new Date(a.last_message_time).getTime()
      );
      const totalUnread = list.reduce((sum, c) => sum + c.unread_count, 0);
      if (onUnreadChange) {
        onUnreadChange(totalUnread);
      }
      return list;
    },
    enabled: !!user?.id,
  });

  // Fetch messages for selected conversation
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', user?.id, selectedConversation],
    queryFn: async () => {
      if (!user?.id || !selectedConversation) return [];
      
      const { data, error } = await supabase
        .from('messages')
        .select(`
          *,
          sender:profiles!sender_id(full_name, email),
          receiver:profiles!receiver_id(full_name, email)
        `)
        .or(`(sender_id.eq.${user.id},receiver_id.eq.${selectedConversation}),(sender_id.eq.${selectedConversation},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Mark messages as read
      const unreadMessages = data.filter((msg: any) => msg.receiver_id === user.id && !msg.is_read);
      if (unreadMessages.length > 0) {
        await supabase
          .from('messages')
          .update({ is_read: true })
          .in('id', unreadMessages.map((msg: any) => msg.id));
      }

      return data;
    },
    enabled: !!user?.id && !!selectedConversation,
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, receiverId }: { content: string; receiverId: string }) => {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: user!.id,
          receiver_id: receiverId,
          content,
          message_type: 'direct'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setMessageContent('');
      queryClient.invalidateQueries({ queryKey: ['messages', user?.id, selectedConversation] });
      queryClient.invalidateQueries({ queryKey: ['conversations', user?.id] });
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = () => {
    if (messageContent.trim() && selectedConversation) {
      sendMessageMutation.mutate({
        content: messageContent.trim(),
        receiverId: selectedConversation,
      });
    }
  };

  const filteredConversations = conversations.filter(conv =>
    conv.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedConv = conversations.find(c => c.user_id === selectedConversation);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
      {/* Conversations List */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Messages
          </CardTitle>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            {conversationsLoading ? (
              <div className="p-4 text-center text-muted-foreground">Loading conversations...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                {searchQuery ? 'No conversations found' : 'No conversations yet'}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.user_id}
                    onClick={() => setSelectedConversation(conv.user_id)}
                    className={`p-4 cursor-pointer hover:bg-accent transition-colors ${
                      selectedConversation === conv.user_id ? 'bg-accent' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={undefined} />
                        <AvatarFallback>
                          {conv.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium truncate">{conv.full_name}</p>
                          <span className="text-xs text-muted-foreground">
                            {new Date(conv.last_message_time).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{conv.last_message}</p>
                      </div>
                      {conv.unread_count > 0 && (
                        <Badge variant="destructive" className="h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Message Area */}
      <Card className="lg:col-span-2">
        {selectedConversation ? (
          <>
            <CardHeader className="border-b">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={undefined} />
                  <AvatarFallback>
                    {selectedConv?.full_name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{selectedConv?.full_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedConv?.email}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[400px] p-4">
                {messagesLoading ? (
                  <div className="text-center text-muted-foreground">Loading messages...</div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message: Message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[70%] ${message.sender_id === user?.id ? 'order-2' : 'order-1'}`}>
                          <div
                            className={`rounded-lg p-3 ${
                              message.sender_id === user?.id
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted'
                            }`}
                          >
                            <p className="text-sm">{message.content}</p>
                          </div>
                          <div className={`flex items-center gap-1 mt-1 text-xs text-muted-foreground ${
                            message.sender_id === user?.id ? 'justify-end' : 'justify-start'
                          }`}>
                            <span>{new Date(message.created_at).toLocaleTimeString()}</span>
                            {message.sender_id === user?.id && (
                              message.is_read ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>
              <div className="border-t p-4">
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Type your message..."
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    className="flex-1 min-h-[40px] max-h-32 resize-none"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!messageContent.trim() || sendMessageMutation.isPending}
                    size="icon"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </>
        ) : (
          <CardContent className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Select a conversation to start messaging</p>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
