// SiteOps Checklist 서비스 워커 — 화면 파일만 저장해 두고, 인터넷이 끊겼을 때 대신 보여 준다
// 데이터(/api)와 로그인(/auth)은 절대 저장하지 않고 항상 서버에서 받는다.
// 화면 파일도 항상 서버에서 먼저 받아(네트워크 우선) 새 버전이 바로 반영되게 한다.
const CACHE = 'siteops-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/install.html',
  '/install.js',
  '/privacy.html',
  '/security.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request, { ignoreSearch: true })) ?? caches.match('/')),
  );
});
