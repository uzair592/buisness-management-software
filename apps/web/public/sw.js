// Retire the previous offline shell without touching IndexedDB or issued work.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("bms-public-shell-")) await caches.delete(key);
    }
    await self.registration.unregister();
    await self.clients.claim();
  })());
});
