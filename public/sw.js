const CACHE_NAME = 'zombie-stickman-cache-v1';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/manifest.json',
    '/icon.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Chiến lược: network-first cho module JS (luôn cần bản mới nhất khi có mạng),
// cache-first cho phần còn lại (app shell / assets tĩnh) để chơi offline thật.
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (url.pathname.startsWith('/src/') || url.pathname.includes('.js')) {
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return res;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
});

// --- Web Push ---
// Nhận push thật từ server (khi đã cấu hình VAPID + có 1 tiến trình server gửi —
// xem src/net/push.js và supabase/functions/send-push/index.ts). Payload mong đợi
// dạng JSON: { title, body, tag?, url? }. Nếu payload không parse được JSON (hoặc
// rỗng), vẫn hiện 1 thông báo mặc định thay vì im lặng bỏ qua.
self.addEventListener('push', (event) => {
    let data = { title: 'Zombie Stickman Idle', body: 'Có cập nhật mới trong game!' };
    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (e) {
            data.body = event.data.text() || data.body;
        }
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: data.tag || 'zombie-stickman-default',
            data: { url: data.url || '/' }
        })
    );
});

// Bấm vào thông báo -> mở/focus lại app (dùng chung cho cả push thật lẫn thông
// báo cục bộ hiển thị qua registration.showNotification trong src/net/push.js)
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            const existing = clientsArr.find((c) => 'focus' in c);
            if (existing) return existing.focus();
            return self.clients.openWindow(targetUrl);
        })
    );
});
