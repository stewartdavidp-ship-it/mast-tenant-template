var CACHE_NAME = 'pos-cache-v1';
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
      // addAll is atomic — if any fail, install fails. Use individual puts.
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

  // Network-first (pass-through) for Firebase, Cloud Functions, Google APIs.
  // SW never intercepts Firestore writes — outbox flush relies on direct network.
  if (url.indexOf('firebaseio.com') !== -1 ||
      url.indexOf('firestore.googleapis.com') !== -1 ||
      url.indexOf('googleapis.com') !== -1 ||
      url.indexOf('cloudfunctions.net') !== -1 ||
      url.indexOf('identitytoolkit') !== -1 ||
      url.indexOf('securetoken') !== -1) {
    return;
  }

  // Cache-first for static POS assets within /pos/ scope.
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(resp) {
        // Opportunistic cache for /pos/ assets
        if (resp && resp.status === 200 && url.indexOf('/pos/') !== -1) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      }).catch(function() {
        // Offline fallback to cached pos/index.html for navigations
        if (e.request.mode === 'navigate') {
          return caches.match('/pos/index.html');
        }
        return Response.error();
      });
    })
  );
});
