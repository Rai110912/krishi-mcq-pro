'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadPwaHelpers } = require('./helpers');

// Load the real production file once (stubs installed inside).
loadPwaHelpers();
const Engine = globalThis.window.KrishiSM2Engine;

const DAY_MS = 24 * 3600 * 1000;

function seed(id, fields) {
    const data = JSON.parse(localStorage.getItem('krishi_sm2') || '{}');
    data[id] = Object.assign(
        { reviews: 0, interval: 0, easeFactor: 2.5, lapses: 0, status: 'new' },
        fields
    );
    localStorage.setItem('krishi_sm2', JSON.stringify(data));
}

function recordOf(id) {
    return JSON.parse(localStorage.getItem('krishi_sm2'))[id];
}

test('new question + fast correct (<=5s) => Easy grade, ~6 day interval', () => {
    const fb = Engine.recordAnswer('q-easy', true, 3);
    const rec = recordOf('q-easy');
    assert.match(fb, /Easy/);
    assert.strictEqual(rec.reviews, 1);
    assert.strictEqual(rec.interval, 6);          // round(5.8)
    assert.strictEqual(rec.lapses, 0);
    assert.strictEqual(rec.status, 'scheduled');
});

test('new question + normal correct (<=15s) => Good grade, 2 day interval', () => {
    const fb = Engine.recordAnswer('q-good', true, 10);
    const rec = recordOf('q-good');
    assert.match(fb, /Good/);
    assert.strictEqual(rec.interval, 2);          // round(2.4)
});

test('new question + slow correct (>15s) => Hard grade, 1 day interval', () => {
    const fb = Engine.recordAnswer('q-hard', true, 30);
    const rec = recordOf('q-hard');
    assert.match(fb, /Hard/);
    assert.strictEqual(rec.interval, 1);          // round(0.6)
});

test('new question + wrong answer => due status, lapses counted, interval 1', () => {
    const fb = Engine.recordAnswer('q-wrong', false, 10);
    const rec = recordOf('q-wrong');
    assert.match(fb, /Fail/);
    assert.strictEqual(rec.lapses, 1);
    assert.strictEqual(rec.status, 'due');
    assert.strictEqual(rec.interval, 1);
});

test('4th consecutive failure => leech suspension for 3 days', () => {
    seed('q-leech', { lapses: 3, reviews: 5, stability: 2, difficulty: 6 });
    const fb = Engine.recordAnswer('q-leech', false, 10);
    const rec = recordOf('q-leech');
    assert.match(fb, /Suspended/);
    assert.strictEqual(rec.lapses, 4);
    assert.strictEqual(rec.status, 'suspended');
    // nextReview should be ~now + 3 days
    assert.ok(Math.abs(rec.nextReview - (Date.now() + 3 * DAY_MS)) < 5000);
});

test('difficulty is clamped to [1,10]', () => {
    seed('q-dmax', { reviews: 5, stability: 2, difficulty: 9.5 });
    Engine.recordAnswer('q-dmax', false, 10);     // would push to 11.5
    assert.ok(recordOf('q-dmax').difficulty <= 10);

    seed('q-dmin', { reviews: 5, stability: 2, difficulty: 1.0 });
    Engine.recordAnswer('q-dmin', true, 3);       // Easy pushes down
    assert.ok(recordOf('q-dmin').difficulty >= 1);
});

test('mastery: interval>=21 and reviews>=4 => mastered status', () => {
    seed('q-master', { reviews: 3, stability: 21, difficulty: 3, lastAnswered: Date.now() });
    const fb = Engine.recordAnswer('q-master', true, 5);
    const rec = recordOf('q-master');
    assert.match(fb, /Mastered/);
    assert.strictEqual(rec.status, 'mastered');
    assert.strictEqual(rec.reviews, 4);
    assert.ok(rec.interval >= 21);
});

test('legacy krishi_review store migrates into krishi_sm2', () => {
    localStorage.setItem('krishi_review', JSON.stringify({ 'legacy-1': '2026-01-01' }));
    const data = Engine._getData();
    assert.ok(data['legacy-1'], 'legacy entry migrated');
    assert.ok(data['legacy-1'].nextReview > 0);
    assert.strictEqual(localStorage.getItem('krishi_review'), null, 'legacy key removed');
});

test('getDueQuestions returns only due items and cleans orphan records', () => {
    seed('due-1', { status: 'due', nextReview: Date.now() - DAY_MS });
    seed('mastered-1', { status: 'mastered', nextReview: Date.now() + 30 * DAY_MS });
    seed('orphan-1', { status: 'due', nextReview: Date.now() - DAY_MS });

    const pool = [{ id: 'due-1' }, { id: 'mastered-1' }];
    const due = Engine.getDueQuestions(pool);

    assert.deepStrictEqual(due.map(q => q.id), ['due-1']);
    const after = JSON.parse(localStorage.getItem('krishi_sm2'));
    assert.strictEqual(after['orphan-1'], undefined, 'orphan cleaned');
    assert.ok(after['due-1'], 'valid kept');
});

test('getStats reports due/mastered counts', () => {
    seed('s-due', { status: 'due', nextReview: Date.now() - DAY_MS });
    seed('s-mastered', { status: 'mastered', nextReview: Date.now() + DAY_MS });
    const stats = Engine.getStats();
    assert.ok(stats.masteredCount >= 1);
    assert.ok(stats.dueCount >= 1);
});
