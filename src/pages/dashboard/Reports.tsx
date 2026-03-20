import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Printer, Download } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const riskLabel = (level: string) => {
  if (level === 'critical') return 'Critical';
  if (level === 'at_risk') return 'At Risk';
  if (level === 'excelling') return 'Excelling';
  return level ? 'Stable' : '—';
};

export default function Reports() {
  const { user } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);

  const { data: subjects = [], isLoading } = useQuery({
    queryKey: ['reports-subjects', user?.id],
    queryFn: async () => {
      const { data: subs } = await supabase
        .from('subjects')
        .select('id, code, name, programs(code, name)')
        .eq('instructor_id', user!.id)
        .order('code');
      if (!subs?.length) return [];
      const reportData = await Promise.all(
        subs.map(async (s) => {
          const { data: enrollments } = await supabase
            .from('enrollments')
            .select('student_id')
            .eq('subject_id', s.id)
            .eq('status', 'active');
          const studentIds = enrollments?.map((e) => e.student_id).filter(Boolean) ?? [];
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, full_name, email, student_id')
            .in('user_id', studentIds);
          const { data: attendance } = await supabase
            .from('attendance')
            .select('student_id, status')
            .eq('subject_id', s.id);
          const { data: activities } = await supabase
            .from('activities')
            .select('id, type, max_score')
            .eq('subject_id', s.id);
          const activityIds = activities?.map((a) => a.id) ?? [];
          let submissions: any[] = [];
          if (activityIds.length) {
            const { data: subData } = await supabase
              .from('submissions')
              .select('student_id, activity_id, score')
              .in('activity_id', activityIds);
            submissions = subData ?? [];
          }
          const { data: predictions } = await supabase
            .from('predictions')
            .select('student_id, risk_level, attendance_rate, quiz_average, assignment_average, recommendation')
            .eq('subject_id', s.id);

          const rows = studentIds.map((sid) => {
            const prof = profiles?.find((p) => p.user_id === sid);
            const pred = predictions?.find((p) => p.student_id === sid);
            const attRows = attendance?.filter((a) => a.student_id === sid) ?? [];
            const totalAtt = attRows.length;
            const presentAtt = attRows.filter((a) => a.status === 'present' || a.status === 'late').length;
            const attRate = totalAtt ? (presentAtt / totalAtt) * 100 : null;

            const studentSubs = submissions.filter((ss) => ss.student_id === sid);
            const quizScores: number[] = [];
            const assignScores: number[] = [];
            for (const sub of studentSubs) {
              const act = activities?.find((a) => a.id === sub.activity_id);
              if (!act || sub.score == null) continue;
              const pct = (sub.score / act.max_score) * 100;
              if (act.type === 'quiz') quizScores.push(pct);
              else if (act.type === 'assignment' || act.type === 'project') assignScores.push(pct);
            }
            const quizAvg = quizScores.length ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length : pred?.quiz_average ? pred.quiz_average * 100 : null;
            const assignAvg = assignScores.length ? assignScores.reduce((a, b) => a + b, 0) / assignScores.length : pred?.assignment_average ? pred.assignment_average * 100 : null;

            return {
              student_id: sid,
              full_name: prof?.full_name ?? '—',
              email: prof?.email ?? '—',
              student_id_code: prof?.student_id ?? '—',
              attendance: attRate,
              quiz_avg: quizAvg,
              assignment_avg: assignAvg,
              risk_level: pred?.risk_level ?? null,
              recommendation: pred?.recommendation ?? '—',
            };
          });

          return { subject: s, rows, program: (s as any).programs };
        })
      );
      return reportData;
    },
    enabled: !!user?.id,
  });

  const allRows = subjects.flatMap((r) =>
    r.rows.map((row) => ({
      ...row,
      subject_code: r.subject.code,
      subject_name: r.subject.name,
      program: (r.program as any)?.code ?? '—',
    }))
  );

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html><head><title>EDGE - Performance Summary Report</title>
      <style>body{font-family:sans-serif;padding:24px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ccc;padding:8px;text-align:left;} th{background:#f5f5f5;}</style>
      </head><body>
      <h1>EDGE - Performance Summary Report</h1>
      <p>Generated ${new Date().toLocaleString()}</p>
      ${el.innerHTML}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
    printWindow.close();
  };

  const downloadCSV = (data: typeof allRows, filename: string) => {
    const headers = ['Subject', 'Program', 'Student', 'Email', 'Student ID', 'Attendance %', 'Quiz Avg %', 'Assignment Avg %', 'Risk Level', 'Recommendation'];
    const rows = data.map((r) => [
      r.subject_code,
      r.program,
      r.full_name,
      r.email,
      r.student_id_code,
      r.attendance != null ? r.attendance.toFixed(1) : '',
      r.quiz_avg != null ? r.quiz_avg.toFixed(1) : '',
      r.assignment_avg != null ? r.assignment_avg.toFixed(1) : '',
      riskLabel(r.risk_level ?? ''),
      (r.recommendation ?? '').replace(/,/g, ';'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-border/70 bg-card/75 backdrop-blur-sm px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-display font-bold">Summary Reports</h1>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCSV(allRows, `edge-report-${new Date().toISOString().slice(0, 10)}.csv`)}
            disabled={allRows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </div>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="print:hidden h-11">
          <TabsTrigger value="all">All Courses</TabsTrigger>
          <TabsTrigger value="per-class">Per Class</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <Card className="bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" />
                Performance across all courses
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Summary of student performance across all your subjects. Use Print or Download CSV for records.
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading...</p>
              ) : allRows.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">No enrolled students in any subject yet.</p>
              ) : (
                <div ref={printRef} className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Program</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Student ID</TableHead>
                        <TableHead>Attendance</TableHead>
                        <TableHead>Quiz Avg</TableHead>
                        <TableHead>Assign. Avg</TableHead>
                        <TableHead>Risk</TableHead>
                        <TableHead>Recommendation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allRows.map((r, i) => (
                        <TableRow key={`${r.student_id}-${r.subject_code}-${i}`}>
                          <TableCell className="font-medium">{r.subject_code}</TableCell>
                          <TableCell>{r.program}</TableCell>
                          <TableCell>{r.full_name}</TableCell>
                          <TableCell>{r.email}</TableCell>
                          <TableCell>{r.student_id_code}</TableCell>
                          <TableCell>{r.attendance != null ? `${r.attendance.toFixed(1)}%` : '—'}</TableCell>
                          <TableCell>{r.quiz_avg != null ? `${r.quiz_avg.toFixed(1)}%` : '—'}</TableCell>
                          <TableCell>{r.assignment_avg != null ? `${r.assignment_avg.toFixed(1)}%` : '—'}</TableCell>
                          <TableCell>
                            <Badge variant={r.risk_level === 'critical' || r.risk_level === 'at_risk' ? 'destructive' : 'secondary'}>
                              {riskLabel(r.risk_level ?? '')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.recommendation}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="per-class">
          <div className="space-y-6">
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : subjects.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No subjects yet.</p>
            ) : (
              subjects.map(({ subject, rows, program }) => (
                <Card key={subject.id} className="bg-card/90">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-lg">
                      <span>{subject.code} — {subject.name}</span>
                      <Badge variant="outline">{(program as any)?.code ?? '—'}</Badge>
                    </CardTitle>
                    <div className="flex gap-2 print:hidden">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          downloadCSV(
                            rows.map((r) => ({ ...r, subject_code: subject.code, subject_name: subject.name, program: (program as any)?.code ?? '—' })),
                            `edge-${subject.code}-${new Date().toISOString().slice(0, 10)}.csv`
                          )
                        }
                        disabled={rows.length === 0}
                      >
                        <Download className="mr-1 h-3.5 w-3.5" /> Download
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {rows.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No enrolled students.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Student</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Attendance</TableHead>
                            <TableHead>Quiz Avg</TableHead>
                            <TableHead>Assign. Avg</TableHead>
                            <TableHead>Risk</TableHead>
                            <TableHead>Recommendation</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r) => (
                            <TableRow key={r.student_id}>
                              <TableCell className="font-medium">{r.full_name}</TableCell>
                              <TableCell>{r.email}</TableCell>
                              <TableCell>{r.attendance != null ? `${r.attendance.toFixed(1)}%` : '—'}</TableCell>
                              <TableCell>{r.quiz_avg != null ? `${r.quiz_avg.toFixed(1)}%` : '—'}</TableCell>
                              <TableCell>{r.assignment_avg != null ? `${r.assignment_avg.toFixed(1)}%` : '—'}</TableCell>
                              <TableCell>
                                <Badge variant={r.risk_level === 'critical' || r.risk_level === 'at_risk' ? 'destructive' : 'secondary'}>
                                  {riskLabel(r.risk_level ?? '')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.recommendation}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
