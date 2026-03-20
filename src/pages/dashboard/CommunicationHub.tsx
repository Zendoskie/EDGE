import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Bell, MessageCircle, Megaphone, Users } from 'lucide-react';
import MessagingSystem from '@/components/MessagingSystem';
import AnnouncementSystem from '@/components/AnnouncementSystem';
import DiscussionForum from '@/components/DiscussionForum';

export default function CommunicationHub() {
  const [unreadCount, setUnreadCount] = useState(0);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Communication Hub</h1>
          <p className="text-muted-foreground">Connect with instructors and peers</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Bell className="h-4 w-4" />
            {unreadCount} unread
          </Badge>
        </div>
      </div>

      <Card className="bg-card/90">
      <Tabs defaultValue="messages" className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-12">
          <TabsTrigger value="messages" className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Direct Messages
          </TabsTrigger>
          <TabsTrigger value="announcements" className="flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            Announcements
          </TabsTrigger>
          <TabsTrigger value="forums" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Discussion Forums
          </TabsTrigger>
        </TabsList>

        <TabsContent value="messages" className="mt-6">
          <MessagingSystem onUnreadChange={setUnreadCount} />
        </TabsContent>

        <TabsContent value="announcements" className="mt-6">
          <AnnouncementSystem />
        </TabsContent>

        <TabsContent value="forums" className="mt-6">
          <DiscussionForum />
        </TabsContent>
      </Tabs>
      </Card>
    </div>
  );
}
