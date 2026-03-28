import { toast } from 'sonner';

/** Must match PWABanner / notification enable flow */
export const EDGE_NOTIFICATION_PREF_KEY = 'edge_notifications_enabled';

export function isDesktopNotificationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  return localStorage.getItem(EDGE_NOTIFICATION_PREF_KEY) === 'true';
}

/**
 * Shows a system notification when the tab is in the background; uses Sonner when the tab is visible
 * so alerts still feel immediate without duplicate OS banners while you're actively using the app.
 */
export function notifyDesktop(title: string, options?: NotificationOptions): Notification | null {
  if (!isDesktopNotificationEnabled()) return null;

  const body = options?.body;
  const merged: NotificationOptions = {
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    ...options,
  };

  try {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      toast.info(title, body ? { description: body } : undefined);
      return null;
    }
    return new Notification(title, merged);
  } catch {
    return null;
  }
}
