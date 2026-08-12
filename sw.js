// LexDesk service worker — PWA install + Web Push
const CACHE_NAME = 'lexdesk-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  self.clients.claim();
});

// Real push notification arrives here even if the app tab is closed
// (works as long as the browser/device is on and LexDesk is installed/allowed).
self.addEventListener('push', (event) => {
  let data = { title: 'تذكير من LexDesk', body: '', urgent: false };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: data.urgent ? [200, 100, 200, 100, 200] : [150],
    requireInteraction: !!data.urgent,
    tag: 'lexdesk-reminder',
    renotify: true,
    data: { url: '/' }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
