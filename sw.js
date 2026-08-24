const CACHE_NAME = 'krishi-mcq-v169-1dj7qp0';

// Install Event: Pre-cache core shell resources with cache-busting reload
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching minimal offline shell assets, local libraries, and modular code...');
        return Promise.all([
          fetch('./', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./', r); }),
          fetch('./index.html', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./index.html', r); }),
          fetch('./manifest.json', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./manifest.json', r); }),
          fetch('./icon.svg', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./icon.svg', r); }),
          fetch('./index.css?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./index.css?v=1dj7qp0', r); }),
          fetch('./questions.json', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./questions.json', r); }),
          fetch('./js/libs/tailwindcss.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/libs/tailwindcss.js', r); }),
          fetch('./js/libs/lucide.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/libs/lucide.js', r); }),
          fetch('./js/canvas_charts.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/canvas_charts.js?v=1dj7qp0', r); }),

          fetch('./js/pwa_helpers.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/pwa_helpers.js?v=1dj7qp0', r); }),
          fetch('./js/app.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/app.js?v=1dj7qp0', r); }),
          fetch('./js/elite_animations_controller.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/elite_animations_controller.js?v=1dj7qp0', r); }),
          fetch('./js/elite_3d_engine.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/elite_3d_engine.js?v=1dj7qp0', r); }),
          fetch('./js/firebase-app-compat.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/firebase-app-compat.js', r); }),
          fetch('./js/firebase-auth-compat.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/firebase-auth-compat.js', r); }),
          fetch('./js/sqlite_db.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/sqlite_db.js?v=1dj7qp0', r); }),
          fetch('./js/krishi_idb.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/krishi_idb.js?v=1dj7qp0', r); }),
          fetch('./js/krishi_worker.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/krishi_worker.js?v=1dj7qp0', r); }),
          fetch('./js/lottie_adapter.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/lottie_adapter.js', r); }),
          fetch('./js/animation_orchestrator.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/animation_orchestrator.js', r); }),
          fetch('./js/libs/lottie.min.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/libs/lottie.min.js', r); }),
          fetch('./js/voice_assistant.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/voice_assistant.js?v=1dj7qp0', r); }),
          fetch('./js/ambient_player.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/ambient_player.js', r); }),
fetch('./js/data_safety.js?v=1dj7qp0', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/data_safety.js?v=1dj7qp0', r); }),
          fetch('./js/firebase-firestore-compat.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/firebase-firestore-compat.js', r); }),
          fetch('./js/libs/qrcode.min.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/libs/qrcode.min.js', r); }),
          fetch('./js/libs/html5-qrcode.min.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/libs/html5-qrcode.min.js', r); }),
          fetch('./js/libs/lz-string.min.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/libs/lz-string.min.js', r); }),
          fetch('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', r); })
        ]);
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
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) return cachedResponse;
              return caches.match('./')
                .then(rootResponse => {
                  if (rootResponse) return rootResponse;
                  return caches.match('./index.html');
                });
            });
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
