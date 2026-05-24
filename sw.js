const CACHE_NAME = 'krishi-mcq-pro-v7';

// Install Event: Pre-cache core shell resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching offline shell...');
        return fetch('./index.html')
          .then(res => {
            if (res.ok) {
              cache.put('./', res.clone());
              cache.put('./index.html', res);
            } else {
              throw new Error('Failed to fetch index.html during SW installation.');
            }
            return cache.addAll([
              './manifest.json',
              './icon.svg'
            ]);
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

// Fetch Event: Network-First falling back to Cache strategy
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
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
        const url = `https://krishi-mcq-sync-default-rtdb.firebaseio.com/sync_keys/${syncKey}.json`;

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
