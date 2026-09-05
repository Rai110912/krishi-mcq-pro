const CACHE_NAME = 'krishi-mcq-v252-yov34ug';

// Core offline shell. The app must be able to boot from these alone, with no network.
// Kept as data (not 30 hand-written fetch calls) so install() can treat each entry
// independently — see precacheOne().
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './index.css?v=yov34ug',
  './questions.json',
  './js/libs/tailwindcss.js',
  './js/libs/lucide.js',
  './js/canvas_charts.js?v=yov34ug',
  './js/pwa_helpers.js?v=yov34ug',
  './js/app.js?v=yov34ug',
  './js/elite_animations_controller.js?v=yov34ug',
  './js/elite_3d_engine.js?v=yov34ug',
  './js/firebase-app-compat.js',
  './js/firebase-auth-compat.js',
  './js/firebase-firestore-compat.js',
  './js/sqlite_db.js?v=yov34ug',
  './js/krishi_idb.js?v=yov34ug',
  './js/krishi_worker.js?v=yov34ug',
  './js/lottie_adapter.js',
  './js/animation_orchestrator.js',
  './js/voice_assistant.js?v=yov34ug',
  './js/ambient_player.js',
  './js/data_safety.js?v=yov34ug',
  './js/libs/lz-string.min.js'
];

// Third-party CDN extras plus the libraries index.html no longer loads eagerly: large,
// optional, and the most likely to be slow or blocked. Cached best-effort AFTER install
// resolves, so they can never gate offline support.
// Only prefetched on connections that can afford it — see shouldPrefetchOptional().
//
// qrcode / html5-qrcode / lottie moved here from PRECACHE_URLS when they became lazy —
// 685 KB combined that most launches never touch. They are still precached on any
// connection that can afford it, so offline QR scanning and offline reward animations keep
// working. On a metered link they are skipped, and the cache-first runtime handler stores
// them the first time the feature is genuinely used.
const OPTIONAL_PRECACHE_URLS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  './js/libs/qrcode.min.js',
  './js/libs/html5-qrcode.min.js',
  './js/libs/lottie.min.js'
];

// The OCR bundle is multiple megabytes and most users never open OCR at all, so
// downloading it on every fresh install burned real mobile data and congested the
// install just when the assets that actually matter were being fetched. Skip it on
// metered/slow links; the runtime cache-first handler still stores it the first time
// OCR is genuinely used, so offline OCR keeps working for anyone who uses OCR.
function shouldPrefetchOptional() {
  const c = self.navigator && self.navigator.connection;
  if (!c) return true; // No Network Information API: keep the old behaviour.
  if (c.saveData) return false;
  return !/(^|-)2g$/.test(c.effectiveType || '') && c.effectiveType !== 'slow-2g';
}

// Versioned URLs (`?v=yov34ug`) are immutable, so the copy the page just downloaded is
// byte-identical and reusing it costs nothing. Only the HTML is fetched with 'reload',
// because it is the version pointer and must never be stale. Using 'reload' for
// everything re-downloaded the whole ~1.5MB shell a second time, which is what made
// registering the worker early compete with the first paint.
function precacheMode(url) {
  return (url === './' || url === './index.html') ? 'reload' : 'default';
}

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
  return fetch(url, { cache: precacheMode(url) })
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
            if (shouldPrefetchOptional()) {
              OPTIONAL_PRECACHE_URLS.forEach(url => precacheOne(cache, url));
            } else {
              console.log('[Service Worker] Metered/slow connection - skipping optional OCR prefetch.');
            }
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

// Walks the cached-shell candidates in order of fidelity. Shared by both the
// stale-while-revalidate hit path and the offline fallback path.
function matchCachedShell(request) {
  return caches.match(request)
    .then(hit => hit || caches.match('./'))
    .then(hit => hit || caches.match('./index.html'));
}

// Fetches the shell from the network and refreshes both shell cache keys. Never
// rejects — resolves to null instead, so callers can treat "no network" uniformly.
function revalidateShell(request) {
  return fetch(request, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
    .then(networkResponse => {
      if (networkResponse && networkResponse.status === 200 && request.url.startsWith('http')) {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put('./index.html', copy.clone());
          cache.put('./', copy);
        });
      }
      return networkResponse;
    })
    .catch(() => null);
}

// True only for the app shell itself. Deliberately narrow: the stale-while-revalidate
// branch below answers out of the shell cache, so anything that is NOT the shell must
// never reach it. `login-helper.html` is same-origin and its own OAuth redirectUri, so
// serving it the cached index.html would hand Google's redirect the wrong document and
// silently break sign-in. Same for the `/__/auth/` handler paths Firebase can host.
function isAppShellUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl, self.location.href); } catch (e) { return false; }
  if (url.origin !== self.location.origin) return false;
  return url.pathname === '/' || /(^|\/)index\.html$/.test(url.pathname);
}

// Fetch Event: stale-while-revalidate for navigations, cache-first for static assets
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const isNavigation = event.request.mode === 'navigate' ||
                       event.request.url.endsWith('/') ||
                       event.request.url.endsWith('index.html');

  if (isNavigation && isAppShellUrl(event.request.url)) {
    // Stale-while-revalidate. This used to be network-first, which meant every single
    // cold start of the Android APK blocked on a round trip to the hosting origin — the
    // APK is a thin WebView on server.url, so launching the app IS a navigation. On a
    // slow link that stalled the splash for seconds, and offline it had to time out
    // before the cache was even consulted. Now the cached shell answers instantly and
    // the fresh copy lands in the cache for the next launch; the page's own
    // checkForUpdates()/SKIP_WAITING flow is what tells the user a new version is ready.
    event.respondWith(
      matchCachedShell(event.request).then(cached => {
        if (cached) {
          event.waitUntil(revalidateShell(event.request));
          return cached;
        }
        // Nothing cached yet (very first launch): the network is the only option.
        return revalidateShell(event.request).then(res => res || new Response(OFFLINE_FALLBACK_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }));
      })
    );
    return;
  }

  // Same-origin navigation that is NOT the shell — e.g. login-helper.html (the OAuth
  // redirectUri) or a deep link that firebase.json's `** -> /index.html` rewrite would
  // resolve to the shell. Network FIRST here, because the requested document must win
  // whenever it exists; only when the network is genuinely gone do we fall back to the
  // cached shell so offline deep links still open the app instead of a bare 503.
  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .catch(() => null)
        .then(res => res || matchCachedShell(event.request))
        .then(res => res || new Response(OFFLINE_FALLBACK_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }))
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
                        // Unversioned vendor bundles, including the ones now fetched on
                        // demand (qrcode, html5-qrcode, lottie). Cache-first means the very
                        // first on-demand load is also the last network trip for them, so a
                        // metered user who was skipped by the optional precache still gets
                        // offline QR and offline animations after using the feature once.
                        // Safe to pin: activate() wipes every cache whose name is not the
                        // current CACHE_NAME, and bump_version.js changes CACHE_NAME on
                        // every build, so a vendor upgrade is still picked up on deploy.
                        event.request.url.includes('/js/libs/') ||
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

  // Explicit opt-in for the OCR bundle that install() now skips on metered/slow links.
  // Lets a "Download OCR for offline use" control fetch it on the user's own terms.
  if (event.data && event.data.type === 'CACHE_OPTIONAL_ASSETS') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => Promise.allSettled(OPTIONAL_PRECACHE_URLS.map(url => precacheOne(cache, url))))
        .then(() => {
          if (event.source) {
            event.source.postMessage({ type: 'OPTIONAL_ASSETS_CACHED' });
          }
        })
    );
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
