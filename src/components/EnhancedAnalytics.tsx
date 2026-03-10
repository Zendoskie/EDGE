import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent 
} from '@/components/ui/chart';
import { 
  LineChart, 
  Line, 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Calendar,
  Brain,
  Award,
  Clock,
  BookOpen,
  BarChart3,
  Activity,
  Zap
} from 'lucide-react';

interface PerformanceData {
  date: string;
  score: number;
  attendance: number;
  subject: string;
  type: string;
}

interface TrendData {
  period: string;
  averageScore: number;
  attendanceRate: number;
  riskLevel: number;
}

interface SubjectPerformance {
  subject: string;
  averageScore: number;
  attendanceRate: number;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function EnhancedAnalytics() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'semester'>('month');

  // Fetch comprehensive performance data
  const { data: performanceData = [], isLoading } = useQuery({
    queryKey: ['performance-analytics', user?.id, timeRange],
    queryFn: async () => {
      if (!user?.id) return [];

      const daysBack = timeRange === 'week' ? 7 : timeRange === 'month' ? 30 : 120;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      // Get scores with activities and subjects
      const { data: scores } = await supabase
        .from('submissions')
        .select(`
          score,
          created_at,
          activities!inner(max_score, type, name, subject_id),
          subjects!inner(code, name)
        `)
        .eq('student_id', user.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      // Get attendance data
      const { data: attendance } = await supabase
        .from('attendance')
        .select('date, status, subjects!inner(code, name)')
        .eq('student_id', user.id)
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: true });

      // Get predictions
      const { data: predictions } = await supabase
        .from('predictions')
        .select('risk_level, created_at, subjects!inner(code, name)')
        .eq('student_id', user.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      return { scores, attendance, predictions };
    },
    enabled: !!user?.id,
  });

  // Process data for charts
  const processTrendData = (): TrendData[] => {
    if (!performanceData.scores || !performanceData.attendance) return [];

    const groupedByPeriod = new Map<string, { scores: number[], attendance: number[], risk: number[] }>();
    
    // Group data by time period
    performanceData.scores.forEach((score: any) => {
      const date = new Date(score.created_at);
      const period = timeRange === 'week' 
        ? date.toLocaleDateString('en', { weekday: 'short' })
        : timeRange === 'month'
        ? date.toLocaleDateString('en', { day: 'numeric', month: 'short' })
        : `Week ${Math.ceil((date.getDate() - 1) / 7)}`;
      
      if (!groupedByPeriod.has(period)) {
        groupedByPeriod.set(period, { scores: [], attendance: [], risk: [] });
      }
      
      const normalizedScore = (score.score / score.activities.max_score) * 100;
      groupedByPeriod.get(period)!.scores.push(normalizedScore);
    });

    performanceData.attendance.forEach((att: any) => {
      const date = new Date(att.date);
      const period = timeRange === 'week' 
        ? date.toLocaleDateString('en', { weekday: 'short' })
        : timeRange === 'month'
        ? date.toLocaleDateString('en', { day: 'numeric', month: 'short' })
        : `Week ${Math.ceil((date.getDate() - 1) / 7)}`;
      
      if (!groupedByPeriod.has(period)) {
        groupedByPeriod.set(period, { scores: [], attendance: [], risk: [] });
      }
      
      const isPresent = att.status === 'present' || att.status === 'late';
      groupedByPeriod.get(period)!.attendance.push(isPresent ? 1 : 0);
    });

    // Convert to array and calculate averages
    return Array.from(groupedByPeriod.entries()).map(([period, data]) => ({
      period,
      averageScore: data.scores.length ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length) : 0,
      attendanceRate: data.attendance.length ? Math.round((data.attendance.reduce((a, b) => a + b, 0) / data.attendance.length) * 100) : 0,
      riskLevel: 0 // Will be calculated based on predictions
    }));
  };

  const processSubjectPerformance = (): SubjectPerformance[] => {
    if (!performanceData.scores) return [];

    const subjectMap = new Map<string, { scores: number[], subjectName: string }>();
    
    performanceData.scores.forEach((score: any) => {
      const subjectCode = score.subjects.code;
      if (!subjectMap.has(subjectCode)) {
        subjectMap.set(subjectCode, { scores: [], subjectName: score.subjects.name });
      }
      
      const normalizedScore = (score.score / score.activities.max_score) * 100;
      subjectMap.get(subjectCode)!.scores.push(normalizedScore);
    });

    return Array.from(subjectMap.entries()).map(([code, data]) => {
      const scores = data.scores;
      const recentScores = scores.slice(-5);
      const olderScores = scores.slice(0, -5);
      
      const recentAvg = recentScores.length ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : 0;
      const olderAvg = olderScores.length ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length : recentAvg;
      
      let trend: 'up' | 'down' | 'stable' = 'stable';
      let trendValue = 0;
      
      if (recentAvg > olderAvg + 5) {
        trend = 'up';
        trendValue = Math.round(recentAvg - olderAvg);
      } else if (recentAvg < olderAvg - 5) {
        trend = 'down';
        trendValue = Math.round(olderAvg - recentAvg);
      }

      return {
        subject: data.subjectName,
        averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        attendanceRate: 0, // Would need to calculate from attendance data
        trend,
        trendValue
      };
    });
  };

  const trendData = processTrendData();
  const subjectPerformance = processSubjectPerformance();

  const overallStats = {
    averageScore: subjectPerformance.length 
      ? Math.round(subjectPerformance.reduce((sum, s) => sum + s.averageScore, 0) / subjectPerformance.length)
      : 0,
    attendanceRate: performanceData.attendance?.length 
      ? Math.round((performanceData.attendance.filter((a: any) => a.status === 'present' || a.status === 'late').length / performanceData.attendance.length) * 100)
      : 0,
    totalSubjects: subjectPerformance.length,
    improvingSubjects: subjectPerformance.filter(s => s.trend === 'up').length,
    decliningSubjects: subjectPerformance.filter(s => s.trend === 'down').length
  };

  const pieData = [
    { name: 'Excellent', value: subjectPerformance.filter(s => s.averageScore >= 90).length, color: '#10b981' },
    { name: 'Good', value: subjectPerformance.filter(s => s.averageScore >= 75 && s.averageScore < 90).length, color: '#3b82f6' },
    { name: 'Average', value: subjectPerformance.filter(s => s.averageScore >= 60 && s.averageScore < 75).length, color: '#f59e0b' },
    { name: 'Needs Improvement', value: subjectPerformance.filter(s => s.averageScore < 60).length, color: '#ef4444' }
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-6">
      {/* Header with Time Range Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Learning Analytics</h2>
          <p className="text-muted-foreground">Track your academic progress and performance trends</p>
        </div>
        <Tabs value={timeRange} onValueChange={(value) => setTimeRange(value as any)}>
          <TabsList>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="semester">Semester</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium">Avg Score</span>
            </div>
            <p className="text-2xl font-bold">{overallStats.averageScore}%</p>
            <p className="text-xs text-muted-foreground">Across all subjects</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium">Attendance</span>
            </div>
            <p className="text-2xl font-bold">{overallStats.attendanceRate}%</p>
            <p className="text-xs text-muted-foreground">This {timeRange}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium">Subjects</span>
            </div>
            <p className="text-2xl font-bold">{overallStats.totalSubjects}</p>
            <p className="text-xs text-muted-foreground">Active enrollments</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium">Improving</span>
            </div>
            <p className="text-2xl font-bold">{overallStats.improvingSubjects}</p>
            <p className="text-xs text-muted-foreground">Subjects on rise</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-sm font-medium">Declining</span>
            </div>
            <p className="text-2xl font-bold">{overallStats.decliningSubjects}</p>
            <p className="text-xs text-muted-foreground">Need attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Performance Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{}} className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Line 
                    type="monotone" 
                    dataKey="averageScore" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    name="Average Score"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="attendanceRate" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    name="Attendance Rate"
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Subject Performance Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Grade Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{}} className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent />} />
                </PieChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Subject Performance Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Subject Performance Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {subjectPerformance.map((subject, index) => (
              <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium">{subject.subject}</h4>
                    <Badge variant={subject.trend === 'up' ? 'default' : subject.trend === 'down' ? 'destructive' : 'secondary'}>
                      {subject.trend === 'up' && <TrendingUp className="h-3 w-3 mr-1" />}
                      {subject.trend === 'down' && <TrendingDown className="h-3 w-3 mr-1" />}
                      {subject.trend === 'stable' && <Activity className="h-3 w-3 mr-1" />}
                      {subject.trend} {subject.trendValue > 0 && `(${subject.trendValue}%)`}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Average Score</span>
                      <span className="font-medium">{subject.averageScore}%</span>
                    </div>
                    <Progress value={subject.averageScore} className="h-2" />
                  </div>
                </div>
                <div className="ml-4 text-right">
                  <div className="text-2xl font-bold">{subject.averageScore}%</div>
                  <div className="text-sm text-muted-foreground">Overall</div>
                </div>
              </div>
            ))}
            {subjectPerformance.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No performance data available for the selected time range
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Learning Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Learning Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <Award className="h-8 w-8 text-blue-600 mb-2" />
              <h4 className="font-medium text-blue-900">Strength Areas</h4>
              <p className="text-sm text-blue-700 mt-1">
                You're excelling in {subjectPerformance.filter(s => s.averageScore >= 85).length} subjects
              </p>
            </div>
            
            <div className="p-4 bg-amber-50 rounded-lg">
              <Clock className="h-8 w-8 text-amber-600 mb-2" />
              <h4 className="font-medium text-amber-900">Focus Areas</h4>
              <p className="text-sm text-amber-700 mt-1">
                {overallStats.decliningSubjects} subjects need attention
              </p>
            </div>
            
            <div className="p-4 bg-green-50 rounded-lg">
              <Target className="h-8 w-8 text-green-600 mb-2" />
              <h4 className="font-medium text-green-900">Progress Trend</h4>
              <p className="text-sm text-green-700 mt-1">
                {overallStats.improvingSubjects > overallStats.decliningSubjects ? 'Positive' : 'Needs Work'} overall momentum
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
