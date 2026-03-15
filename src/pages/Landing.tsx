import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { GraduationCap, Brain, TrendingUp, Users, BookOpen, Activity, Target } from 'lucide-react';

/** Wrapper that animates children to "pop up" when they enter the viewport on scroll */
function PopInSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: '0px 0px -60px 0px', threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
    >
      {children}
    </div>
  );
}

export default function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (user) {
    return null; // Will redirect
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50/80 dark:from-background dark:via-background dark:to-secondary/10">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/80 to-primary" />

      <div className="container mx-auto px-4 py-12 md:py-20 max-w-6xl">
        {/* Hero — pops in on load */}
        <PopInSection>
        <header className="text-center mb-20">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 dark:bg-primary/20 border border-primary/20 mb-8">
            <GraduationCap className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold font-display tracking-tight text-foreground mb-3">
            EDGE
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground font-medium mb-4">
            Early Detection of Grade Evaluation
          </p>
          <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Predictive analytics and early intervention for academic success.
          </p>
        </header>
        </PopInSection>

        {/* Features Grid */}
        <PopInSection>
        <h2 className="text-2xl font-semibold text-center text-foreground mb-10 font-display">What EDGE Offers</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20 max-w-5xl mx-auto">
          <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-4">
                <Brain className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Deep Learning Analytics</h3>
              <p className="text-muted-foreground">
                Advanced neural networks analyze complex academic patterns and predict performance trends with 95% accuracy
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Predictive Monitoring</h3>
              <p className="text-muted-foreground">
                Deep learning models forecast academic trajectories and identify at-risk students before grades decline
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
                <Users className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Neural Network Insights</h3>
              <p className="text-muted-foreground">
                AI-powered recommendations for personalized learning paths based on deep pattern analysis
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center mx-auto mb-4">
                <BookOpen className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Smart Enrollment</h3>
              <p className="text-muted-foreground">
                Intelligent course enrollment system with program and year restrictions for regular students
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mx-auto mb-4">
                <Activity className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Model Training</h3>
              <p className="text-muted-foreground">
                Continuously learning from student data to improve prediction accuracy and intervention strategies
              </p>
            </CardContent>
          </Card>

          <Card className="border border-border/60 bg-card/80 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300">
            <CardContent className="p-6 text-center">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mx-auto mb-4">
                <Target className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Risk Prediction</h3>
              <p className="text-muted-foreground">
                Early warning system identifies students needing intervention before academic performance drops
              </p>
            </CardContent>
          </Card>
        </div>
        </PopInSection>

        {/* How It Works Section */}
        <PopInSection>
        <div className="max-w-4xl mx-auto mb-20 text-center">
          <h2 className="text-2xl font-semibold text-foreground mb-12 font-display">How EDGE Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-foreground">
                1
              </div>
              <h3 className="text-xl font-semibold mb-3">Data Collection</h3>
              <p className="text-muted-foreground leading-relaxed">
                System gathers comprehensive academic data including grades, attendance, assignments, and participation patterns
              </p>
            </div>
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-foreground">
                2
              </div>
              <h3 className="text-xl font-semibold mb-3">Deep Learning Processing</h3>
              <p className="text-muted-foreground leading-relaxed">
                Neural networks analyze patterns and predict academic outcomes with advanced machine learning models
              </p>
            </div>
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-foreground">
                3
              </div>
              <h3 className="text-xl font-semibold mb-3">Predictive Interventions</h3>
              <p className="text-muted-foreground leading-relaxed">
                Early alerts and recommendations help instructors provide targeted support before students struggle
              </p>
            </div>
          </div>
        </div>
        </PopInSection>
      </div>

      {/* Single Get Started at the very bottom of the page */}
      <PopInSection className="flex justify-center">
      <div className="container mx-auto px-4 pb-16 pt-8 max-w-6xl flex justify-center">
        <Button
          size="lg"
          className="text-base px-10 py-6 h-auto rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all"
          onClick={() => navigate('/login')}
        >
          Get Started
        </Button>
      </div>
      </PopInSection>
    </div>
  );
}
