const CACHE_NAME = 'agriculture-exam-v25;

// Install Event: Pre-cache core shell resources with cache-busting reload
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching minimal offline shell assets and Firebase SDKs...');
        return Promise.all([
          fetch('./manifest.json', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./manifest.json', r); }),
          fetch('./icon.svg', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./icon.svg', r); }),
          fetch('./js/firebase-app-compat.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/firebase-app-compat.js', r); }),
          fetch('./js/firebase-database-compat.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/firebase-database-compat.js', r); }),
          fetch('./js/firebase-auth-compat.js', { cache: 'reload' }).then(r => { if (r.ok) cache.put('./js/firebase-auth-compat.js', r); })
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
                        event.request.url.includes('unpkg.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true })
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
function getQueuedSyncData() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open('KrishiOfflineSyncDB', 1);
    request.onerror = () => resolve(null);
    request.onsuccess = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sync_queue')) {
        resolve(null);
        return;
      }
      try {
        const tx = db.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        const getReq = store.get('pending_sync');
        getReq.onsuccess = () => resolve(getReq.result);
        getReq.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    };
  });
}

function clearQueuedSyncData() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const request = indexedDB.open('KrishiOfflineSyncDB', 1);
    request.onsuccess = event => {
      const db = event.target.result;
      if (db.objectStoreNames.contains('sync_queue')) {
        try {
          const tx = db.transaction('sync_queue', 'readwrite');
          tx.objectStore('sync_queue').delete('pending_sync');
        } catch (e) {}
      }
      resolve();
    };
    request.onerror = () => resolve();
  });
}

self.addEventListener('sync', event => {
  if (event.tag === 'krishi-db-sync') {
    event.waitUntil(
      getQueuedSyncData().then(syncData => {
        if (!syncData || !syncData.syncKey || !syncData.payload) {
          return;
        }

        const syncKey = syncData.syncKey;
        const payload = syncData.payload;
        const url = `https://krishi-mcq-pro-default-rtdb.firebaseio.com/sync_keys/${syncKey}.json`;

        console.log('[Service Worker] Executing W3C Background Sync for key:', syncKey);

        return fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }).then(res => {
          if (res.status === 200 || res.ok) {
            console.log('[Service Worker] Background Sync completed successfully!');
            return clearQueuedSyncData();
          } else {
            console.warn('[Service Worker] Firebase REST API responded with error:', res.status);
            throw new Error('Firebase REST error: ' + res.status);
          }
        }).catch(err => {
          console.error('[Service Worker] Background Sync failed during network fetch:', err);
          throw err;
        });
      })
    );
  }
});

// ==================== PERIODIC BACKGROUND SYNCHRONIZATION ====================
function updateAppContentInBackground() {
  console.log('[Service Worker] Executing W3C Periodic Background Sync content pre-caching...');
  const ASSETS_TO_UPDATE = [
    './index.html',
    './manifest.json',
    './icon.svg'
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
