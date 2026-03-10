-- Create messages table for direct communication
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'direct' CHECK (message_type IN ('direct', 'announcement', 'system')),
  is_read BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create announcements table for course-wide notifications
CREATE TABLE public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_pinned BOOLEAN DEFAULT false,
  is_published BOOLEAN DEFAULT true,
  published_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create message_read_receipts table for read tracking
CREATE TABLE public.message_read_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (message_id, user_id)
);

-- Create announcement_views table for tracking announcement views
CREATE TABLE public.announcement_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES public.announcements(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  viewed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

-- Create discussion_threads table for subject-specific forums
CREATE TABLE public.discussion_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  reply_count INTEGER DEFAULT 0,
  last_reply_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create discussion_replies table for forum responses
CREATE TABLE public.discussion_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES public.discussion_threads(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  parent_reply_id UUID REFERENCES public.discussion_replies(id) ON DELETE CASCADE,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on all communication tables
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_replies ENABLE ROW LEVEL SECURITY;

-- RLS policies for messages
CREATE POLICY "Users can view their own messages" ON public.messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update their own messages" ON public.messages
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE POLICY "Users can delete their own messages" ON public.messages
  FOR DELETE USING (auth.uid() = sender_id);

-- RLS policies for announcements
CREATE POLICY "Anyone can view published announcements" ON public.announcements
  FOR SELECT USING (is_published = true AND (expires_at IS NULL OR expires_at > now()));

CREATE POLICY "Instructors can manage announcements" ON public.announcements
  FOR ALL USING (public.has_role(auth.uid(), 'instructor'));

-- RLS policies for discussion threads
CREATE POLICY "Anyone enrolled can view discussion threads" ON public.discussion_threads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.enrollments 
      WHERE enrollments.subject_id = discussion_threads.subject_id 
      AND enrollments.student_id = auth.uid()
    ) OR public.has_role(auth.uid(), 'instructor')
  );

CREATE POLICY "Enrolled users can create threads" ON public.discussion_threads
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.enrollments 
      WHERE enrollments.subject_id = discussion_threads.subject_id 
      AND enrollments.student_id = auth.uid()
    ) OR public.has_role(auth.uid(), 'instructor')
  );

CREATE POLICY "Authors can update their threads" ON public.discussion_threads
  FOR UPDATE USING (auth.uid() = author_id);

CREATE POLICY "Instructors can manage threads" ON public.discussion_threads
  FOR UPDATE USING (public.has_role(auth.uid(), 'instructor'));

-- RLS policies for discussion replies
CREATE POLICY "Anyone can view discussion replies" ON public.discussion_replies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.discussion_threads
      JOIN public.enrollments ON enrollments.subject_id = discussion_threads.subject_id
      WHERE discussion_threads.id = discussion_replies.thread_id 
      AND (enrollments.student_id = auth.uid() OR public.has_role(auth.uid(), 'instructor'))
    )
  );

CREATE POLICY "Enrolled users can create replies" ON public.discussion_replies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.discussion_threads
      JOIN public.enrollments ON enrollments.subject_id = discussion_threads.subject_id
      WHERE discussion_threads.id = discussion_replies.thread_id 
      AND (enrollments.student_id = auth.uid() OR public.has_role(auth.uid(), 'instructor'))
    )
  );

-- RLS policies for read receipts and views
CREATE POLICY "Users can manage their own read receipts" ON public.message_read_receipts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own announcement views" ON public.announcement_views
  FOR ALL USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_messages_sender_receiver ON public.messages(sender_id, receiver_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);
CREATE INDEX idx_announcements_subject ON public.announcements(subject_id, published_at DESC);
CREATE INDEX idx_announcements_priority ON public.announcements(priority, published_at DESC);
CREATE INDEX idx_discussion_threads_subject ON public.discussion_threads(subject_id, last_reply_at DESC);
CREATE INDEX idx_discussion_replies_thread ON public.discussion_replies(thread_id, created_at);

-- Functions to update reply counts and timestamps
CREATE OR REPLACE FUNCTION public.update_thread_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.discussion_threads 
    SET reply_count = reply_count + 1,
        last_reply_at = NEW.created_at
    WHERE id = NEW.thread_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.discussion_threads 
    SET last_reply_at = NEW.updated_at
    WHERE id = NEW.thread_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update thread statistics
CREATE TRIGGER update_thread_stats_trigger
  AFTER INSERT OR UPDATE ON public.discussion_replies
  FOR EACH ROW EXECUTE FUNCTION public.update_thread_stats();
