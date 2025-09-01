// service-worker.js — cache-first navigations + robust install for iOS reliability.

const CACHE_VERSION = 'passcode-cache-v2';
const CACHE_NAME = CACHE_VERSION;

// Precache assets; keep list lean to reduce eviction risk on iOS
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',          // index.html references "manifest.json"
  './manifesh.json',          // tolerate the misspelled file if it exists
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png',
  './wallpaper.jpg',
  './homescreen.jpg',
  './service-worker.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        // Try addAll first
        await cache.addAll(ASSETS);
      } catch (err) {
        // Fallback: add one-by-one; ignore failures so install still completes
        await Promise.all(ASSETS.map(async (url) => {
          try { await cache.add(url); } catch (e) { /* ignore missing */ }
        }));
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const accept = req.headers.get('accept') || '';
  const isHTMLNavigation = req.mode === 'navigate' || accept.includes('text/html');

  if (isHTMLNavigation) {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(cacheFirst(req));
});

// Cache-first navigations with background revalidate (stale-while-revalidate)
async function handleNavigation(event) {
  const cache = await caches.open(CACHE_NAME);
  const INDEX = './index.html';

  // Serve cached shell immediately if present
  const cached = await cache.match(INDEX);
  if (cached) {
    event.waitUntil((async () => {
      try {
        const res = await fetch(INDEX, { cache: 'no-cache' });
        if (res && res.ok) await cache.put(INDEX, res.clone());
      } catch (e) { /* offline */ }
    })());
    return cached;
  }

  // First run: try network, then fallback
  try {
    const res = await fetch(event.request);
    if (res && res.ok) {
      try { await cache.put(INDEX, res.clone()); } catch (e) {}
    }
    return res;
  } catch (e) {
    const fallback = await cache.match(INDEX);
    if (fallback) return fallback;
    return new Response('<!doctype html><title>Offline</title><h1>Offline</h1>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 503, statusText: 'Service Unavailable'
    });
  }
}

// Cache-first for static assets, with graceful fallbacks
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    if (res && res.ok && new URL(request.url).origin === self.location.origin) {
      try { await cache.put(request, res.clone()); } catch (e) {}
    }
    return res;
  } catch (e) {
    // No generic binary fallback here; rely on index.html for navigations
    return new Response(null, { status: 503, statusText: 'Service Unavailable' });
  }
}

// Support SKIP_WAITING from page
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
