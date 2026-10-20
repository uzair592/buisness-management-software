// Browser acceptance fixture: a previously installed root-scope worker.
// It only seeds the old cache; no business data or authenticated API is cached.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  await caches.open("bms-public-shell-legacy");
  await self.clients.claim();
})()));
