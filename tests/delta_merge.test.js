'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadPwaHelpers } = require('./helpers');

loadPwaHelpers();
const Merge = globalThis.window.KrishiDeltaMerge;

test('inserts only new ids, mutates pool in place', () => {
    const pool = [{ id: 'a', q: 'A?' }];
    const incoming = [
        { id: 'b', q: 'B?' },
        { id: 'a', q: 'A-duplicate-id?' },
        { id: 'c', q: 'C?' }
    ];
    const { inserted } = Merge.mergeInto(pool, incoming);
    assert.deepStrictEqual(inserted.map(q => q.id), ['b', 'c']);
    assert.strictEqual(pool.length, 3);
});

test('dedupes by question text when id missing', () => {
    const pool = [{ q: 'Same text?' }];
    const { inserted } = Merge.mergeInto(pool, [
        { q: 'Same text?' },          // dup by text
        { q: 'Different?' , id: '' }  // no id, new text => insert
    ]);
    assert.strictEqual(inserted.length, 1);
    assert.strictEqual(pool.length, 2);
});

test('safe with non-array inputs (matches original fallback behavior)', () => {
    const r1 = Merge.mergeInto(null, [{ id: 'x' }]);
    assert.strictEqual(r1.pool.length, 1);

    const r2 = Merge.mergeInto([{ id: 'y' }], undefined);
    assert.strictEqual(r2.pool.length, 1);
    assert.strictEqual(r2.inserted.length, 0);
});

test('real-world delta shape: empty payload inserts nothing', () => {
    const pool = [{ id: 'keep' }];
    const { inserted } = Merge.mergeInto(pool, []);
    assert.strictEqual(inserted.length, 0);
    assert.strictEqual(pool[0].id, 'keep');
});
