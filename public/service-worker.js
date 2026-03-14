const CACHE_NAME = 'task-snoozer-v1';
const ASSETS = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {
        // Gracefully handle if some assets fail to cache
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);
  const isHtmlRequest = event.request.destination === 'document' || url.pathname === '/' || url.pathname === '/index.html';

  if (isHtmlRequest) {
    // Network-first for HTML: always try to get latest version
    event.respondWith(
      fetch(event.request).then((response) => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Fall back to cache if network fails
        return caches.match(event.request);
      })
    );
  } else {
    // Stale-while-revalidate for assets: return cached immediately, update in background
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        // Return cached response immediately
        const fetchPromise = fetch(event.request).then((response) => {
          // Validate response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Update cache in background
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        }).catch(() => {
          // Network request failed, that's okay - we already returned cached version
        });

        // Return cached version if available, otherwise wait for network
        return cachedResponse || fetchPromise;
      })
    );
  }
});
