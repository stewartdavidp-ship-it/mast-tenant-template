// POS service worker. Scoped to /pos/ ONLY (registered with { scope: '/pos/' }).
//
// CACHE STRATEGY (2026-06-10 fix):
//   - App shell (navigations + /pos/index.html) → NETWORK-FIRST. The previous
//     version was cache-first with a never-changing CACHE_NAME, so once a
//     visitor cached index.html they were pinned to that build FOREVER — every
//     deploy was invisible even after a hard refresh (a hard refresh does not
//     bypass the service worker). Network-first means the latest shell loads
//     whenever online, with the cached copy only as an offline fallback.
//   - Other static /pos/ assets (manifest, icons) → cache-first (immutable-ish).
// Bump CACHE_NAME on any caching-behaviour change so activate() purges the old
// cache (the cleanup below deletes every cache whose name !== CACHE_NAME).
var CACHE_NAME = 'pos-cache-v2';
var APP_SHELL = '/pos/index.html';
var PRECACHE = [
  '/pos/',
  '/pos/index.html',
  '/pos/manifest.json',
  '/pos/icons/icon-192.png',
  '/pos/icons/icon-512.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Individual puts (not addAll) so one precache miss doesn't fail install.
      return Promise.all(PRECACHE.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('[pos-sw] precache miss', url, err && err.message);
        });
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
          .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Pass-through (never intercept) for Firebase, Cloud Functions, Google APIs.
  // The outbox flush + submitOrder rely on direct, uncached network.
  if (url.indexOf('firebaseio.com') !== -1 ||
      url.indexOf('firestore.googleapis.com') !== -1 ||
      url.indexOf('googleapis.com') !== -1 ||
      url.indexOf('cloudfunctions.net') !== -1 ||
      url.indexOf('identitytoolkit') !== -1 ||
      url.indexOf('securetoken') !== -1) {
    return;
  }

  if (e.request.method !== 'GET') return;

  // App shell → NETWORK-FIRST so every deploy is picked up immediately.
  var isAppShell = e.request.mode === 'navigate' ||
    /\/pos\/(index\.html)?(\?.*)?$/.test(url);
  if (isAppShell) {
    e.respondWith(
      fetch(e.request).then(function(resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(APP_SHELL, clone); });
        }
        return resp;
      }).catch(function() {
        // Offline → serve the last good shell.
        return caches.match(APP_SHELL).then(function(c) { return c || caches.match('/pos/'); });
      })
    );
    return;
  }

  // Other static /pos/ assets → cache-first, with opportunistic caching.
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(resp) {
        if (resp && resp.status === 200 && url.indexOf('/pos/') !== -1) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      }).catch(function() { return Response.error(); });
    })
  );
});
