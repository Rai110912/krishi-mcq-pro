'use strict';

/**
 * KrishiSM2Engine store-location contract.
 *
 * KrishiStorage.init() copies every krishi_* key out of native localStorage and then deletes
 * the localStorage copy (js/krishi_idb.js:88-96). The engine used to read and write
 * localStorage directly, so on every boot after an answer its whole schedule vanished from
 * where it looks — verified live with 2 records in KrishiStorage and _getData() returning 0.
 * These tests pin the engine to one store and pin the reconciliation that stops the update
 * itself from dropping records.
 */

const test = require('node:test');
const assert = require('node:assert');
const { loadPwaHelpers } = require('./helpers');

loadPwaHelpers();
const Engine = globalThis.window.KrishiSM2Engine;

/** A stand-in for KrishiStorage: a separate store that is NOT native localStorage. */
function installKrishiStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    const api = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: k => { store.delete(k); },
        _dump: () => Object.fromEntries(store)
    };
    globalThis.window.KrishiStorage = api;
    return api;
}

function removeKrishiStorage() {
    delete globalThis.window.KrishiStorage;
}

const rec = (fields = {}) => Object.assign(
    { reviews: 1, interval: 2, easeFactor: 2.5, lapses: 0, difficulty: 5, stability: 1, status: 'scheduled' },
    fields
);

test.beforeEach(() => {
    localStorage.clear();
    removeKrishiStorage();
});

test('the engine reads and writes KrishiStorage, not native localStorage', () => {
    const ks = installKrishiStorage({
        krishi_sm2: JSON.stringify({ 'q-real': rec({ lastAnswered: 5000 }) })
    });

    const data = Engine._getData();
    assert.deepEqual(Object.keys(data), ['q-real'],
        'this returned {} in production: the schedule was in KrishiStorage and the engine ' +
        'was reading a localStorage key that init() had already deleted'
    );

    Engine._saveData({ 'q-written': rec() });
    assert.ok(ks._dump().krishi_sm2.includes('q-written'), 'the write must land in KrishiStorage');
    assert.equal(localStorage.getItem('krishi_sm2'), null,
        'and must NOT also go to localStorage — two copies of one key is the bug itself'
    );
});

test('a stray localStorage blob is folded in, not discarded', () => {
    // Exactly the state a real device is in on the update: KrishiStorage holds the pre-boot
    // snapshot, localStorage holds whatever was answered after init() deleted it.
    installKrishiStorage({
        krishi_sm2: JSON.stringify({
            'q-old':  rec({ lastAnswered: 1000, reviews: 4 }),
            'q-both': rec({ lastAnswered: 1000, reviews: 4 })
        })
    });
    localStorage.setItem('krishi_sm2', JSON.stringify({
        'q-new':  rec({ lastAnswered: 9000, reviews: 1 }),
        'q-both': rec({ lastAnswered: 9000, reviews: 5 })
    }));

    const data = Engine._getData();

    assert.deepEqual(Object.keys(data).sort(), ['q-both', 'q-new', 'q-old'],
        'the union of both stores — picking either side alone drops real reviews'
    );
    assert.equal(data['q-both'].reviews, 5,
        'for a record in both stores the newer lastAnswered wins, the same rule the cloud ' +
        'merge uses'
    );
    assert.equal(localStorage.getItem('krishi_sm2'), null,
        'and the stray copy is drained, so the next _getData() does not re-merge it forever'
    );
    assert.ok(globalThis.window.KrishiStorage.getItem('krishi_sm2').includes('q-new'),
        'the union has to be persisted, not just returned'
    );
});

test('with no KrishiStorage present localStorage stays the store and is never drained', () => {
    localStorage.setItem('krishi_sm2', JSON.stringify({ 'q-only': rec({ lastAnswered: 7000 }) }));

    const data = Engine._getData();
    assert.deepEqual(Object.keys(data), ['q-only'],
        'localStorage is the fallback store before KrishiStorage loads'
    );
    assert.ok(localStorage.getItem('krishi_sm2'),
        'draining it here would delete the live data — _drainStrayLocalStorage must bail out ' +
        'when KrishiStorage is absent'
    );
});

test('an unparseable stray blob is dropped without taking the real records with it', () => {
    installKrishiStorage({ krishi_sm2: JSON.stringify({ 'q-real': rec({ lastAnswered: 3000 }) }) });
    localStorage.setItem('krishi_sm2', '{not json');

    const data = Engine._getData();
    assert.deepEqual(Object.keys(data), ['q-real'], 'the real schedule survives');
    assert.equal(localStorage.getItem('krishi_sm2'), null,
        'the garbage is removed, or every _getData() re-reads it'
    );
});

test('a recorded answer round-trips through KrishiStorage', () => {
    const ks = installKrishiStorage();

    Engine.recordAnswer('q-live', true, 3);
    const stored = JSON.parse(ks._dump().krishi_sm2 || '{}');
    assert.equal(stored['q-live'].reviews, 1, 'the answer landed in the real store');
    assert.ok(stored['q-live'].lastAnswered > 0,
        'lastAnswered is what the cloud merge orders records on'
    );

    // The whole point: a second read sees the first answer instead of starting from scratch.
    Engine.recordAnswer('q-live', true, 3);
    assert.equal(JSON.parse(ks._dump().krishi_sm2)['q-live'].reviews, 2,
        'reviews used to reset to 1 on every boot because _getData() came back empty'
    );
});

test('the daily review log and retention rate use the same store', () => {
    const ks = installKrishiStorage();

    Engine.recordDailyReview(true);
    Engine.recordDailyReview(false);

    assert.ok(ks._dump().krishi_sm2_daily_log, 'the log must live in KrishiStorage');
    assert.equal(localStorage.getItem('krishi_sm2_daily_log'), null);
    assert.equal(Engine.getRetentionRate(), 50,
        'getRetentionRate() read 0% after every boot: it looked in localStorage, which ' +
        'init() had emptied'
    );
});

test('a stray daily log is merged by the larger per-day tally', () => {
    const today = new Date().toISOString().split('T')[0];
    installKrishiStorage({
        krishi_sm2_daily_log: JSON.stringify({ [today]: { total: 2, correct: 1 } })
    });
    localStorage.setItem('krishi_sm2_daily_log', JSON.stringify({
        [today]: { total: 8, correct: 6 },
        '2026-01-01': { total: 3, correct: 3 }
    }));

    Engine.recordDailyReview(null);   // read + reconcile without counting an attempt

    const log = JSON.parse(globalThis.window.KrishiStorage.getItem('krishi_sm2_daily_log'));
    assert.equal(log[today].total, 8, 'the fuller tally wins rather than one side overwriting');
    assert.equal(log['2026-01-01'].total, 3, 'and days only the stray copy had are kept');
    assert.equal(localStorage.getItem('krishi_sm2_daily_log'), null, 'stray copy drained');
});

test('the legacy krishi_review migration is cleared from both stores', () => {
    const ks = installKrishiStorage({
        krishi_review: JSON.stringify({ 'legacy-q': '2026-01-01' })
    });
    localStorage.setItem('krishi_review', JSON.stringify({ 'legacy-q': '2026-01-01' }));

    const data = Engine._getData();
    assert.ok(data['legacy-q'], 'the legacy date still becomes a scheduling record');
    assert.equal(ks.getItem('krishi_review'), null, 'cleared from KrishiStorage');
    assert.equal(localStorage.getItem('krishi_review'), null,
        'and from localStorage, or init() migrates it back in and it is re-imported forever'
    );
});
