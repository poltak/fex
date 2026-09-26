/* Cache only this deployment's build assets. Rates use the app's data store. */
const entries = self.__WB_MANIFEST;
const scope = new URL(self.registration.scope);
const prefix = `fex-shell:${scope.pathname}:`;
const version = __FEX_BUILD_ID__;
const cacheName = prefix + version;
const assets = new Set(entries.map(entry => new URL(entry.url, scope).href));
const shell = new URL('index.html', scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...assets].map(url => new Request(url, { cache: 'reload' })));
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'FEX_ACCEPT_UPDATE') self.skipWaiting();
  if (event.data?.type === 'FEX_CLIENT_READY' && event.data.version === version && event.source?.id) {
    event.waitUntil((async () => {
      if (self.registration.installing || self.registration.waiting) return;
      const keys = await caches.keys();
      const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => client.url.startsWith(scope.href));
      // Only the sole, fully loaded client of this build can retire old assets.
      // A waiting worker's cache must remain intact until the user accepts it.
      if (windows.length !== 1 || windows[0].id !== event.source.id || self.registration.installing || self.registration.waiting) return;
      await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    })());
  }
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Open tabs can still ask for their old hashed files. Keep those caches.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const scopedWindows = windows.filter(client => client.url.startsWith(scope.href));
    if (!scopedWindows.length) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // There is one app route. Do not replace missing files or unrelated paths with HTML.
  const isShell = request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname);
  if (!isShell && !assets.has(url.href) && !url.pathname.startsWith(new URL('assets/', scope).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(isShell ? shell : request, { ignoreVary: true });
    if (cached) return cached;
    if (!isShell) {
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix) && key !== cacheName) {
          const old = await (await caches.open(key)).match(request, { ignoreVary: true });
          if (old) return old;
        }
      }
    }
    return fetch(request);
  })());
});
