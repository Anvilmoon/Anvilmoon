// Anvilmoon offline support: caches the game so it loads with no connection.
// Bump VERSION whenever you deploy changes so players get the new files.
const VERSION = 'anvilmoon-1.11.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './fonts/jacquarda-bastarda-9-latin-400-normal.woff2', './fonts/pixelify-sans-latin-400-normal.woff2',
  './fonts/pixelify-sans-latin-500-normal.woff2', './fonts/pixelify-sans-latin-600-normal.woff2', './fonts/pixelify-sans-latin-700-normal.woff2',
  './fonts/vt323-latin-400-normal.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/emblem.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Never cache the game server's live data (accounts, auctions, duels).
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/config.js') return;
  // Pages: network first so updates arrive, cache as fallback. Everything else: cache first.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put('./index.html', copy)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; })));
});
