import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePWA } from '@/hooks/usePWA';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BookOpen, 
  TrendingUp, 
  Calendar, 
  Award, 
  AlertTriangle,
  Brain,
  Clock,
  Target,
  BarChart3,
  Download,
  Bell
} from 'lucide-react';

type Jsonish = Record<string, unknown>;

interface OfflineData {
  subjects: Jsonish[];
  attendance: Jsonish[];
  scores: Jsonish[];
  lastSync: string;
}

export default function OfflineSupport() {
  const { user } = useAuth();
  const { isOnline, showNotification } = usePWA();
  const [offlineData, setOfflineData] = useState<OfflineData>({
    subjects: [],
    attendance: [],
    scores: [],
    lastSync: new Date().toISOString()
  });

  // Load and cache data for offline use
  const { data: subjects } = useQuery({
    queryKey: ['offline-subjects', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('enrollments')
        .select('subjects(id, code, name, instructor_id)')
        .eq('student_id', user!.id);
      return data?.map(e => e.subjects) || [];
    },
    enabled: !!user?.id && isOnline,
  });

  const { data: attendance } = useQuery({
    queryKey: ['offline-attendance', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('attendance')
        .select('*')
        .eq('student_id', user!.id)
        .order('date', { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!user?.id && isOnline,
  });

  const { data: scores } = useQuery({
    queryKey: ['offline-scores', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('submissions')
        .select('score, activities(max_score, type, name), subjects(code, name)')
        .eq('student_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!user?.id && isOnline,
  });

  // Cache data for offline use
  useEffect(() => {
    if (!isOnline || (!subjects && !attendance && !scores)) return;
    setOfflineData((prev) => {
      const newData = {
        subjects: subjects ?? prev.subjects,
        attendance: attendance ?? prev.attendance,
        scores: scores ?? prev.scores,
        lastSync: new Date().toISOString(),
      };
      localStorage.setItem("academic-guardian-offline-data", JSON.stringify(newData));
      return newData;
    });
  }, [subjects, attendance, scores, isOnline]);

  // Load cached data on mount
  useEffect(() => {
    const cached = localStorage.getItem('academic-guardian-offline-data');
    if (cached) {
      try {
        setOfflineData(JSON.parse(cached));
      } catch (error) {
        console.error('Failed to load cached data:', error);
      }
    }
  }, []);

  const syncData = async () => {
    if (!isOnline) return;
    
    showNotification('Syncing data...', { body: 'Updating your offline cache' });
    
    // Trigger refetch of all data
    window.location.reload();
  };

  const calculateAttendanceRate = () => {
    if (!offlineData.attendance.length) return 0;
    const present = offlineData.attendance.filter(a => 
      a.status === 'present' || a.status === 'late'
    ).length;
    return Math.round((present / offlineData.attendance.length) * 100);
  };

  const calculateAverageScore = () => {
    if (!offlineData.scores.length) return 0;
    const validScores = offlineData.scores.filter(s => s.score != null);
    if (!validScores.length) return 0;
    
    const total = validScores.reduce((sum, s) => {
      const maxScore = s.activities?.max_score || 100;
      return sum + (s.score / maxScore) * 100;
    }, 0);
    
    return Math.round(total / validScores.length);
  };

  const formatLastSync = () => {
    const date = new Date(offlineData.lastSync);
    return date.toLocaleString();
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Offline Learning Center
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={isOnline ? "default" : "secondary"}>
                {isOnline ? 'Online' : 'Offline'}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Last sync: {formatLastSync()}
              </span>
            </div>
            {isOnline && (
              <Button size="sm" onClick={syncData}>
                <Download className="h-4 w-4 mr-2" />
                Sync Now
              </Button>
            )}
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="subjects">Subjects</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium">Subjects</span>
                    </div>
                    <p className="text-2xl font-bold">{offlineData.subjects.length}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">Attendance</span>
                    </div>
                    <p className="text-2xl font-bold">{calculateAttendanceRate()}%</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-purple-600" />
                      <span className="text-sm font-medium">Avg Score</span>
                    </div>
                    <p className="text-2xl font-bold">{calculateAverageScore()}%</p>
                  </CardContent>
                </Card>
              </div>

              {!isOnline && (
                <Card className="border-orange-200 bg-orange-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <span className="text-sm font-medium text-orange-800">
                        Offline Mode
                      </span>
                    </div>
                    <p className="text-xs text-orange-600 mt-1">
                      You're viewing cached data. Some features may be limited until you reconnect.
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="subjects" className="space-y-4">
              <div className="space-y-2">
                {offlineData.subjects.map((subject, index) => (
                  <Card key={index}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{subject.name}</h4>
                          <p className="text-sm text-muted-foreground">{subject.code}</p>
                        </div>
                        <Badge variant="outline">Cached</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {offlineData.subjects.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    No subject data available offline
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="performance" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Attendance Rate</span>
                    <span className="text-sm">{calculateAttendanceRate()}%</span>
                  </div>
                  <Progress value={calculateAttendanceRate()} className="h-2" />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Average Score</span>
                    <span className="text-sm">{calculateAverageScore()}%</span>
                  </div>
                  <Progress value={calculateAverageScore()} className="h-2" />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recent Activity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {offlineData.scores.slice(0, 5).map((score, index) => (
                        <div key={index} className="flex items-center justify-between text-sm">
                          <span>{score.activities?.name}</span>
                          <Badge variant="outline">
                            {score.score}/{score.activities?.max_score}
                          </Badge>
                        </div>
                      ))}
                      {offlineData.scores.length === 0 && (
                        <p className="text-center text-muted-foreground py-4">
                          No score data available offline
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}
