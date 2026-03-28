import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePWA } from '@/hooks/usePWA';
import { 
  Download, 
  Wifi, 
  WifiOff, 
  Smartphone, 
  CheckCircle 
} from 'lucide-react';

export default function PWABanner() {
  const { 
    isInstallable, 
    isInstalled, 
    isOnline, 
    install, 
  } = usePWA();

  const handleInstall = async () => {
    const success = await install();
    if (success) {
      console.log('PWA installed successfully');
    }
  };

  if (isInstalled && isOnline) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 space-y-2">
      {!isOnline && (
        <Card className="border-warning/30 bg-warning/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <WifiOff className="h-5 w-5 text-warning-foreground" />
              <div className="flex-1">
                <p className="text-sm font-medium text-warning-foreground">
                  You're offline
                </p>
                <p className="text-xs text-warning-foreground/80">
                  Some features may be limited
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isInstalled && isOnline && isInstallable && (
        <Card className="border-primary/30 bg-primary/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Install Academic Guardian
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-primary mb-3">
              Get instant access and offline support by installing our app
            </p>
            <Button 
              size="sm" 
              onClick={handleInstall}
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Install App
            </Button>
          </CardContent>
        </Card>
      )}

      {isInstalled && !isOnline && (
        <Card className="border-success/30 bg-success/10">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-xs font-medium text-success">
                App installed
              </span>
              <Badge variant="secondary" className="ml-auto text-xs">
                <WifiOff className="h-3 w-3 mr-1" />
                Offline
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
