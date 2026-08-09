// Service Worker: кешує весь застосунок, щоб інтернет міг зникнути разом
// зі світлом, а робота продовжувалась (розділ 1). Шляхи — відносні до
// розташування цього файлу, тому працюють і в корені, і під /herkules-desk/
// на GitHub Pages.

const CACHE_NAME = 'herkules-v1';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/db.js',
  'js/access.js',
  'js/visits.js',
  'js/desk.js',
  'js/clients.js',
  'js/subscriptions.js',
  'js/barcode.js',
  'js/qr.js',
  'js/sales.js',
  'js/journal.js',
  'js/settings.js',
  'js/backup.js',
  'js/ui.js',
  'icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // жодного CDN у рантаймі (розділ 1)
  event.respondWith(staleWhileRevalidate(req));
});

// Кеш віддається миттєво, мережа оновлює його у фоні. Якщо офлайн і файла
// немає в кеші — для навігації повертаємо index.html (SPA-маршрутизація
// через хеш працює й так), для іншого — 503.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then((resp) => {
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);

  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  if (request.mode === 'navigate') return cache.match('index.html');
  return new Response('Офлайн: ресурс недоступний', { status: 503 });
}
