import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AdvancedReporting from '@/components/AdvancedReporting';
import { FileText, BarChart3, Download, ExternalLink } from 'lucide-react';

/**
 * Advanced Reports page — wires real client-side report generation
 * (see AdvancedReporting) plus shortcuts to existing analytics exports.
 */
export default function EnhancedReports() {
  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
          <div>
            <h1 className="text-2xl font-display font-bold">Advanced Reports</h1>
            <p className="text-muted-foreground">
              Generate instructor reports in-browser (PDF) and jump to campus analytics exports.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/90">
          <CardHeader className="text-center pb-2">
            <FileText className="h-7 w-7 mx-auto mb-2 text-primary" />
            <CardTitle className="text-base">Templates</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            Use the generator below to create a PDF from a saved template.
          </CardContent>
        </Card>
        <Card className="bg-card/90">
          <CardHeader className="text-center pb-2">
            <BarChart3 className="h-7 w-7 mx-auto mb-2 text-success" />
            <CardTitle className="text-base">Engagement analytics</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Admin PDF/Excel exports</p>
            <Button asChild size="sm" variant="outline" className="gap-1">
              <Link to="/dashboard/admin/engagement-analytics">
                Open <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="bg-card/90">
          <CardHeader className="text-center pb-2">
            <Download className="h-7 w-7 mx-auto mb-2 text-primary" />
            <CardTitle className="text-base">Standard reports</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">Class and risk summaries</p>
            <Button asChild size="sm" variant="outline" className="gap-1">
              <Link to="/dashboard/reports">
                Open <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <AdvancedReporting />
    </div>
  );
}
