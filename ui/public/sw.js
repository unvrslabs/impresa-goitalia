// Kill switch - unregister this service worker completely
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))).then(() => {
      return self.registration.unregister();
    })
  );
});
