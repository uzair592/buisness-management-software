// Only public application files are cached. Authenticated APIs and business data
// are never stored in the service worker; the scoped IndexedDB handles local data.
const CACHE = "bms-public-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch("/", { cache: "no-store" });
    if (!response.ok) return;
    const html = await response.clone().text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
    const cache = await caches.open(CACHE);
    await cache.put("/", response);
    await cache.addAll([...new Set(["/favicon.svg", "/manifest.webmanifest", ...assets])]);
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("bms-public-shell-") && key !== CACHE) await caches.delete(key);
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
    url.pathname.startsWith("/v1/") || url.pathname.startsWith("/health")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match("/");
      return cached || Response.error();
    }));
    return;
  }
  if (url.pathname.startsWith("/assets/") || ["/favicon.svg", "/manifest.webmanifest"].includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic") (await caches.open(CACHE)).put(request, response.clone());
      return response;
    })));
  }
});
