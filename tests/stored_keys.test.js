'use strict';

/**
 * Store-location contract for the three krishi_* keys js/pwa_helpers.js owns.
 *
 * KrishiStorage.init() copies every krishi_* key out of native localStorage into its own
 * IndexedDB-backed store and then DELETES the localStorage copy (js/krishi_idb.js:88-96).
 * These three keys were read from and written to native localStorage directly, so on every
 * boot each one came back null — the value had been moved out from under it:
 *
 *   • krishi_pwa_dismissed        — "Later" on the install banner is supposed to hold for 7
 *                                   days; the banner returned on the very next launch.
 *   • krishi_last_delta_sync_time — the delta-question sync restarted from timestamp 0 every
 *                                   launch: the full merge ran again and the "syncing new
 *                                   questions" HUD appeared with nothing new to show.
 *   • krishi_active_cache_name    — the OTA check read null, wrote the CURRENT server version
 *                                   and returned, so the one launch that follows a deploy —
 *                                   the launch where it matters — never announced the update.
 *
 * Same failure the SM2 engine had (tests/sm2_store.test.js); same fix, so the same shape of
 * test: one store, a union rather than a blind pick, and the stray copy drained.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPwaHelpers } = require('./helpers');

loadPwaHelpers();
const W = globalThis.window;
const HELPERS_JS = fs.readFileSync(path.join(__dirname, '..', 'js', 'pwa_helpers.js'), 'utf8');

/** A stand-in for KrishiStorage: a separate store that is NOT native localStorage. */
function installKrishiStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    const api = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: k => { store.delete(k); },
        _dump: () => Object.fromEntries(store)
    };
    W.KrishiStorage = api;
    return api;
}

test.beforeEach(() => {
    localStorage.clear();
    delete W.KrishiStorage;
});

test('a key held only by KrishiStorage is found, and the write goes to the same store', () => {
    const ks = installKrishiStorage({ krishi_pwa_dismissed: '1700000000000' });

    assert.equal(W.krishiReadStoredKey('krishi_pwa_dismissed'), '1700000000000',
        'this returned null in production: the value was in KrishiStorage and the read went ' +
        'to a localStorage key init() had already deleted'
    );

    W.krishiWriteStoredKey('krishi_active_cache_name', 'krishi-v233');
    assert.equal(ks._dump().krishi_active_cache_name, 'krishi-v233');
    assert.equal(localStorage.getItem('krishi_active_cache_name'), null,
        'two copies of one key is the bug itself — the next boot would read the other one'
    );
});

test('with no KrishiStorage present localStorage is the store and is never drained', () => {
    localStorage.setItem('krishi_active_cache_name', 'krishi-v232');

    assert.equal(W.krishiReadStoredKey('krishi_active_cache_name'), 'krishi-v232',
        'localStorage is the fallback store before KrishiStorage loads'
    );
    assert.ok(localStorage.getItem('krishi_active_cache_name'),
        'draining here would delete the live value — there is no other store to hold it'
    );

    W.krishiWriteStoredKey('krishi_active_cache_name', 'krishi-v233');
    assert.equal(localStorage.getItem('krishi_active_cache_name'), 'krishi-v233',
        'and the write has to land somewhere rather than being dropped'
    );
});

test('a stray localStorage copy wins by default and is drained', () => {
    // Exactly the state a device is in on the update: KrishiStorage holds the pre-boot value,
    // localStorage holds whatever an older build wrote after init() deleted its copy.
    const ks = installKrishiStorage({ krishi_active_cache_name: 'krishi-v230' });
    localStorage.setItem('krishi_active_cache_name', 'krishi-v232');

    assert.equal(W.krishiReadStoredKey('krishi_active_cache_name'), 'krishi-v232',
        'krishi_idb.js:82 states the rule this follows: "LocalStorage ALWAYS has the newest ' +
        'data if it exists"'
    );
    assert.equal(ks._dump().krishi_active_cache_name, 'krishi-v232',
        'the winner has to be persisted, not just returned'
    );
    assert.equal(localStorage.getItem('krishi_active_cache_name'), null,
        'and the stray copy drained, or every read re-merges it and the stores never converge'
    );
});

test('a clock-valued key never moves backwards', () => {
    // The default (stray wins) is right for a version name and wrong for a timestamp: an older
    // build re-writing a stale cursor would restart the delta sync from further back, or cut a
    // 7-day banner dismissal short.
    installKrishiStorage({ krishi_last_delta_sync_time: '9000' });
    localStorage.setItem('krishi_last_delta_sync_time', '5000');

    assert.equal(W.krishiReadStoredKey('krishi_last_delta_sync_time', W.krishiNewerTimestamp), '9000',
        'the newer timestamp wins regardless of which store it sits in'
    );
    assert.equal(localStorage.getItem('krishi_last_delta_sync_time'), null,
        'the loser is still drained — leaving it makes the comparison run forever'
    );
});

test('krishiNewerTimestamp() treats an unreadable side as no timestamp at all', () => {
    const newer = W.krishiNewerTimestamp;
    assert.equal(newer('1000', 'not-a-number'), '1000', 'garbage must not beat a real clock');
    assert.equal(newer('not-a-number', '1000'), '1000', 'and must not win by being held');
    assert.equal(newer('1000', '1000'), '1000',
        'equal clocks keep the held value, so an equal-valued stray cannot cause a rewrite'
    );
});

test('an absent key reads as null rather than as an empty string', () => {
    installKrishiStorage();
    assert.equal(W.krishiReadStoredKey('krishi_pwa_dismissed'), null,
        'the OTA check branches on !activeCache and the banner on !dismissedTime; "" would ' +
        'pass both of those as falsy but a "0" written by String(null) would not'
    );
});

test('a throwing store does not take the caller down with it', () => {
    // Safari in private mode throws on localStorage access, and KrishiStorage can be mid-init.
    W.KrishiStorage = { getItem: () => { throw new Error('idb not ready'); }, setItem: () => {}, removeItem: () => {} };
    localStorage.setItem('krishi_pwa_dismissed', '1700000000000');
    assert.equal(W.krishiReadStoredKey('krishi_pwa_dismissed'), '1700000000000',
        'an unreadable store means "this side has nothing", not a crash inside the boot path'
    );

    W.KrishiStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    assert.doesNotThrow(() => W.krishiWriteStoredKey('krishi_pwa_dismissed', Date.now()),
        'a failed write is logged silently; throwing here would abort initPWAInstallFlow()'
    );
});

// ── The keys must not be read from native localStorage anywhere in this file ──────

test('no krishi_* key in pwa_helpers.js touches native localStorage directly', () => {
    ['krishi_pwa_dismissed', 'krishi_last_delta_sync_time', 'krishi_active_cache_name'].forEach(key => {
        [`localStorage.getItem('${key}'`, `localStorage.setItem('${key}'`].forEach(bad => {
            assert.equal(HELPERS_JS.indexOf(bad), -1,
                key + ' is back on native localStorage — init() deletes that copy, so the ' +
                'read returns null on every boot after the first'
            );
        });
    });
});

test('the two clock-valued keys pass the monotonic resolver and the version name does not', () => {
    const readsOf = key => HELPERS_JS.split(/\r?\n/)
        .filter(l => l.includes(`krishiReadStoredKey('${key}'`));

    ['krishi_pwa_dismissed', 'krishi_last_delta_sync_time'].forEach(key => {
        const reads = readsOf(key);
        assert.ok(reads.length > 0, key + ' is no longer read - update this test');
        reads.forEach(l => assert.match(l, /krishiNewerTimestamp/,
            key + ' is a clock; without the resolver a stale stray copy wins and the value ' +
            'moves backwards'
        ));
    });

    readsOf('krishi_active_cache_name').forEach(l => {
        assert.ok(!l.includes('krishiNewerTimestamp'),
            'a cache name is not a number - parseInt() would make every version tie at 0'
        );
    });
});

test('the OTA check compares against the same store it writes', () => {
    const ota = HELPERS_JS.slice(HELPERS_JS.indexOf('function initLiveOTAUpdateEngine'));
    const readAt = ota.indexOf("krishiReadStoredKey('krishi_active_cache_name'");
    const writeAt = ota.indexOf("krishiWriteStoredKey('krishi_active_cache_name'");
    assert.ok(readAt > -1 && writeAt > readAt,
        'read then write, both through the accessors — a mixed pair is why the check read ' +
        '"no active cache yet" on the first look of every launch and returned without ' +
        'announcing the update'
    );
});
