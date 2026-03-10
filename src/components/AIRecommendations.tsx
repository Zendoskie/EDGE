import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Brain, 
  BookOpen, 
  Clock, 
  Users, 
  Target, 
  TrendingUp,
  Lightbulb,
  CheckCircle,
  AlertTriangle,
  Star,
  BarChart3
} from 'lucide-react';

interface LearningRecommendation {
  id: string;
  student_id: string;
  subject_id?: string;
  recommendation_type: 'study_resource' | 'time_management' | 'learning_style' | 'collaboration' | 'remediation';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  confidence_score: number;
  is_actioned: boolean;
  created_at: string;
  subjects?: {
    code: string;
    name: string;
  };
}

interface LearningResource {
  id: string;
  title: string;
  description: string;
  resource_type: 'video' | 'article' | 'quiz' | 'exercise' | 'book' | 'website' | 'tool';
  url?: string;
  subject_id?: string;
  difficulty_level: number;
  estimated_time_minutes?: number;
  tags: string[];
  created_at: string;
}

interface StudyPattern {
  id: string;
  subject_id?: string;
  study_date: string;
  study_duration_minutes: number;
  time_of_day: 'morning' | 'afternoon' | 'evening' | 'night';
  activity_type: 'reading' | 'practice' | 'review' | 'assignment' | 'discussion';
  completion_rate: number;
  difficulty_rating: number;
  subjects?: {
    code: string;
    name: string;
  };
}

export default function AIRecommendations() {
  const { user } = useAuth();
  const [selectedType, setSelectedType] = useState<string>('all');
  const [expandedRecommendation, setExpandedRecommendation] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch AI recommendations
  const { data: recommendations = [], isLoading: recommendationsLoading } = useQuery({
    queryKey: ['ai-recommendations', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('learning_recommendations')
        .select(`
          *,
          subjects(code, name)
        `)
        .eq('student_id', user.id)
        .or('expires_at.is.null,expires_at.gt.now()')
        .order('priority', { ascending: false })
        .order('confidence_score', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Fetch learning resources
  const { data: resources = [] } = useQuery({
    queryKey: ['learning-resources', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('learning_resources')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Fetch study patterns
  const { data: studyPatterns = [] } = useQuery({
    queryKey: ['study-patterns', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('study_patterns')
        .select(`
          *,
          subjects(code, name)
        `)
        .eq('student_id', user.id)
        .order('study_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Mark recommendation as actioned
  const actionRecommendationMutation = useMutation({
    mutationFn: async (recommendationId: string) => {
      const { error } = await supabase
        .from('learning_recommendations')
        .update({ is_actioned: true })
        .eq('id', recommendationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-recommendations', user?.id] });
    },
  });

  // Track resource interaction
  const trackResourceInteractionMutation = useMutation({
    mutationFn: async ({ resourceId, interactionType }: { resourceId: string; interactionType: string }) => {
      const { error } = await supabase
        .from('student_resource_interactions')
        .insert({
          student_id: user!.id,
          resource_id: resourceId,
          interaction_type: interactionType,
        });

      if (error) throw error;
    },
  });

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'study_resource': return <BookOpen className="h-5 w-5" />;
      case 'time_management': return <Clock className="h-5 w-5" />;
      case 'collaboration': return <Users className="h-5 w-5" />;
      case 'remediation': return <AlertTriangle className="h-5 w-5" />;
      default: return <Lightbulb className="h-5 w-5" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  const getResourceIcon = (type: string) => {
    switch (type) {
      case 'video': return '🎥';
      case 'article': return '📄';
      case 'quiz': return '📝';
      case 'exercise': return '💪';
      case 'book': return '📚';
      case 'website': return '🌐';
      case 'tool': return '🛠️';
      default: return '📋';
    }
  };

  const getStudyPatternInsights = () => {
    if (!studyPatterns.length) return null;

    const totalStudyTime = studyPatterns.reduce((sum, pattern) => sum + pattern.study_duration_minutes, 0);
    const avgSessionTime = totalStudyTime / studyPatterns.length;
    
    const timeOfDayDistribution = studyPatterns.reduce((acc, pattern) => {
      acc[pattern.time_of_day] = (acc[pattern.time_of_day] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const mostProductiveTime = Object.entries(timeOfDayDistribution)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'morning';

    const avgCompletionRate = studyPatterns.reduce((sum, pattern) => sum + pattern.completion_rate, 0) / studyPatterns.length;

    return {
      avgSessionTime: Math.round(avgSessionTime),
      mostProductiveTime,
      avgCompletionRate: Math.round(avgCompletionRate),
      totalStudyTime: Math.round(totalStudyTime / 60), // Convert to hours
    };
  };

  const patternInsights = getStudyPatternInsights();

  const filteredRecommendations = selectedType === 'all' 
    ? recommendations 
    : recommendations.filter((rec: LearningRecommendation) => rec.recommendation_type === selectedType);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Learning Assistant</h2>
          <p className="text-muted-foreground">Personalized recommendations powered by machine learning</p>
        </div>
        <Badge variant="outline" className="flex items-center gap-1">
          <Brain className="h-4 w-4" />
          AI-Powered
        </Badge>
      </div>

      <Tabs defaultValue="recommendations" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          <TabsTrigger value="resources">Learning Resources</TabsTrigger>
          <TabsTrigger value="insights">Study Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="mt-6">
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={selectedType === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedType('all')}
              >
                All
              </Button>
              <Button
                variant={selectedType === 'study_resource' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedType('study_resource')}
              >
                Study Resources
              </Button>
              <Button
                variant={selectedType === 'time_management' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedType('time_management')}
              >
                Time Management
              </Button>
              <Button
                variant={selectedType === 'collaboration' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedType('collaboration')}
              >
                Collaboration
              </Button>
              <Button
                variant={selectedType === 'remediation' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedType('remediation')}
              >
                Remediation
              </Button>
            </div>

            {recommendationsLoading ? (
              <div className="text-center py-8">Loading recommendations...</div>
            ) : filteredRecommendations.length === 0 ? (
              <Card>
                <CardContent className="text-center py-8">
                  <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {selectedType === 'all' 
                      ? 'No recommendations available yet. Complete more activities to get personalized suggestions!'
                      : `No ${selectedType} recommendations available.`
                    }
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredRecommendations.map((recommendation: LearningRecommendation) => (
                  <Card key={recommendation.id} className={recommendation.is_actioned ? 'opacity-60' : ''}>
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                          {getRecommendationIcon(recommendation.recommendation_type)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-semibold">{recommendation.title}</h3>
                            <Badge variant={getPriorityColor(recommendation.priority)}>
                              {recommendation.priority}
                            </Badge>
                            {recommendation.is_actioned && (
                              <Badge variant="outline" className="flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" />
                                Actioned
                              </Badge>
                            )}
                          </div>
                          {recommendation.subjects && (
                            <p className="text-sm text-muted-foreground">
                              {recommendation.subjects.code} - {recommendation.subjects.name}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {!recommendation.is_actioned && (
                            <Button
                              size="sm"
                              onClick={() => actionRecommendationMutation.mutate(recommendation.id)}
                            >
                              Mark as Complete
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedRecommendation(
                              expandedRecommendation === recommendation.id ? null : recommendation.id
                            )}
                          >
                            {expandedRecommendation === recommendation.id ? 'Hide' : 'Details'}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    {expandedRecommendation === recommendation.id && (
                      <CardContent className="border-t">
                        <div className="space-y-4">
                          <p className="text-sm">{recommendation.description}</p>
                          <div className="flex items-center gap-4 text-sm">
                            <div className="flex items-center gap-1">
                              <Target className="h-4 w-4" />
                              <span>Confidence: {Math.round(recommendation.confidence_score * 100)}%</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="h-4 w-4" />
                              <span>Created: {new Date(recommendation.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="resources" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resources.map((resource: LearningResource) => (
              <Card key={resource.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{getResourceIcon(resource.resource_type)}</span>
                    <Badge variant="outline">{resource.resource_type}</Badge>
                  </div>
                  <h3 className="font-semibold line-clamp-2">{resource.title}</h3>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
                    {resource.description}
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Difficulty:</span>
                      <div className="flex gap-1">
                        {[...Array(5)].map((_, i) => (
                          <div
                            key={i}
                            className={`w-2 h-2 rounded-full ${
                              i < resource.difficulty_level ? 'bg-blue-500' : 'bg-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    {resource.estimated_time_minutes && (
                      <div className="flex items-center justify-between text-sm">
                        <span>Duration:</span>
                        <span>{resource.estimated_time_minutes} min</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {resource.tags.map((tag, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button 
                    className="w-full mt-3"
                    onClick={() => trackResourceInteractionMutation.mutate({
                      resourceId: resource.id,
                      interactionType: 'viewed'
                    })}
                  >
                    Access Resource
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="insights" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {patternInsights && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Study Patterns
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm">Total Study Time</span>
                        <span className="font-semibold">{patternInsights.totalStudyTime}h</span>
                      </div>
                      <Progress value={Math.min(patternInsights.totalStudyTime / 40 * 100, 100)} className="h-2" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm">Avg Session</span>
                        <span className="font-semibold">{patternInsights.avgSessionTime}min</span>
                      </div>
                      <Progress value={Math.min(patternInsights.avgSessionTime / 120 * 100, 100)} className="h-2" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm">Completion Rate</span>
                        <span className="font-semibold">{patternInsights.avgCompletionRate}%</span>
                      </div>
                      <Progress value={patternInsights.avgCompletionRate} className="h-2" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Peak Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center space-y-2">
                      <div className="text-2xl font-bold capitalize">
                        {patternInsights.mostProductiveTime}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Most productive time of day
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Learning Style
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center space-y-2">
                      <div className="text-lg font-semibold">
                        {patternInsights.avgCompletionRate > 80 ? 'Visual Learner' : 
                         patternInsights.avgCompletionRate > 60 ? 'Kinesthetic Learner' : 'Reading/Writing'}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Based on your study patterns
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
