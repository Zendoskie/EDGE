import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  Download, 
  Calendar, 
  Filter,
  BarChart3,
  TrendingUp,
  Users,
  Clock,
  CheckCircle,
  AlertTriangle,
  Printer,
  Mail,
  Eye
} from 'lucide-react';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  type: 'student_performance' | 'class_summary' | 'attendance_analysis' | 'risk_assessment' | 'custom';
  created_by: string;
  created_at: string;
}

interface GeneratedReport {
  id: string;
  template_id: string;
  parameters: Record<string, any>;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  file_url?: string;
  generated_at: string;
  expires_at: string;
}

interface ReportData {
  students: any[];
  subjects: any[];
  attendance: any[];
  scores: any[];
  predictions: any[];
}

export default function AdvancedReporting() {
  const { user, role } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [reportParameters, setReportParameters] = useState<Record<string, any>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewData, setPreviewData] = useState<ReportData | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch report templates
  const { data: templates = [] } = useQuery({
    queryKey: ['report-templates', role],
    queryFn: async () => {
      if (role !== 'instructor') return [];
      
      const { data, error } = await supabase
        .from('report_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: role === 'instructor',
  });

  // Fetch generated reports
  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['generated-reports', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const { data, error } = await supabase
        .from('generated_reports')
        .select(`
          *,
          report_templates(name, type)
        `)
        .eq('created_by', user.id)
        .order('generated_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  // Generate report mutation
  const generateReportMutation = useMutation({
    mutationFn: async ({ templateId, parameters }: { templateId: string; parameters: Record<string, any> }) => {
      setIsGenerating(true);

      // Call Supabase function to generate report
      const { data, error } = await supabase.functions.invoke('generate-report', {
        body: {
          templateId,
          parameters,
          userId: user!.id,
        },
      });

      setIsGenerating(false);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generated-reports', user?.id] });
    },
  });

  // Download report mutation
  const downloadReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const { data, error } = await supabase.functions.invoke('download-report', {
        body: { reportId },
      });

      if (error) throw error;
      return data;
    },
  });

  // Email report mutation
  const emailReportMutation = useMutation({
    mutationFn: async ({ reportId, recipients }: { reportId: string; recipients: string[] }) => {
      const { data, error } = await supabase.functions.invoke('email-report', {
        body: { reportId, recipients },
      });

      if (error) throw error;
      return data;
    },
  });

  const handleGenerateReport = () => {
    if (!selectedTemplate) return;
    
    generateReportMutation.mutate({
      templateId: selectedTemplate,
      parameters: reportParameters
    });
  };

  const handleDownloadReport = (reportId: string, fileUrl: string) => {
    downloadReportMutation.mutate(reportId);
    // Fallback: direct download
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = `report-${reportId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEmailReport = (reportId: string) => {
    const recipients = prompt('Enter email addresses (comma-separated):');
    if (recipients) {
      const emailList = recipients.split(',').map(e => e.trim()).filter(e => e);
      emailReportMutation.mutate({
        reportId,
        recipients: emailList
      });
    }
  };

  const handlePrintReport = () => {
    if (printRef.current) {
      const printContent = printRef.current.innerHTML;
      const printWindow = window.open('', '', 'width=800,height=600');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Academic Report</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .header { text-align: center; margin-bottom: 30px; }
                .footer { margin-top: 30px; text-align: center; color: #666; }
              </style>
            </head>
            <body>
              ${printContent}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  };

  const renderParameterInputs = (template: ReportTemplate) => {
    switch (template.type) {
      case 'student_performance':
        return (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Date Range</label>
              <select 
                className="w-full p-2 border rounded-md"
                onChange={(e) => setReportParameters(prev => ({ ...prev, dateRange: e.target.value }))}
              >
                <option value="last_week">Last Week</option>
                <option value="last_month">Last Month</option>
                <option value="last_semester">Last Semester</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Include</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    onChange={(e) => setReportParameters(prev => ({ ...prev, includeGrades: e.target.checked }))}
                  />
                  <span>Grades & Scores</span>
                </label>
                <label className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    onChange={(e) => setReportParameters(prev => ({ ...prev, includeAttendance: e.target.checked }))}
                  />
                  <span>Attendance Records</span>
                </label>
                <label className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    onChange={(e) => setReportParameters(prev => ({ ...prev, includePredictions: e.target.checked }))}
                  />
                  <span>Risk Assessments</span>
                </label>
              </div>
            </div>
          </div>
        );
      
      case 'class_summary':
        return (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Subject</label>
              <select 
                className="w-full p-2 border rounded-md"
                onChange={(e) => setReportParameters(prev => ({ ...prev, subjectId: e.target.value }))}
              >
                <option value="">Select Subject</option>
                {/* This would be populated with actual subjects */}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Summary Type</label>
              <select 
                className="w-full p-2 border rounded-md"
                onChange={(e) => setReportParameters(prev => ({ ...prev, summaryType: e.target.value }))}
              >
                <option value="overview">Class Overview</option>
                <option value="performance">Performance Analysis</option>
                <option value="engagement">Engagement Metrics</option>
              </select>
            </div>
          </div>
        );
      
      default:
        return (
          <div className="text-center py-8 text-muted-foreground">
            Select a template to configure report parameters
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Advanced Reporting</h2>
          <p className="text-muted-foreground">Generate comprehensive academic reports</p>
        </div>
        <Badge variant="outline" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Automated Reports
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Report Templates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {templates.map((template: ReportTemplate) => (
                <div
                  key={template.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedTemplate === template.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-accent'
                  }`}
                  onClick={() => {
                    setSelectedTemplate(template.id);
                    setReportParameters({});
                    setPreviewData(null);
                  }}
                >
                  <h4 className="font-medium">{template.name}</h4>
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                  <Badge variant="outline" className="mt-2">
                    {template.type.replace('_', ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Parameters Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Report Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTemplate ? (
              <div className="space-y-4">
                {renderParameterInputs(templates.find((t: ReportTemplate) => t.id === selectedTemplate)!)}
                <div className="flex gap-2">
                  <Button
                    onClick={handleGenerateReport}
                    disabled={!selectedTemplate || isGenerating}
                    className="flex-1"
                  >
                    {isGenerating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-2" />
                        Generate Report
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setPreviewData({} as ReportData)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Preview
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Select a template to configure parameters
              </div>
            )}
          </CardContent>
        </Card>

        {/* Generated Reports */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              {reportsLoading ? (
                <div className="text-center">Loading reports...</div>
              ) : reports.length === 0 ? (
                <div className="text-center text-muted-foreground">
                  No reports generated yet
                </div>
              ) : (
                <div className="space-y-3">
                  {reports.map((report: GeneratedReport) => (
                    <div key={report.id} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium">{report.report_templates?.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            Generated: {new Date(report.generated_at).toLocaleString()}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={
                              report.status === 'completed' ? 'default' :
                              report.status === 'failed' ? 'destructive' : 'secondary'
                            }>
                              {report.status}
                            </Badge>
                            {report.expires_at && (
                              <span className="text-xs text-muted-foreground">
                                Expires: {new Date(report.expires_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {report.status === 'completed' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleDownloadReport(report.id, report.file_url!)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEmailReport(report.id)}
                              >
                                <Mail className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePrintReport()}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            </>
                          )}
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

      {/* Report Preview */}
      {previewData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Report Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={printRef} className="space-y-6">
              <div className="header">
                <h1>Academic Performance Report</h1>
                <p>Generated on {new Date().toLocaleDateString()}</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <h2>Executive Summary</h2>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">85%</div>
                      <div className="text-sm text-muted-foreground">Average Score</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">92%</div>
                      <div className="text-sm text-muted-foreground">Attendance Rate</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">12</div>
                      <div className="text-sm text-muted-foreground">Total Students</div>
                    </div>
                  </div>
                </div>

                <div>
                  <h2>Performance Trends</h2>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span>Improvement Rate:</span>
                      <span className="font-medium text-green-600">+15%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Risk Reduction:</span>
                      <span className="font-medium text-green-600">-8%</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h2>Recommendations</h2>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                      <span>Focus on students with declining performance trends</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                      <span>Implement additional support sessions for high-risk subjects</span>
                    </li>
                  </ul>
                </div>
              </div>

              <div className="footer">
                <p>Generated by Academic Guardian System</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
