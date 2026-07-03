/* GAME PWA service worker: cache-first для статики, network-first для страниц.
   API (/api/*) не кэшируем никогда. */
const CACHE = 'game-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // мост Max — только сеть

  const isStatic = url.pathname.startsWith('/_next/static/') ||
    /\.(png|woff2|webmanifest|ico|svg)$/.test(url.pathname);

  if (isStatic) {
    // cache-first: статика неизменна (хэши в именах)
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }),
      ),
    );
  } else {
    // network-first: страницы всегда свежие, офлайн — из кэша
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request)),
    );
  }
});
