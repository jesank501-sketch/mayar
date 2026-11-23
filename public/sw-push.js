// Service Worker Web Push & Notification Click Handler for BartaConnect

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
    payload = {
      title: typeof parsed.title === 'string' && parsed.title ? parsed.title : payload.title,
      body: typeof parsed.body === 'string' && parsed.body ? parsed.body : payload.body,
      url: typeof parsed.url === 'string' && parsed.url ? parsed.url : '/',
      tag: typeof parsed.tag === 'string' && parsed.tag ? parsed.tag : payload.tag,
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
