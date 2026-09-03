'use strict';

/**
 * Boot & offline contract tests.
 *
 * These exist because the app shipped for months with NO service worker registered at
 * all: the registration lived inside the DOMContentLoaded async function, past
 * `await loadStaticQuestions()`, and was attached with `window.addEventListener('load')`
 * — by which time `load` had already fired. The whole offline feature was dead, yet
 * nothing threw, nothing logged, and every existing test still passed.
 *
 * A full headless boot would need a browser automation dependency. Instead these tests
 * assert the *contract* that bug violated, plus they run sw.js for real inside a `vm`
 * with mocked service-worker globals. Zero external dependencies, same style as
 * tests/helpers.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const SW_JS = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const LOTTIE_ADAPTER = fs.readFileSync(path.join(ROOT, 'js', 'lottie_adapter.js'), 'utf8');

const APP_LINES = APP_JS.split('\n');
// Source with `//` comment lines removed. Contract regexes that search for a *code* shape
// must run against this: the comments explaining a removed bug quote the very code they
// replaced, so searching raw source makes a test pass or fail on comment length.
const APP_CODE = APP_LINES.filter(l => !l.trim().startsWith('//')).join('\n');

/** 1-based line number of the first line matching `re`, ignoring `//` comment lines. */
function findLine(re, what) {
    for (let i = 0; i < APP_LINES.length; i++) {
        const line = APP_LINES[i];
        if (line.trim().startsWith('//')) continue;
        if (re.test(line)) return i + 1;
    }
    assert.fail('js/app.js: could not locate ' + what + ' - update tests/boot_contract.test.js');
}

// ── Static boot-order contract (js/app.js) ──────────────────────────────────────

test('service worker is registered before the blocking awaits in DOMContentLoaded', () => {
    const register = findLine(/navigator\.serviceWorker\.register\(/, 'serviceWorker.register() call');
    const blockingAwait = findLine(/^\s*await loadStaticQuestions\(\);/, 'await loadStaticQuestions();');

    assert.ok(
        register < blockingAwait,
        'serviceWorker.register() is at line ' + register + ' but `await loadStaticQuestions()` is ' +
        'at line ' + blockingAwait + '. Registration must come FIRST, otherwise offline setup does ' +
        'not start until a ~358KB JSON payload has been fetched and parsed.'
    );
});

test('serviceWorker.register() is not gated behind a window load listener', () => {
    const register = APP_JS.indexOf('navigator.serviceWorker.register(');
    // Look at the 400 chars in front of the registration: a `load` listener there is the
    // exact shape of the original bug.
    const preamble = APP_JS.slice(Math.max(0, register - 400), register);
    assert.ok(
        !/addEventListener\(\s*['"]load['"]/.test(preamble),
        'registration appears to be inside a window `load` listener again - by the time this ' +
        'code runs `load` has already fired, so the listener never executes.'
    );
});

test('window load listeners after the boot await have a readyState fast path', () => {
    // Listeners registered before the first await are fine: script evaluation happens
    // before `load`. Only code past the await is in the danger zone, because that runs
    // in a later task, after `load` has already fired.
    const blockingAwait = findLine(/^\s*await loadStaticQuestions\(\);/, 'await loadStaticQuestions();');
    const offenders = [];
    APP_LINES.forEach((line, i) => {
        if (i + 1 <= blockingAwait) return;
        if (!/window\.addEventListener\(\s*['"]load['"]/.test(line)) return;
        // The guard is expected on this line or the one immediately above it.
        const context = (APP_LINES[i - 1] || '') + '\n' + line;
        if (!/readyState\s*===\s*['"]complete['"]/.test(context)) {
            offenders.push(i + 1);
        }
    });
    assert.deepStrictEqual(
        offenders, [],
        'unguarded window `load` listener(s) at line(s) ' + offenders.join(', ') +
        '. Anything below `await loadStaticQuestions()` runs after `load` has fired, so a ' +
        'bare listener there is dead code. Use: readyState === "complete" ? fn() : addEventListener(...).'
    );
});

// ── Precache manifest contract (sw.js vs index.html) ───────────────────────────

function precacheList() {
    const m = SW_JS.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
    assert.ok(m, 'PRECACHE_URLS not found in sw.js');
    return m[1].split(',')
        .map(s => (s.match(/'([^']+)'/) || [])[1])
        .filter(Boolean);
}

test('every local script index.html loads is in the SW precache list', () => {
    const precached = precacheList().map(u => u.replace(/^\.\//, '').split('?')[0]);
    const referenced = new Set();
    const re = /<script[^>]+src=["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(INDEX_HTML)) !== null) {
        const src = m[1];
        if (/^(https?:)?\/\//.test(src)) continue; // CDN: optional by design
        referenced.add(src.replace(/^\.?\//, '').split('?')[0]);
    }
    assert.ok(referenced.size > 0, 'no local <script> tags parsed out of index.html');

    const missing = [...referenced].filter(s => !precached.includes(s));
    assert.deepStrictEqual(
        missing, [],
        'script(s) loaded by index.html but never precached: ' + missing.join(', ') +
        '. They will be missing offline. Add them to PRECACHE_URLS in sw.js.'
    );
});

test('bump_version.js rewrite targets still match sw.js', () => {
    assert.ok(
        /const CACHE_NAME = '.*?';/.test(SW_JS),
        'CACHE_NAME no longer matches the regex bump_version.js uses to bump it'
    );
    assert.ok(
        (SW_JS.match(/\?v=[a-zA-Z0-9_]+/g) || []).length > 0,
        'no ?v= tokens left in sw.js - bump_version.js would silently stop versioning assets'
    );
});

// ── sw.js behavioural tests: the real worker, run inside a vm ───────────────────

const BASE = 'http://localhost/';
const abs = (x) => new URL(typeof x === 'string' ? x : x.url, BASE).href;

function createSwHarness({ unreachable = [], offline = false, cacheSeed = {}, connection } = {}) {
    const store = new Map();
    Object.keys(cacheSeed).forEach(k => store.set(abs(k), new Response(cacheSeed[k], { status: 200 })));

    const fetchCalls = [];
    const listeners = {};
    let skipWaitingCalled = false;

    const cacheObj = {
        put: (req, res) => { store.set(abs(req), res); return Promise.resolve(); },
        keys: () => Promise.resolve([...store.keys()].map(url => ({ url }))),
        match: (req) => Promise.resolve(store.has(abs(req)) ? store.get(abs(req)).clone() : undefined)
    };
    const cachesMock = {
        open: () => Promise.resolve(cacheObj),
        match: (req) => cacheObj.match(req),
        keys: () => Promise.resolve(['krishi-test-cache']),
        delete: () => Promise.resolve(true)
    };
    const fetchMock = (input, opts) => {
        const url = abs(input);
        fetchCalls.push({ url, cache: opts && opts.cache });
        if (offline || unreachable.some(u => url.includes(u))) {
            return Promise.reject(new Error('offline: ' + url));
        }
        return Promise.resolve(new Response('network-body', { status: 200 }));
    };
    const clientsMock = { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) };
    const selfMock = {
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipWaiting: () => { skipWaitingCalled = true; return Promise.resolve(); },
        clients: clientsMock,
        registration: { showNotification: () => Promise.resolve() },
        location: new URL(BASE),
        navigator: connection ? { connection } : {}
    };

    vm.runInContext(SW_JS, vm.createContext({
        self: selfMock, caches: cachesMock, fetch: fetchMock, clients: clientsMock,
        console: { log() {}, warn() {}, error() {} },
        Response, URL, Promise, setTimeout
    }), { filename: 'sw.js' });

    return {
        store, fetchCalls,
        get skipWaitingCalled() { return skipWaitingCalled; },
        install() {
            const waits = [];
            listeners.install({ waitUntil: p => waits.push(p) });
            return Promise.all(waits);
        },
        navigate(url) {
            const request = { method: 'GET', mode: 'navigate', url: url || BASE };
            let responded;
            const waits = [];
            listeners.fetch({ request, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
            return Promise.resolve(responded).then(res => ({ res, waits }));
        },
        /** A plain sub-resource GET (script/image/etc), i.e. NOT a navigation. */
        request(url) {
            const request = { method: 'GET', mode: 'no-cors', url: abs(url) };
            let responded;
            const waits = [];
            listeners.fetch({ request, respondWith: p => { responded = p; }, waitUntil: p => waits.push(p) });
            return Promise.resolve(responded).then(res => ({ res, waits }));
        }
    };
}

test('install() survives unreachable assets and still activates', async () => {
    // The original install() wrapped ~30 bare fetches in one Promise.all with no per-item
    // catch, so a single blocked CDN rejected the batch, skipWaiting() never ran, the
    // worker never activated and the cache stayed EMPTY. That is the real reason offline
    // startup died - sw.js itself was fine.
    const sw = createSwHarness({ unreachable: ['questions.json', 'lucide.js', 'jsdelivr'] });
    await sw.install();

    assert.strictEqual(sw.skipWaitingCalled, true, 'skipWaiting() was not reached - install() rejected');
    assert.ok(sw.store.size >= 20, 'expected the reachable core assets to be cached, got ' + sw.store.size);
    assert.ok(!sw.store.has(abs('./questions.json')), 'an unreachable asset must not be cached');
});

test('install() reuses the HTTP cache for versioned assets but revalidates the HTML', async () => {
    // Fetching everything with cache:'reload' re-downloaded the whole shell a second
    // time, which is what made registering the worker early fight the first paint.
    const sw = createSwHarness();
    await sw.install();

    const html = sw.fetchCalls.find(c => c.url === abs('./index.html'));
    const versioned = sw.fetchCalls.find(c => c.url.includes('app.js?v='));

    assert.ok(html, './index.html was never precached');
    assert.strictEqual(html.cache, 'reload', 'the HTML is the version pointer and must never be stale');
    assert.ok(versioned, 'no versioned asset was precached');
    assert.strictEqual(versioned.cache, 'default',
        'versioned URLs are immutable - refetching them with cache:"reload" doubles the shell download');
});

test('the multi-MB OCR bundle is skipped on metered connections', async () => {
    const metered = createSwHarness({ connection: { saveData: true, effectiveType: '4g' } });
    await metered.install();
    assert.ok(
        !metered.fetchCalls.some(c => c.url.includes('tesseract')),
        'OCR bundle was prefetched despite saveData - that is several MB of the user\'s mobile data'
    );

    const wifi = createSwHarness({ connection: { saveData: false, effectiveType: '4g' } });
    await wifi.install();
    assert.ok(
        wifi.fetchCalls.some(c => c.url.includes('tesseract')),
        'OCR bundle should still be prefetched on an unmetered connection so offline OCR works'
    );
});

test('navigation answers from cache first and revalidates in the background', async () => {
    // The APK is a thin WebView on server.url, so launching the app IS a navigation.
    // Network-first meant every cold start blocked on a round trip to the origin.
    const sw = createSwHarness({ cacheSeed: { './': 'CACHED-SHELL' } });
    const { res, waits } = await sw.navigate(BASE);

    assert.strictEqual(await res.text(), 'CACHED-SHELL',
        'a cached shell must be served immediately instead of waiting for the network');
    assert.ok(waits.length > 0, 'the fresh copy must still be revalidated via waitUntil()');
    await Promise.all(waits);
    assert.ok(sw.fetchCalls.some(c => c.url === BASE), 'no background revalidation request was made');
});

test('navigation offline with an empty cache still renders a real page', async () => {
    // This chain used to end at caches.match('./index.html'), which resolves to undefined
    // on a first launch while offline - respondWith(undefined) is a blank white screen.
    const sw = createSwHarness({ offline: true });
    const { res } = await sw.navigate(BASE);

    assert.ok(res, 'respondWith() resolved to undefined - that is the blank white screen');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const body = await res.text();
    assert.match(body, /You are offline/);
    assert.match(body, /Try again/);
});

test('a cached shell wins over a dead network', async () => {
    const sw = createSwHarness({ offline: true, cacheSeed: { './index.html': 'CACHED-SHELL' } });
    const { res, waits } = await sw.navigate(BASE);
    await Promise.allSettled(waits);

    assert.strictEqual(await res.text(), 'CACHED-SHELL',
        'offline navigation must fall through to the cached shell, not the synthesised fallback');
});

// ── login-helper.html must never be answered with the app shell ─────────────────

test('a same-origin non-shell navigation is not served the cached app shell', async () => {
    // login-helper.html is its own OAuth redirectUri (see login-helper.html:239). The
    // stale-while-revalidate branch answers out of the shell cache and matchCachedShell()
    // falls through to caches.match('./'), so before isAppShellUrl() gated it, Google's
    // redirect landed on the cached index.html instead of the helper page and sign-in
    // silently failed.
    const sw = createSwHarness({ cacheSeed: { './': 'CACHED-SHELL', './index.html': 'CACHED-SHELL' } });
    const { res } = await sw.navigate(BASE + 'login-helper.html');

    assert.strictEqual(await res.text(), 'network-body',
        'login-helper.html was answered from the shell cache. Non-shell navigations must go ' +
        'to the network first, or the OAuth redirect target is replaced by the app shell.');
    assert.ok(
        sw.fetchCalls.some(c => c.url === abs('./login-helper.html')),
        'no network request was made for login-helper.html at all'
    );
});

test('the app shell still answers from cache when a non-shell page is also cached', async () => {
    // Guards the opposite direction: narrowing the SWR branch must not accidentally push
    // the shell itself onto the network-first path, which is the cold-start regression
    // stale-while-revalidate existed to fix.
    const sw = createSwHarness({ cacheSeed: { './': 'CACHED-SHELL' } });
    const { res } = await sw.navigate(BASE + 'index.html');
    assert.strictEqual(await res.text(), 'CACHED-SHELL', 'index.html must stay cache-first');
});

// ── controllerchange must not reload on first activation (js/app.js) ────────────

test('the first service worker activation does not reload the page', () => {
    // Registration was hoisted above the boot awaits, so install -> skipWaiting ->
    // clients.claim -> controllerchange now completes a few seconds after first paint —
    // exactly when a user taps "Sign in with Google". An unconditional reload there tore
    // down the opener, so signInWithPopup()'s promise died and the popup was orphaned.
    const handler = APP_JS.slice(APP_JS.indexOf("addEventListener('controllerchange'"));
    const body = handler.slice(0, handler.indexOf('location.reload()'));

    assert.match(body, /!swHadControllerAtBoot/,
        'the controllerchange handler reloads without checking whether a controller existed ' +
        'at boot. A first activation is not an update - there is nothing stale to refresh.');
    assert.match(body, /__krishiAuthInFlight__/,
        'the reload is not suppressed during an auth handshake');
});

test('swHadControllerAtBoot is sampled before register(), not after activation', () => {
    const sample = findLine(/const swHadControllerAtBoot =/, 'swHadControllerAtBoot assignment');
    const register = findLine(/navigator\.serviceWorker\.register\(/, 'serviceWorker.register() call');
    assert.ok(
        sample < register,
        'swHadControllerAtBoot is read at line ' + sample + ', after register() at line ' +
        register + '. By then a controller may already be claimed, so the flag would always ' +
        'be true and the first-activation reload would come back.'
    );
});

test('handleGoogleLogin clears the auth-in-flight flag on every exit path', () => {
    const start = APP_JS.indexOf('async function handleGoogleLogin()');
    assert.ok(start > 0, 'handleGoogleLogin not found');
    const fn = APP_JS.slice(start, APP_JS.indexOf('function initGoogleOneTap()', start));

    assert.match(fn, /__krishiAuthInFlight__\s*=\s*true/, 'the flag is never set');
    assert.match(fn, /finally\s*\{[\s\S]*?__krishiAuthInFlight__\s*=\s*false/,
        'the flag must be cleared in a `finally`. handleGoogleLogin has an early `return` in ' +
        'the native-failure path, so clearing it only after the happy path would leave the ' +
        'flag stuck true and permanently suppress genuine update reloads.'
    );
});

// ── Heavy libraries are fetched on demand, not on boot ──────────────────────────

// 685 KB of vendor code that only two screens ever touch. qrcode.min.js and
// html5-qrcode.min.js were plain <script> tags with no `defer`, so they blocked the HTML
// parser on EVERY launch; lottie.min.js was deferred but still downloaded and parsed on
// every launch, then usually discarded by the adapter's own accessibility checks.
const LAZY_LIBS = ['qrcode.min.js', 'html5-qrcode.min.js', 'lottie.min.js'];

test('the on-demand libraries are not <script> tags in index.html any more', () => {
    const eager = LAZY_LIBS.filter(lib => {
        const re = new RegExp('<script[^>]+src=["\'][^"\']*' + lib.replace('.', '\\.'));
        return re.test(INDEX_HTML);
    });
    assert.deepStrictEqual(
        eager, [],
        'these libraries are loaded eagerly again: ' + eager.join(', ') + '. Together they ' +
        'are ~685 KB on a cold start for features most launches never open. They must be ' +
        'fetched at the point of use - loadScriptOnce() in js/app.js, loadLottieEngine() ' +
        'in js/lottie_adapter.js.'
    );
});

test('every on-demand library is still cached by the service worker', () => {
    // Dropping the <script> tag without keeping the file in a precache list would silently
    // break offline QR scanning and offline reward animations.
    const optional = SW_JS.match(/const OPTIONAL_PRECACHE_URLS = \[([\s\S]*?)\];/);
    assert.ok(optional, 'OPTIONAL_PRECACHE_URLS not found in sw.js');
    const missing = LAZY_LIBS.filter(lib => !optional[1].includes(lib));
    assert.deepStrictEqual(
        missing, [],
        'not reachable offline any more: ' + missing.join(', ') + '. A lazily loaded file ' +
        'still has to be in OPTIONAL_PRECACHE_URLS, or the first use offline fails.'
    );
    assert.ok(
        !precacheList().some(u => LAZY_LIBS.some(lib => u.includes(lib))),
        'an on-demand library is back in the blocking PRECACHE_URLS list - install() would ' +
        'download it on every fresh install, which is the mobile data this change saved.'
    );
});

test('loadScriptOnce() does not cache a failed load', () => {
    const i = APP_JS.indexOf('function loadScriptOnce(');
    assert.ok(i > 0, 'loadScriptOnce() not found in js/app.js');
    const fn = APP_JS.slice(i, APP_JS.indexOf('\n    }', i));

    assert.match(fn, /onerror[\s\S]{0,120}?delete scriptLoadPromises\[src\]/,
        'a rejected promise stays cached, so every later attempt re-rejects instantly. ' +
        'A user who opened the QR screen while offline could then never open it again this ' +
        'session, even after reconnecting.'
    );
    assert.match(fn, /if\s*\(\s*scriptLoadPromises\[src\]\s*\)\s*return/,
        'concurrent callers must share one <script> tag and one download'
    );
});

test('openQRScanner() cannot spin forever when the library never defines its global', () => {
    const i = APP_JS.indexOf('function openQRScanner()');
    assert.ok(i > 0, 'openQRScanner() not found');
    const guard = APP_JS.slice(i, APP_JS.indexOf('// Native Capacitor Camera', i));

    assert.ok(
        !/setTimeout\(\s*openQRScanner/.test(guard),
        'the old blind `setTimeout(openQRScanner, 500)` retry is back. With no eager ' +
        '<script> tag there is nothing to wait for, so it loops forever showing a toast.'
    );
    assert.match(guard, /loadScriptOnce\(\s*'\.\/js\/libs\/html5-qrcode\.min\.js'\s*\)/,
        'the guard must actually fetch the scanner library'
    );
    assert.match(guard, /qrScannerLibUnavailable/,
        'openQRScanner() re-calls itself after the load resolves. Without a latch for ' +
        '"loaded but the global is still missing" that recursion never terminates, because ' +
        'loadScriptOnce() resolves instantly from cache on every subsequent pass.'
    );
});

test('a missing QR library no longer aborts the rest of updateSyncUI()', () => {
    assert.ok(
        !/typeof QRCode === 'undefined'[\s\S]{0,400}?return;/.test(APP_CODE),
        "the `typeof QRCode === 'undefined'` gate is back in updateSyncUI(). It `return`s " +
        'out of the whole function, so a QR library that has not arrived yet also leaves ' +
        'the statistics dashboard and every sync status badge below it unpopulated. Load ' +
        'the library where it is used instead.'
    );
});

test('the Lottie engine is fetched only after the cheap bail-outs have passed', () => {
    const perf = LOTTIE_ADAPTER.indexOf('getPerfSettings');
    const validate = LOTTIE_ADAPTER.indexOf("fetch(path, { cache: 'force-cache' })");
    const engine = LOTTIE_ADAPTER.indexOf('await loadLottieEngine()');

    assert.ok(perf > 0 && validate > 0 && engine > 0,
        'js/lottie_adapter.js no longer has the perf check / asset validation / engine load ' +
        'trio this test tracks - update tests/boot_contract.test.js');
    assert.ok(
        perf < engine && validate < engine,
        'lottie-web (298 KB) is downloaded before the accessibility, performance and asset ' +
        'checks that decide whether anything will be rendered at all. A battery-mode or ' +
        'reduce-motion user must never pay for it.'
    );
});

test('loadLottieEngine() reports failure instead of rejecting, and retries later', () => {
    const i = LOTTIE_ADAPTER.indexOf('function loadLottieEngine()');
    assert.ok(i > 0, 'loadLottieEngine() not found in js/lottie_adapter.js');
    const fn = LOTTIE_ADAPTER.slice(i, LOTTIE_ADAPTER.indexOf('\n    }', i));

    assert.ok(
        !/reject/.test(fn),
        'loadLottieEngine() rejects. Every caller already treats "no Lottie" as "run the ' +
        'fallback", so a rejection here turns a graceful downgrade into an unhandled ' +
        'rejection inside play().'
    );
    assert.match(fn, /onerror[\s\S]{0,120}?lottieEnginePromise = null/,
        'a failed engine load stays cached, so reward animations are dead for the whole ' +
        'session after one flaky fetch'
    );
});

test('an on-demand library is served cache-first once it has been fetched', async () => {
    // Closes the gap the optional precache leaves on metered links: shouldPrefetchOptional()
    // skips these files there, so the very first genuine use is the only chance to store
    // them. Cache-first also means no revalidation round trip on every later use.
    const sw = createSwHarness({ cacheSeed: { './js/libs/html5-qrcode.min.js': 'CACHED-LIB' } });
    const { res } = await sw.request('./js/libs/html5-qrcode.min.js');

    assert.strictEqual(await res.text(), 'CACHED-LIB',
        '/js/libs/ is not on the cache-first path, so every on-demand load hits the network ' +
        'first and a metered user who was skipped by the optional precache has no offline ' +
        'copy of the QR scanner or the Lottie engine.');
    assert.ok(
        !sw.fetchCalls.some(c => c.url.includes('html5-qrcode')),
        'a cached vendor library must not be re-requested from the network'
    );
});

test('an uncached on-demand library is fetched and then stored', async () => {
    const sw = createSwHarness();
    const { res } = await sw.request('./js/libs/lottie.min.js');
    assert.strictEqual(await res.text(), 'network-body');
    assert.ok(
        sw.store.has(abs('./js/libs/lottie.min.js')),
        'the first on-demand load did not populate the cache, so offline playback stays ' +
        'broken no matter how many times the feature is used online'
    );
});
