import { User } from 'firebase/auth';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return null;
  }
}

async function registerWebPushDevice(user: User): Promise<void> {
  try {
    const registration = await getReadyServiceWorkerRegistration();
    if (!registration || !('pushManager' in registration)) return;

    const vapidResp = await fetch('/api/push/vapid-public-key');
    if (!vapidResp.ok) return;
    const vapidData = (await vapidResp.json()) as { publicKey?: string };
    if (!vapidData.publicKey) return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });
    }

    const token = await user.getIdToken();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
  } catch (err) {
    // Foreground/SW local notifications still work even if PushManager isn't available
    console.warn('Web Push subscription registration skipped:', err);
  }
}

export async function syncExistingPushSubscription(user: User): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  await registerWebPushDevice(user);
}

export async function enableAndSubscribePushNotifications(
  user: User,
): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission === 'granted') {
    await registerWebPushDevice(user);
  }
  return permission;
}

export async function showLocalNotification(params: {
  title: string;
  body: string;
  tag: string;
}): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const registration = await getReadyServiceWorkerRegistration();
  if (registration) {
    try {
      await registration.showNotification(params.title, {
        body: params.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: params.tag,
        data: { url: '/' },
      });
      return;
    } catch {
      // Fallback to Notification constructor below
    }
  }

  try {
    new Notification(params.title, {
      body: params.body,
      icon: '/pwa-192x192.png',
      tag: params.tag,
    });
  } catch {
    // Some mobile browsers require ServiceWorker.showNotification only
  }
}

export async function dispatchAdminPushNotification(params: {
  adminUser: User;
  targetUserId?: string;
  broadcast?: boolean;
  title: string;
  body: string;
  tag: string;
}): Promise<void> {
  try {
    const token = await params.adminUser.getIdToken();
    await fetch('/api/push/notify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: params.targetUserId,
        broadcast: Boolean(params.broadcast),
        title: params.title,
        body: params.body,
        tag: params.tag,
      }),
    });
  } catch (err) {
    console.warn('Admin push dispatch failed:', err);
  }
}
