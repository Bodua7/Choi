// Service Worker cho PWA "Zombie Commander" - cache-first với network fallback,
// giúp Treo Máy/mở lại game hoạt động ổn định kể cả mất mạng tạm thời.
const CACHE = 'zc-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.open(CACHE).then((cache) =>
            cache.match(e.request).then((cached) => {
                const fetchPromise = fetch(e.request)
                    .then((res) => {
                        if (res && res.status === 200) cache.put(e.request, res.clone());
                        return res;
                    })
                    .catch(() => cached);
                return cached || fetchPromise;
            })
        )
    );
});
