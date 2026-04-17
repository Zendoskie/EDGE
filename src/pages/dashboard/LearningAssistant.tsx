import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import AIRecommendations from '@/components/AIRecommendations';
import { Brain, Target, Calendar, TrendingUp } from 'lucide-react';

export default function LearningAssistant() {
  const [activeTab, setActiveTab] = useState('assistant');

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
        <div>
          <h1 className="text-2xl font-display font-bold">Learning Assistant</h1>
          <p className="text-muted-foreground">Your AI-powered academic companion</p>
        </div>
        <Badge className="flex items-center gap-2">
          <Brain className="h-4 w-4" />
          AI Enhanced
        </Badge>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-12">
          <TabsTrigger value="assistant" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Assistant
          </TabsTrigger>
          <TabsTrigger value="patterns" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Study Patterns
          </TabsTrigger>
          <TabsTrigger value="planning" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Planning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assistant" className="mt-6">
          <AIRecommendations />
        </TabsContent>

        <TabsContent value="patterns" className="mt-6">
          <AIRecommendations />
        </TabsContent>

        <TabsContent value="planning" className="mt-6">
          <AIRecommendations />
        </TabsContent>
      </Tabs>
    </div>
  );
}
