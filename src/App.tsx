import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };
import { AuthProvider } from "@/hooks/useAuth";
import PWABanner from "@/components/PWABanner";
import Index from "./pages/Index";
import Login from "./pages/Login";
import DashboardLayout from "./components/DashboardLayout";
import DashboardHome from "./pages/dashboard/DashboardHome";
import Subjects from "./pages/dashboard/Subjects";
import SubjectDetail from "./pages/dashboard/SubjectDetail";
import MySubjects from "./pages/dashboard/MySubjects";
import MyAttendance from "./pages/dashboard/MyAttendance";
import MyScores from "./pages/dashboard/MyScores";
import Insights from "./pages/dashboard/Insights";
import LearningAssistant from "./pages/dashboard/LearningAssistant";
import Settings from "./pages/dashboard/Settings";
import Programs from "./pages/dashboard/Programs";
import Reports from "./pages/dashboard/Reports";
import EnhancedReports from "./pages/dashboard/EnhancedReports";
import CommunicationHub from "./pages/dashboard/CommunicationHub";
import EnhancedUX from "./pages/dashboard/EnhancedUX";
import AdministrativeFeatures from "./pages/dashboard/AdministrativeFeatures";
import EnhancedSecurity from "./pages/dashboard/EnhancedSecurity";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="edge-theme">
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <PWABanner />
          <BrowserRouter future={routerFuture}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/dashboard" element={<DashboardLayout />}>
                <Route index element={<DashboardHome />} />
                <Route path="subjects" element={<Subjects />} />
                <Route path="subjects/:id" element={<SubjectDetail />} />
                <Route path="my-subjects" element={<MySubjects />} />
                <Route path="my-attendance" element={<MyAttendance />} />
                <Route path="my-scores" element={<MyScores />} />
                <Route path="insights" element={<Insights />} />
                <Route path="learning-assistant" element={<LearningAssistant />} />
                <Route path="enhanced-ux" element={<EnhancedUX />} />
                <Route path="administrative" element={<AdministrativeFeatures />} />
                <Route path="enhanced-security" element={<EnhancedSecurity />} />
                <Route path="communication" element={<CommunicationHub />} />
                <Route path="enhanced-reports" element={<EnhancedReports />} />
                <Route path="settings" element={<Settings />} />
                <Route path="programs" element={<Programs />} />
                <Route path="reports" element={<Reports />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
