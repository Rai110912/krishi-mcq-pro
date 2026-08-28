const CACHE_NAME = 'krishi-mcq-v211-1gl3dck';

// Core offline shell. The app must be able to boot from these alone, with no network.
// Kept as data (not 30 hand-written fetch calls) so install() can treat each entry
// independently — see precacheOne().
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './index.css?v=1gl3dck',
  './questions.json',
  './js/libs/tailwindcss.js',
  './js/libs/lucide.js',
  './js/canvas_charts.js?v=1gl3dck',
  './js/pwa_helpers.js?v=1gl3dck',
  './js/app.js?v=1gl3dck',
  './js/elite_animations_controller.js?v=1gl3dck',
  './js/elite_3d_engine.js?v=1gl3dck',
  './js/firebase-app-compat.js',
  './js/firebase-auth-compat.js',
  './js/firebase-firestore-compat.js',
  './js/sqlite_db.js?v=1gl3dck',
  './js/krishi_idb.js?v=1gl3dck',
  './js/krishi_worker.js?v=1gl3dck',
  './js/lottie_adapter.js',
  './js/animation_orchestrator.js',
  './js/libs/lottie.min.js',
  './js/voice_assistant.js?v=1gl3dck',
  './js/ambient_player.js',
  './js/data_safety.js?v=1gl3dck',
  './js/libs/qrcode.min.js',
  './js/libs/html5-qrcode.min.js',
  './js/libs/lz-string.min.js'
];

// Third-party CDN extras: large, optional, and the most likely to be slow or blocked.
// Cached best-effort AFTER install resolves, so they can never gate offline support.
const OPTIONAL_PRECACHE_URLS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

// Last-resort offline page, inlined on purpose: a cached offline.html could itself be
// the asset that failed to cache, and this has to render with zero dependencies.
const OFFLINE_FALLBACK_HTML = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Offline - Krishi MCQ Pro</title><style>' +
  'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}' +
  '.c{text-align:center;max-width:320px}.i{font-size:44px;margin-bottom:14px}' +
  'h1{font-size:17px;margin:0 0 8px}p{font-size:13px;line-height:1.6;color:#93a2b8;margin:0 0 20px}' +
  'button{background:#4f46e5;color:#fff;border:0;padding:11px 22px;border-radius:10px;' +
  'font-size:13px;font-weight:700;cursor:pointer}</style></head><body><div class="c">' +
  '<div class="i">📡</div><h1>You are offline</h1>' +
  '<p>Krishi MCQ Pro needs an internet connection once to finish setting up offline mode. ' +
  'Connect and reload - after that the app works without internet.</p>' +
  '<button onclick="location.reload()">Try again</button></div></body></html>';

// Caches one URL and NEVER rejects. install() previously wrapped ~30 bare fetches in
// Promise.all(), so a single unreachable asset (typically the jsdelivr CDN entry)
// rejected the whole batch, install() failed, the worker never activated and the cache
// stayed EMPTY — the real reason offline startup died. Anything skipped here is picked
// up later by the runtime cache-first handler or the periodic sync.
function precacheOne(cache, url) {
  return fetch(url, { cache: 'reload' })
    .then(res => (res && res.ok) ? cache.put(url, res) : null)
    .catch(err => {
      console.warn('[Service Worker] Precache skipped:', url, (err && err.message) || err);
    });
}

// Install Event: Pre-cache core shell resources with cache-busting reload
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching offline shell (' + PRECACHE_URLS.length + ' core assets)...');
        return Promise.allSettled(PRECACHE_URLS.map(url => precacheOne(cache, url)))
          .then(() => {
            // Deliberately not awaited: a slow CDN must not delay activation.
            OPTIONAL_PRECACHE_URLS.forEach(url => precacheOne(cache, url));
          });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event: Clear older cache schemas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing legacy cache store:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-First falling back to Cache strategy with cache-busting on navigations
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const isNavigation = event.request.mode === 'navigate' || 
                       event.request.url.endsWith('/') || 
                       event.request.url.endsWith('index.html');

  if (isNavigation) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              if (event.request.url.startsWith('http')) {
                cache.put(event.request, responseClone.clone());
                cache.put('./', responseClone);
              }
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Walk the fallbacks in order of fidelity. The last step synthesises a page
          // so respondWith() can never resolve to undefined — that is what turned a
          // first-launch-while-offline into a blank white screen with no explanation.
          return caches.match(event.request)
            .then(hit => hit || caches.match('./'))
            .then(hit => hit || caches.match('./index.html'))
            .then(hit => hit || new Response(OFFLINE_FALLBACK_HTML, {
              status: 200,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }));
        })
    );
    return;
  }

  // Cache-first for static assets like icons, fonts, local scripts, and external libraries
  const isStaticAsset = event.request.url.includes('icon.svg') || 
                        event.request.url.includes('manifest.json') ||
                        event.request.url.includes('fonts.googleapis.com') ||
                        event.request.url.includes('fonts.gstatic.com') ||
                        event.request.url.includes('/js/firebase-') ||
                        event.request.url.includes('/js/elite_') ||
                        event.request.url.includes('unpkg.com') ||
                        event.request.url.includes('tesseract.js') ||
                        event.request.url.includes('tessdata') ||
                        event.request.url.includes('projectnaptha');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => {
                  if (event.request.url.startsWith('http')) {
                    cache.put(event.request, responseClone);
                  }
                });
              }
              return networkResponse;
            });
        })
    );
    return;
  }

  const isApiRequest = event.request.url.includes('firestore.googleapis.com') ||
                       event.request.url.includes('generativelanguage.googleapis.com') ||
                       event.request.url.includes('identitytoolkit.googleapis.com') ||
                       event.request.url.includes('securetoken.googleapis.com') ||
                       event.request.url.includes('elevenlabs.io');

  if (isApiRequest) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            if (event.request.url.startsWith('http')) {
              cache.put(event.request, responseClone);
            }
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request, { ignoreSearch: true })
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return new Response('Network connection lost and resource not cached.', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({ 'Content-Type': 'text/plain' })
            });
          });
      })
  );
});

// ==================== BACKGROUND SYNCHRONIZATION EVENT ====================
// Custom background REST sync is deprecated; native Firestore offline persistence is utilized instead.

// ==================== PERIODIC BACKGROUND SYNCHRONIZATION ====================
function updateAppContentInBackground() {
  console.log('[Service Worker] Executing W3C Periodic Background Sync content pre-caching...');
  const ASSETS_TO_UPDATE =[
        './',
        './index.html',
        './manifest.json',
        './icon.svg',
        './js/libs/tailwindcss.js',
        './js/libs/lucide.js',
        'https://cdn.quilljs.com/1.3.7/quill.min.js',
        'https://cdn.quilljs.com/1.3.7/quill.snow.css',
        './js/libs/qrcode.min.js',
        './js/libs/html5-qrcode.min.js'
    ];

  return caches.open(CACHE_NAME).then(cache => {
    return Promise.all(
      ASSETS_TO_UPDATE.map(url => {
        return fetch(url, { cache: 'reload' })
          .then(res => {
            if (res.ok) {
              console.log('[Service Worker] Successfully pre-cached fresh asset:', url);
              return cache.put(url, res);
            }
          })
          .catch(err => console.warn('[Service Worker] Periodic pre-caching failed for:', url, err));
      })
    );
  });
}

self.addEventListener('periodicsync', event => {
  if (event.tag === 'krishi-daily-update') {
    event.waitUntil(updateAppContentInBackground());
  }
});

// Message Event: Listen for SKIP_WAITING to skip waiting phase on user request
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Sync Event: Listen for background sync request to sync cloud database
self.addEventListener('sync', event => {
  if (event.tag === 'sync-cloud-data') {
    console.log('[Service Worker] Background sync event triggered for cloud data');
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'BACKGROUND_SYNC_TRIGGER' });
        });
      })
    );
  }
});

// ==================== FIREBASE CLOUD MESSAGING (BACKGROUND EVENT) ====================
self.addEventListener('push', event => {
  console.log('[Service Worker] Push event received.');
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch(e) {
      data = { title: 'Notification', body: event.data.text() };
    }
  }

  const title = data.title || 'Krishi MCQ Pro 🌾';
  const options = {
    body: data.body || 'New update or message available!',
    icon: data.icon || './icon.svg',
    badge: './icon.svg',
    data: data.url || '/'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url === event.notification.data && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data || '/');
      }
    })
  );
});
