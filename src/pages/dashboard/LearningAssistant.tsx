import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// import AIRecommendations from '@/components/AIRecommendations';
import { 
  Brain, 
  BookOpen, 
  Target, 
  TrendingUp,
  Calendar,
  Users
} from 'lucide-react';

export default function LearningAssistant() {
  const [activeTab, setActiveTab] = useState('recommendations');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Learning Assistant</h1>
          <p className="text-muted-foreground">Your AI-powered academic companion</p>
        </div>
        <Badge className="flex items-center gap-2">
          <Brain className="h-4 w-4" />
          AI Enhanced
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="recommendations" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Recommendations
          </TabsTrigger>
          <TabsTrigger value="resources" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Resources
          </TabsTrigger>
          <TabsTrigger value="insights" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Insights
          </TabsTrigger>
          <TabsTrigger value="planning" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Planning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="mt-6">
          <Card>
            <CardContent className="text-center py-8">
              <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                AI-powered recommendations coming soon!
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Get personalized learning suggestions based on your performance and study patterns.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources" className="mt-6">
          <Card>
            <CardContent className="text-center py-8">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Learning resources coming soon!
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Access curated learning materials and resources tailored to your needs.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights" className="mt-6">
          <Card>
            <CardContent className="text-center py-8">
              <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Study insights coming soon!
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Analyze your learning patterns and performance trends.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="planning" className="mt-6">
          <Card>
            <CardContent className="text-center py-8">
              <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Smart study planning features coming soon!
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Get personalized study schedules based on your patterns and upcoming deadlines.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
