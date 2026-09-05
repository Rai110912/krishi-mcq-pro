'use strict';

/**
 * Cloud-sync contract tests.
 *
 * The sync layer is ~1000 lines inside a single IIFE in js/app.js with no exports, so it
 * cannot be require()d and unit-tested. These are static source contracts instead — the
 * same approach tests/boot_contract.test.js uses for the boot order, and the same reason:
 * every bug these lock down was invisible. Nothing threw, nothing logged, and the app
 * reported "Synced".
 *
 * Zero external dependencies, matching tests/helpers.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

/** Body of a top-level `function name(` / `async function name(` declaration, brace-matched. */
function functionBody(name) {
    const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
    const m = re.exec(APP_JS);
    assert.ok(m, 'js/app.js: function ' + name + '() not found - update tests/cloud_sync_contract.test.js');
    const open = APP_JS.indexOf('{', m.index + m[0].length);
    let depth = 0;
    for (let i = open; i < APP_JS.length; i++) {
        const c = APP_JS[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return APP_JS.slice(open, i + 1);
        }
    }
    assert.fail('js/app.js: unbalanced braces while reading ' + name + '()');
}

// ── Payload size guard on EVERY users/{uid} write ───────────────────────────────

test('prepareCloudPayload() compresses the unbounded arrays and asserts the size', () => {
    const body = functionBody('prepareCloudPayload');
    assert.match(body, /compressUnboundedFields\(/,
        'prepareCloudPayload() must delegate compression to compressUnboundedFields() - the ' +
        'backup-size meter measures through the same helper, and inlining it here is how the ' +
        'meter and the write path drifted apart in the first place.');
    assert.match(body, /assertPayloadFits\(/,
        'prepareCloudPayload() must end in assertPayloadFits() - it is the only thing standing ' +
        'between a heavy user and Firestore\'s 1 MiB hard limit.');

    const helper = functionBody('compressUnboundedFields');
    assert.match(helper, /timingLog/, 'timingLog is not compressed');
    assert.match(helper, /mockScores/, 'mockScores is not compressed');
});

// ── The size the user is shown must be the size that is written ─────────────────

test('measureCloudDocKB() measures the document the write path actually sends', () => {
    const body = functionBody('measureCloudDocKB');

    assert.match(body, /delete\s+probe\.customQuestions/,
        'the backup-size meter still counts customQuestions. syncQbankToChunks() deletes that ' +
        'field from every payload before the write - the bank lives in the qbank subcollection ' +
        'and cannot contribute to the 900 KB document limit - so counting it over-reported the ' +
        'payload (measured 2.8x) and drove a red warning telling the user to delete their ' +
        'question bank for no benefit.');

    assert.match(body, /compressUnboundedFields\(/,
        'the meter must apply the same compression the write path applies before ' +
        'assertPayloadFits() sees the payload, or it reports timingLog at its raw size - ' +
        'timing records compress roughly 10-20x, and timingLog is the single largest field.');
});

test('the backup meter renders through measureCloudDocKB(), not a raw collect', () => {
    const body = functionBody('updateSyncUI');
    assert.match(body, /measureCloudDocKB\(\)/, 'the meter no longer calls measureCloudDocKB()');
    assert.doesNotMatch(body, /JSON\.stringify\(collectAllAppData\(\)\)/,
        'updateSyncUI() is stringifying the raw collectAllAppData() again. That is the ' +
        'over-reporting bug: it counts the offloaded question bank and the uncompressed ' +
        'timing log against a limit neither of them reaches.');
});

// ── A status the app cannot resolve must not be left on screen ──────────────────

test("setSyncStatus() arms a watchdog for 'Syncing...' and clears it otherwise", () => {
    const body = functionBody('setSyncStatus');

    assert.match(body, /clearTimeout\(window\.__krishiSyncWatchdog\)/,
        'a status change must cancel the pending watchdog, or a resolved sync still gets ' +
        'retired by a stale timer.');
    assert.match(body, /if\s*\(\s*status\s*===\s*'Syncing\.\.\.'\s*\)/,
        "setSyncStatus() no longer arms the watchdog on 'Syncing...'. That status is persisted " +
        'in localStorage and the only success-path clear on the initCloudSync() route sits ' +
        'behind two early returns in the snapshot handler, so a dropped snapshot froze the ' +
        'amber pulse across every relaunch.');
    assert.match(body, /resolveStuckSyncStatus\(\)/,
        'the watchdog must resolve the badge against krishi_sync_pending rather than guess.');
});

test("setSyncStatus('Synced') stamps the last-sync time for every path", () => {
    const body = functionBody('setSyncStatus');
    assert.match(body, /krishi_last_sync_time/,
        '"Last Synced" is written only by the two manual paths again. performCloudSync() and ' +
        'the realtime snapshot handler both reach setSyncStatus(\'Synced\') without stamping ' +
        'it, so the panel showed the last time the user pressed Sync Now while every ' +
        'automatic sync succeeded invisibly behind it.');
    assert.match(body, /removeItem\('krishi_sync_payload_too_big'\)/,
        'a completed cycle proves the payload fit, so the size-stop marker must be cleared - ' +
        'it was previously written once and never read or cleared anywhere.');
});

test('the watchdog does not fake a successful sync', () => {
    const body = functionBody('setSyncStatus');
    // Comments stripped first: the code here is *explained* in terms of setSyncStatus(), so a
    // raw text match reads the explanation as a violation of the thing it explains.
    const watchdog = body
        .slice(body.indexOf('__krishiSyncWatchdog = setTimeout'))
        .replace(/\/\/[^\n]*/g, '');
    assert.ok(watchdog.length > 0, 'watchdog timer not found in setSyncStatus()');
    assert.doesNotMatch(watchdog, /setSyncStatus\(/,
        'the watchdog must write krishi_sync_status directly. Routing back through ' +
        'setSyncStatus() would stamp a fresh "Last Synced" time for a sync that never ' +
        'reported success - trading a stuck badge for a lying timestamp.');
    assert.match(watchdog, /KrishiStorage\.setItem\('krishi_sync_status'/,
        'the watchdog must actually resolve the stored status, not just re-render.');
});

test('every users/{uid} document write goes through prepareCloudPayload()', () => {
    // Writes to the single users/{uid} doc. Subcollection writes (qbank/sessions/handoff/
    // backups/active_session) are separate documents with their own limits and are excluded
    // by requiring the ref to be the bare user doc.
    const writers = [
        ['Restore push',                /prepareCloudPayload\(payload, 'Restore push'\)[\s\S]{0,200}?ref\.set\(payload/],
        ['Realtime snapshot delta',     /prepareCloudPayload\(delta, 'Realtime sync delta'\)[\s\S]{0,300}?\.doc\(uid\)\.set\(\{ \.\.\.delta/],
        ['Conflict keep-local',         /prepareCloudPayload\(localDataPayload, 'Conflict keep-local push'\)[\s\S]{0,200}?docRef\.set\(localDataPayload/],
        ['performCloudSync delta',      /prepareCloudPayload\(delta, 'Sync delta'\)[\s\S]{0,600}?docRef\.update\(\{ \.\.\.delta/],
        ['Initial full push',           /prepareCloudPayload\(localDataPayload, 'Initial full sync payload'\)[\s\S]{0,600}?docRef\.set\(localDataPayload/]
    ];
    const unguarded = writers.filter(([, re]) => !re.test(APP_JS)).map(([label]) => label);
    assert.deepStrictEqual(
        unguarded, [],
        'these users/{uid} write path(s) no longer run prepareCloudPayload() immediately before ' +
        'the write: ' + unguarded.join(', ') + '. The realtime path and the conflict-modal path ' +
        'both shipped timingLog/mockScores RAW and skipped the 900 KB assertion entirely, so a ' +
        'heavy user\'s sync died on Firestore\'s 1 MiB limit with only a console line.'
    );
});

test('no write path hand-rolls its own compression any more', () => {
    // Five call sites each doing their own compressToUTF16 + assert is exactly how three of
    // them drifted out of sync. Only prepareCloudPayload() and the qbank chunker may compress.
    const sites = (APP_JS.match(/compressToUTF16\(/g) || []).length;
    assert.ok(
        sites <= 3,
        'found ' + sites + ' compressToUTF16() call sites. Compression for the users/{uid} doc ' +
        'belongs in prepareCloudPayload() only (2 fields), plus the qbank chunker (1).'
    );
});

// ── One sync cycle at a time ────────────────────────────────────────────────────

test('performCloudSync() refuses to start while another cycle holds the lock', () => {
    const body = functionBody('performCloudSync');
    const beforeFirstAwait = body.slice(0, body.indexOf('await '));

    assert.match(beforeFirstAwait, /if\s*\(\s*syncInProgress\s*\)/,
        'performCloudSync() reaches its first await without checking syncInProgress. ' +
        'saveData() schedules a sync on every answer while one cycle takes seconds, so two ' +
        'runs overlap and both write users/{uid}/qbank/chunk_N - the bank tears (chunk_0 from ' +
        'one run, chunk_1 from the other) and decompresses to garbage on the next hydrate.'
    );
    assert.match(beforeFirstAwait, /syncRerunTimer/,
        'the coalesced request is dropped instead of retried. Bailing without re-arming loses ' +
        'the sync that was asked for.'
    );
});

test('the coalescing retry cannot stack up multiple timers', () => {
    const body = functionBody('performCloudSync');
    const guard = body.slice(body.indexOf('if (syncInProgress)'), body.indexOf('await '));
    assert.match(guard, /if\s*\(\s*!syncRerunTimer\s*\)/,
        'every coalesced request must reuse the one pending timer. Without the !syncRerunTimer ' +
        'check, a practice session queues one retry per answer.'
    );
    assert.match(guard, /syncRerunTimer\s*=\s*null/,
        'the timer handle must be cleared when it fires, or only one retry ever happens'
    );
});

// ── Network flaps must not re-init the whole sync stack ─────────────────────────

test("the 'online' listener only re-inits when the realtime listener is missing", () => {
    // js/app.js has three 'online' listeners (badge refresh, sync re-init, pending flush).
    // This targets the re-init one specifically.
    const i = APP_JS.indexOf('initCloudSync();', APP_JS.indexOf("addEventListener('online', () =>"));
    assert.ok(i > 0, "no 'online' handler calling initCloudSync() found");
    const start = APP_JS.lastIndexOf("addEventListener('online'", i);
    const handler = APP_JS.slice(start, i);

    assert.match(handler, /!window\.syncListenerUnsubscribe/,
        "the 'online' handler calls initCloudSync() unconditionally. Mobile links flap " +
        'constantly and initCloudSync() tears down and re-attaches four onSnapshot listeners, ' +
        're-reads the whole user document, re-fetches device location and rewrites presence. ' +
        'The Firestore SDK reconnects its own listeners; only re-init when there is none.'
    );
});
