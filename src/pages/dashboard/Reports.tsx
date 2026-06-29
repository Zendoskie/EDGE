import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Printer, Download, Eye } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatAssessmentTypeLabel } from '@/lib/assessment-types';

import { canonicalRiskLevel, riskLabel } from '@/lib/risk-utils';
import { RiskBadge } from '@/components/RiskBadge';
import { EngagementBadge } from '@/components/EngagementBadge';
import { engagementLabel, canonicalEngagementLevel, formatActivityTypeLabel } from '@/lib/engagement-utils';

export default function Reports() {
  const { user } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
  const [selectedPreview, setSelectedPreview] = useState<{
    mode: 'all' | 'class';
    title: string;
    subtitle: string;
    rows: Array<{
      student_id: string;
      full_name: string;
      email: string;
      student_id_code: string;
      attendance: number | null;
      quiz_avg: number | null;
      assignment_avg: number | null;
      risk_level: string | null;
      recommendation: string;
      engagement_level?: string | null;
      participation_count?: number | null;
      recent_activity_summary?: string;
      subject_code?: string;
      program?: string;
    }>;
  } | null>(null);

  const { data: subjects = [], isLoading } = useQuery({
    queryKey: ['reports-subjects', user?.id],
    queryFn: async () => {
      const { data: subs } = await supabase
        .from('subjects')
        .select('id, code, name, programs(code, name)')
        .eq('instructor_id', user!.id)
        .order('code');
      if (!subs?.length) return [];
      const allStudentIds = new Set<string>();
      const reportData = await Promise.all(
        subs.map(async (s) => {
          const { data: enrollments } = await supabase
            .from('enrollments')
            .select('student_id')
            .eq('subject_id', s.id)
            .eq('status', 'active');
          const studentIds = enrollments?.map((e) => e.student_id).filter(Boolean) ?? [];
          studentIds.forEach((id) => allStudentIds.add(id as string));
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
            .select('id, title, type, max_score')
            .eq('subject_id', s.id);
          const activityIds = activities?.map((a) => a.id) ?? [];
          let submissions: any[] = [];
          if (activityIds.length) {
            const { data: subData } = await supabase
              .from('submissions')
              .select('student_id, activity_id, score, assessment_type')
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

          return { subject: s, rows, program: (s as any).programs, gradeRecords: buildGradeRecords(profiles ?? [], activities ?? [], submissions) };
        })
      );

      const studentIdList = [...allStudentIds];
      let engagementByStudent = new Map<string, {
        engagement_level: string;
        participation_count: number;
      }>();
      const recentActivityByStudent = new Map<string, string>();

      if (studentIdList.length > 0) {
        const [{ data: summaries }, { data: activities }] = await Promise.all([
          supabase
            .from('student_engagement_summary')
            .select('student_id, engagement_level, participation_count')
            .in('student_id', studentIdList),
          supabase
            .from('student_activity')
            .select('student_id, activity_type, activity_description, created_at')
            .in('student_id', studentIdList)
            .order('created_at', { ascending: false })
            .limit(500),
        ]);

        engagementByStudent = new Map(
          (summaries ?? []).map((row) => [row.student_id, row]),
        );

        for (const act of activities ?? []) {
          const sid = act.student_id as string;
          if (!sid || recentActivityByStudent.has(sid)) continue;
          const label = act.activity_description?.trim() || formatActivityTypeLabel(act.activity_type);
          recentActivityByStudent.set(sid, label);
        }
      }

      return reportData.map((item) => ({
        ...item,
        rows: item.rows.map((row) => {
          const eng = engagementByStudent.get(row.student_id);
          return {
            ...row,
            engagement_level: eng?.engagement_level ?? null,
            participation_count: eng?.participation_count ?? null,
            recent_activity_summary: recentActivityByStudent.get(row.student_id) ?? '—',
          };
        }),
      }));
    },
    enabled: !!user?.id,
  });

  function buildGradeRecords(
    profiles: Array<{ user_id: string; full_name?: string | null; student_id?: string | null }>,
    activitiesList: Array<{ id: string; title?: string | null; type?: string | null; max_score?: number | null }>,
    submissionsList: Array<{ student_id?: string | null; activity_id?: string | null; score?: number | null; assessment_type?: string | null }>,
  ) {
    const records: Array<{
      student_id: string;
      full_name: string;
      student_id_code: string;
      activity_title: string;
      activity_type: string;
      assessment_type: string | null;
      score: number | null;
      max_score: number | null;
      percent: number | null;
    }> = [];

    for (const sub of submissionsList) {
      if (sub.score == null || !sub.student_id || !sub.activity_id) continue;
      const prof = profiles.find((p) => p.user_id === sub.student_id);
      const act = activitiesList.find((a) => a.id === sub.activity_id);
      const max = act?.max_score ?? null;
      const pct = max ? (Number(sub.score) / Number(max)) * 100 : null;
      records.push({
        student_id: sub.student_id,
        full_name: prof?.full_name ?? '—',
        student_id_code: prof?.student_id ?? '—',
        activity_title: act?.title ?? '—',
        activity_type: act?.type ?? '—',
        assessment_type: sub.assessment_type ?? null,
        score: sub.score,
        max_score: max,
        percent: pct,
      });
    }

    return records.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  const allGradeRecords = subjects.flatMap((r) =>
    (r.gradeRecords ?? []).map((record) => ({
      ...record,
      subject_code: r.subject.code,
      subject_name: r.subject.name,
      program: (r.program as any)?.code ?? '—',
    })),
  );

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
    const headers = [
      'Subject', 'Program', 'Student', 'Email', 'Student ID', 'Attendance %', 'Quiz Avg %', 'Assignment Avg %',
      'Risk Level', 'Engagement Level', 'Participation Count', 'Recent Activity',
      'Recommendation',
    ];
    const rows = data.map((r) => [
      r.subject_code,
      r.program,
      r.full_name,
      r.email,
      r.student_id_code,
      r.attendance != null ? r.attendance.toFixed(1) : '',
      r.quiz_avg != null ? r.quiz_avg.toFixed(1) : '',
      r.assignment_avg != null ? r.assignment_avg.toFixed(1) : '',
      riskLabel(canonicalRiskLevel(r.risk_level ?? '')),
      r.engagement_level ? engagementLabel(canonicalEngagementLevel(r.engagement_level)) : '',
      r.participation_count != null ? String(r.participation_count) : '',
      (r.recent_activity_summary ?? '').replace(/,/g, ';'),
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

  const printSubjectReport = (
    subject: { code: string; name: string },
    programCode: string,
    rows: Array<{
      full_name: string;
      email: string;
      student_id_code: string;
      attendance: number | null;
      quiz_avg: number | null;
      assignment_avg: number | null;
      risk_level: string | null;
      recommendation: string;
      engagement_level?: string | null;
      participation_count?: number | null;
      recent_activity_summary?: string;
    }>,
  ) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.print();
      return;
    }

    const bodyRows = rows
      .map((r) => {
        const recommendation = (r.recommendation ?? '—').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const engagement = r.engagement_level
          ? engagementLabel(canonicalEngagementLevel(r.engagement_level))
          : '—';
        return `
          <tr>
            <td>${r.full_name ?? '—'}</td>
            <td>${r.email ?? '—'}</td>
            <td>${r.student_id_code ?? '—'}</td>
            <td>${r.attendance != null ? `${r.attendance.toFixed(1)}%` : '—'}</td>
            <td>${r.quiz_avg != null ? `${r.quiz_avg.toFixed(1)}%` : '—'}</td>
            <td>${r.assignment_avg != null ? `${r.assignment_avg.toFixed(1)}%` : '—'}</td>
            <td>${riskLabel(canonicalRiskLevel(r.risk_level ?? ''))}</td>
            <td>${engagement}</td>
            <td>${r.participation_count ?? '—'}</td>
            <td>${(r.recent_activity_summary ?? '—').replace(/</g, '&lt;')}</td>
            <td>${recommendation}</td>
          </tr>
        `;
      })
      .join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${subject.code} - Class Summary Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { margin: 0 0 4px; }
            p { margin: 0 0 8px; color: #444; }
            table { border-collapse: collapse; width: 100%; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #f5f5f5; font-weight: 600; }
          </style>
        </head>
        <body>
          <h1>EDGE - Per Class Summary Report</h1>
          <p><strong>Subject:</strong> ${subject.code} — ${subject.name}</p>
          <p><strong>Program:</strong> ${programCode || '—'}</p>
          <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Email</th>
                <th>Student ID</th>
                <th>Attendance</th>
                <th>Quiz Avg</th>
                <th>Assign. Avg</th>
                <th>Risk</th>
                <th>Engagement</th>
                <th>Participation</th>
                <th>Recent Activity</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              ${bodyRows || '<tr><td colspan="11">No enrolled students.</td></tr>'}
            </tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
    printWindow.close();
  };

  const openSubjectPreview = (
    subject: { code: string; name: string },
    programCode: string,
    rows: Array<{
      student_id: string;
      full_name: string;
      email: string;
      student_id_code: string;
      attendance: number | null;
      quiz_avg: number | null;
      assignment_avg: number | null;
      risk_level: string | null;
      recommendation: string;
    }>
  ) => {
    setSelectedPreview({
      mode: 'class',
      title: `${subject.code} - ${subject.name}`,
      subtitle: `Program: ${programCode || '—'}`,
      rows,
    });
  };

  const openAllCoursesPreview = () => {
    setSelectedPreview({
      mode: 'all',
      title: 'All Courses Performance Report',
      subtitle: 'Combined view across all your subjects',
      rows: allRows,
    });
  };

  return (
    <div className="space-y-6 animate-fade-in min-w-0">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Summary Reports</h1>
            <p className="text-sm text-muted-foreground mt-1">Generate clean printable and CSV-ready performance reports.</p>
          </div>
        <div className="flex gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={openAllCoursesPreview}
            disabled={allRows.length === 0}
          >
            <Eye className="mr-2 h-4 w-4" />
            View Report
          </Button>
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
      </section>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="print:hidden h-11">
          <TabsTrigger value="all">All Courses</TabsTrigger>
          <TabsTrigger value="per-class">Per Class</TabsTrigger>
          <TabsTrigger value="grades">Grade Records</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <Card className="bg-card/90 interactive-lift">
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
                        <TableHead>Engagement</TableHead>
                        <TableHead>Participation</TableHead>
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
                            <RiskBadge level={r.risk_level} />
                          </TableCell>
                          <TableCell>
                            {r.engagement_level ? (
                              <EngagementBadge level={r.engagement_level} />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>{r.participation_count ?? '—'}</TableCell>
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
                <Card key={subject.id} className="bg-card/90 interactive-lift">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-lg">
                      <span>{subject.code} — {subject.name}</span>
                      <Badge variant="outline">{(program as any)?.code ?? '—'}</Badge>
                    </CardTitle>
                    <div className="flex gap-2 print:hidden">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openSubjectPreview(subject, (program as any)?.code ?? '—', rows)}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" /> View Report
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => printSubjectReport(subject, (program as any)?.code ?? '—', rows)}
                      >
                        <Printer className="mr-1 h-3.5 w-3.5" /> Print / PDF
                      </Button>
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
                      <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Student</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Attendance</TableHead>
                            <TableHead>Quiz Avg</TableHead>
                            <TableHead>Assign. Avg</TableHead>
                            <TableHead>Risk</TableHead>
                            <TableHead>Engagement</TableHead>
                            <TableHead>Participation</TableHead>
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
                                <RiskBadge level={r.risk_level} />
                              </TableCell>
                              <TableCell>
                                {r.engagement_level ? (
                                  <EngagementBadge level={r.engagement_level} />
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell>{r.participation_count ?? '—'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.recommendation}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
        <TabsContent value="grades">
          <Card className="bg-card/90 interactive-lift">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" />
                Grade records with assessment types
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Individual grade entries across all subjects, including the assessment type recorded by the instructor.
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading...</p>
              ) : allGradeRecords.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">No graded records yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Student</TableHead>
                        <TableHead>Student ID</TableHead>
                        <TableHead>Activity</TableHead>
                        <TableHead>Assessment Type</TableHead>
                        <TableHead>Score</TableHead>
                        <TableHead>%</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allGradeRecords.map((r, i) => (
                        <TableRow key={`${r.student_id}-${r.subject_code}-${r.activity_title}-${i}`}>
                          <TableCell className="font-medium">{r.subject_code}</TableCell>
                          <TableCell>{r.full_name}</TableCell>
                          <TableCell>{r.student_id_code}</TableCell>
                          <TableCell>{r.activity_title}</TableCell>
                          <TableCell>{formatAssessmentTypeLabel(r.assessment_type)}</TableCell>
                          <TableCell>
                            {r.score != null && r.max_score != null ? `${r.score} / ${r.max_score}` : '—'}
                          </TableCell>
                          <TableCell>{r.percent != null ? `${r.percent.toFixed(1)}%` : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedPreview} onOpenChange={(open) => !open && setSelectedPreview(null)}>
        <DialogContent className="max-w-7xl w-[min(100vw-1rem,80rem)] max-h-[90dvh] overflow-y-auto p-3 sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {selectedPreview?.title}
            </DialogTitle>
            <DialogDescription>
              {selectedPreview?.subtitle}
            </DialogDescription>
          </DialogHeader>
          {!selectedPreview || selectedPreview.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enrolled students.</p>
          ) : (
            <div className="max-h-[76vh] overflow-auto rounded-md border bg-muted/20 p-2 sm:p-4">
              <div className="mx-auto w-full min-w-0 md:min-w-[1050px] bg-white text-slate-900 border border-slate-300 shadow-sm">
                <div className="border-b border-slate-300 px-6 py-4">
                  <p className="text-xl font-bold tracking-tight">
                    {selectedPreview.mode === 'all' ? 'EDGE Performance Summary Report' : 'EDGE Class Performance Report'}
                  </p>
                  <p className="text-sm text-slate-600">
                    {selectedPreview.title}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-700">
                    <span><strong>Scope:</strong> {selectedPreview.mode === 'all' ? 'All Courses' : 'Single Class'}</span>
                    <span><strong>Generated:</strong> {new Date().toLocaleString()}</span>
                    <span><strong>Students:</strong> {selectedPreview.rows.length}</span>
                  </div>
                </div>

                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">#</th>
                      {selectedPreview.mode === 'all' && (
                        <>
                          <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Subject</th>
                          <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Program</th>
                        </>
                      )}
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Student</th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Email</th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Student ID</th>
                      <th className="border border-slate-300 px-3 py-2 text-right font-semibold">Attendance</th>
                      <th className="border border-slate-300 px-3 py-2 text-right font-semibold">Quiz Avg</th>
                      <th className="border border-slate-300 px-3 py-2 text-right font-semibold">Assign. Avg</th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Risk</th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Engagement</th>
                      <th className="border border-slate-300 px-3 py-2 text-right font-semibold">Participation</th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Recent Activity</th>
                      <th className="border border-slate-300 px-3 py-2 text-left font-semibold">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPreview.rows.map((r, index) => (
                      <tr key={`${r.student_id}-${r.subject_code ?? 'single'}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className="border border-slate-200 px-3 py-2 align-top text-slate-600">{index + 1}</td>
                        {selectedPreview.mode === 'all' && (
                          <>
                            <td className="border border-slate-200 px-3 py-2 align-top">{r.subject_code ?? '—'}</td>
                            <td className="border border-slate-200 px-3 py-2 align-top">{r.program ?? '—'}</td>
                          </>
                        )}
                        <td className="border border-slate-200 px-3 py-2 align-top font-medium">{r.full_name}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top">{r.email}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top">{r.student_id_code}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top text-right">{r.attendance != null ? `${r.attendance.toFixed(1)}%` : '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top text-right">{r.quiz_avg != null ? `${r.quiz_avg.toFixed(1)}%` : '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top text-right">{r.assignment_avg != null ? `${r.assignment_avg.toFixed(1)}%` : '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top">{riskLabel(canonicalRiskLevel(r.risk_level ?? ''))}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top">
                          {r.engagement_level ? engagementLabel(canonicalEngagementLevel(r.engagement_level)) : '—'}
                        </td>
                        <td className="border border-slate-200 px-3 py-2 align-top text-right">{r.participation_count ?? '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top">{r.recent_activity_summary ?? '—'}</td>
                        <td className="border border-slate-200 px-3 py-2 align-top whitespace-normal">{r.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
