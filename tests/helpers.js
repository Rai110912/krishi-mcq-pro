'use strict';

/**
 * Minimal browser-environment stub so browser-scoped modules
 * (js/pwa_helpers.js) can load and run under Node's test runner.
 * Zero external dependencies by design.
 */

function createLocalStorageStub(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; },
        _dump: () => Object.fromEntries(store)
    };
}

function installBrowserStubs({ localStorageSeed = {} } = {}) {
    const localStorage = createLocalStorageStub(localStorageSeed);

    globalThis.localStorage = localStorage;
    globalThis.window = globalThis.window || globalThis;
    globalThis.document = {
        getElementById: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
    };
    if (!globalThis.navigator) {
        Object.defineProperty(globalThis, 'navigator', {
            value: { onLine: true },
            configurable: true
        });
    }

    return { localStorage };
}

/** Load the real production module once per process with stubs installed. */
function loadPwaHelpers(options) {
    installBrowserStubs(options);
    require('../js/pwa_helpers.js');
}

module.exports = { installBrowserStubs, loadPwaHelpers, createLocalStorageStub };
