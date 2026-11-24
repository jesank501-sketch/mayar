import { User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app, db } from '../firebase';

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
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing?.active) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3500)),
    ]);
  } catch {
    return null;
  }
}

export function playMessageAlertTone(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1046, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Ignore autoplay restriction errors before user gesture
  }
}

let fcmForegroundListenerAttached = false;

async function registerFcmDeviceToken(
  user: User,
  registration: ServiceWorkerRegistration | null,
): Promise<void> {
  try {
    const supported = await isSupported();
    if (!supported) return;

    const messaging = getMessaging(app);

    if (!fcmForegroundListenerAttached) {
      fcmForegroundListenerAttached = true;
      onMessage(messaging, (payload) => {
        const title = payload.notification?.title || payload.data?.title || 'BartaConnect';
        const body =
          payload.notification?.body ||
          payload.data?.body ||
          'আপনার জন্য নতুন একটি মেসেজ এসেছে।';
        const tag = payload.data?.tag || 'bartaconnect-fcm';
        void showLocalNotification({ title, body, tag });
      });
    }

    const fcmVapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim();
    if (!fcmVapidKey || !registration) {
      return;
    }

    const fcmToken = await getToken(messaging, {
      vapidKey: fcmVapidKey,
      serviceWorkerRegistration: registration,
    });

    if (!fcmToken || fcmToken.length < 20 || fcmToken.length > 500) return;

    const tokenRef = doc(db, 'fcmTokens', user.uid);
    const existingSnap = await getDoc(tokenRef);
    const existingTokens = existingSnap.exists()
      ? ((existingSnap.data() as { tokens?: string[] }).tokens ?? [])
      : [];

    if (existingTokens[0] === fcmToken) return;

    const updatedTokens = [
      fcmToken,
      ...existingTokens.filter((t) => typeof t === 'string' && t !== fcmToken),
    ].slice(0, 5);

    await setDoc(tokenRef, {
      userId: user.uid,
      tokens: updatedTokens,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('FCM registration skipped:', err);
  }
}

async function registerWebPushDevice(user: User): Promise<void> {
  try {
    const registration = await getReadyServiceWorkerRegistration();

    // Register FCM foreground listener + device token if configured
    await registerFcmDeviceToken(user, registration);

    if (!registration || !('pushManager' in registration)) return;

    const vapidResp = await fetch('/api/push/vapid-public-key');
    const contentType = (vapidResp.headers.get('content-type') ?? '').toLowerCase();
    if (!vapidResp.ok || !contentType.includes('application/json')) {
      return;
    }
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
    // Foreground/SW local notifications still work on static hosting like Netlify
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
        renotify: true,
        vibrate: [200, 100, 200],
        data: { url: '/' },
      } as NotificationOptions);
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
    const resp = await fetch('/api/push/notify', {
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
    if (!resp.ok) {
      // Static hosts (e.g. Netlify) won't serve /api/push/notify; real-time Firestore notifications remain active
      return;
    }
  } catch {
    // Non-blocking push dispatch
  }
}
