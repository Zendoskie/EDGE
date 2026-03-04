import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
