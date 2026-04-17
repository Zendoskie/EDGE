import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  FileText, 
  BarChart3, 
  Download,
  Settings
} from 'lucide-react';

export default function EnhancedReports() {
  return (
    <div className="space-y-6 animate-fade-in">
      <section className="page-section overflow-hidden">
        <div className="page-section-header bg-gradient-to-r from-card via-card to-primary/5">
        <div>
          <h1 className="text-2xl font-display font-bold">Advanced Reports</h1>
          <p className="text-muted-foreground">Comprehensive academic reporting and analytics</p>
        </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <Card className="bg-card/90 hover:shadow-md transition-shadow cursor-pointer interactive-lift">
          <CardHeader className="text-center">
            <FileText className="h-8 w-8 mx-auto mb-2 text-primary" />
            <CardTitle>Generate Reports</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Create custom reports with templates and automated generation
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/90 hover:shadow-md transition-shadow cursor-pointer interactive-lift">
          <CardHeader className="text-center">
            <BarChart3 className="h-8 w-8 mx-auto mb-2 text-success" />
            <CardTitle>Analytics</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              View detailed analytics and performance insights
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/90 hover:shadow-md transition-shadow cursor-pointer interactive-lift">
          <CardHeader className="text-center">
            <Download className="h-8 w-8 mx-auto mb-2 text-primary" />
            <CardTitle>Export Data</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Export reports in various formats (PDF, Excel, CSV)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/90 hover:shadow-md transition-shadow cursor-pointer interactive-lift">
          <CardHeader className="text-center">
            <Settings className="h-8 w-8 mx-auto mb-2 text-warning-foreground" />
            <CardTitle>Schedule Reports</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Automate report generation on schedule
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="bg-card/90 rounded-xl border border-border/70">
        <div className="p-6">
          <div className="text-center">
            <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Advanced Report Generation</h3>
            <p className="text-muted-foreground">
              Advanced reporting features coming soon!
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Get comprehensive reports with templates, automated generation, and multiple export formats.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
