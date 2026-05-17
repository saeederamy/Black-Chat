// Black Chat — Service Worker
// Provides: install/activate hooks, push notification clicks, basic offline fallback.
const CACHE_NAME = 'blackchat-v1';
const ASSETS = [
  '/',
  '/static/script.js',
  '/static/manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for HTML, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Don't cache the api or websocket; let them go through.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/'))
    );
  } else if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(req).then((res) => res || fetch(req))
    );
  }
});

// When the user taps a system notification we send from the page,
// focus an existing tab or open a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetRoom = event.notification.data && event.notification.data.room;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes(self.location.origin)) {
          if (targetRoom && 'postMessage' in client) {
            client.postMessage({ type: 'open_room', room: targetRoom });
          }
          return client.focus();
        }
      }
      const url = targetRoom ? `/?room=${encodeURIComponent(targetRoom)}` : '/';
      return self.clients.openWindow(url);
    })
  );
});

// Web Push event — show a notification when the server sends one
self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = { title: 'New message', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Black Chat';
  const options = {
    body: data.body || '',
    icon: data.icon || '/static/icon-192.png',
    badge: data.badge || '/static/icon-192.png',
    tag: data.tag || data.room || 'msg',
    renotify: true,
    data: { room: data.room || null },
    vibrate: [100, 50, 100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

