/* MTC Waiter — Service Worker */
// Bumped on redesign — the activate handler drops every older cache, so the
// old terracotta shell/assets can't survive on an installed device.
const CACHE_NAME = 'waiter-v3';
// Menu photos downloaded for offline browsing — survives app-shell cache bumps.
const MENU_IMG_CACHE = 'waiter-menu-images';

// Assets to pre-cache for offline support
const PRECACHE_URLS = [
  '/waiter',
  '/waiter-manifest.json',
  '/waiter-icon-192.png',
  '/waiter-icon-512.png',
];

// Install: pre-cache shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches, claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== MENU_IMG_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   API calls    → Network-only (always fresh data)
//   Static JS/CSS → Cache-first, update in background
//   Pages         → Network-first, fall back to cache
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API: always network, never cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/pos/') || url.pathname.startsWith('/auth/')) {
    return; // browser handles normally
  }

  // Static assets (JS, CSS, fonts, images): cache-first
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/public/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(c => c.put(request, response.clone()));
          }
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // Navigation / pages: network-first, fall back to cache
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(c => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Listen for skip-waiting message (sent on new SW activation)
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
