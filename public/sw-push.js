// Service Worker Web Push, FCM & Notification Click Handler for BartaConnect

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {
    title: 'BartaConnect',
    body: 'আপনার জন্য নতুন একটি মেসেজ এসেছে।',
    url: '/',
    tag: 'bartaconnect-message',
  };

  try {
    const parsed = event.data.json();
    const fcmNotif = parsed && typeof parsed.notification === 'object' ? parsed.notification : null;
    const fcmData = parsed && typeof parsed.data === 'object' ? parsed.data : null;

    const rawTitle =
      (typeof parsed.title === 'string' && parsed.title) ||
      (fcmNotif && typeof fcmNotif.title === 'string' && fcmNotif.title) ||
      (fcmData && typeof fcmData.title === 'string' && fcmData.title) ||
      '';
    const rawBody =
      (typeof parsed.body === 'string' && parsed.body) ||
      (fcmNotif && typeof fcmNotif.body === 'string' && fcmNotif.body) ||
      (fcmData && typeof fcmData.body === 'string' && fcmData.body) ||
      '';
    const rawUrl =
      (typeof parsed.url === 'string' && parsed.url) ||
      (fcmData && typeof fcmData.url === 'string' && fcmData.url) ||
      '/';
    const rawTag =
      (typeof parsed.tag === 'string' && parsed.tag) ||
      (fcmData && typeof fcmData.tag === 'string' && fcmData.tag) ||
      payload.tag;

    payload = {
      title: rawTitle || payload.title,
      body: rawBody || payload.body,
      url: rawUrl,
      tag: rawTag,
    };
  } catch {
    try {
      const text = event.data.text();
      if (text) payload.body = text;
    } catch {
      // Ignore malformed payload
    }
  }

  const options = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag,
    renotify: true,
    vibrate: [140, 60, 140],
    data: { url: payload.url },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
