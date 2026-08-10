/* Veyl Studio service worker — offline substrate (Track D).
   Plain SW, no workbox.

   Strategy:
   - install:  pre-cache the app shell (/, /index.html, manifest, icons)
   - fetch:    cache-first for heavy immutable assets — /models/**, /wasm/**,
               /worklets/**, /textures/**, hashed /static/** bundles, and the
               MediaPipe / CDN model+wasm downloads (opaque-safe) → veyl-heavy-v1
               network-first with cache fallback for navigations (app shell)
               never touches /api/** (recordings, backend calls stay live)
*/

const SHELL_CACHE = 'veyl-shell-v1';
const HEAVY_CACHE = 'veyl-heavy-v1';

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* same-origin path prefixes that hold heavy, effectively-immutable assets */
const HEAVY_PATHS = ['/models/', '/wasm/', '/worklets/', '/textures/', '/static/'];

/* cross-origin hosts serving model / wasm payloads (MediaPipe et al.) */
const HEAVY_HOSTS = [
  'cdn.jsdelivr.net',
  'storage.googleapis.com',
  'unpkg.com',
  'fonts.gstatic.com',
  'fonts.googleapis.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {}) // a missing shell URL must not brick installation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== HEAVY_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isHeavyRequest(url) {
  if (url.origin === self.location.origin) {
    return HEAVY_PATHS.some((p) => url.pathname.startsWith(p));
  }
  return HEAVY_HOSTS.includes(url.hostname);
}

/* cache-first with background fill; opaque (no-cors) responses are cached as-is */
async function cacheFirst(request) {
  const cache = await caches.open(HEAVY_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone()).catch(() => {}); // quota errors are non-fatal
  }
  return response;
}

/* network-first for navigations so deploys land, shell fallback offline */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('/index.html', response.clone()).catch(() => {});
    return response;
  } catch (_) {
    const cache = await caches.open(SHELL_CACHE);
    return (
      (await cache.match(request)) ||
      (await cache.match('/index.html')) ||
      (await cache.match('/')) ||
      Response.error()
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* never intercept the backend — recordings, vault sync, everything live */
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (isHeavyRequest(url)) {
    event.respondWith(cacheFirst(request));
  }
});
