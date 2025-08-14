const CACHE_NAME = 'passcode-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png',
  './wallpaper.jpg',
  './homescreen.jpg'
];

// Install: cache app shell
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static assets, network-first for navigation (HTML)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // For navigation (HTML pages) — try network first, fallback to cache
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(req).then(res => {
        // update cache with latest index.html
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // For other GET requests (assets) — respond from cache first, then network
  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(networkRes => {
          // cache fetched asset for future
          return caches.open(CACHE_NAME).then(cache => {
            // avoid caching cross-origin requests (e.g., analytics) to keep cache small
            if (url.origin === self.location.origin) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          });
        }).catch(() => {
          // final fallback: try to return a cached index (for images/pages)
          return caches.match('./index.html');
        });
      })
    );
  }
});
