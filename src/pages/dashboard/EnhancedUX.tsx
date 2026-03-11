import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Check, 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Moon, 
  Sun, 
  Eye,
  EyeOff,
  Zap,
  Shield,
  Users,
  BookOpen,
  Target,
  BarChart3
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  completed: boolean;
}

export default function EnhancedUX() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [accessibilitySettings, setAccessibilitySettings] = useState({
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false
  });

  const onboardingSteps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to EDGE',
      description: 'Early Detection of Grade Evaluation - AI-powered academic performance monitoring',
      icon: <Target className="h-8 w-8" />,
      completed: false
    },
    {
      id: 'profile',
      title: 'Complete Your Profile',
      description: 'Set up your academic information and preferences',
      icon: <Users className="h-8 w-8" />,
      completed: false
    },
    {
      id: 'subjects',
      title: 'Explore Your Subjects',
      description: 'View and manage your enrolled courses',
      icon: <BookOpen className="h-8 w-8" />,
      completed: false
    },
    {
      id: 'features',
      title: 'Discover Features',
      description: 'Learn about AI-powered analytics and communication tools',
      icon: <Zap className="h-8 w-8" />,
      completed: false
    },
    {
      id: 'ready',
      title: 'Ready to Start',
      description: 'You\'re all set up and ready to begin your academic journey',
      icon: <Check className="h-8 w-8" />,
      completed: false
    }
  ];

  useEffect(() => {
    // Check if user has completed onboarding
    const hasCompletedOnboarding = localStorage.getItem('onboarding_completed') === 'true';
    setShowOnboarding(!hasCompletedOnboarding);
  }, []);

  useEffect(() => {
    // Apply dark mode
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  const completeOnboarding = () => {
    localStorage.setItem('onboarding_completed', 'true');
    setShowOnboarding(false);
  };

  const nextStep = () => {
    if (currentStep < onboardingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const updateAccessibilitySetting = (setting: keyof typeof accessibilitySettings) => {
    setAccessibilitySettings(prev => ({
      ...prev,
      [setting]: !prev[setting]
    }));
  };

  if (showOnboarding) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-blue-600">
              Welcome to Academic Guardian
            </CardTitle>
            <p className="text-muted-foreground mt-2">
              Let's get you set up with our AI-powered academic platform
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-2">
                {onboardingSteps.map((step, index) => (
                  <div
                    key={step.id}
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      index <= currentStep ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    {step.completed ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      step.icon
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold mb-2">
                {onboardingSteps[currentStep].title}
              </h3>
              <p className="text-muted-foreground mb-6">
                {onboardingSteps[currentStep].description}
              </p>

              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={prevStep}
                  disabled={currentStep === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                
                <div className="flex space-x-2">
                  {currentStep < onboardingSteps.length - 1 && (
                    <Button onClick={nextStep}>
                      Next
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                  
                  {currentStep === onboardingSteps.length - 1 && (
                    <Button onClick={completeOnboarding} className="bg-green-600 hover:bg-green-700">
                      Get Started
                      <Check className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Progress value={((currentStep + 1) / onboardingSteps.length) * 100} className="w-full" />
              <p className="text-center text-sm text-muted-foreground mt-2">
                Step {currentStep + 1} of {onboardingSteps.length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Enhanced User Experience</h1>
          <p className="text-muted-foreground">Personalize your academic experience</p>
        </div>
        
        <div className="flex items-center space-x-4">
          <Button
            variant={isDarkMode ? "default" : "outline"}
            onClick={toggleDarkMode}
            className="flex items-center gap-2"
          >
            {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {isDarkMode ? 'Light Mode' : 'Dark Mode'}
          </Button>
          
          <Button
            variant="outline"
            onClick={() => setShowOnboarding(true)}
          >
            <Eye className="h-4 w-4 mr-2" />
            Show Onboarding
          </Button>
        </div>
      </div>

      <Tabs defaultValue="accessibility" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="accessibility" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Accessibility
          </TabsTrigger>
          <TabsTrigger value="preferences" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="shortcuts" className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Shortcuts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accessibility" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Accessibility Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(accessibilitySettings).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <h4 className="font-medium capitalize">
                        {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {key === 'highContrast' && 'Increase contrast for better visibility'}
                        {key === 'reducedMotion' && 'Reduce animations and transitions'}
                        {key === 'largeText' && 'Increase text size for better readability'}
                        {key === 'screenReader' && 'Optimize for screen readers'}
                      </p>
                    </div>
                    <Button
                      variant={value ? "default" : "outline"}
                      onClick={() => updateAccessibilitySetting(key as keyof typeof accessibilitySettings)}
                      className="min-w-[100px]"
                    >
                      {value ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                User Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Dashboard Layout</h4>
                  <select className="w-full p-2 border rounded-md">
                    <option>Default</option>
                    <option>Compact</option>
                    <option>Detailed</option>
                  </select>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Default Page</h4>
                  <select className="w-full p-2 border rounded-md">
                    <option>Dashboard</option>
                    <option>Analytics</option>
                    <option>Communication</option>
                    <option>Reports</option>
                  </select>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">Notification Settings</h4>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" defaultChecked />
                      <span>Email notifications</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" defaultChecked />
                      <span>Push notifications</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" />
                      <span>Weekly progress reports</span>
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shortcuts" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Keyboard Shortcuts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Navigation</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd>
                      <span>+ K</span>
                      <span>Dashboard</span>
                    </div>
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd>
                      <span>+ A</span>
                      <span>Analytics</span>
                    </div>
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd>
                      <span>+ C</span>
                      <span>Communication</span>
                    </div>
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd>
                      <span>+ R</span>
                      <span>Reports</span>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 border rounded-lg">
                  <h4 className="font-medium mb-2">Actions</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd>
                      <span>+ N</span>
                      <span>New Message</span>
                    </div>
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd>
                      <span>+ S</span>
                      <span>Search</span>
                    </div>
                    <div className="flex justify-between">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Esc</kbd>
                      <span>Close Modal</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
