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

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getPushApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return configured ? configured.replace(/\/+$/, '') : '';
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    let existing = await navigator.serviceWorker.getRegistration('/');
    if (!existing) {
      try {
        existing = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        // Fallback to ready below
      }
    }
    if (existing?.active) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 10_000)),
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

async function registerWebPushDevice(user: User): Promise<boolean> {
  try {
    const registration = await getReadyServiceWorkerRegistration();

    // Register FCM foreground listener + device token if configured
    await registerFcmDeviceToken(user, registration);

    if (!registration || !('pushManager' in registration)) return false;

    const apiBase = getPushApiBase();
    const vapidResp = await fetch(`${apiBase}/api/push/vapid-public-key`);
    const contentType = (vapidResp.headers.get('content-type') ?? '').toLowerCase();
    if (!vapidResp.ok || !contentType.includes('application/json')) {
      return false;
    }
    const vapidData = (await vapidResp.json()) as { publicKey?: string };
    const vapidPublicKey = vapidData.publicKey?.trim();
    if (!vapidPublicKey) return false;

    const expectedKeyBytes = urlBase64ToUint8Array(vapidPublicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const existingKeyBuf = subscription.options?.applicationServerKey;
      const keyMatches =
        existingKeyBuf instanceof ArrayBuffer &&
        uint8ArraysEqual(new Uint8Array(existingKeyBuf), expectedKeyBytes);
      if (!keyMatches) {
        try {
          await subscription.unsubscribe();
        } catch {
          // Proceed with fresh subscribe attempt
        }
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKeyBytes,
      });
    }

    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint ?? '';
    const p256dh = subJson.keys?.p256dh ?? '';
    const auth = subJson.keys?.auth ?? '';

    const token = await user.getIdToken();
    const savePromises: Promise<unknown>[] = [
      fetch(`${apiBase}/api/push/subscribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subscription: subJson }),
      }),
    ];

    if (endpoint.startsWith('https://') && p256dh.length >= 10 && auth.length >= 6) {
      savePromises.push(
        setDoc(doc(db, 'pushSubscriptions', user.uid), {
          userId: user.uid,
          endpoint: endpoint.slice(0, 1500),
          p256dh: p256dh.slice(0, 300),
          auth: auth.slice(0, 150),
          vapidPublicKey: vapidPublicKey.slice(0, 300),
          updatedAt: serverTimestamp(),
        }).catch(() => {}),
      );
    }

    await Promise.all(savePromises);
    return true;
  } catch (err) {
    console.warn('Web Push subscription registration skipped:', err);
    return false;
  }
}

export async function syncExistingPushSubscription(user: User): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return false;
  return await registerWebPushDevice(user);
}

export function watchServiceWorkerControllerForPush(user: User): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }
  const handleSync = () => {
    if (isNotificationSupported() && Notification.permission === 'granted') {
      void registerWebPushDevice(user);
    }
  };
  navigator.serviceWorker.addEventListener('controllerchange', handleSync);
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      handleSync();
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', handleSync);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
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

  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Ignore unsupported vibrate
  }

  const registration = await getReadyServiceWorkerRegistration();
  if (registration) {
    try {
      await registration.showNotification(params.title, {
        body: params.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: params.tag,
        renotify: true,
        silent: false,
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

export interface PushDispatchResult {
  ok: boolean;
  sent: number;
  attempted: number;
  staticHost?: boolean;
}

export async function dispatchAdminPushNotification(params: {
  adminUser: User;
  targetUserId?: string;
  broadcast?: boolean;
  title: string;
  body: string;
  tag: string;
}): Promise<PushDispatchResult> {
  try {
    const token = await params.adminUser.getIdToken();
    const apiBase = getPushApiBase();
    const resp = await fetch(`${apiBase}/api/push/notify`, {
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
    const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (!resp.ok || !contentType.includes('application/json')) {
      return { ok: false, sent: 0, attempted: 0, staticHost: resp.status === 404 || !contentType.includes('application/json') };
    }
    const data = (await resp.json()) as { ok?: boolean; sent?: number; attempted?: number };
    return {
      ok: Boolean(data.ok),
      sent: typeof data.sent === 'number' ? data.sent : 0,
      attempted: typeof data.attempted === 'number' ? data.attempted : 0,
    };
  } catch {
    return { ok: false, sent: 0, attempted: 0 };
  }
}
