const CACHE_NAME = 'passcode-cache-v4';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon-120.png',
  'apple-touch-icon-152.png',
  'apple-touch-icon-180.png',
  'wallpaper.jpg'
];

self.addEventListener('install', evt => {
  evt.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', evt => {
  // let API requests go to network
  if (evt.request.url.includes('/api/storedata.php')) return;
  evt.respondWith(
    caches.match(evt.request).then(resp => resp || fetch(evt.request).catch(()=>caches.match('./')))
  );
});
