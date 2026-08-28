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

const APP_LINES = APP_JS.split('\n');

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
