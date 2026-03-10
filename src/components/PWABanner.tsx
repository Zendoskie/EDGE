import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePWA } from '@/hooks/usePWA';
import { 
  Download, 
  Wifi, 
  WifiOff, 
  Bell, 
  Smartphone, 
  CheckCircle 
} from 'lucide-react';

export default function PWABanner() {
  const { 
    isInstallable, 
    isInstalled, 
    isOnline, 
    install, 
    requestNotificationPermission 
  } = usePWA();
  
  const [notificationRequested, setNotificationRequested] = useState(false);

  const handleInstall = async () => {
    const success = await install();
    if (success) {
      console.log('PWA installed successfully');
    }
  };

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotificationRequested(true);
    if (granted) {
      console.log('Notifications enabled');
    }
  };

  if (isInstalled && isOnline && notificationRequested) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 space-y-2">
      {!isOnline && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <WifiOff className="h-5 w-5 text-orange-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-800">
                  You're offline
                </p>
                <p className="text-xs text-orange-600">
                  Some features may be limited
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isInstallable && !isInstalled && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Install Academic Guardian
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-blue-700 mb-3">
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

      {!notificationRequested && isOnline && (
        <Card className="border-purple-200 bg-purple-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Enable Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-purple-700 mb-3">
              Stay updated with grades, attendance, and important alerts
            </p>
            <Button 
              size="sm" 
              onClick={handleEnableNotifications}
              className="w-full"
              variant="outline"
            >
              Enable Notifications
            </Button>
          </CardContent>
        </Card>
      )}

      {isInstalled && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-xs font-medium text-green-800">
                App installed & ready
              </span>
              {isOnline ? (
                <Badge variant="secondary" className="ml-auto text-xs">
                  <Wifi className="h-3 w-3 mr-1" />
                  Online
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-auto text-xs">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
