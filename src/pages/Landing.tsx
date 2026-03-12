import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { GraduationCap, Brain, TrendingUp, Users, BookOpen, Shield, Zap, Activity, Target, AlertTriangle } from 'lucide-react';

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
    <div className="min-h-screen bg-gradient-to-br from-background via-background/50 to-secondary/20">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <div className="flex items-center justify-center mb-6">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
              <GraduationCap className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold font-display mb-4 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            EDGE
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground font-medium mb-8">
            Early Detection of Grade Evaluation
          </p>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            An advanced deep learning system that predicts academic challenges and enables proactive student support
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16 max-w-6xl mx-auto">
          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
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

          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
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

          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
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

          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
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

          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
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

          <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow duration-300">
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

        {/* How It Works Section */}
        <div className="max-w-4xl mx-auto mb-16">
          <h2 className="text-3xl font-bold text-center mb-12 font-display">How EDGE Works</h2>
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

        {/* CTA Section */}
        <div className="text-center">
          <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-2xl p-12 max-w-2xl mx-auto border border-primary/20">
            <h2 className="text-2xl font-bold mb-4 font-display">Ready to Transform Academic Success?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Join thousands of students and instructors leveraging deep learning to improve academic outcomes through predictive analytics and early intervention.
            </p>
            <Button 
              size="lg" 
              className="text-lg px-8 py-3 h-auto shadow-lg hover:shadow-xl transition-shadow duration-300"
              onClick={() => navigate('/login')}
            >
              Get Started Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
