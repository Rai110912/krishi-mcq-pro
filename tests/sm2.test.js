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

// The flashcard swiper self-rates ("I know this") without ever picking an option, so it must not
// earn the same credit as a graded answer.
test('maxGrade caps a self-rated swipe at Good instead of Easy', () => {
    const fb = Engine.recordAnswer('q-selfrated', true, 2, { maxGrade: 2 });
    assert.match(fb, /Good/);
    assert.strictEqual(recordOf('q-selfrated').interval, 2);   // Good on a new card => stability 2.4

    // The identical 2 second answer without the cap still earns the full Easy interval.
    const fb2 = Engine.recordAnswer('q-uncapped', true, 2);
    assert.match(fb2, /Easy/);
    assert.strictEqual(recordOf('q-uncapped').interval, 6);

    // A wrong answer is already grade 0, so the cap can only ever trim, never lift.
    Engine.recordAnswer('q-capped-wrong', false, 2, { maxGrade: 2 });
    assert.strictEqual(recordOf('q-capped-wrong').status, 'due');
});

// The 3-day leech penalty recordAnswer() stamps as suspendUntil was written and then never read
// again: getDueQuestions()/getStats() dropped every suspended record on status alone, with no time
// comparison. Four wrong answers - or four "study later" swipes, which grade as wrong - retired a
// card from Spaced Review permanently. 'mastered' had the same shape, and coming back after 21+
// days is the entire point of the status.
test('a rested-out leech or mature card returns to the due queue, and not one day early', () => {
    localStorage.setItem('krishi_sm2', '{}');
    const pool = [{ id: 'leech-serving' }, { id: 'leech-expired' }, { id: 'mature' }, { id: 'mature-due' }];
    seed('leech-serving', { status: 'suspended', lapses: 4, nextReview: Date.now() + 2 * DAY_MS });
    seed('leech-expired', { status: 'suspended', lapses: 4, nextReview: Date.now() - 60 * 1000 });
    seed('mature', { status: 'mastered', reviews: 6, nextReview: Date.now() + 30 * DAY_MS });
    seed('mature-due', { status: 'mastered', reviews: 6, nextReview: Date.now() - DAY_MS });

    assert.deepStrictEqual(
        Engine.getDueQuestions(pool).map(q => q.id).sort(),
        ['leech-expired', 'mature-due']
    );

    // The status buckets must NOT move: the analytics mastery card partitions totalTracked into
    // mastered + leeched + learning, so a rested-out card is still leeched/mastered. It is merely
    // also due today, and dueCount has to agree with getDueQuestions() or the tile badge lies.
    const stats = Engine.getStats();
    assert.strictEqual(stats.leechedCount, 2, 'both leeches still count as leeched');
    assert.strictEqual(stats.masteredCount, 2, 'both mature cards still count as mastered');
    assert.strictEqual(stats.dueCount, 2, 'dueCount tracks getDueQuestions()');
    assert.strictEqual(stats.totalTracked, 4);
});

// A record with no nextReview at all must stay parked rather than fall through as "due", which is
// what a plain `nextReview > now` test would do.
test('a suspended record with no nextReview stays out instead of becoming due', () => {
    localStorage.setItem('krishi_sm2', '{}');
    seed('leech-undated', { status: 'suspended', lapses: 4 });
    assert.deepStrictEqual(Engine.getDueQuestions([{ id: 'leech-undated' }]), []);
    assert.strictEqual(Engine.getStats().dueCount, 0);
});

// Runs last: getDueQuestions() prunes every record whose id is missing from the pool it is given.
test('getNewQuestions returns the never-graded cards getDueQuestions cannot reach', () => {
    seed('seen-1', { status: 'due', nextReview: Date.now() - DAY_MS });
    const pool = [{ id: 'seen-1' }, { id: 'never-1' }, { id: 'never-2' }];

    assert.deepStrictEqual(Engine.getNewQuestions(pool).map(q => q.id), ['never-1', 'never-2']);
    assert.deepStrictEqual(Engine.getNewQuestions([]), []);

    // The gap this closes: a card with no record is invisible to the scheduler.
    assert.strictEqual(Engine.getDueQuestions(pool).some(q => q.id === 'never-1'), false);
});

// The prune is the only DESTRUCTIVE thing in this engine: it deletes every record whose id is
// missing from the pool it is handed, and that delete is permanent and syncs to the other device.
// Callers hand it getAllQuestions(), which excludes draft/revision/deleted custom questions and is
// missing the entire static bank until `await loadStaticQuestions()` resolves - or forever, when
// questions.json fails offline and the catch sets defaultQuestions = []. So real questions looked
// like orphans and their FSRS history was destroyed. window.getKrishiPruneIdSet() is the fix: the
// full id universe, every status included, withheld entirely until the bank is proven hydrated.
test('the orphan prune withholds while the bank is unproven, and never punishes a status change', () => {
    localStorage.setItem('krishi_sm2', '{}');
    seed('static-1', { status: 'due', nextReview: Date.now() - DAY_MS });
    seed('drafted-1', { status: 'due', nextReview: Date.now() - DAY_MS });
    seed('gone-1', { status: 'due', nextReview: Date.now() - DAY_MS });

    window.getKrishiPruneIdSet = () => null;
    try {
        // Bank not hydrated: nothing may be deleted, however short the pool looks.
        assert.deepStrictEqual(Engine.getDueQuestions([{ id: 'static-1' }]).map(q => q.id), ['static-1']);
        let held = JSON.parse(localStorage.getItem('krishi_sm2'));
        assert.ok(held['drafted-1'] && held['gone-1'], 'a record was pruned while the bank was unproven');

        // A throwing hook is the same answer: prune nothing.
        window.getKrishiPruneIdSet = () => { throw new Error('bank exploded'); };
        Engine.getDueQuestions([{ id: 'static-1' }]);
        held = JSON.parse(localStorage.getItem('krishi_sm2'));
        assert.ok(held['drafted-1'] && held['gone-1'], 'a throwing hook must not authorise a prune');

        // Hydrated. The universe carries every id regardless of status, so a question demoted to
        // draft/revision (saveData() does that by itself on a validation failure) or soft-deleted
        // is absent from the practice pool yet keeps its schedule. Only a genuinely unknown id goes.
        window.getKrishiPruneIdSet = () => new Set(['static-1', 'drafted-1']);
        assert.deepStrictEqual(Engine.getDueQuestions([{ id: 'static-1' }]).map(q => q.id), ['static-1']);
        const after = JSON.parse(localStorage.getItem('krishi_sm2'));
        assert.ok(after['drafted-1'], 'a draft/revision/deleted question lost its review history');
        assert.strictEqual(after['gone-1'], undefined, 'a truly unknown id is still pruned');
    } finally {
        delete window.getKrishiPruneIdSet;
    }
});

// getStats() walks the record store, getDueQuestions() walks the question bank. Once the prune
// stopped deleting records for hidden questions, those two populations could disagree - and
// dueCount is what the Practice tile badge shows, so it is the one that has to be honest.
test('dueCount counts only cards a session can serve, so the badge cannot over-promise', () => {
    localStorage.setItem('krishi_sm2', '{}');
    seed('live-1', { status: 'due', nextReview: Date.now() - DAY_MS });
    seed('hidden-1', { status: 'due', nextReview: Date.now() - DAY_MS });

    window.getPracticeIdSet = () => new Set(['live-1']);
    try {
        const stats = Engine.getStats();
        assert.strictEqual(stats.dueCount, 1, 'a question outside the practice pool inflated the badge');
        assert.strictEqual(stats.totalTracked, 2, 'the hidden record is still tracked, just not due');
        assert.strictEqual(
            Engine.getDueQuestions([{ id: 'live-1' }, { id: 'hidden-1' }]).length,
            2,
            'getDueQuestions answers about the pool it is handed, unfiltered by this hook'
        );
    } finally {
        delete window.getPracticeIdSet;
    }
});

// Every caller caps this list - startSpacedReview() keeps 15 - so bank order made the cap a lottery:
// with 200 cards due you got a random 15, and a fresh random 15 tomorrow, which means a card overdue
// by three months had no better chance of a rep than one first due today and could lose that draw
// every single day while the backlog grew. Urgency is the entire point of a schedule.
test('due cards come back most overdue first, so a capped session takes the most urgent', () => {
    localStorage.setItem('krishi_sm2', '{}');
    seed('fresh',   { status: 'scheduled', nextReview: Date.now() - 60 * 1000 });
    seed('ancient', { status: 'scheduled', nextReview: Date.now() - 90 * DAY_MS });
    seed('midway',  { status: 'scheduled', nextReview: Date.now() - 7 * DAY_MS });
    seed('later',   { status: 'scheduled', nextReview: Date.now() + 5 * DAY_MS });

    // Bank order deliberately disagrees with urgency order, least urgent first.
    const pool = [{ id: 'fresh' }, { id: 'later' }, { id: 'midway' }, { id: 'ancient' }];
    assert.deepStrictEqual(
        Engine.getDueQuestions(pool).map(q => q.id),
        ['ancient', 'midway', 'fresh'],
        'getDueQuestions() is not ordered by nextReview, so a capped session picks arbitrary cards'
    );

    // The ordering only matters because callers slice it - that is the behaviour being pinned.
    assert.deepStrictEqual(Engine.getDueQuestions(pool).slice(0, 2).map(q => q.id), ['ancient', 'midway']);
});
