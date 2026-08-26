import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  Download,
  Filter,
  Clock,
  CheckCircle,
  Printer,
  Eye,
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
  parameters: Record<string, unknown>;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  file_url?: string;
  generated_at: string;
  expires_at: string;
  report_templates?: {
    name: string;
    type: string;
  };
}

type PdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function downloadPdfBlob(doc: jsPDF, filename: string) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function buildInstructorReportPdf(
  template: ReportTemplate,
  parameters: Record<string, unknown>,
  instructorId: string,
): Promise<jsPDF> {
  const doc = new jsPDF() as PdfDoc;
  doc.setFontSize(16);
  doc.text(template.name || 'EDGE Academic Report', 14, 18);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);
  doc.text(`Template: ${template.type.replace(/_/g, ' ')}`, 14, 32);
  if (parameters.dateRange) {
    doc.text(`Date range: ${String(parameters.dateRange)}`, 14, 38);
  }

  const { data: subjects } = await supabase
    .from('subjects')
    .select('id, code, name')
    .eq('instructor_id', instructorId);
  const subjectList = subjects ?? [];
  const subjectIds = subjectList.map((s) => s.id);

  let y = 46;
  doc.setFontSize(12);
  doc.text('Subjects covered', 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Code', 'Name']],
    body: subjectList.length
      ? subjectList.map((s) => [s.code ?? '', s.name ?? ''])
      : [['—', 'No subjects']],
    styles: { fontSize: 9 },
  });

  let nextY = doc.lastAutoTable?.finalY ?? y + 20;
  nextY += 10;

  if (subjectIds.length > 0 && (parameters.includePredictions || template.type === 'risk_assessment')) {
    const { data: predictions } = await supabase
      .from('predictions')
      .select('risk_level, risk_score, created_at')
      .in('subject_id', subjectIds)
      .order('created_at', { ascending: false })
      .limit(40);

    doc.setFontSize(12);
    doc.text('Recent risk predictions (sample)', 14, nextY);
    autoTable(doc, {
      startY: nextY + 4,
      head: [['Risk level', 'Score', 'Date']],
      body: (predictions ?? []).map((p) => [
        p.risk_level ?? '—',
        p.risk_score != null ? String(p.risk_score) : '—',
        p.created_at ? new Date(p.created_at).toLocaleDateString() : '—',
      ]),
      styles: { fontSize: 9 },
    });
    nextY = doc.lastAutoTable?.finalY ?? nextY + 20;
    nextY += 10;
  }

  if (subjectIds.length > 0 && (parameters.includeAttendance || template.type === 'attendance_analysis')) {
    const { data: attendance } = await supabase
      .from('attendance')
      .select('status, date')
      .in('subject_id', subjectIds)
      .order('date', { ascending: false })
      .limit(1);

    const { count } = await supabase
      .from('attendance')
      .select('*', { count: 'exact', head: true })
      .in('subject_id', subjectIds);

    doc.setFontSize(11);
    doc.text(`Attendance records in scope: ${count ?? 0}`, 14, nextY);
    if (attendance?.[0]) {
      doc.text(
        `Latest record: ${attendance[0].date} (${attendance[0].status})`,
        14,
        nextY + 6,
      );
    }
  }

  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    'Generated in EDGE (client-side). For engagement campus exports, use Admin Engagement Analytics.',
    14,
    280,
  );
  doc.setTextColor(0);

  return doc;
}

export default function AdvancedReporting() {
  const { user, role } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [reportParameters, setReportParameters] = useState<Record<string, unknown>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ['report-templates', role],
    queryFn: async (): Promise<ReportTemplate[]> => {
      if (role !== 'instructor' && role !== 'admin') return [];

      const { data, error } = await supabase
        .from('report_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        type: row.type as ReportTemplate['type'],
        created_by: row.created_by ?? '',
        created_at: row.created_at ?? '',
      }));
    },
    enabled: role === 'instructor' || role === 'admin',
  });

  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['generated-reports', user?.id],
    queryFn: async (): Promise<GeneratedReport[]> => {
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
      return (data ?? []).map((row) => ({
        id: row.id,
        template_id: row.template_id,
        parameters: (row.parameters as Record<string, unknown>) ?? {},
        status: (row.status as GeneratedReport['status']) ?? 'pending',
        file_url: row.file_url ?? undefined,
        generated_at: row.generated_at ?? '',
        expires_at: row.expires_at ?? '',
        report_templates: row.report_templates
          ? {
              name: row.report_templates.name,
              type: row.report_templates.type,
            }
          : undefined,
      }));
    },
    enabled: !!user?.id,
  });

  const generateReportMutation = useMutation({
    mutationFn: async ({
      templateId,
      parameters,
    }: {
      templateId: string;
      parameters: Record<string, unknown>;
    }) => {
      if (!user?.id) throw new Error('Not signed in');
      setIsGenerating(true);
      try {
        const template = templates.find((t) => t.id === templateId);
        if (!template) throw new Error('Template not found');

        const doc = await buildInstructorReportPdf(template, parameters, user.id);
        downloadPdfBlob(doc, `edge-report-${template.type}-${Date.now()}.pdf`);

        const expires = new Date();
        expires.setDate(expires.getDate() + 30);

        const { data, error } = await supabase
          .from('generated_reports')
          .insert({
            template_id: templateId,
            parameters,
            status: 'completed',
            created_by: user.id,
            generated_at: new Date().toISOString(),
            expires_at: expires.toISOString(),
            file_url: null,
          })
          .select('id')
          .single();

        if (error) throw error;
        return data;
      } finally {
        setIsGenerating(false);
      }
    },
    onSuccess: () => {
      toast.success('Report PDF downloaded and saved to your history.');
      queryClient.invalidateQueries({ queryKey: ['generated-reports', user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not generate report'),
  });

  const regenerateFromHistory = useMutation({
    mutationFn: async (report: GeneratedReport) => {
      if (!user?.id) throw new Error('Not signed in');
      const template = templates.find((t) => t.id === report.template_id);
      if (!template) {
        throw new Error('Template missing — generate a new PDF from a template.');
      }
      const doc = await buildInstructorReportPdf(template, report.parameters, user.id);
      downloadPdfBlob(doc, `edge-report-${report.id.slice(0, 8)}.pdf`);
    },
    onSuccess: () => toast.success('PDF downloaded.'),
    onError: (e: Error) => toast.error(e.message),
  });

  const handlePrintPreview = () => {
    if (!printRef.current) return;
    const printContent = printRef.current.innerHTML;
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>EDGE Report</title>
      <style>body{font-family:sans-serif;margin:20px}</style></head>
      <body>${printContent}</body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Report generator</h2>
          <p className="text-sm text-muted-foreground">
            Creates a PDF in your browser and stores a history row (no broken cloud download).
          </p>
        </div>
        <Badge variant="outline" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Client PDF
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-5 w-5" />
              Templates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No templates yet. Use Engagement Analytics or the main Reports page for exports.
              </p>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <button
                    type="button"
                    key={template.id}
                    className={`w-full text-left p-3 border rounded-lg transition-colors ${
                      selectedTemplate === template.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-accent'
                    }`}
                    onClick={() => {
                      setSelectedTemplate(template.id);
                      setReportParameters({ includePredictions: true });
                    }}
                  >
                    <h4 className="font-medium text-sm">{template.name}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                    <Badge variant="outline" className="mt-2 text-xs">
                      {template.type.replace(/_/g, ' ')}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameters</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTemplate ? (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Date Range</label>
                  <select
                    className="w-full p-2 border rounded-md bg-background mt-1"
                    onChange={(e) =>
                      setReportParameters((prev) => ({ ...prev, dateRange: e.target.value }))
                    }
                  >
                    <option value="last_week">Last Week</option>
                    <option value="last_month">Last Month</option>
                    <option value="last_semester">Last Semester</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Include</label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      onChange={(e) =>
                        setReportParameters((prev) => ({
                          ...prev,
                          includeAttendance: e.target.checked,
                        }))
                      }
                    />
                    Attendance summary
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      defaultChecked
                      onChange={(e) =>
                        setReportParameters((prev) => ({
                          ...prev,
                          includePredictions: e.target.checked,
                        }))
                      }
                    />
                    Risk predictions
                  </label>
                </div>
                <Button
                  onClick={() =>
                    generateReportMutation.mutate({
                      templateId: selectedTemplate,
                      parameters: reportParameters,
                    })
                  }
                  disabled={isGenerating}
                  className="w-full"
                >
                  {isGenerating ? 'Generating…' : 'Generate & download PDF'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Select a template to configure parameters
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-5 w-5" />
              Recent reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              {reportsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : reports.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center">No reports generated yet</p>
              ) : (
                <div className="space-y-3">
                  {reports.map((report) => (
                    <div key={report.id} className="p-3 border rounded-lg space-y-2">
                      <div>
                        <h4 className="font-medium text-sm">
                          {report.report_templates?.name ?? 'Report'}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {report.generated_at
                            ? new Date(report.generated_at).toLocaleString()
                            : ''}
                        </p>
                        <Badge
                          variant={report.status === 'completed' ? 'default' : 'secondary'}
                          className="mt-1"
                        >
                          {report.status}
                        </Badge>
                      </div>
                      {report.status === 'completed' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-1"
                          disabled={regenerateFromHistory.isPending}
                          onClick={() => regenerateFromHistory.mutate(report)}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Re-download PDF
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Printable summary
          </CardTitle>
          <Button size="sm" variant="outline" onClick={handlePrintPreview}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </CardHeader>
        <CardContent>
          <div ref={printRef} className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-lg">EDGE Academic Summary</h3>
              <p className="text-muted-foreground">
                Generated on {new Date().toLocaleDateString()} — use Generate & download PDF for a
                full export.
              </p>
            </div>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                Review low engagement + elevated risk on Student Engagement Monitoring.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                Campus engagement PDF/Excel: Admin → Engagement Analytics.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
