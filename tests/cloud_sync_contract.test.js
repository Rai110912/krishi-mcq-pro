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

/**
 * Body of a function with its comments stripped. A `doesNotMatch` contract has to read code only:
 * the comment explaining *why* confirm() was removed contains the word confirm(), so matching the
 * raw body would fail on the very explanation of the fix.
 */
function codeOf(name) {
    return functionBody(name)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── Payload size guard on EVERY users/{uid} write ───────────────────────────────

/** The single list that drives both compression on write and decoding on read. */
function compressedCloudFields() {
    const m = APP_JS.match(/const COMPRESSED_CLOUD_FIELDS\s*=\s*\[([^\]]*)\]/);
    assert.ok(m, 'COMPRESSED_CLOUD_FIELDS was renamed or removed - update this test');
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

test('prepareCloudPayload() compresses the unbounded arrays and asserts the size', () => {
    const body = functionBody('prepareCloudPayload');
    assert.match(body, /compressUnboundedFields\(/,
        'prepareCloudPayload() must delegate compression to compressUnboundedFields() - the ' +
        'backup-size meter measures through the same helper, and inlining it here is how the ' +
        'meter and the write path drifted apart in the first place.');
    assert.match(body, /assertPayloadFits\(/,
        'prepareCloudPayload() must end in assertPayloadFits() - it is the only thing standing ' +
        'between a heavy user and Firestore\'s 1 MiB hard limit.');

    const fields = compressedCloudFields();
    ['timingLog', 'mockScores'].forEach(f => {
        assert.ok(fields.includes(f), f + ' is not compressed');
    });
    assert.ok(fields.includes('sm2'),
        'sm2 must be compressed. It grows by one 197-byte record per distinct question the ' +
        'user ever answers - ~385 KB at 2,000 answered questions and past the whole 900 KB ' +
        'document budget on its own at ~4,600 - and the too-big message points the user at ' +
        'timing history and mock results, so following it would not free the full bytes.');

    const helper = functionBody('compressUnboundedFields');
    assert.match(helper, /COMPRESSED_CLOUD_FIELDS/,
        'compressUnboundedFields() must drive off the shared field list, not its own inline ' +
        'copy: mergeCloudAndLocalData() decodes the same names on the way back in, and a ' +
        'field compressed on write but not decoded on read reaches the merge as a string.');
});

/** The `{ field: emptyValue }` map decompressCloudFields() drives off. */
function decompressibleCloudFields() {
    const body = functionBody('decompressibleCloudFields');
    const out = {};
    const re = /(\w+)\s*:\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(body))) out[m[1]] = m[2];
    return out;
}

test('every compressed field is decoded again on the way in', () => {
    const decodable = decompressibleCloudFields();

    compressedCloudFields().forEach(field => {
        assert.ok(Object.prototype.hasOwnProperty.call(decodable, field),
            field + ' is compressed on write but never decoded on read. A reader would then ' +
            'get a compressed string: `{ ...aString }` does not throw, it silently yields ' +
            '{0:"a",1:"b",...} and that gets written down as the user\'s data.');
    });

    // The empty value each field falls back to when its blob is unreadable has to match the
    // SHAPE the readers use it as. sm2 is a map keyed by question id; '[]' here would hand the
    // sm2 union an array, and `{ ...[] }` spreads without complaint.
    assert.equal(decodable.sm2, '{}',
        'sm2 is an object keyed by question id, not a list - an array fallback blanks the ' +
        'whole review schedule into {0:...,1:...}');
    ['timingLog', 'mockScores', 'customQuestions'].forEach(f => {
        assert.equal(decodable[f], '[]', f + ' is a list and its fallback must be one');
    });

    // The decode is type-driven, not flag-driven: documents written before a field joined
    // COMPRESSED_CLOUD_FIELDS carry a raw array and no isCompressed flag, and every one of
    // those is already in the cloud.
    const decoder = functionBody('decompressCloudFields');
    assert.match(decoder, /typeof payload\[field\] !== 'string'/,
        'a raw (already-decoded) field must pass through untouched, or every document written ' +
        'by an older build fails to read');
    assert.match(decoder, /decompressibleCloudFields\(\)/,
        'the decoder must drive off the shared field map, not an inline copy of it');

    // A blob that decompresses to nothing must THROW, not fall back to the empty value.
    // Measured live: LZString.decompressFromUTF16() returns '' for a string it cannot read, so
    // `JSON.parse(decompress(blob) || '{}')` turned a truncated schedule into an empty one —
    // survivable in the merge, where the union keeps the local side, and destructive in the
    // vault restore, which hands sm2 straight to _saveData().
    assert.match(decoder, /if \(!text\) throw/,
        'an unreadable blob must be reported, not silently read as "the user had no data"');
    assert.match(decoder, /\(blob === ''\) \? empties\[field\]/,
        'an empty field is genuinely nothing to decode and must not be called corrupt');
});

test('there is exactly one decoder, and every reader of a cloud document goes through it', () => {
    // One encoder with a decoder per reader is how sm2 reached a reader as a string in the
    // first place: mergeCloudAndLocalData() had its own inline decode loop and
    // restoreFromCloudVault() had none, which only survived because the vault wrote raw
    // documents. The vault compresses now, so a forgotten second decoder is a silent
    // corruption rather than a crash.
    assert.match(functionBody('mergeCloudAndLocalData'), /decompressCloudFields\(cloud/,
        'the sync merge must decode through the shared decoder');
    assert.match(functionBody('restoreFromCloudVault'), /decompressCloudFields\(d/,
        'the vault restore reads a document that prepareVaultSnapshot() compressed - reading ' +
        'it raw restores {0:"a",1:"b",...} as the user\'s history and reports success');

    assert.ok(APP_JS.indexOf('decodeCompressed') === -1,
        'the old per-reader decode closure is back - it is the shape of the bug');
});

test('decoding is separate from coercion, because the two readers need different things', () => {
    const merge = functionBody('mergeCloudAndLocalData');
    // The merge wants an array for these three whether the document carried one or not.
    assert.match(merge, /\['timingLog', 'mockScores', 'customQuestions'\]\.forEach/,
        'the merge must still coerce its three list fields - a missing timingLog reaching the ' +
        'concat as undefined throws mid-merge');

    // The vault restore must NOT: applyVaultSnapshot() switches on hasOwnProperty, so turning
    // an absent customQuestions into [] would blank the question bank while restoring a backup.
    const decoder = functionBody('decompressCloudFields');
    assert.ok(!/Array\.isArray/.test(decoder),
        'coercion inside the shared decoder would make "this snapshot has no question bank" ' +
        'indistinguishable from "this snapshot has an empty one"');
});

// ── The size the user is shown must be the size that is written ─────────────────

test('measureCloudDocKB() measures the document the write path actually sends', () => {
    // The probe is shared with rankCloudDocFields(), which names the biggest fields in the
    // too-big toast. Both numbers describe the same 900 KB limit, so they are built once.
    assert.match(functionBody('measureCloudDocKB'), /buildCloudDocProbe\(\)/,
        'the meter must measure the shared probe. A second probe of its own is exactly how ' +
        'the meter and the write path drifted apart before.');

    const body = functionBody('buildCloudDocProbe');

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

test('the too-big toast names the fields that are actually full', () => {
    const body = functionBody('handlePayloadTooBigError');

    assert.match(body, /rankCloudDocFields\(/,
        'the toast named "timing history / mock results" unconditionally. That was right when ' +
        'those were the only compressed fields, but sm2 grows by one 197-byte record per ' +
        'distinct question answered and passes the whole 900 KB budget alone at ~4,600 - so ' +
        'for the heavy user who actually hits this, the advice pointed at two fields holding a ' +
        'fraction of the bytes. Clearing them would not resume backup and the history would be ' +
        'gone for nothing.');
    assert.match(body, /cloudFieldLabel\(/,
        'a raw payload key is not an instruction - a user cannot act on "sm2"');
    assert.match(body, /catch\s*\(err\)/,
        'the ranking runs collectAllAppData() and must not be able to suppress the toast: a ' +
        'toast that names nothing still beats no toast at the one moment backup has stopped');

    const rank = functionBody('rankCloudDocFields');
    assert.match(rank, /buildCloudDocProbe\(\)/,
        'ranking a differently-built payload would let the "~N KB" total and the per-field ' +
        'breakdown beside it disagree about what the document contains');
    assert.match(rank, /sort\(\(a, b\) => b\.kb - a\.kb\)/, 'largest first, or it names the wrong field');
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
    assert.match(body, /armSyncWatchdog\(\)/,
        "the 'Syncing...' branch must arm the watchdog. The timer body lives in " +
        'armSyncWatchdog() because the quiz deferral in scheduleCloudSync() re-arms it too, ' +
        'and two copies of a timeout rule drift apart.');
    assert.match(functionBody('armSyncWatchdog'), /resolveStuckSyncStatus\(\)/,
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
    const body = functionBody('armSyncWatchdog');
    // Comments stripped first: the code here is *explained* in terms of setSyncStatus(), so a
    // raw text match reads the explanation as a violation of the thing it explains.
    const watchdog = body
        .slice(body.indexOf('__krishiSyncWatchdog = setTimeout'))
        .replace(/\/\/[^\n]*/g, '');
    assert.ok(watchdog.length > 0, 'watchdog timer not found in armSyncWatchdog()');
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
        ['Realtime snapshot delta',      /prepareCloudPayload\(delta, 'Realtime sync delta'\)[\s\S]{0,300}?\.doc\(uid\)\.set\(\{ \.\.\.delta/],
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

test('both delta writers measure the projected document, not just the delta', () => {
    // prepareCloudPayload() asserts the size of the payload handed to it. For a delta that is
    // the size of the CHANGE, so a document already sitting near Firestore's 1 MiB cap accepts
    // a 20-byte delta, gets rejected by Firestore, and the rejection does not match
    // isPayloadTooBigError() - a bare "Sync failed" plus three pointless retries instead of the
    // toast that names the fields to clear.
    assert.match(functionBody('performCloudSync'),
        /assertProjectedCloudDocFits\(currentCloudData, delta/,
        'performCloudSync()\'s delta write must assert the projected document.');
    assert.match(APP_JS,
        /assertProjectedCloudDocFits\(cloudData, delta[\s\S]{0,900}?\.doc\(uid\)\.set\(\{ \.\.\.delta/,
        'the realtime delta write must assert the projected document before writing.');
    const body = functionBody('assertProjectedCloudDocFits');
    assert.match(body, /delete projected\.customQuestions/,
        'the question bank lives in the qbank subcollection and cannot count against the ' +
        'document limit; leaving it in over-reports by ~2.8x (see measureCloudDocKB).');
    assert.match(body, /compressUnboundedFields\(projected\)/,
        'the document is stored compressed, so measuring it raw would refuse writes that fit.');
    assert.match(body, /payloadFitsCloudDoc\(projected\)/,
        'the cheap raw check must short-circuit first, or every ordinary sync pays an LZ pass ' +
        'over the whole document.');
});

test('the realtime delta write is awaited and its failure is retried', () => {
    const body = functionBody('initCloudSync');
    assert.match(body, /await firestore\.collection\('users'\)\.doc\(uid\)\.set\(\{ \.\.\.delta/,
        'fire-and-forget cleared krishi_sync_pending and set the badge to Synced while the ' +
        'write was still in flight; a rejected write then reached nothing but a console.error.');
    assert.doesNotMatch(body, /Real-time push back failed/,
        'the .catch() that swallowed a rejected realtime write must be gone - the outer catch ' +
        'sets Sync failed and schedules a retry.');
    assert.match(body, /scheduleSyncRetry\('realtime merge failure'\)/,
        'a failed realtime cycle must schedule a retry instead of waiting for the next local ' +
        'change; performCloudSync() has always done this.');
});

test('deleting the whole question bank reaches the cloud', () => {
    const body = functionBody('syncQbankToChunks');
    assert.doesNotMatch(body, /!Array\.isArray\(sourceArr\) \|\| sourceArr\.length === 0/,
        'an unconditional early return on an empty bank means "delete every custom question" ' +
        'never reaches the cloud: the chunks and the qbankHash stay, so a reinstall or a ' +
        'second login downloads the whole bank back.');
    assert.match(body, /if \(!customQuestionsHydrated\) return;/,
        'an empty bank may only be published when the local copy is genuinely empty. ' +
        'collectAllAppData() omits customQuestions until IndexedDB is hydrated, and ' +
        'publishing that [] would destroy the cloud copy.');
    assert.match(body, /parseInt\(prevChunks, 10\) \|\| 0\) === 0\) return;/,
        'with no cloud chunks there is nothing to clear, and every account that never created ' +
        'a question would upload an empty chunk on its first sync.');
    assert.match(body, /lastWriter: syncWriterId/,
        'the qbank metadata write is the one users/{uid} write that bypasses ' +
        'prepareCloudPayload(), so it must stamp the writer itself or its own server-ack echo ' +
        'runs the whole pipeline a second time.');
});

test('the conflict modal counts what the document actually holds', () => {
    const body = functionBody('checkForSyncConflicts');
    assert.match(body, /cloudCollectionCount\(cloud\.timingLog\)/,
        'timingLog is stored as an LZ string, so (cloud.timingLog || []).length returned the ' +
        'CHARACTER count of a compressed blob - thousands of phantom "logs" against a couple ' +
        'of hundred local ones, which raised a conflict on virtually every manual Sync Now.');
    assert.match(body, /cloud\.qbankCount/,
        'the bank left the document for users/{uid}/qbank, so cloud.customQuestions is absent ' +
        'and read as a flat 0 - "Cloud: 0 MCQs" beside a fully intact cloud bank.');
    assert.match(body, /customQuestionsHydrated/,
        'an unhydrated local bank reports 0 questions and is not evidence of a difference.');
    assert.match(functionBody('cloudCollectionCount'), /decompressFromUTF16/,
        'the helper has to decode a compressed field to count its records.');
});

test('"Use Cloud" restores the compressed fields it claims to restore', () => {
    // applyAllAppData()'s type guards skip a raw LZ string outright: setJSONArraySafely()
    // returns on !Array.isArray and the sm2 block requires an object. So the branch restored
    // bookmarks and counters while silently leaving the review schedule, timing history and
    // mock results on their local values - under a toast saying the local copy was overwritten.
    assert.match(APP_JS,
        /decompressCloudFields\(cloudData, 'Conflict use-cloud'\)[\s\S]{0,200}?applyAllAppData\(cloudData\)/,
        'the use-cloud branch must decode the document before applying it.');
    assert.match(APP_JS,
        /hydrateQbankFromChunks\(uid, docRef, cloudData\)[\s\S]{0,400}?applyAllAppData\(cloudData\)/,
        'the question bank lives in users/{uid}/qbank and has to be hydrated for "Use Cloud" ' +
        'to mean anything for questions.');
});

test('"Keep Local" does not push the question bank into the users doc', () => {
    // prepareCloudPayload() does not strip customQuestions - only syncQbankToChunks() does.
    assert.match(APP_JS,
        /syncQbankToChunks\(uid, docRef, localDataPayload\.customQuestions, localDataPayload[\s\S]{0,400}?prepareCloudPayload\(localDataPayload, 'Conflict keep-local push'\)/,
        'the keep-local push must offload the bank to the qbank subcollection first, or it ' +
        'writes the whole bank inline into users/{uid} - the write the qbank offload removed.');
});

test('the two unbounded CRDT logs go up compressed', () => {
    // Maps keyed by question id holding one {action,timestamp,_rev} record per distinct
    // question ever marked: the same growth curve as sm2. Measured 18x compressible at 4,600
    // entries (307.4 KB -> 17 KB), and they were the last two unbounded fields going up raw.
    const list = APP_JS.match(/const COMPRESSED_CLOUD_FIELDS = \[([^\]]*)\]/);
    assert.ok(list, 'COMPRESSED_CLOUD_FIELDS not found');
    ['wrongLog', 'bookmarkedLog'].forEach(f => {
        assert.match(list[1], new RegExp("'" + f + "'"),
            f + ' must be compressed for the users/{uid} write.');
        assert.match(functionBody('decompressibleCloudFields'),
            new RegExp(f + ":\\s*'\\{\\}'"),
            f + ' is a MAP: decoding it to \'[]\' would hand the merge an array, and ' +
            '{ ...[] } spreads without complaint.');
    });
});

test('a converged cycle does not re-parse every key back into memory', () => {
    const body = functionBody('applyAllAppData');
    assert.match(body, /if \(changed \|\| \(window\.__krishiApplyWrites \|\| 0\) !== _writesAtEntry\) \{\s*loadData\(\);/,
        'loadData()/loadTimingData() ran unconditionally, so a fully converged sync that wrote ' +
        'zero keys still re-parsed every krishi_* value. `changed` alone is not the test: the ' +
        'syncSelectiveLogs block writes KrishiStorage keys without touching it.');
    assert.match(functionBody('setItemIfChanged'), /__krishiApplyWrites/,
        'the write counter is what makes the gate above safe.');
    assert.match(functionBody('setJSONArraySafely'), /return setItemIfChanged\(/,
        'setJSONArraySafely() must report whether it wrote, or the gate misses its keys.');
});

test('krishi_last_updated_at is never handed a Firestore Timestamp', () => {
    // String(aTimestamp) is "[object Object]". Harmless only for as long as nothing reads the
    // key - and a merge ordered by it would get NaN.
    const writes = APP_JS.match(/setItem\('krishi_last_updated_at',[^)]*\)/g) || [];
    assert.ok(writes.length > 0, 'no krishi_last_updated_at writers found');
    writes.forEach(w => {
        assert.doesNotMatch(w, /(cloudData|currentCloudData)\.updatedAt(?!\s*\))/,
            'raw cloud updatedAt written straight into the key: ' + w +
            ' - route it through cloudUpdatedAtMs().');
    });
    assert.match(functionBody('cloudUpdatedAtMs'), /toMillis/,
        'the coercion helper must handle a Firestore Timestamp.');
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

// ── Settings must be able to travel DOWN from a peer ───────────────────────────
//
// collectAllAppData() rewrites payload.updatedAt to Date.now() on every read, so the
// document clock `useCloud = cloudUpdatedAt > local.updatedAt` is structurally almost
// always false. Any field resolved on that flag alone can only ever be pushed up, never
// pulled down: on a second device the home layout, theme, planner, goals, sound settings
// and last practice config stayed at their defaults forever. Each one now merges on its
// own settingStamps clock instead.

/** The stamped fields, and the storage key whose write must set each one's clock. */
const STAMPED = {
    dark: 'krishi_dark',
    batterySaver: 'krishi_battery_saver',
    hapticEnabled: 'krishi_haptic_enabled',
    eliteAnimations: 'krishi_elite_animations',
    difficultyBias: 'krishi_difficulty_bias',
    intensityMode: 'krishi_intensity_mode',
    activePlanMode: 'krishi_active_plan_mode',
    retryDelay: 'krishi_retry_delay',
    homeSettings: 'krishi_home_settings',
    appearanceSettings: 'krishi_appearance_settings',
    customAppearanceSettings: 'krishi_custom_appearance_settings',
    plannerSettings: 'krishi_planner_settings',
    goalSettings: 'krishi_goal_settings',
    lastPracticeConfig: 'krishi_last_practice_config',
    soundEnabled: 'krishi_sound_enabled',
    soundMuted: 'krishi_sound_muted',
    soundVolume: 'krishi_sound_volume'
};

test('every stamped setting resolves on its per-field clock, not the document clock', () => {
    const body = functionBody('mergeCloudAndLocalData');
    Object.keys(STAMPED).forEach(field => {
        // Scalar toggles are resolved inside a forEach over a name array, not by name.
        const line = new RegExp('merged\\.' + field + '\\s*=\\s*([^;]+);').exec(body);
        if (!line) return;
        assert.match(line[1], /takeCloudFor\(/,
            'merged.' + field + ' is resolved without takeCloudFor(). If it reads `useCloud` ' +
            'directly it can never be pulled from a peer, because collectAllAppData() sets ' +
            'local.updatedAt to Date.now() and the cloud stamp is always older.'
        );
    });
    // `useCloud` may survive only as takeCloudFor()'s own legacy fallback.
    const outside = body.replace(/function takeCloudFor[\s\S]*?\n        \}/, '');
    assert.doesNotMatch(outside, /useCloud\s*\?/,
        'a `useCloud ? cloud : local` ternary is left outside takeCloudFor(); that field can ' +
        'never travel down from another device'
    );
});

test('takeCloudFor() picks the newer clock and carries the survivor forward', () => {
    // Behavioural, not textual: lift the real source out of the merge and run it.
    const body = functionBody('mergeCloudAndLocalData');
    const src = /function takeCloudFor\(field\)\s*\{[\s\S]*?\n        \}/.exec(body);
    assert.ok(src, 'takeCloudFor() not found inside mergeCloudAndLocalData()');

    const build = (localStamps, cloudStamps, useCloud) => {
        const mergedStamps = {};
        // eslint-disable-next-line no-new-func
        const fn = new Function('localStamps', 'cloudStamps', 'mergedStamps', 'useCloud',
            src[0] + '; return takeCloudFor;')(localStamps, cloudStamps, mergedStamps, useCloud);
        return { fn, mergedStamps };
    };

    let { fn, mergedStamps } = build({ homeSettings: 100 }, { homeSettings: 500 }, false);
    assert.equal(fn('homeSettings'), true,
        'a peer that wrote later must win even though the document clock says otherwise'
    );
    assert.equal(mergedStamps.homeSettings, 500, 'the winning clock must be carried forward');

    ({ fn, mergedStamps } = build({ homeSettings: 900 }, { homeSettings: 500 }, false));
    assert.equal(fn('homeSettings'), false, 'the newer local edit must not be overwritten');
    assert.equal(mergedStamps.homeSettings, 900,
        'the surviving clock must be the max, or the next merge compares against a stale ' +
        'stamp and flips the value straight back'
    );

    ({ fn, mergedStamps } = build({}, {}, false));
    assert.equal(fn('homeSettings'), false, 'no stamps on either side falls back to useCloud');
    assert.deepEqual(mergedStamps, {},
        'a zero stamp must not be written, or a legacy field looks clocked at 0 forever'
    );

    ({ fn } = build({}, {}, true));
    assert.equal(fn('homeSettings'), true, 'the legacy document-clock fallback must still work');
});

test('the stamp is taken at the storage boundary, not at each write site', () => {
    // 17 keys written from 10 functions. A hand-maintained list of stampSetting() calls is
    // how this bug happens again: the writer nobody remembered stays on a stale clock and
    // silently loses to the peer. Hooking setItem/removeItem once cannot be forgotten.
    const hook = /function installSettingStampHook\(\)\s*\{[\s\S]*?\n    \}\)\(\);/.exec(APP_JS);
    assert.ok(hook, 'installSettingStampHook() is gone — settings writes are no longer clocked');
    const src = hook[0];

    assert.match(src, /store\.setItem\s*=\s*function/, 'setItem is not hooked');
    assert.match(src, /store\.removeItem\s*=\s*function/,
        'removeItem is not hooked; reset-to-defaults is a write and needs a clock, otherwise ' +
        "the peer's stale copy wins and the reset is undone"
    );
    // Memory: a wrapper that forgets .apply(this, arguments) makes the call silently no-op.
    assert.match(src, /rawSetItem\.apply\(store,\s*arguments\)/, 'setItem wrapper drops its args');
    assert.match(src, /rawRemoveItem\.apply\(store,\s*arguments\)/, 'removeItem wrapper drops its args');
    assert.match(src, /__krishiApplyingCloudData/,
        'the hook must stand down while applyAllAppData() installs a peer\'s values, or every ' +
        'incoming setting is re-stamped Date.now() and pushed straight back out'
    );

    const map = /const STAMPED_SETTING_KEYS = \{[\s\S]*?\n    \};/.exec(APP_JS);
    assert.ok(map, 'STAMPED_SETTING_KEYS map not found');
    Object.entries(STAMPED).forEach(([field, key]) => {
        assert.ok(map[0].includes("'" + key + "'") && map[0].includes("'" + field + "'"),
            'STAMPED_SETTING_KEYS is missing ' + key + ' -> ' + field + ', so writing it takes ' +
            'no clock and the setting can never win against a peer'
        );
    });
});

test('applyAllAppData() suppresses the stamp hook only when real clocks arrive', () => {
    const body = functionBody('applyAllAppData');
    assert.match(body, /window\.__krishiApplyingCloudData = hasIncomingStamps/,
        'suppression must be conditional: a legacy payload carrying no settingStamps is ' +
        'better off stamped locally than left ordered by a stale clock'
    );
    assert.match(body, /finally\s*\{\s*window\.__krishiApplyingCloudData = false;/,
        'the suppression flag must be cleared in a finally — a throw mid-apply would leave ' +
        'every later settings write unclocked for the rest of the session'
    );
});

// ── Mock results must union, not pick a winner ──────────────────────────────────
//
// The merge used to keep whichever side's array was longer and discard the other side
// whole: a phone with 3 mock results and a tablet with 2 merged to 3, and the tablet's two
// were gone permanently. recordMockScore() pushes {acc, ts}, so `ts` is a real identity and
// these union exactly like timingLog.

/** Runs the real mockScores block out of mergeCloudAndLocalData() against two devices. */
function mergeMockScores(localScores, cloudScores) {
    const body = functionBody('mergeCloudAndLocalData');
    const from = body.indexOf('let localMockScores');
    assert.ok(from > 0, 'the mockScores merge block was renamed — update this test');
    const marker = '.slice(-scoreCap);';
    const to = body.indexOf(marker, from);
    assert.ok(to > from, 'mockScores is no longer capped by scoreCap — update this test');
    const src = body.slice(from, to + marker.length);
    const merged = {};
    // eslint-disable-next-line no-new-func
    new Function('local', 'cloud', 'merged', src)(
        { mockScores: localScores }, { mockScores: cloudScores }, merged
    );
    return merged.mockScores;
}

test('mockScores unions both devices instead of discarding the shorter history', () => {
    const phone = [{ acc: 55, ts: 1 }, { acc: 60, ts: 2 }, { acc: 65, ts: 3 }];
    const tablet = [{ acc: 70, ts: 4 }, { acc: 75, ts: 5 }];

    const merged = mergeMockScores(phone, tablet);
    assert.deepEqual(merged.map(s => s.acc), [55, 60, 65, 70, 75],
        'every result from both devices must survive, in chronological order'
    );

    // Same inputs, roles swapped: the outcome must not depend on which side is longer.
    assert.deepEqual(mergeMockScores(tablet, phone).map(s => s.acc), [55, 60, 65, 70, 75],
        'the merge must be symmetric; longest-wins was the bug'
    );
});

test('mockScores merge is idempotent and keeps equal accuracies apart', () => {
    const once = mergeMockScores([{ acc: 80, ts: 10 }], [{ acc: 90, ts: 20 }]);
    const twice = mergeMockScores(once, once);
    assert.deepEqual(twice, once, 'merging the merged result must not duplicate or drop rows');

    // Two tests both scored 75%: keying on the value would collapse them into one.
    const dupes = mergeMockScores([{ acc: 75, ts: 1 }], [{ acc: 75, ts: 2 }]);
    assert.equal(dupes.length, 2, 'two distinct results with the same accuracy must both survive');
});

test('mockScores keeps pre-ts legacy entries from both devices', () => {
    // Before the Growth Chart, recordMockScore pushed a bare number.
    const merged = mergeMockScores([70, 80], [55, { acc: 95, ts: 900 }]);
    assert.equal(merged.length, 3,
        "each side's legacy entries are keyed by ordinal, so the longer side's extras survive " +
        'while the shared ordinals dedupe'
    );
    assert.equal(merged[merged.length - 1].acc, 95, 'the stamped entry is the newest');
    assert.ok(merged.slice(0, -1).every(s => (s && s.ts) == null),
        'legacy entries carry no ts, so they must sort to the front as the oldest'
    );
});

test('mockScores cap keeps the newest and can never shrink either device', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ acc: 50 + i, ts: i + 1 }));
    const extra = [{ acc: 99, ts: 5000 }];

    const merged = mergeMockScores(many, extra);
    assert.ok(merged.length >= many.length,
        'a merge must never return fewer results than a device already had'
    );
    assert.equal(merged[merged.length - 1].acc, 99, 'the newest result must survive the cap');
    assert.ok(merged.every((s, i, a) => i === 0 || (s.ts || 0) >= (a[i - 1].ts || 0)),
        'the cap keeps the tail, so the array must be chronological or it drops the newest'
    );
});

test('the longest-wins mockScores merge is gone', () => {
    const body = functionBody('mergeCloudAndLocalData');
    assert.doesNotMatch(body, /localMockScores\.length\s*>=\s*cloudMockScores\.length/,
        'the longest-wins ternary is back: it discards one device\'s entire mock history'
    );
    assert.match(body, /scoreMap\.set\(scoreKey\(s\), s\)/,
        'mockScores must merge through an identity map like timingLog does'
    );
});

// ── A capped list has two trim sites, and they must agree ───────────────────────
//
// The cloud merge unioned practiceRecent to 50 while saveRecentPracticeSessionLog() cut it
// back to 10, so the first session finished after a sync deleted 40 entries — the peer
// device's older sessions first, since the list is newest-first. The union was real and then
// immediately undone, which is why cross-device practice history looked like it appeared and
// then vanished. Both sites now read one constant.

/** Runs the real practiceRecent block out of mergeCloudAndLocalData() against two devices. */
function mergePracticeRecent(localList, cloudList) {
    const body = functionBody('mergeCloudAndLocalData');
    const from = body.indexOf('let localPracticeRecent');
    assert.ok(from > 0, 'the practiceRecent merge block was renamed — update this test');
    const marker = 'PRACTICE_RECENT_CAP);';
    const to = body.indexOf(marker, from);
    assert.ok(to > from,
        'the practiceRecent merge no longer caps with PRACTICE_RECENT_CAP — a raw number here ' +
        'is the exact drift this test exists to catch'
    );
    const src = body.slice(from, to + marker.length);
    const merged = {};
    // eslint-disable-next-line no-new-func
    new Function('local', 'cloud', 'merged', 'PRACTICE_RECENT_CAP', src)(
        { practiceRecent: localList }, { practiceRecent: cloudList }, merged, practiceRecentCap()
    );
    return merged.practiceRecent;
}

/** The single declared cap, read out of the source so the tests cannot hardcode a stale one. */
function practiceRecentCap() {
    const m = /const\s+PRACTICE_RECENT_CAP\s*=\s*(\d+)\s*;/.exec(APP_JS);
    assert.ok(m, 'js/app.js: const PRACTICE_RECENT_CAP was removed or renamed');
    return Number(m[1]);
}

/** Runs the real saveRecentPracticeSessionLog() body against a starting list. */
function appendPracticeSession(existing, item) {
    const body = functionBody('saveRecentPracticeSessionLog');
    let stored = JSON.stringify(existing);
    const store = {
        getItem: () => stored,
        setItem: (_k, v) => { stored = v; }
    };
    // eslint-disable-next-line no-new-func
    new Function('KrishiStorage', 'PRACTICE_RECENT_CAP', 'item', body.slice(1, -1))(
        store, practiceRecentCap(), item
    );
    return JSON.parse(stored);
}

test('one constant caps practiceRecent in both the writer and the merge', () => {
    const declarations = APP_JS.match(/const\s+PRACTICE_RECENT_CAP\s*=/g) || [];
    assert.equal(declarations.length, 1,
        'PRACTICE_RECENT_CAP must be declared exactly once; a second copy is a second number ' +
        'that can drift'
    );

    const writer = functionBody('saveRecentPracticeSessionLog');
    assert.match(writer, /slice\(0,\s*PRACTICE_RECENT_CAP\)/,
        'saveRecentPracticeSessionLog() must trim to PRACTICE_RECENT_CAP — the hardcoded ' +
        'slice(0, 10) is what threw away the merged history'
    );
    assert.doesNotMatch(writer, /slice\(0,\s*\d+\)/,
        'a numeric literal is back in the writer; it can no longer be kept in step with the merge'
    );

    const body = functionBody('mergeCloudAndLocalData');
    const line = /merged\.practiceRecent\s*=.*$/m.exec(body);
    assert.ok(line, 'merged.practiceRecent assignment not found');
    assert.match(line[0], /PRACTICE_RECENT_CAP/,
        'the merge must cap practiceRecent with the same constant the writer trims to'
    );
});

test('a finished session no longer deletes the history the merge just gained', () => {
    const cap = practiceRecentCap();
    const phone = Array.from({ length: 10 }, (_, i) => ({
        id: 'sess_p' + i, timestamp: 2000 + i, accuracy: 70, correct: 7, total: 10, mode: 'Phone'
    }));
    const tablet = Array.from({ length: 10 }, (_, i) => ({
        id: 'sess_t' + i, timestamp: 1000 + i, accuracy: 60, correct: 6, total: 10, mode: 'Tablet'
    }));

    const merged = mergePracticeRecent(phone, tablet);
    assert.equal(merged.length, 20, 'both devices\' sessions must survive the union');

    // The step that used to undo it: one more practice session on the phone.
    const after = appendPracticeSession(merged, {
        id: 'sess_new', timestamp: 9999, accuracy: 90, correct: 9, total: 10, mode: 'Phone'
    });
    assert.equal(after.length, 21,
        'the writer trimmed the union back down — this is the bug, and 10 here means it is back'
    );
    assert.equal(after[0].id, 'sess_new', 'the new session goes to the front (newest-first)');
    assert.ok(after.some(s => s.mode === 'Tablet'),
        'the peer device\'s sessions must still be there after practising locally'
    );
    assert.ok(cap >= 20,
        'the cap must leave room for two devices\' worth of sessions, or the union is pointless'
    );
});

test('practiceRecent stays newest-first and bounded at the shared cap', () => {
    const cap = practiceRecentCap();
    let list = [];
    for (let i = 0; i < cap + 15; i++) {
        list = appendPracticeSession(list, { id: 'sess_' + i, timestamp: i, accuracy: 50, correct: 5, total: 10, mode: 'M' });
    }
    assert.equal(list.length, cap, 'the writer must still enforce a bound');
    assert.equal(list[0].id, 'sess_' + (cap + 14), 'the newest session must be first');
    assert.ok(list.every((s, i, a) => i === 0 || s.timestamp <= a[i - 1].timestamp),
        'newest-first order is what the UI slice(0, 5) and the merge sort both rely on'
    );

    // Merging a full list with itself must not grow or reorder it.
    assert.deepEqual(mergePracticeRecent(list, list), list,
        'the practiceRecent merge must be idempotent at the cap'
    );
});

test('mockScores and timingLog writers hold their merged length instead of draining', () => {
    // These two look like the same cap mismatch but lose nothing: a single shift() after a
    // single push cannot walk an over-long array back down, so they sit at whatever the merge
    // produced. Lowering their merge caps to "fix" the mismatch would delete real history.
    const recorder = APP_JS.slice(APP_JS.indexOf('recordQuestionTime: function'), APP_JS.indexOf('loadTimingData: function'));
    assert.match(recorder, /_timingLog\.length\s*>\s*500\)\s*_timingLog\.shift\(\)/,
        'timingLog still trims with one shift() per push; if this became a while/splice drain it ' +
        'would grind the merged 2000 back to 500 and thrash against the cloud every sync'
    );
    assert.match(recorder, /_mockTestScores\.length\s*>\s*10\)\s*_mockTestScores\.shift\(\)/,
        'mockScores still trims with one shift() per push - see above'
    );
});

// ── A union cannot delete, so deletions need tombstones ─────────────────────────
//
// examProfiles unions by `p.id` and syllabusCustom by `s.subject`. A union only ever grows,
// so deleteProfileDirectly() / deleteCustomSubject() removed the row locally and the next
// merge with a peer that still held it handed it straight back. customSubjects already had a
// CRDT log for exactly this; these two now use the same {action, timestamp, _rev} records.

/** The four places a payload field has to appear or it silently never travels. */
const ROUND_TRIP = [
    ['examProfilesLog', 'krishi_exam_profiles_log'],
    ['syllabusCustomLog', 'krishi_syllabus_custom_log']
];

test('tombstone logs are wired through all four sync stages', () => {
    for (const [field] of ROUND_TRIP) {
        assert.match(functionBody('collectAllAppData'), new RegExp('payload\\.' + field + '\\s*='),
            'collectAllAppData() never reads ' + field + ', so the tombstones stay on this device'
        );
        assert.match(functionBody('applyAllAppData'), new RegExp('data\\.' + field),
            'applyAllAppData() never writes ' + field + ' down, so this device would keep only ' +
            'its own records and the union would resurrect every row the peer deleted'
        );
        assert.match(functionBody('mergeCloudAndLocalData'), new RegExp('merged\\.' + field + '\\s*='),
            'mergeCloudAndLocalData() must carry ' + field + ' forward or it is dropped on write-back'
        );
        // dark/batterySaver were already lost exactly this way: merged correctly, then never
        // shipped because the delta writer did not list them.
        assert.match(functionBody('getDifferentialSyncDelta'), new RegExp("'" + field + "'"),
            field + ' is missing from getDifferentialSyncDelta()\'s keysToCheck, so a deletion ' +
            'would merge correctly on this device and never be sent to the other one'
        );
    }
});

test('every tombstoned list has a log key and an identity matching its merge key', () => {
    const spec = APP_JS.slice(APP_JS.indexOf('const TOMBSTONE_LISTS'), APP_JS.indexOf('function tombstoneIdsOf'));
    assert.match(spec, /'krishi_exam_profiles':\s*\{[^}]*idOf:\s*p\s*=>\s*\(p && p\.id\)/,
        'examProfiles tombstones must key on p.id - the merge keys profileMap on p.id, and an ' +
        'id mismatch means the tombstone names a row the merge cannot find'
    );
    assert.match(spec, /'krishi_syllabus_custom':\s*\{[^}]*idOf:\s*s\s*=>\s*\(s && s\.subject\)/,
        'syllabusCustom tombstones must key on s.subject to match syllabusMap'
    );
    for (const [, logKey] of ROUND_TRIP) {
        assert.ok(spec.includes("'" + logKey + "'"), 'log key ' + logKey + ' is not declared');
        assert.ok(!APP_JS.includes("TOMBSTONE_LISTS['" + logKey + "']?."),
            'the log key must not itself be a tombstoned list or writing the log recurses'
        );
    }
});

/** Runs one real tombstoned-list block out of mergeCloudAndLocalData(). */
function mergeTombstonedList(field, localState, cloudState) {
    const body = functionBody('mergeCloudAndLocalData');
    const start = field === 'examProfiles' ? 'let localProfiles' : 'let localSyllabus';
    const endMarker = 'merged.' + field + ' = Array.from(';
    const from = body.indexOf(start);
    assert.ok(from > 0, 'the ' + field + ' merge block was renamed — update this test');
    const to = body.indexOf(endMarker, from);
    assert.ok(to > from, field + ' is no longer built from a Map — update this test');
    const src = body.slice(from, body.indexOf(';', to) + 1);
    assert.match(src, /mergeCRDTLogs\(/,
        field + ' does not consult a CRDT log, so a deletion there can still be resurrected'
    );
    const merged = {};
    // eslint-disable-next-line no-new-func
    const crdt = new Function('localLog', 'cloudLog', functionBody('mergeCRDTLogs').slice(1, -1));
    // The syllabus block delegates per-subject convergence to mergeSyllabusSubject(), which in
    // turn names topics through syllabusTopicNameOf(). Both are lifted out of js/app.js the same
    // way mergeCRDTLogs() is, so this runs the real merge rather than a copy of it that can rot.
    // eslint-disable-next-line no-new-func
    const topicNameOf = new Function('id', 'subject', functionBody('syllabusTopicNameOf').slice(1, -1));
    // eslint-disable-next-line no-new-func
    const mergeSub = new Function('cloudSub', 'localSub', 'log', 'syllabusTopicNameOf',
        functionBody('mergeSyllabusSubject').slice(1, -1));
    // eslint-disable-next-line no-new-func
    new Function('local', 'cloud', 'merged', 'mergeCRDTLogs', 'mergeSyllabusSubject', src)(
        localState, cloudState, merged, crdt,
        (c, l, log) => mergeSub(c, l, log, topicNameOf)
    );
    return merged;
}

/** The id a topic tombstone is written under, read out of js/app.js so the test cannot drift. */
function syllabusTopicId(subject, name) {
    // eslint-disable-next-line no-new-func
    return new Function('subject', 'topicName', functionBody('syllabusTopicId').slice(1, -1))(subject, name);
}

// ── Question-bank deletes ───────────────────────────────────────────────────────

/** deepMergeCustomQuestion(), lifted out of mergeCloudAndLocalData(). */
function mergeQuestion(localQ, cloudQ) {
    return new Function('localQ', 'cloudQ',
        functionBody('deepMergeCustomQuestion').slice(1, -1))(localQ, cloudQ);
}
function compactQuestions(arr) {
    // The TTL is a module-level const and new Function() bodies see only globals, so the real
    // value has to be lifted out of the source alongside the function itself.
    const ttl = APP_JS.match(/var DELETED_QUESTION_TTL_MS = ([^;]+);/);
    assert.ok(ttl, 'DELETED_QUESTION_TTL_MS not found in js/app.js');
    return new Function('arr', 'const DELETED_QUESTION_TTL_MS = ' + ttl[1] + ';' +
        functionBody('compactDeletedQuestions').slice(1, -1))(arr);
}
const DAY = 24 * 60 * 60 * 1000;

test('a deleted custom question stays deleted against a peer that still has it live', () => {
    // The question bank needs no *Log tombstone map: a question is a full object, so
    // deleteCustomQuestion() soft-deletes in place (deleted = true + a fresh updatedAt),
    // collectAllAppData() ships that record like any other, and the field-level merge carries
    // the flag. Losing that property is what would make deletes bounce back off the peer.
    const base = { id: 7, q: 'Q7', sub: 'Agronomy' };
    const deletedHere = { ...base, deleted: true, updatedAt: 200 };

    assert.equal(mergeQuestion(deletedHere, { ...base, updatedAt: 100 }).deleted, true,
        'peer holds it live with an older stamp - the delete must win');
    assert.equal(mergeQuestion({ ...base, updatedAt: 100 }, { ...base, deleted: true, updatedAt: 200 }).deleted, true,
        'the delete arriving FROM the cloud must survive a local copy that predates it');
    assert.equal(mergeQuestion({ ...base, deleted: false, updatedAt: 100 }, { ...base, deleted: true, updatedAt: 200 }).deleted, true,
        'an explicit deleted:false must not override a newer delete');
});

test('a same-millisecond delete beats an edit instead of resurrecting', () => {
    // isLocalNewer is a strict >, so a tie handed the whole record to the cloud copy and dropped
    // the local deleted flag. Of the two ways to guess wrong on a tie, resurrecting is worse: a
    // question that comes back on every sync cannot be removed at all.
    const base = { id: 7, q: 'Q7', sub: 'Agronomy' };
    assert.equal(mergeQuestion({ ...base, deleted: true, updatedAt: 100 }, { ...base, deleted: false, updatedAt: 100 }).deleted, true,
        'a tie must resolve to deleted');
    assert.equal(mergeQuestion({ ...base, deleted: true, updatedAt: 100 }, { ...base, deleted: false, updatedAt: 200 }).deleted, false,
        'an edit stamped strictly AFTER the delete is a deliberate restore and must still win - ' +
        'otherwise deleting a question once bans it forever');
});

test('expired question tombstones are reaped, live questions never are', () => {
    const old = Date.now() - 200 * DAY;
    const recent = Date.now() - 2 * DAY;
    const kept = compactQuestions([
        { id: 1, q: 'live but ancient', updatedAt: old },
        { id: 2, q: 'deleted long ago', deleted: true, updatedAt: old },
        { id: 3, q: 'deleted this week', deleted: true, updatedAt: recent },
        { id: 4, q: 'live', updatedAt: recent }
    ]).map(q => q.id);

    assert.deepEqual(kept, [1, 3, 4],
        'only the expired tombstone may be dropped: a live question is never reaped on age, and ' +
        'a fresh tombstone is still the only thing stopping a peer from handing the question back');
    assert.deepEqual(compactQuestions(undefined), [],
        'collectAllAppData() OMITS customQuestions until the bank is hydrated, so the compactor ' +
        'is handed undefined on every unhydrated sync');
});

test('tombstone compaction is applied to both sides of the union', () => {
    const body = functionBody('mergeCloudAndLocalData');
    assert.match(body, /compactDeletedQuestions\(local\.customQuestions\)/,
        'compacting only one side is pointless - the peer hands every tombstone straight back.');
    assert.match(body, /compactDeletedQuestions\(cloud\.customQuestions\)/,
        'the cloud copy is the side that resurrects tombstones, so it must be compacted too.');
    assert.match(body, /const _cqExpected = Math\.max\(cqLocal\.length, cqCloud\.length\)/,
        'the shrink guard has to measure the union against the COMPACTED inputs; against the raw ' +
        'lists every compaction would abort the sync as an unsound merge.');
    assert.match(APP_JS, /var DELETED_QUESTION_TTL_MS = \d+ \* 24 \* 60 \* 60 \* 1000/,
        'the retention window is the resurrection risk and must stay an obvious named constant. ' +
        'var, not const: a snapshot can reach the merge before this line has executed, and a TDZ ' +
        'ReferenceError there would break every sync.');
    assert.match(functionBody('compactDeletedQuestions'), /if \(!isFinite\(cutoff\)\) return arr;/,
        'with the TTL not yet initialised the cutoff is NaN; the compactor must fall back to ' +
        'reaping nothing rather than silently comparing against NaN.');
});

test('a deleted exam profile stays deleted after merging with a peer that still has it', () => {
    const keep = { id: 'profile_1', name: 'Kept', active: true };
    const gone = { id: 'profile_2', name: 'Deleted' };

    // Phone deleted profile_2; the tablet's copy of the cloud still lists it.
    const merged = mergeTombstonedList('examProfiles',
        { examProfiles: [keep], examProfilesLog: { profile_2: { action: 'remove', timestamp: 200, _rev: 1 } } },
        { examProfiles: [keep, gone], examProfilesLog: {} }
    );

    assert.deepEqual(merged.examProfiles.map(p => p.id), ['profile_1'],
        'the union handed the deleted profile back — this is the whole bug'
    );
    assert.equal(merged.examProfilesLog.profile_2.action, 'remove',
        'the tombstone must be carried forward, or the next merge resurrects the row again'
    );
});

test('a re-added profile beats an older tombstone', () => {
    const again = { id: 'profile_2', name: 'Back' };
    const merged = mergeTombstonedList('examProfiles',
        { examProfiles: [again], examProfilesLog: { profile_2: { action: 'add', timestamp: 900, _rev: 2 } } },
        { examProfiles: [], examProfilesLog: { profile_2: { action: 'remove', timestamp: 200, _rev: 1 } } }
    );
    assert.deepEqual(merged.examProfiles.map(p => p.id), ['profile_2'],
        'the newer add must win, or deleting something once bans it forever'
    );
});

test('a deleted syllabus subject stays deleted', () => {
    const merged = mergeTombstonedList('syllabusCustom',
        { syllabusCustom: [{ subject: 'Agronomy', topics: [] }], syllabusCustomLog: { Horticulture: { action: 'remove', timestamp: 500, _rev: 1 } } },
        { syllabusCustom: [{ subject: 'Agronomy', topics: [] }, { subject: 'Horticulture', topics: [] }], syllabusCustomLog: {} }
    );
    assert.deepEqual(merged.syllabusCustom.map(s => s.subject), ['Agronomy'],
        'deleteCustomSubject() must survive a merge with a peer that still has the subject'
    );
});

// ── The syllabus converges per TOPIC, not per subject ────────────────────────────

/** The one subject both sides hold, after the real merge block ran. */
function mergeOneSubject(localSub, cloudSub, localLog, cloudLog) {
    const merged = mergeTombstonedList('syllabusCustom',
        { syllabusCustom: [localSub], syllabusCustomLog: localLog || {} },
        { syllabusCustom: [cloudSub], syllabusCustomLog: cloudLog || {} }
    );
    return merged.syllabusCustom.find(s => s.subject === localSub.subject) || { topics: [] };
}

const topic = (name, fields) => Object.assign({ name: name, status: 'Pending' }, fields);

test('topics added on both devices are unioned, not overwritten by one side', () => {
    // Three chapters typed into Agronomy on the phone, two on the tablet. The old merge did
    // `localSyllabus.forEach(s => syllabusMap.set(s.subject, s))` — local's whole subject
    // object won, so the tablet's two were destroyed on BOTH devices, and the syllabus is
    // hand-typed with no other copy anywhere.
    const sub = mergeOneSubject(
        { subject: 'Agronomy', topics: [topic('Soil'), topic('Seed'), topic('Tillage')] },
        { subject: 'Agronomy', topics: [topic('Irrigation'), topic('Weeds')] }
    );
    assert.deepEqual(sub.topics.map(t => t.name).sort(),
        ['Irrigation', 'Seed', 'Soil', 'Tillage', 'Weeds'],
        'the union of both sides — either side alone silently deletes hand-typed chapters'
    );
});

test('a topic status is resolved by clock, never by the higher STATUS_WEIGHT', () => {
    // 'Weak' scores 20 and 'Completed' scores 100, but marking a finished chapter Weak again
    // is a deliberate edit after a bad practice run. Taking the higher weight would undo it
    // from the other device on every sync.
    const downgraded = mergeOneSubject(
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Weak', updatedAt: 9000 })] },
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Completed', updatedAt: 100 })] }
    );
    assert.equal(downgraded.topics[0].status, 'Weak',
        'the newer edit wins even though it is the lower weight'
    );

    const upgraded = mergeOneSubject(
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Pending', updatedAt: 100 })] },
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Mastered', updatedAt: 9000 })] }
    );
    assert.equal(upgraded.topics[0].status, 'Mastered',
        'and the cloud wins when the cloud is the newer side'
    );
});

test('an unstamped topic loses to a stamped one, and two unstamped ties keep local', () => {
    // No updatedAt means nothing has touched that row since stamping was added; the stamped
    // side is the only one holding evidence that a person made a choice.
    const stamped = mergeOneSubject(
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Pending' })] },
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Completed', updatedAt: 9000 })] }
    );
    assert.equal(stamped.topics[0].status, 'Completed', 'the stamped edit wins');

    const tied = mergeOneSubject(
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Studying' })] },
        { subject: 'Agronomy', topics: [topic('Soil', { status: 'Completed' })] }
    );
    assert.equal(tied.topics[0].status, 'Studying',
        'two legacy copies tie and local keeps its own — the same outcome as before ' +
        'mergeSyllabusSubject() existed'
    );
});

test('a deleted topic stays deleted, and its tombstone cannot collide with a subject', () => {
    const id = syllabusTopicId('Agronomy', 'Seed');
    const sub = mergeOneSubject(
        { subject: 'Agronomy', topics: [topic('Soil')] },
        { subject: 'Agronomy', topics: [topic('Soil'), topic('Seed')] },
        { [id]: { action: 'remove', timestamp: 500, _rev: 1 } }
    );
    assert.deepEqual(sub.topics.map(t => t.name), ['Soil'],
        'a union can no more delete a topic than it could a subject — deleteCustomTopic() ' +
        'needs the same tombstone'
    );

    // The subject-level sweep runs over the same log. A topic id is a JSON triple, so it can
    // never equal a subject key and that delete simply misses it.
    const survived = mergeTombstonedList('syllabusCustom',
        { syllabusCustom: [{ subject: 'Agronomy', topics: [] }], syllabusCustomLog: { [id]: { action: 'remove', timestamp: 500, _rev: 1 } } },
        { syllabusCustom: [{ subject: 'Agronomy', topics: [] }], syllabusCustomLog: {} }
    );
    assert.deepEqual(survived.syllabusCustom.map(s => s.subject), ['Agronomy'],
        'deleting a topic must not delete the subject it lives in'
    );
});

test('a topic tombstone only bites the subject it names', () => {
    const sub = mergeOneSubject(
        { subject: 'Horticulture', topics: [topic('Soil')] },
        { subject: 'Horticulture', topics: [topic('Soil'), topic('Seed')] },
        { [syllabusTopicId('Agronomy', 'Seed')]: { action: 'remove', timestamp: 500, _rev: 1 } }
    );
    assert.deepEqual(sub.topics.map(t => t.name).sort(), ['Seed', 'Soil'],
        'two subjects may hold a chapter of the same name; deleting one must not delete the other'
    );
});

test('the subject id stays the bare subject name', () => {
    // Tombstones written by earlier builds are keyed that way. Re-keying subjects would stop
    // matching them and resurrect every subject the user has ever deleted.
    const spec = APP_JS.slice(APP_JS.indexOf("'krishi_syllabus_custom':"), APP_JS.indexOf("'krishi_syllabus_custom':") + 500);
    assert.match(spec, /idOf: s => \(s && s\.subject\)\s*\r?\n?\s*\? \[s\.subject\]/,
        'the first identity a syllabus row owns must be its bare subject name'
    );
    assert.match(functionBody('syllabusTopicId'), /JSON\.stringify\(\['t',/,
        'a topic id must be unambiguous for any name a user can type — no separator character ' +
        'that a chapter name could contain'
    );
    assert.match(functionBody('tombstoneIdsOf'), /Array\.isArray\(ids\) \? ids : \[ids\]/,
        'one row now owns several identities (its subject plus one per topic), so idOf may ' +
        'return an array'
    );
});

test('stampSyllabusChanges() stamps only the rows whose content changed', () => {
    const body = functionBody('stampSyllabusChanges');
    // Stamping the whole array on every save would make the last device to open the planner
    // win every topic — the whole-subject overwrite this all exists to end, one level down.
    assert.match(body, /unchanged\(t, oldT, 'status'\)/,
        'a topic is stamped on a status change, not unconditionally');
    assert.match(body, /unchanged\(sub, old, 'weightage'\)/,
        'a subject is stamped on a weightage change');
    assert.match(body, /getSyllabusData\(\)/,
        'the baseline must be getSyllabusData(), not the raw stored key: on a device that has ' +
        'never saved, an empty baseline stamps all four DEFAULT_AGRI_SYLLABUS subjects with ' +
        'Date.now() and beats the real statuses waiting in the cloud');

    const writer = functionBody('saveSyllabusData');
    assert.match(writer, /stampSyllabusChanges\(data\)[\s\S]*setItem\('krishi_syllabus_custom'/,
        'stamped BEFORE the write, or the diff compares the new list against itself and ' +
        'nothing is ever marked as changed'
    );
    // Six writers reach saveSyllabusData() today; stamping at each edit site instead would
    // mean a seventh ships unstamped rows that lose every merge with nobody noticing.
    ['submitCustomSyllabusSubject', 'addCustomTopicToSubject', 'updateCustomTopicStatus',
     'updateCustomSubjectWeight', 'resetSubjectData'].forEach(fn => {
        assert.match(functionBody(fn), /saveSyllabusData\(/,
            fn + '() must persist through saveSyllabusData(), or its edit is never stamped ' +
            'and always loses the merge');
    });
});

test('tombstones only remove; a list with no log merges exactly as before', () => {
    const a = { id: 'p1' }, b = { id: 'p2' };
    const merged = mergeTombstonedList('examProfiles',
        { examProfiles: [a] }, { examProfiles: [b] }
    );
    assert.deepEqual(merged.examProfiles.map(p => p.id).sort(), ['p1', 'p2'],
        'with no tombstones on either side the union must be untouched — legacy payloads have ' +
        'no log at all and must not lose rows'
    );
});

/** Runs the real recordTombstoneDiff() against a stubbed store. */
function runDiff(startingLog, beforeIds, afterIds) {
    let saved = JSON.stringify(startingLog);
    const store = { getItem: () => saved, setItem: (_k, v) => { saved = v; } };
    // eslint-disable-next-line no-new-func
    new Function('KrishiStorage', 'safeJsonParse', 'spec', 'beforeIds', 'afterIds',
        functionBody('recordTombstoneDiff').slice(1, -1)
    )(store, (s, f) => { try { return JSON.parse(s); } catch (e) { return f; } },
      { logKey: 'k' }, beforeIds, afterIds);
    return JSON.parse(saved);
}

test('the tombstone record is derived from the diff, not written at each delete site', () => {
    const log = runDiff({}, ['p1', 'p2', 'p3'], ['p1']);
    assert.equal(log.p2.action, 'remove', 'a row that disappeared must get a remove record');
    assert.equal(log.p3.action, 'remove');
    assert.equal(log.p1, undefined, 'a row that survived unchanged must not be logged at all');

    const added = runDiff({}, ['p1'], ['p1', 'p4']);
    assert.equal(added.p4.action, 'add',
        'adds are logged too: an add record is the only thing that can beat a stale tombstone ' +
        'still sitting on a peer'
    );
});

test('re-recording the same state does not bump the tombstone clock', () => {
    const first = runDiff({}, ['p1', 'p2'], ['p1']);
    const again = runDiff(first, ['p1', 'p2'], ['p1']);
    assert.deepEqual(again, first,
        'an unchanged record must keep its original timestamp and _rev, or every save would ' +
        'refresh the clock and a genuine re-add on the peer could never win'
    );

    const flipped = runDiff(first, ['p1'], ['p1', 'p2']);
    assert.equal(flipped.p2.action, 'add', 'a real change must still be recorded');
    assert.ok(flipped.p2._rev > first.p2._rev, '_rev must advance so same-millisecond edits order');
});

test('the diff reads the old ids before the write and covers removeItem', () => {
    const hook = APP_JS.slice(APP_JS.indexOf('function installSettingStampHook'), APP_JS.indexOf('function toggleDarkMode'));

    assert.match(hook, /const rawGetItem = store\.getItem/,
        'the hook must capture getItem: the previous ids have to be read before the write ' +
        'lands, or the diff compares the new list against itself and records nothing'
    );
    for (const fn of ['setItem', 'removeItem']) {
        const block = hook.slice(hook.indexOf('store.' + fn + ' = function'));
        const beforeIdx = block.indexOf('beforeIds');
        const writeIdx = block.indexOf(fn === 'setItem' ? 'rawSetItem.apply' : 'rawRemoveItem.apply');
        assert.ok(beforeIdx > 0 && beforeIdx < writeIdx,
            'store.' + fn + ' must read the old ids BEFORE calling through to the real ' + fn
        );
    }
    assert.match(hook, /recordTombstoneDiff\(spec, beforeIds, \[\]\)/,
        'removeItem must record a tombstone for every row: resetHomeCustomizer() wipes ' +
        'krishi_exam_profiles that way, and the cloud used to put all of them back'
    );
});

test('applyAllAppData() suppresses tombstone diffing unconditionally', () => {
    const body = functionBody('applyAllAppData');
    assert.match(body, /window\.__krishiApplyingCloudList\s*=\s*true/,
        'the merged list legitimately differs from the local one, so diffing it would mint ' +
        "records claiming this device authored the peer's edits"
    );
    assert.doesNotMatch(body, /__krishiApplyingCloudList\s*=\s*hasIncomingStamps/,
        'this flag must NOT be tied to hasIncomingStamps: a legacy payload carries no stamps ' +
        'but still needs tombstone diffing switched off while it is applied'
    );
    assert.match(body, /finally\s*\{[^}]*__krishiApplyingCloudList\s*=\s*false/,
        'the flag must clear in a finally, or one throw leaves every later deletion unrecorded'
    );
});

/** The single declared layout cap, read out of the source rather than hardcoded here. */
function layoutBackupCap() {
    const m = /const\s+LAYOUT_BACKUP_CAP\s*=\s*(\d+)\s*;/.exec(APP_JS);
    assert.ok(m, 'js/app.js: const LAYOUT_BACKUP_CAP was removed or renamed');
    return Number(m[1]);
}

/** Runs the real layoutBackups block out of mergeCloudAndLocalData(). */
function mergeLayoutBackups(localList, cloudList) {
    const body = functionBody('mergeCloudAndLocalData');
    const from = body.indexOf('const layoutKey =');
    assert.ok(from > 0, 'the layoutBackups merge block was renamed — update this test');
    const marker = 'LAYOUT_BACKUP_CAP);';
    const to = body.indexOf(marker, from);
    assert.ok(to > from,
        'the layoutBackups merge no longer caps with LAYOUT_BACKUP_CAP — an uncapped union ' +
        'here grows the cloud document forever, which is the bug this test exists to catch'
    );
    const merged = {};
    // eslint-disable-next-line no-new-func
    new Function('local', 'cloud', 'merged', 'LAYOUT_BACKUP_CAP', body.slice(from, to + marker.length))(
        { layoutBackups: localList }, { layoutBackups: cloudList }, merged, layoutBackupCap()
    );
    return merged.layoutBackups;
}

/** Runs the real saveHomeSettings() backup-capture path against a starting list. */
function captureLayoutBackup(existing, oldSettings) {
    const body = functionBody('saveHomeSettings');
    const store = {
        krishi_layout_backups: JSON.stringify(existing),
        krishi_home_settings: JSON.stringify(oldSettings)
    };
    // eslint-disable-next-line no-new-func
    new Function('KrishiStorage', 'LAYOUT_BACKUP_CAP', 'settings', body.slice(1, -1))(
        {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; }
        },
        layoutBackupCap(),
        { widgets: ['new'] }
    );
    return JSON.parse(store.krishi_layout_backups);
}

const pt = (ts, tag) => ({ timestamp: ts, time: tag, settings: { widgets: [tag] } });

test('one constant caps layoutBackups in both the writer and the merge', () => {
    assert.equal((APP_JS.match(/const\s+LAYOUT_BACKUP_CAP\s*=/g) || []).length, 1,
        'exactly one declaration: two would be free to drift apart again'
    );

    const writer = functionBody('saveHomeSettings');
    assert.match(writer, /LAYOUT_BACKUP_CAP/,
        'saveHomeSettings() must trim to the shared constant'
    );
    assert.doesNotMatch(writer, /slice\(0,\s*\d+\)/,
        'a bare slice(0, 3) is back in the writer — that literal is what drifted from the merge'
    );

    const mergeBlock = functionBody('mergeCloudAndLocalData');
    const line = mergeBlock.slice(mergeBlock.indexOf('merged.layoutBackups ='));
    assert.match(line.slice(0, 260), /LAYOUT_BACKUP_CAP/,
        'the merge must cap with the constant, not a literal and not "no cap at all"'
    );
});

test('the layoutBackups union no longer grows without limit', () => {
    const cap = layoutBackupCap();
    const phone = [pt(300, 'p3'), pt(200, 'p2'), pt(100, 'p1')];
    const tablet = [pt(305, 't3'), pt(205, 't2'), pt(105, 't1')];

    const merged = mergeLayoutBackups(phone, tablet);
    assert.equal(merged.length, cap,
        'two devices holding ' + phone.length + ' points each merged to ' + merged.length +
        '; uncapped this kept every recovery point either device ever captured, each one ' +
        'carrying a full home-layout snapshot, in a document budgeted at ~900 KB'
    );

    // Merging the result back in must not grow it again — otherwise every sync ratchets up.
    const again = mergeLayoutBackups(merged, phone.concat(tablet));
    assert.equal(again.length, cap, 'the merge must be idempotent at the cap');
});

test('the cap keeps the NEWEST recovery points and numbers them #1 first', () => {
    const merged = mergeLayoutBackups([pt(100, 'old')], [pt(900, 'newest'), pt(500, 'mid')]);
    assert.deepEqual(merged.map(b => b.timestamp), [900, 500, 100],
        'Array.from(map.values()) came out cloud-first then local-appended, so the list was ' +
        'in arbitrary order after a sync and renderBackupLayouts() labels purely by array ' +
        'index — "#1 Recovery Point" could be the oldest one'
    );

    const cap = layoutBackupCap();
    const many = Array.from({ length: cap + 4 }, (_, i) => pt((i + 1) * 10, 'b' + i));
    const capped = mergeLayoutBackups([], many);
    assert.deepEqual(
        capped.map(b => b.timestamp),
        many.map(b => b.timestamp).sort((a, b) => b - a).slice(0, cap),
        'an unsorted list capped with slice() keeps an arbitrary ' + cap + ', not the newest'
    );
});

test('a layout edit no longer keeps an arbitrary 3 of a re-inflated list', () => {
    const cap = layoutBackupCap();
    const merged = mergeLayoutBackups([pt(300, 'p3'), pt(200, 'p2')], [pt(305, 't3'), pt(205, 't2')]);
    const after = captureLayoutBackup(merged, { widgets: ['previous'] });

    assert.equal(after.length, cap, 'the writer trims to the same cap the merge produced');
    assert.equal(after[0].settings.widgets[0], 'previous',
        'the newest entry is the layout that was just replaced'
    );
    assert.deepEqual(after.slice(1).map(b => b.timestamp), [305, 300],
        'and the survivors are the newest of the merged union, not whichever ones happened ' +
        'to sit at the front of an unsorted array'
    );
});

test('the writer sorts before trimming instead of trusting its input order', () => {
    // Exactly what an already-stored list looks like on a device that synced under the old
    // uncapped, unsorted merge: 6 points, cloud-first then local-appended.
    const scrambled = [pt(105, 't1'), pt(305, 't3'), pt(100, 'p1'), pt(300, 'p3'), pt(205, 't2'), pt(200, 'p2')];
    const after = captureLayoutBackup(scrambled, { widgets: ['previous'] });

    assert.equal(after.length, layoutBackupCap());
    assert.deepEqual(after.slice(1).map(b => b.timestamp), [305, 300],
        'slice() takes the FRONT of the array, so without a sort this kept timestamp 105 — ' +
        'the oldest of the six — and destroyed 305 and 300. Verified live before the sort ' +
        'was added: survivors were t1(105) and t3(305).'
    );
    assert.ok(after.every((b, i) => i === 0 || after[i - 1].timestamp >= b.timestamp),
        'the stored list must come out newest-first so the next trim is also correct'
    );
});

test('renderBackupLayouts() numbers by array position, so it sorts first', () => {
    const body = functionBody('renderBackupLayouts');
    assert.match(body, /#\$\{idx \+ 1\} Recovery Point/,
        'the label is pure array index — if this changed, this test can go'
    );
    const sortIdx = body.search(/\.sort\(\(a, b\) => \(b\.timestamp \|\| 0\) - \(a\.timestamp \|\| 0\)\)/);
    assert.ok(sortIdx > 0,
        'a legacy list stored before the writer and merge were sorted is in arbitrary order, ' +
        'and would be rendered with the oldest recovery point labelled "#1"'
    );
    assert.ok(sortIdx < body.indexOf('backups.forEach'),
        'the sort has to happen before the list is rendered'
    );
    assert.match(body, /backups\.slice\(\)\.sort\(/,
        'sort a copy: this is a read path and must not silently rewrite what is stored'
    );
});

test('layoutBackups is still wired through all four sync stages', () => {
    assert.match(functionBody('collectAllAppData'), /payload\.layoutBackups\s*=/);
    assert.match(functionBody('applyAllAppData'), /data\.layoutBackups/);
    assert.match(functionBody('mergeCloudAndLocalData'), /merged\.layoutBackups\s*=/);
    assert.match(functionBody('getDifferentialSyncDelta'), /'layoutBackups'/,
        'omitting it from keysToCheck is the same failure mode dark/batterySaver had'
    );
});

/** Runs the real SM2 block out of mergeCloudAndLocalData(). */
function mergeSm2(localSm2, cloudSm2) {
    const body = functionBody('mergeCloudAndLocalData');
    const from = body.indexOf('let sm2Map =');
    assert.ok(from > 0, 'the sm2 merge block was renamed — update this test');
    const marker = 'merged.sm2 = sm2Map;';
    const to = body.indexOf(marker, from);
    assert.ok(to > from, 'merged.sm2 is no longer built from sm2Map — update this test');
    const merged = {};
    // eslint-disable-next-line no-new-func
    new Function('local', 'cloud', 'merged', body.slice(from, to + marker.length))(
        { sm2: localSm2 }, { sm2: cloudSm2 }, merged
    );
    return merged.sm2;
}

const sm2rec = f => Object.assign({ reviews: 1, lapses: 0, difficulty: 5, stability: 1, interval: 2 }, f);

test('the sm2 merge is a union of question ids', () => {
    const merged = mergeSm2(
        { 'q-phone': sm2rec({ lastAnswered: 100 }) },
        { 'q-tablet': sm2rec({ lastAnswered: 200 }) }
    );
    assert.deepEqual(Object.keys(merged).sort(), ['q-phone', 'q-tablet']);
});

test('the later answer wins the whole FSRS tuple', () => {
    const older = sm2rec({ lastAnswered: 1000, difficulty: 3, stability: 9, interval: 30 });
    const newer = sm2rec({ lastAnswered: 2000, difficulty: 7, stability: 2, interval: 1 });

    for (const [label, l, c, expect] of [
        ['cloud newer', older, newer, 7],
        ['local newer', newer, older, 7]
    ]) {
        const got = mergeSm2({ q: l }, { q: c });
        assert.equal(got.q.difficulty, expect, label + ': the newer record must win');
        assert.equal(got.q.stability, 2,
            label + ': and it must win as a whole — difficulty, stability, interval and ' +
            'nextReview are one coupled FSRS state, so a per-field max would produce a ' +
            'state neither device ever computed'
        );
    }
});

test('reviews and lapses can never go backwards across two devices', () => {
    // Three answers on the phone, one later answer on the tablet.
    const phone  = sm2rec({ lastAnswered: 1000, reviews: 3, lapses: 2 });
    const tablet = sm2rec({ lastAnswered: 9000, reviews: 1, lapses: 0 });

    const merged = mergeSm2({ q: phone }, { q: tablet });
    assert.equal(merged.q.lastAnswered, 9000, 'the later answer still wins the record');
    assert.equal(merged.q.reviews, 3,
        'the tablet\'s later answer used to take the whole record and drop reviews 3 -> 1, ' +
        'un-mastering the question: reviews >= 4 is half the mastery gate'
    );
    assert.equal(merged.q.lapses, 2, 'lapses is a pure tally too and feeds leech suspension');
});

test('a tie keeps handing the record to the cloud, on purpose', () => {
    // Not a bug to flip. A strictly newer record already wins from either side, so `>=` only
    // decides exact ties — and a tie means both devices hold the same record from a previous
    // sync, or two never-answered seeds with no lastAnswered at all (0 == 0). Handing those
    // to local would let a fresh install beat the real history in the cloud.
    const merged = mergeSm2(
        { q: sm2rec({ lastAnswered: 0, difficulty: 5, status: 'new' }) },
        { q: sm2rec({ lastAnswered: 0, difficulty: 8, status: 'scheduled' }) }
    );
    assert.equal(merged.q.difficulty, 8, 'the cloud copy wins an untimestamped tie');
    assert.match(functionBody('mergeCloudAndLocalData'),
        /\(cVal\.lastAnswered \|\| 0\) >= \(lVal\.lastAnswered \|\| 0\)/,
        'if this ever becomes `>`, re-read the comment above it first'
    );
});

test('the SM2 engine no longer reads or writes native localStorage', () => {
    const helpers = fs.readFileSync(path.join(ROOT, 'js', 'pwa_helpers.js'), 'utf8');
    const cls = helpers.slice(helpers.indexOf('class KrishiSM2Engine'));

    // The only permitted native-localStorage touches: the _store() fallback for the window
    // before KrishiStorage loads, and _drainStrayLocalStorage() which exists to clear it.
    const drainFrom = cls.indexOf('static _drainStrayLocalStorage');
    const drainTo = cls.indexOf('static _saveData');
    assert.ok(drainFrom > 0 && drainTo > drainFrom, 'js/pwa_helpers.js: _drainStrayLocalStorage went missing');

    const outside = (cls.slice(0, drainFrom) + cls.slice(drainTo))
        .split('\n')
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .filter(l => /localStorage\.(getItem|setItem)\(/.test(l));

    assert.deepEqual(outside, [],
        'KrishiStorage.init() deletes every krishi_* key from native localStorage, so a ' +
        'direct read here comes back null and a direct write is invisible to the sync. ' +
        'Found: ' + JSON.stringify(outside)
    );
    assert.match(cls.slice(0, drainFrom), /return window\.KrishiStorage \|\| localStorage;/,
        'the fallback must stay: without KrishiStorage loaded, localStorage IS the store'
    );
});


// ── The retention tally has to travel with the schedule ─────────────────────────

test('sm2DailyLog is wired through all four sync stages', () => {
    assert.match(functionBody('collectAllAppData'), /payload\.sm2DailyLog\s*=/,
        'collectAllAppData() never reads the daily review log. It was reachable only by ' +
        'recording a review, so no sync stage could carry it: the schedule synced across ' +
        'devices and the retention figure behind it did not - 80% on the phone, 0% on a ' +
        'tablet holding the same account.'
    );
    assert.match(functionBody('applyAllAppData'), /data\.sm2DailyLog/,
        'applyAllAppData() never writes the peer tally down, so a pull leaves retention local'
    );
    assert.match(functionBody('mergeCloudAndLocalData'), /merged\.sm2DailyLog\s*=/,
        'the merge must carry sm2DailyLog forward or it is dropped on write-back'
    );
    assert.match(functionBody('getDifferentialSyncDelta'), /'sm2DailyLog'/,
        'missing from keysToCheck means it merges correctly here and is never sent'
    );
});

test('the daily log merges on the larger tally, never a sum and never last-write-wins', () => {
    const merge = functionBody('mergeCloudAndLocalData');
    const from = merge.indexOf('sm2DailyLog');
    const block = merge.slice(from, from + 900);

    assert.match(block, /mergeDailyLogs/,
        'the merge must reuse KrishiSM2Engine.mergeDailyLogs(). The same rule runs in ' +
        '_getDailyLog() when reconciling a stray localStorage copy, and two copies of a ' +
        'merge rule are how the capped-list numbers drifted apart.'
    );
    assert.doesNotMatch(block, /\+\s*\(\s*(local|cloud)\.sm2DailyLog/,
        'summing the two sides double-counts every day that was already synced and walks ' +
        'the retention rate past 100%'
    );

    // mergeDailyLogs is a `static` class method, so functionBody()'s declaration regex does
    // not reach it - match the method head in pwa_helpers.js directly.
    const helpers = fs.readFileSync(path.join(ROOT, 'js', 'pwa_helpers.js'), 'utf8');
    const ruleAt = helpers.indexOf('static mergeDailyLogs(');
    assert.ok(ruleAt > -1, 'KrishiSM2Engine.mergeDailyLogs() was renamed - update this test');
    const rule = helpers.slice(ruleAt, ruleAt + 600);
    assert.match(rule, /\(rec\.total \|\| 0\) > \(held\.total \|\| 0\)/,
        'per-day counters: the fuller tally is the more complete one. A timestamp rule is ' +
        'wrong here - the two sides are partial counts of the SAME day, not two versions of ' +
        'one record, so last-write-wins throws away real attempts.'
    );
});

// ── A failed write has to be retried, and a pending one has to be drained ────────

test('performCloudSync() arms a retry on every failure except an oversized payload', () => {
    const body = functionBody('performCloudSync');

    // The three ways a cycle ends without the data landing.
    const failures = body.match(/setSyncStatus\('Sync failed'\)/g) || [];
    assert.equal(failures.length, 3,
        'the failure paths in performCloudSync() changed - re-check that each one still arms ' +
        'a retry (server read, absence confirmation, and the catch-all)');

    assert.match(body, /scheduleSyncRetry\('server read failure'\)/,
        'a failed server read left krishi_sync_pending at true and returned with no retry. ' +
        'The only retry in the file is the onSnapshot error callback, which fires for a broken ' +
        'listener, not a failed write - and navigator.onLine reads true on captive portals, so ' +
        "no offline->online transition ever came to trigger the 'online' listener either.");
    assert.match(body, /scheduleSyncRetry\('absence check failure'\)/,
        'the initial-push path fails the same way and needs the same ladder');
    assert.match(body, /scheduleSyncRetry\('write failure'\)/,
        'the catch-all must retry too, or a transient write error is permanent for the session');

    // An oversized document fails identically every time.
    const tooBig = body.slice(body.indexOf('isPayloadTooBigError(err)'));
    assert.match(tooBig, /handlePayloadTooBigError\(err\)[\s\S]{0,120}\}\s*else\s*\{[\s\S]{0,200}scheduleSyncRetry/,
        'the size stop must sit on the OTHER side of the retry branch. Retrying an oversized ' +
        'payload three times cannot succeed - it just burns quota and re-raises the toast.');
});

test('the retry ladder backs off, keeps one timer, and resets on success', () => {
    const delays = functionBody('syncRetryDelays');
    const steps = (delays.match(/\d+/g) || []).map(Number);
    assert.deepEqual(steps, [5000, 15000, 60000],
        'the backoff steps changed - a flat or unbounded ladder hammers a link that is ' +
        'already failing');

    const retry = functionBody('scheduleSyncRetry');
    assert.match(retry, /if\s*\(window\.__krishiSyncRetryTimer\)\s*return/,
        'without the single-timer guard every failing save stacks another ladder and the ' +
        'request rate multiplies against the connection that is already down');
    assert.match(retry, /attempt >= delays\.length/, 'the ladder must be bounded');
    assert.match(retry, /krishi_sync_pending'\)\s*!==\s*'true'\)\s*return/,
        'a retry that fires after something else drained the queue is a pointless full cycle');
    assert.match(retry, /window\.__krishiSyncRetryAttempt/,
        'the attempt counter must live on window: scheduleSyncRetry() is reachable from the ' +
        'boot route, where a module-level binding in this region is still in its temporal ' +
        'dead zone - the same reason syncWatchdogMs() is a function.');

    assert.match(functionBody('setSyncStatus'), /clearSyncRetry\(\)/,
        "reaching 'Synced' must reset the ladder, or the first failure after a long healthy " +
        'session starts at 60s and the next one gives up permanently');
});

test('a sync left pending is drained at boot and on foreground', () => {
    const drain = functionBody('drainPendingSync');
    assert.match(drain, /performCloudSync\(\)/,
        'a drain must go straight to performCloudSync(). scheduleCloudSync() would increment ' +
        'krishi_sync_pending_count and inflate the offline-queue badge by one every launch.');
    assert.match(drain, /navigator\.onLine/, 'draining while offline just repaints Offline');

    assert.match(APP_JS, /setTimeout\(\(\) => drainPendingSync\('app start'\)/,
        'nothing on the boot path ever sent a pending sync: scheduleCloudSync() is reached at ' +
        'startup only from the snapshot handler else-branch (the create path), so a device ' +
        'killed while offline came back with pending=true, a queue badge showing N, and no ' +
        'code path that would ever send it.');
    assert.match(APP_JS, /visibilityState !== 'visible'\) return;\s*\r?\n\s*if \(KrishiStorage\.getItem\('krishi_sync_pending'\)/,
        'returning to the foreground is the only reliable retry signal left on mobile: the ' +
        'write fails while backgrounded, the ladder runs out unseen, and the OS freezes the ' +
        "tab before any 'online' event is delivered.");
});

// ── A live quiz must not pay for 50 full sync cycles ─────────────────────────────

test('scheduleCloudSync() defers while a quiz is live, with a hard ceiling', () => {
    const body = functionBody('scheduleCloudSync');

    assert.match(body, /isQuizInProgress\(\)[\s\S]{0,120}quizSyncMaxDeferMs\(\)/,
        'the debounce must re-arm while a quiz is live. saveData() schedules a sync per ' +
        'submitted answer, so a 50-question session fired up to 50 full cycles - each a ' +
        'server read, a CRDT merge over the whole payload, and a write whose sm2 field alone ' +
        'reaches ~385 KB at 2,000 answered questions.');
    assert.match(body, /setTimeout\(tick, 5000\)/, 'the re-arm step is gone');
    assert.ok(/armSyncWatchdog\(\)/.test(body),
        'the deferral window is longer than syncWatchdogMs(), so the watchdog has to be held ' +
        "open - otherwise it retires a still-queued sync as 'Sync failed' at 60s, mid-quiz.");

    const ceiling = Number((functionBody('quizSyncMaxDeferMs').match(/\d+/) || [])[0]);
    assert.ok(ceiling > 0 && ceiling <= 300000,
        'the ceiling is what keeps a long mock test checkpointed rather than holding every ' +
        'answer to the final question; unbounded deferral is a data-loss risk, not an ' +
        'optimisation');
});

test('isQuizInProgress() is self-contained and checks all three conditions', () => {
    const body = functionBody('isQuizInProgress');

    assert.match(body, /isQuizOnScreen\(\)/,
        'quiz visibility is decided in exactly one place. This function used to read ' +
        '`practice-active-state-panels` directly, with the polarity backwards.');
    assert.match(body, /practice-result-panel/,
        'the summary screen is reachable with the panels still up; syncing there is correct ' +
        'and must not be deferred');
    assert.match(body, /isFinishing/,
        'a session already finishing is not a live question - deferring its final write is ' +
        'exactly the write that matters most');

    assert.doesNotMatch(body, /\bquizVisible\(|\bliveSession\(|\bresultsVisible\(/,
        'those helpers live inside the IIFE at js/app.js:23369 and are not in scope here. ' +
        'Calling one would throw a ReferenceError inside the debounce timer, where nothing ' +
        'catches it - the sync would simply stop.');
});

// ── Quiz detection polarity ──────────────────────────────────────────────────────
// page-mcq is not a routed page: it is a `hidden`-toggled child INSIDE page-practice,
// a sibling of practice-active-state-panels. Starting a session hides the panels and
// shows page-mcq, so "panels visible" means the exact opposite of "quiz live". Two
// call sites read it the wrong way round, which put the subject picker and Recent
// Practice History on screen on top of a live question whenever a sync landed.

function runQuizOnScreen(pageMcq) {
    const doc = {
        getElementById(id) {
            if (id !== 'page-mcq') throw new Error('isQuizOnScreen must only read page-mcq, got ' + id);
            return pageMcq;
        }
    };
    return new Function('document', functionBody('isQuizOnScreen').slice(1, -1))(doc);
}
const el = (classes, offsetParent) => ({
    classList: { contains: c => classes.includes(c) },
    offsetParent
});

test('quiz detection reads page-mcq and gets the polarity right', () => {
    assert.equal(runQuizOnScreen(el([], {})), true,
        'a page-mcq with no `hidden` class, inside a visible page, IS a live quiz');
    assert.equal(runQuizOnScreen(el(['hidden'], {})), false,
        'the `hidden` class is how every quiz exit path closes the card (js/app.js:5680)');
    assert.equal(runQuizOnScreen(el([], null)), false,
        'navigate() force-sets inline display:none on every .page, so a page-mcq with no ' +
        '`hidden` class is still invisible when page-practice is not the active page - ' +
        'offsetParent is the only thing that catches that');
    assert.equal(runQuizOnScreen(null), false, 'a missing element is not a quiz');
});

test('no sync guard decides "quiz is live" from the practice panels', () => {
    for (const fn of ['isQuizInProgress', 'isQuizOnScreen']) {
        assert.doesNotMatch(functionBody(fn), /practice-active-state-panels/,
            fn + '() must not read the panels. They are hidden precisely WHEN a quiz is ' +
            'live, so `!panels.contains("hidden")` is true only when there is no quiz: the ' +
            'deferral never engaged mid-quiz, and it fired while the user sat idle on the ' +
            'practice page - which silently blocked that page from ever refreshing on sync.');
    }

    const assign = (APP_JS.split(/\r?\n/).find(l => /isUserInActiveQuiz\s*=/.test(l)) || '');
    assert.ok(assign, 'the sync-render dispatcher no longer names its quiz guard - retarget this test');
    assert.match(assign, /isQuizOnScreen\(\)/,
        'the sync-render dispatcher had the same inversion, so mid-quiz it fell through to ' +
        'the page-practice branch and rebuilt that page under the live question card');
    assert.doesNotMatch(assign, /practice-active-state-panels/,
        'and while the user sat idle on the practice page the inverted guard fired instead, ' +
        'returning early and leaving that page stale after every sync');
});

test('a cloud sync cannot un-hide the practice panels over a live quiz', () => {
    const body = functionBody('updateHomePage');
    const idx = body.indexOf('practice-empty-state');
    assert.ok(idx > -1, 'updateHomePage() no longer owns the empty-vs-active toggle - retarget this test');

    const block = body.slice(idx, idx + 700);
    assert.match(block, /isQuizOnScreen\(\)/,
        'this block is the practice page\'s only general-purpose empty-vs-active owner and it ' +
        'lives in the HOME renderer, so any of updateHomePage()\'s ~20 callers reaches it from ' +
        'any screen. performSmartMerge() is one of them (js/app.js:4784): a sync landing ' +
        'mid-quiz removed `hidden` from the panels and stacked them on top of the quiz.');
    assert.match(block, /typeof isQuizOnScreen === 'function'/,
        'updateHomePage() is reachable from the boot path; a bare call would throw if the ' +
        'declaration has not been evaluated yet');

    const removeIdx = block.indexOf("elActivePanels.classList.remove('hidden')");
    assert.ok(removeIdx > -1 && block.indexOf('isQuizOnScreen') < removeIdx,
        'the guard has to come before the un-hide, not after it');
});

// ── Every reader of a now-compressed field must be type-guarded ──────────────────

test('the cloud-vault restore will not hand a compressed sm2 to the engine', () => {
    const body = functionBody('restoreFromCloudVault');
    const line = (body.split(/\r?\n/).find(l => l.includes('KrishiSM2Engine._saveData')) || '');
    assert.ok(line, 'the vault restore no longer writes sm2 - update this test');
    assert.match(line, /typeof d\.sm2 === 'object'/,
        'decompressCloudFields() turns a compressed sm2 back into a map, but a snapshot whose ' +
        'sm2 is neither — truncated, hand-edited, written by a build that stored it as a list — ' +
        'must not reach _saveData(), which validates nothing and would replace the entire ' +
        'review schedule with whatever it is handed.');
    assert.match(line, /!Array\.isArray\(d\.sm2\)/,
        'an array would be written down as a schedule keyed 0,1,2...');
});

test('a cloud sm2 of the wrong shape is normalised, not spread', () => {
    const merge = functionBody('mergeCloudAndLocalData');
    const guardAt = merge.indexOf('decompressCloudFields(cloud');
    assert.ok(guardAt > -1, "the sm2 decode moved - update this test");
    const guard = merge.slice(guardAt, guardAt + 700);

    assert.match(guard, /Array\.isArray\(cloud\.sm2\)/,
        'the union at merged.sm2 spreads cloud.sm2. An array spreads to {0:...,1:...} and a ' +
        'decode that returned one - from a peer that wrote the field as a list, or a truncated ' +
        'blob - would be written down as the schedule.');
    assert.match(guard, /cloud\.sm2 = \{\}/, 'the fallback has to be an object, matching the union');
    assert.ok(merge.indexOf('...(cloud.sm2') > guardAt,
        'the guard must run BEFORE the union reads cloud.sm2, or it guards nothing');
    // An ABSENT sm2 has to stay absent. Normalising it to {} would make the union
    // `{ ...(cloud.sm2 || {}), ...local.sm2 }` no different, but getDifferentialSyncDelta()
    // then sees a field the cloud document does not have and uploads an empty schedule.
    assert.match(guard, /cloud\.sm2 !== undefined/,
        'a document with no sm2 at all must not be given an empty one');
});

// ── The midnight vault is a sixth writer of a size-limited document ──────────────

test('the midnight snapshot is compressed and size-checked like every other document write', () => {
    const prep = functionBody('prepareVaultSnapshot');
    // This wrote collectAllAppData() RAW: no compression, no assertion, no strip of
    // customQuestions. Firestore hard-limits a document to 1 MiB, so for exactly the heavy
    // user this safety net exists for, the nightly snapshot failed on the limit with nothing
    // but a console.warn — every night, for as long as the bank stayed large.
    assert.match(prep, /compressUnboundedFields\(snapshot\)/,
        'the snapshot must go through the SAME compressor as the users/{uid} document, not a ' +
        'second copy of the logic — that drift is what this bug was');
    assert.match(prep, /assertPayloadFits\(snapshot/,
        'and assert its own size, or it fails at Firestore instead of here');

    assert.match(functionBody('performMidnightVaultBackup'), /prepareVaultSnapshot\(collectAllAppData\(\)/,
        'the write path must not be able to reach .set() without going through the preparer');
});

test('the snapshot drops the question bank only after compression was not enough', () => {
    const prep = functionBody('prepareVaultSnapshot');
    const compressAt = prep.indexOf('compressUnboundedFields(snapshot)');
    const dropAt = prep.indexOf('delete snapshot.customQuestions');
    assert.ok(compressAt > -1 && dropAt > compressAt,
        'compress FIRST. A snapshot is far more useful with the bank in it, and the compressed ' +
        'fields are usually where the bytes are: a 3,000-record sm2 map measures 671 KB raw ' +
        'and 24 KB compressed.'
    );
    assert.match(prep, /if \(!payloadFitsCloudDoc\(snapshot\)/,
        'the drop must be conditional — an ordinary snapshot keeps its bank');
    // vaultEntryOf() reports qCount -1 for a bank-free snapshot and the row reads "bank not
    // included", so this degrades the snapshot instead of losing the whole day.
    assert.match(functionBody('vaultEntryOf'), /-1/,
        'a bank-free snapshot has to stay a supported shape in the vault index');
});

test('payloadFitsCloudDoc() asks the size question instead of throwing it', () => {
    const body = functionBody('payloadFitsCloudDoc');
    assert.match(body, /FIRESTORE_DOC_SOFT_LIMIT/,
        'one limit, one constant — a second number here is how the meter and the write path ' +
        'drifted apart before');
    // Unmeasurable returns true, matching assertPayloadFits(): a payload that cannot be
    // stringified is not evidence of size, and acting on it would drop the user's bank on a guess.
    assert.match(body, /catch \(e\) \{ return true; \}/,
        'an unstringifiable payload must not be treated as oversized');
});

test('a snapshot that is over the limit even without the bank stops retrying', () => {
    const body = functionBody('performMidnightVaultBackup');
    assert.match(body, /isPayloadTooBigError\(e\)/,
        'the deterministic failure has to be told apart from a transient one');
    const tooBigAt = body.indexOf('isPayloadTooBigError(e)');
    const tail = body.slice(tooBigAt, tooBigAt + 900);
    // scheduleMidnightCloudVault() runs on every successful sync, so leaving the date unstamped
    // retries a write that cannot succeed, all day, every cycle.
    assert.match(tail, /setItem\('krishi_last_vault_date', dateStr\)/,
        'the date must still be stamped, or the impossible write is retried on every sync ' +
        'for the rest of the day');
    // Comments stripped: this branch explains in prose why it does NOT call the toast helper,
    // and a substring search would find the explanation and read it as the call.
    const code = tail.replace(/\/\/[^\n]*/g, '');
    assert.ok(!/handlePayloadTooBigError\(/.test(code),
        'the users/{uid} document is over the limit too in that case and the sync path has ' +
        'already told the user — a second toast from here only repeats it');
});

test('a snapshot that landed is not reported as failed because the bookkeeping after it was not', () => {
    const body = functionBody('performMidnightVaultBackup');
    const indexAt = body.indexOf('recordVaultIndexEntry');
    assert.ok(indexAt > -1, 'the vault index write moved - update this test');
    assert.match(body.slice(Math.max(0, indexAt - 120), indexAt + 200), /try \{ await recordVaultIndexEntry/,
        'the pointer doc and the pruning are best-effort: they must not be able to take the ' +
        'snapshot down with them'
    );
    assert.ok(body.indexOf("setItem('krishi_last_vault_date', dateStr)") < indexAt,
        'the date is stamped once the snapshot itself is written, not once the index is'
    );
});

// ── Sync cost: work a cycle must not repeat ─────────────────────────────────────
// Everything below was measured, not guessed. None of it was a wrong result — the app
// reported "Synced" and the data was correct. It was the same correct answer computed
// over and over, which on a phone is battery and heat.

test('a sync activity log entry cannot schedule another sync', () => {
    const body = functionBody('logSyncActivity');
    assert.ok(!/\bsaveData\(\)/.test(body),
        'saveData() ends in scheduleCloudSync("Data saved"), and performCloudSync() calls ' +
        'logSyncActivity() on EVERY successful cycle including the "already up to date" ' +
        'branch. Calling it here scheduled another sync 800ms later, forever.'
    );
    assert.match(body, /setJSON\('krishi_syncActivityLog'/,
        'the entry still has to be persisted - just this one key, not the whole store'
    );
});

test('the log key that broke the loop is in neither the delta nor the payload', () => {
    // This is WHY logSyncActivity() could not be allowed to schedule a sync: the write it
    // made was invisible to the comparison, so the sync it scheduled always found nothing
    // to send, logged "already up to date", and scheduled itself again.
    assert.ok(!/'syncActivityLog'/.test(functionBody('getDifferentialSyncDelta')),
        'syncActivityLog is deliberately not a synced field'
    );
    assert.ok(!/syncActivityLog/.test(functionBody('collectAllAppData')),
        'syncActivityLog is deliberately not part of the cloud payload'
    );
});

test('every outgoing write is stamped with the writer id at the one choke point', () => {
    assert.match(functionBody('prepareCloudPayload'), /payload\.lastWriter\s*=\s*syncWriterId/,
        'stamped in prepareCloudPayload() because all five users-doc writers pass through ' +
        'it; stamping at the call sites is how compression and the size check drifted before'
    );
    assert.match(APP_JS, /const syncWriterId\s*=\s*'w'\s*\+\s*Math\.random/,
        'per page load, so a stale id from a previous session is never trusted'
    );
    assert.ok(!/'lastWriter'/.test(functionBody('getDifferentialSyncDelta')),
        'the stamp must never itself look like a change to send'
    );
});

test('the realtime listener skips the server echo of this device own write', () => {
    const at = APP_JS.indexOf('cachedCloudData.lastWriter === syncWriterId');
    assert.ok(at > -1,
        'the echo check is gone: every real edit costs two full pipelines again - the write, ' +
        'then the ack snapshot re-running hydrate, merge, apply, delta, qbank hash and render'
    );
    const guard = APP_JS.slice(at - 400, at + 400);
    assert.match(guard, /!snapshotDroppedDuringSync/,
        'the echo may only be skipped when no snapshot was missed while a cycle held the lock'
    );
    // The order matters: hasPendingWrites is Firestore telling us the write has not been
    // acked yet, which is a different (and cheaper) reason to return.
    assert.ok(APP_JS.indexOf('hasPendingWrites') < at,
        'the pending-write guard runs before the echo check'
    );
});

test('a snapshot dropped while a cycle held the lock forces the next one to be processed', () => {
    const at = APP_JS.indexOf('if (syncInProgress) {');
    assert.ok(at > -1, 'the listener lock guard moved - update this test');
    // Comments stripped: the branch explains its own reasoning at length, and a windowed
    // substring search would otherwise measure the prose rather than the code.
    const guard = APP_JS.slice(at, at + 1400).replace(/\/\/[^\n]*/g, '');
    assert.match(guard, /snapshotDroppedDuringSync\s*=\s*true/,
        'a peer edit arriving mid-cycle is not merged by that cycle. Without recording it, ' +
        'the echo skip would swallow the only snapshot that still carried it.'
    );
    assert.match(APP_JS, /snapshotDroppedDuringSync\s*=\s*false/,
        'the flag has to be cleared once a snapshot is actually processed'
    );
});

test('a delta this device wrote is folded into the cached snapshot, from the raw source', () => {
    const body = functionBody('adoptWrittenDelta');
    assert.match(body, /source\[key\]/,
        'values must come from the merged payload: prepareCloudPayload() LZ-compressed the ' +
        'delta own copies in place, and the cached snapshot has to stay decompressed'
    );
    assert.match(body, /invalidateCloudFieldStrings\(cloud\)/,
        'this is the one place a cached snapshot object is mutated, so it is the one place ' +
        'that must drop the memoised strings keyed on it'
    );
    for (const caller of ['performCloudSync']) {
        assert.match(functionBody(caller), /adoptWrittenDelta\(/,
            caller + '() must record what it wrote, or the next cycle rebuilds the identical ' +
            'delta and sends it to Firestore again'
        );
    }
});

test('the cloud side of the delta comparison is stringified once per snapshot, not per cycle', () => {
    const body = functionBody('getDifferentialSyncDelta');
    assert.match(body, /cloudFieldString\(cloud, key\)/,
        'sm2 alone is ~385 KB of JSON at 2,000 answered questions and the cloud object does ' +
        'not change between cycles; re-stringifying it was ~13 ms of pure waste per cycle'
    );
    assert.match(body, /JSON\.stringify\(local\[key\]\)/,
        'the LOCAL side must NOT be cached - it is the side that changes, and a stale local ' +
        'string is a change that never gets synced'
    );
    assert.match(functionBody('cloudFieldString'), /_cloudFieldStrings/);
    assert.match(APP_JS, /const _cloudFieldStrings\s*=\s*new WeakMap\(\)/,
        'keyed by object identity: Firestore hands out a fresh object per snapshot, so a new ' +
        'document cannot read a stale string and nothing has to remember to clear this'
    );
});

test('a storage write that would change nothing is skipped', () => {
    const body = functionBody('setItemIfChanged');
    assert.match(body, /KrishiStorage\.getItem\(key\) === next/,
        'compare before writing: every krishi_* setItem runs the storage hooks (setting ' +
        'clocks, tombstone diffing, syllabus stamping) and then an IndexedDB put'
    );
    assert.match(body, /typeof value === 'string'\) \? value : String\(value\)/,
        'callers pass booleans and numbers (soundEnabled, dark, retryDelay) straight through, ' +
        'and the store holds strings'
    );
    // The array writer is the one that carries timingLog and the syllabus, so it matters most.
    assert.match(functionBody('setJSONArraySafely'), /setItemIfChanged\(key, JSON\.stringify\(incoming\)\)/,
        'the safe array writer must go through it too'
    );
});

test('a converged device rewrites nothing, including the two biggest values', () => {
    const body = functionBody('applyAllAppData');
    // The review schedule is the largest single value a sync writes.
    const sm2At = body.indexOf('KrishiSM2Engine._saveData(data.sm2)');
    assert.ok(sm2At > -1, 'the sm2 write moved - update this test');
    const sm2Guard = body.slice(Math.max(0, sm2At - 500), sm2At);
    assert.match(sm2Guard, /incomingSm2 !== heldSm2/,
        'the schedule was handed to the engine on every cycle even when the merge produced ' +
        'the identical map'
    );
    assert.match(body, /incomingDaily !== heldDaily/,
        'the daily review tally needs the same comparison'
    );
    // The profile block repainted the header and the home greeting on every cycle, because
    // the stamp comparison is `>=` and a converged device ties.
    assert.match(body, /if \(profileChanged\) \{/,
        'renderProfileIdentity()/refreshHomeGreeting() must only run when the name or photo ' +
        'actually changed'
    );
    for (const key of ['krishi_home_settings', 'krishi_planner_settings', 'krishi_goal_settings',
                       'krishi_sound_enabled', 'krishi_dark', 'krishi_battery_saver']) {
        assert.match(body, new RegExp('setItemIfChanged\\(\'' + key + '\''),
            key + ' must go through the compare-first writer'
        );
    }
    assert.ok(!/KrishiStorage\.setItem\('krishi_home_settings'/.test(body),
        'no settings key may keep writing unconditionally'
    );
});

test('the question bank chunks transfer in parallel', () => {
    assert.match(functionBody('downloadQbankChunks'), /await Promise\.all\(indexes\.map/,
        'sequential awaits cost one full round-trip per chunk (200-600ms each on mobile ' +
        'data) before the merge could even begin'
    );
    const up = functionBody('uploadQbankChunks');
    assert.match(up, /await Promise\.all\(slices\.map/, 'chunk writes go out together');
    assert.match(up, /await Promise\.all\(orphans\.map/, 'the orphan cleanup goes out together');
    assert.ok(!/for \([^)]*\)\s*\{\s*await/.test(up),
        'no await may be left inside a loop in the upload path'
    );
    // The metadata write stays last and separate: it is what publishes the chunks, and a
    // torn set is already handled (download throws, hydrate keeps the local bank).
    const sync = functionBody('syncQbankToChunks');
    assert.ok(sync.indexOf('uploadQbankChunks') < sync.indexOf('qbankHash: hash'),
        'the metadata that makes the chunks discoverable must be written after them'
    );
});

// ── Advanced Setup (page-practice-config) ──────────────────────────────────────
//
// Every bug below was silent in the same way the sync bugs above were: the run started, the
// page rendered, and the setting the user picked simply did not apply.

/** The two statements in setupMCQSession() that own the activeConfig lifecycle. */
function configLifecycleRunner() {
    const body = functionBody('setupMCQSession');
    const clear = /if \(state\.activeConfig && state\.activeConfig\.__sessionConsumed\) \{[\s\S]*?\n\s*\}/.exec(body);
    const stamp = /if \(state\.activeConfig\) state\.activeConfig\.__sessionConsumed = true;/.exec(body);
    assert.ok(clear, 'setupMCQSession() no longer clears a consumed activeConfig');
    assert.ok(stamp, 'setupMCQSession() no longer stamps the config it is about to consume');
    assert.ok(body.indexOf(clear[0]) < body.indexOf(stamp[0]),
        'the clear must run before the stamp, or a config would be dropped the moment it arrives'
    );
    const fn = new Function('state', clear[0] + '\n' + stamp[0]);
    return state => { fn(state); return state; };
}

test('an Advanced Setup config cannot leak into the next session', () => {
    const startSession = configLifecycleRunner();

    // Run 1: Advanced Setup hands over its own config.
    const advanced = { feedback: 'end', negativeMarking: 'on', perQTimer: 'on', perQSec: 15 };
    const state = startSession({ activeConfig: advanced });
    assert.strictEqual(state.activeConfig, advanced, 'the config its own session brought must survive');
    assert.strictEqual(advanced.__sessionConsumed, true, 'that config is now spoken for');

    // Run 2: plain practice, "Fix My Mistakes", "Weakest Subject" - none of these set a config.
    // This is the leak: answers stayed hidden (feedback:'end') and a 20% penalty applied with
    // nothing on screen to explain it.
    assert.strictEqual(startSession(state).activeConfig, null,
        'a session that brings no config of its own must not inherit the last one'
    );

    // Run 3: a fresh config from any other caller is untouched.
    const mock = { isMock: true, feedback: 'end' };
    state.activeConfig = mock;
    assert.strictEqual(startSession(state).activeConfig, mock, 'a freshly assigned config is this session\'s');
});

test('the config saved for next time never carries the session stamp', () => {
    const body = functionBody('startAdvancedConfiguredPractice');
    const stored = body.indexOf('saveAdvancedSetupConfig(cfg)');
    const adopted = body.indexOf('state.activeConfig = cfg');
    assert.ok(stored > -1 && adopted > -1, 'startAdvancedConfiguredPractice() no longer does both');
    assert.ok(stored < adopted,
        'the config is stringified into storage and only then handed to state, so the stamp added ' +
        'downstream can never reach the stored copy - reversing this would persist ' +
        '__sessionConsumed and every restored config would be dropped on arrival'
    );
});

test('the difficulty gate matches a bank that never stored a difficulty', () => {
    const keeps = new Function('q', 'cfg', 'hardSet', functionBody('advancedDifficultyMatches').slice(1, -1));

    // questions.json carries {id,q,opts,ans,expl,sub} and no difficulty at all, so every static
    // question read undefined and a strict !== rejected all of them: all three graded options
    // produced an empty pool. Missing difficulty now reads as Medium, matching normalizeQuestion().
    assert.strictEqual(keeps({}, { difficulty: 'Medium' }), true, 'a question with no difficulty counts as Medium');
    assert.strictEqual(keeps({}, { difficulty: 'Easy' }), false, 'and only as Medium');

    // Imported difficulties arrive with whatever casing and padding the source had.
    assert.strictEqual(keeps({ difficulty: ' easy ' }, { difficulty: 'Easy' }), true, 'both sides are trimmed and lowercased');
    assert.strictEqual(keeps({ difficulty: 'HARD' }, { difficulty: 'Hard' }), true, 'casing cannot decide a match');
    assert.strictEqual(keeps({ difficulty: 'Easy' }, { difficulty: 'Hard' }), false, 'a real mismatch still rejects');
    assert.strictEqual(keeps({ difficulty: 'Easy' }, { difficulty: 'all' }), true, '"Any difficulty mixed" gates nothing');

    // "Hard for me" ignores the author's grade entirely and asks this student's own record.
    const hard = new Set(['7']);
    assert.strictEqual(keeps({ id: 7, difficulty: 'Easy' }, { difficulty: 'weak' }, hard), true,
        'an author-Easy question the student keeps failing is still hard for them'
    );
    assert.strictEqual(keeps({ id: 8, difficulty: 'Hard' }, { difficulty: 'weak' }, hard), false,
        'and an author-Hard question they always get right is not'
    );
    assert.strictEqual(keeps({ id: 7 }, { difficulty: 'weak' }, null), false,
        'no personal record set means nothing qualifies - never a crash'
    );
});

test('an empty pool names the setting that emptied it', () => {
    const why = new Function('cfg', 'res', functionBody('describeEmptyAdvancedPool').slice(1, -1));
    const cfg = { subject: 'Agronomy', topic: 'all', difficulty: 'Easy' };

    // One message per cause, because the old single "No questions match your filter metrics"
    // toast named none of the ten controls that could have produced it.
    assert.match(why(cfg, { survivedCategory: 0, survivedDifficulty: 0 }), /^No questions found in "Agronomy"\./);
    assert.match(why(cfg, { survivedCategory: 12, survivedDifficulty: 0 }), /^No "Easy" questions in "Agronomy"\./);
    assert.match(why(cfg, { survivedCategory: 12, survivedDifficulty: 12 }), /^12 question\(s\) in "Agronomy", but none match the "Include" boxes\./);

    // The topic wins the scope label when both are set, and "your question bank" covers all/all.
    assert.match(why({ subject: 'Agronomy', topic: 'Soil', difficulty: 'all' }, { survivedCategory: 0 }), /in "Soil"\./);
    assert.match(why({ subject: 'all', topic: 'all', difficulty: 'all' }, { survivedCategory: 0 }), /in your question bank\./);

    // "Hard for me" is derived, so "no Easy questions here" would be nonsense advice for it.
    assert.match(why({ subject: 'all', topic: 'all', difficulty: 'weak' }, { survivedCategory: 9, survivedDifficulty: 0 }),
        /counts as weak for you yet/
    );

    // And the tallies it reads still have to be kept by the builder.
    const build = functionBody('buildAdvancedPool');
    for (const counter of ['survivedCategory']) {
        assert.match(build, new RegExp(counter + '\\+\\+'), counter + ' must be tallied inside the filter');
    }
    assert.match(build, /survivedDifficulty: scoped\.length/, 'survivedDifficulty is the scoped list itself');
    assert.ok(!/No questions match your filter metrics["'`]\)/.test(APP_JS),
        'the one-size-fits-all toast gave the user nothing to act on'
    );
});

test('a saved subject or topic that no longer exists falls back to "all"', () => {
    // Without this the select ends up with value '' and selectedIndex -1: the control renders
    // blank and every later filter compares questions against '', so Start always failed.
    assert.match(functionBody('openPracticeSetupPage'), /subSel\.selectedIndex === -1/,
        'the subject a caller deep-links to needs the guard'
    );
    assert.match(functionBody('applyAdvancedSetupConfig'), /subSel\.selectedIndex === -1/,
        'so does the subject named by a restored config or preset'
    );
    const changed = functionBody('onPracticeSubjectChanged');
    assert.match(changed, /topicSel\.selectedIndex === -1/, 'the topic select needs it too');
    assert.ok(changed.indexOf('topicSel.value = targetTopicToSet') < changed.indexOf('topicSel.selectedIndex === -1'),
        'the fallback has to run after the assignment it is correcting'
    );
});
test('the subject and topic options cannot carry markup out of a question bank', () => {
    // Subject and topic strings come from imported questions - OCR, paste, spreadsheet - so
    // `Agro" onmouseover="x` used to close the value attribute early: a live handler landed on
    // the <option> and the value truncated to "Agro", after which the filter matched nothing.
    for (const [fn, sel, v] of [['openPracticeSetupPage', 'subSel', 'sub'], ['onPracticeSubjectChanged', 'topicSel', 'top']]) {
        const body = functionBody(fn);
        const opt = new RegExp(sel + '\\.innerHTML \\+= `<option value="\\$\\{escapeCreatorHtml\\(' + v + '\\)\\}">\\$\\{escapeCreatorHtml\\(' + v + '\\)\\}');
        assert.match(body, opt, fn + '(): both the value and the label must be escaped');
        assert.ok(!new RegExp('<option value="\\$\\{' + v + '\\}').test(body),
            fn + '(): no raw interpolation may remain'
        );
    }
});

test('every inclusion count on the setup page is scoped and valid by construction', () => {
    const body = functionBody('updateSizingDiagnosticsInSetup');
    // Comments stripped: the block comment below explains which helpers were dropped, and naming
    // them there must not read as still calling them.
    const code = body.replace(/\/\/[^\n]*/g, '');

    // The counts used to be whole-bank numbers: "Bookmarks (12)" stood next to a subject holding
    // two of them, and two of the four were raw list lengths that still counted ids whose
    // question had been deleted. Both faults disappear when every count is a filter over
    // `res.scoped` - the questions that already passed the subject/topic/difficulty gates, drawn
    // from the live bank - so validity is no longer something a helper has to strip by hand.
    for (const id of ['wrong', 'bookmarks', 'unattempt', 'custom', 'due']) {
        assert.match(code, new RegExp("setText\\('prac-cfg-cnt-" + id + "', res\\.scoped\\.filter\\("),
            'prac-cfg-cnt-' + id + ' must be counted from the scoped list'
        );
    }
    assert.ok(!/getValidWrongCount\(\)|getValidBookmarkedCount\(\)/.test(code),
        'the whole-bank helpers cannot come back - they answer a different question than the label asks'
    );
    assert.ok(!/localData\.(bookmarked|wrong)\.length/.test(code), 'no raw list length may remain here');

    // And the same builder feeds the session, so a count here cannot disagree with what Start gives.
    assert.match(code, /const res = buildAdvancedPool\(cfg\)/, 'the counts come from the shared pool builder');
    assert.match(functionBody('startAdvancedConfiguredPractice'), /const res = buildAdvancedPool\(cfg\)/,
        'and so does the run itself'
    );
});

test('the setup number inputs are clamped to the bounds the markup advertises', () => {
    const body = functionBody('readAdvancedSetupConfig');
    const i = body.indexOf('const num = (');
    assert.ok(i > -1, 'the clamp helper moved - retarget this test');
    const open = body.indexOf('{', body.indexOf('=>', i));
    let depth = 0, end = -1;
    for (let j = open; j < body.length && end < 0; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}' && --depth === 0) end = j;
    }
    assert.ok(end > -1, 'unbalanced braces in the clamp helper');
    const clamp = new Function('input', 'min', 'max', 'fallback', 'clampInputs', body.slice(open + 1, end));

    // min/max on a number <input> is validation metadata only, and this page has no form. A
    // typed "-5" made the total timer silently never start (its `> 0` test failed while the
    // dropdown still read "Limit overall time"), and a negative countdown put expectedEndTime
    // in the past, auto-marking every question wrong on the first tick.
    const el = v => ({ value: v });
    const neg = el('-5');
    assert.strictEqual(clamp(neg, 2, 180, 20, true), 2, 'a negative duration clamps up to the minimum');
    assert.strictEqual(neg.value, 2, 'and Start writes the corrected value back so the fix is visible');
    assert.strictEqual(clamp(el('9999'), 5, 300, 30, true), 300, 'an absurd countdown clamps down');
    assert.strictEqual(clamp(el(''), 2, 180, 20, true), 20, 'a cleared field falls back to the default');
    assert.strictEqual(clamp(el('abc'), 5, 300, 30, true), 30, 'so does an unparseable one');
    assert.strictEqual(clamp(el('45'), 5, 300, 30, true), 45, 'a value in range passes through');
    assert.strictEqual(clamp(null, 2, 180, 20, true), 20, 'a missing input is not a crash');

    // The live preview reads the same controls on every keystroke, and must NOT rewrite them:
    // a typed "-5" heading toward "-50" would be corrected to 2 before the 0 arrived.
    const typing = el('-5');
    assert.strictEqual(clamp(typing, 2, 180, 20, false), 2, 'the preview still clamps the value it uses');
    assert.strictEqual(typing.value, '-5', 'but leaves the half-typed field alone');
});
test('the spaced-review query is never handed a filtered pool', () => {
    // KrishiSM2Engine.getDueQuestions() DELETES every SM2 record whose id is missing from the
    // array it is given (js/pwa_helpers.js:858). Handing it a subject-filtered pool would wipe
    // the review schedule of every other subject - silently, and on both devices after sync.
    const calls = [...APP_JS.matchAll(/getDueQuestions\(([^)]*)\)/g)].map(m => m[1].trim());
    assert.ok(calls.length > 0, 'getDueQuestions() is no longer called - retarget this test');
    for (const arg of calls) {
        assert.ok(!/pool|scoped|filtered/i.test(arg),
            'getDueQuestions(' + arg + ') looks filtered; it must always see the full bank'
        );
    }
    const cache = functionBody('getAdvancedDueIdSet');
    assert.match(cache, /getDueQuestions\(allQuestions\)/, 'the cached reader passes its own full-bank argument through');
    assert.match(functionBody('buildAdvancedPool'), /getAdvancedDueIdSet\(allQuestions\)/,
        'and buildAdvancedPool() hands it getAllQuestions(), never its own filtered list'
    );

    // Cached, because updateSizingDiagnosticsInSetup() now fires on every slider tick and that
    // call re-parses its store, walks the whole bank and can write back.
    assert.match(cache, /_advDueCache/, 'the due set is memoised');
    assert.match(cache, /- _advDueCache\.at\) < \d+/, 'with a short TTL, so answering a question is reflected quickly');
});

test('the Include boxes are a union, and unticking all of them means "everything in scope"', () => {
    const g = globalThis;
    const saved = ['getAllQuestions', 'getCustomQuestions', 'getAdvancedDueIdSet', 'getPersonalHardIdSet',
        'advancedDifficultyMatches', 'timingLog', 'localData'].map(k => [k, g[k]]);

    const BANK = [
        { id: '1', sub: 'Agronomy', topic: 'Soil', difficulty: 'Easy' },   // attempted, clean
        { id: '2', sub: 'Agronomy', topic: 'Soil' },                        // wrong once
        { id: '3', sub: 'Agronomy', topic: 'Pests' },                       // bookmarked
        { id: '4', sub: 'Horticulture', topic: 'Fruit' },                   // never attempted
        { id: '5', sub: 'Agronomy', topic: 'Soil' }                         // custom + due
    ];
    g.getAllQuestions = () => BANK;
    g.getCustomQuestions = () => [{ id: '5' }];
    g.getAdvancedDueIdSet = () => new Set(['5']);
    g.getPersonalHardIdSet = () => new Set(['2']);
    g.advancedDifficultyMatches = new Function('q', 'cfg', 'hardSet', functionBody('advancedDifficultyMatches').slice(1, -1));
    g.timingLog = [{ qid: '1' }, { qid: '2' }, { qid: '3' }, { qid: '5' }];
    g.localData = { wrong: ['2'], bookmarked: ['3'] };

    const build = new Function('cfg', functionBody('buildAdvancedPool').slice(1, -1));
    const base = { subject: 'all', topic: 'all', difficulty: 'all' };
    const ids = r => r.pool.map(q => q.id).join(',');
    try {
        // Nothing ticked is not "nothing" - it is the whole scope. The page offers no other way
        // to say "just quiz me on this chapter".
        assert.strictEqual(ids(build(base)), '1,2,3,4,5', 'no Include box ticked keeps everything in scope');

        // Each box adds its own list; they are OR-ed, never AND-ed.
        assert.strictEqual(ids(build({ ...base, incWrong: true })), '2');
        assert.strictEqual(ids(build({ ...base, incBookmarks: true })), '3');
        assert.strictEqual(ids(build({ ...base, incUnattempted: true })), '4');
        assert.strictEqual(ids(build({ ...base, incCustom: true })), '5');
        assert.strictEqual(ids(build({ ...base, incDue: true })), '5', 'the 5th box reaches the SM2 schedule');
        assert.strictEqual(ids(build({ ...base, incWrong: true, incDue: true })), '2,5', 'two boxes union');

        // The scoped list is what the count labels read, so it must stop before the Include boxes.
        const scopedOnly = build({ ...base, subject: 'Agronomy', incWrong: true });
        assert.deepStrictEqual(scopedOnly.scoped.map(q => q.id), ['1', '2', '3', '5'],
            'scoped is post-subject and pre-inclusion, which is what makes "Bookmarks (n)" subject-aware'
        );
        assert.strictEqual(scopedOnly.survivedCategory, 4);
        assert.strictEqual(ids(scopedOnly), '2', 'and the pool is still the Include-box union');

        // A topic filter narrows further, and "Hard for me" ignores the author's grade.
        assert.strictEqual(ids(build({ subject: 'Agronomy', topic: 'Soil', difficulty: 'all' })), '1,2,5');
        assert.strictEqual(ids(build({ ...base, difficulty: 'weak' })), '2', 'weak reads the student\'s own record');
        assert.strictEqual(ids(build({ ...base, difficulty: 'Easy' })), '1', 'a graded difficulty still works');
        assert.strictEqual(build({ subject: 'Botany', topic: 'all', difficulty: 'all' }).survivedCategory, 0,
            'an unknown subject survives nothing, which is the first branch of the failure message'
        );
    } finally {
        for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
    }
});

test('the preview states the real length, and warns when one setting contradicts another', () => {
    const g = globalThis;
    const saved = ['document', 'escapeCreatorHtml', 'describeEmptyAdvancedPool'].map(k => [k, g[k]]);
    const nodes = {};
    const node = () => {
        const cls = new Set();
        return {
            innerHTML: '', className: '', disabled: false, cls,
            classList: { toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } },
            querySelector() { return this._l || (this._l = { textContent: '', dataset: {} }); }
        };
    };
    g.document = { getElementById: id => (nodes[id] || (nodes[id] = node())) };
    g.escapeCreatorHtml = s => String(s);
    g.describeEmptyAdvancedPool = () => 'nothing matched';
    const render = new Function('cfg', 'res', functionBody('renderAdvancedSetupPreview').slice(1, -1));
    const res = n => ({ pool: Array.from({ length: n }, (_, i) => ({ id: String(i) })) });
    const cfgOf = o => Object.assign({
        subject: 'all', topic: 'all', difficulty: 'all', count: 20,
        timer: 'off', timerMin: 20, perQTimer: 'off', perQSec: 30
    }, o);
    const preview = () => nodes['prac-cfg-preview'].innerHTML;
    const warn = () => nodes['prac-cfg-warn'].innerHTML;
    const label = () => nodes['prac-cfg-start']._l.textContent;

    try {
        // The whole point of the refactor: the number is knowable before pressing Start.
        render(cfgOf({}), res(50));
        assert.match(preview(), /<b>20<\/b> questions ready from <b>all subjects<\/b>/);
        assert.match(preview(), /\(50 match, 30 held back\)/, 'and it says what the slider is holding back');
        assert.strictEqual(label(), 'Start Practice · 20 Qs');
        assert.strictEqual(warn(), '', 'a consistent config warns about nothing');

        // count: 'all' has to bypass the slider entirely - Math.min('all', n) is NaN.
        render(cfgOf({ count: 'all' }), res(50));
        assert.match(preview(), /<b>50<\/b> questions ready/, '"use every match" means every match');
        assert.ok(!/held back/.test(preview()), 'nothing is held back when the cap is off');
        assert.strictEqual(label(), 'Start Practice · 50 Qs');

        // This is the only button on the page translateAppLabels() localises, so the count must
        // be appended to the translated verb rather than replacing it with an English sentence.
        nodes['prac-cfg-start']._l.dataset.baseText = 'अभ्यास सुरु';
        render(cfgOf({ count: 10 }), res(50));
        assert.strictEqual(label(), 'अभ्यास सुरु · 10 Qs', 'a Nepali label must survive a preview refresh');
        nodes['prac-cfg-start']._l.dataset.baseText = '';

        // Asking for 50 and silently getting 12 used to look like a session that ended early.
        render(cfgOf({ count: 50 }), res(12));
        assert.match(warn(), /Only 12 match your filters, so this run is 12 long, not 50\./);

        // Both timers on is legal but usually a mistake: 50 x 30s needs 25 min, not 20, so the
        // paper clock would expire mid-question.
        render(cfgOf({ count: 'all', timer: 'on', timerMin: 20, perQTimer: 'on', perQSec: 30 }), res(50));
        assert.match(warn(), /20 min total clock ends before 50 x 30s does\. Allow ~25 min/);
        render(cfgOf({ count: 'all', timer: 'on', timerMin: 30, perQTimer: 'on', perQSec: 30 }), res(50));
        assert.strictEqual(warn(), '', '25 min of questions inside a 30 min clock is fine');

        // An impossible config disables Start instead of letting it fail into a toast.
        render(cfgOf({}), res(0));
        assert.match(preview(), /nothing matched/, 'and it borrows the same explanation the toast used');
        assert.strictEqual(nodes['prac-cfg-start'].disabled, true);
        assert.strictEqual(label(), 'No questions match');
        assert.ok(nodes['prac-cfg-start'].cls.has('pointer-events-none'));

        render(cfgOf({}), res(1));
        assert.match(preview(), /<b>1<\/b> question ready/, 'one question is not "1 questions"');
        assert.strictEqual(nodes['prac-cfg-start'].disabled, false, 'and Start comes back');
    } finally {
        for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
    }
});

test('"use every matching question" cannot slice a pool to nothing', () => {
    const body = functionBody('startAdvancedConfiguredPractice');
    const line = (body.split(/\r?\n/).find(l => /pool = pool\.slice\(/.test(l)) || '');
    assert.ok(line, 'the slice in startAdvancedConfiguredPractice() moved - retarget this test');
    const take = new Function('pool', 'cfg', line + '\nreturn pool.length;');
    const ten = () => Array.from({ length: 10 }, (_, i) => i);

    // Math.min('all', 10) is NaN and slice(0, NaN) returns [], so without its own branch the new
    // checkbox would have started an empty session.
    assert.strictEqual(take(ten(), { count: 'all' }), 10, '"all" keeps the whole pool');
    assert.strictEqual(take(ten(), { count: 4 }), 4, 'a number still caps');
    assert.strictEqual(take(ten(), { count: 99 }), 10, 'and cannot ask for more than exists');
});

test('the personal difficulty band is built from this student\'s own answers', () => {
    const g = globalThis;
    const saved = [['localData', g.localData], ['timingLog', g.timingLog]];
    const hardSet = new Function(functionBody('getPersonalHardIdSet').slice(1, -1));
    try {
        // The author-assigned difficulty is nearly empty data - the static bank stores none and
        // every import defaults to Medium - so the dropdown could only sort hand-graded questions.
        // timingLog already holds {qid, timeSec, correct} for every answer ever given.
        g.localData = { wrong: ['99'] };
        g.timingLog = [
            { qid: '10', correct: true, timeSec: 10 },
            { qid: '11', correct: true, timeSec: 10 },
            { qid: '12', correct: true, timeSec: 60 },   // right, but 2.8x the average
            { qid: '13', correct: false, timeSec: 5 }    // wrong once is enough
        ];
        const hard = hardSet();
        assert.ok(hard.has('99'), 'the unresolved mistake list seeds the band');
        assert.ok(hard.has('13'), 'answered wrong at least once');
        assert.ok(hard.has('12'), 'right but far slower than their own average is not yet fluent');
        assert.ok(!hard.has('10') && !hard.has('11'), 'right and quick is not hard for them');

        // Ids are normalised on both sides: timingLog stores whatever the session had.
        g.localData = { wrong: [7] };
        g.timingLog = [{ qid: 8, correct: false, timeSec: 3 }];
        const mixed = hardSet();
        assert.ok(mixed.has('7') && mixed.has('8'), 'numeric ids compare as strings');

        // No history at all must not crash, and must not declare everything hard.
        g.localData = {};
        g.timingLog = [];
        assert.strictEqual(hardSet().size, 0, 'a fresh install has no weak questions yet');
        g.timingLog = [{ qid: '1', correct: true }, { qid: '2', correct: true }];
        assert.strictEqual(hardSet().size, 0, 'untimed entries cannot make an average out of nothing');
    } finally {
        for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
    }
});

test('saved setups ride inside the existing synced key, and an older bare config still restores', () => {
    const g = globalThis;
    const saved = ['KrishiStorage', 'readAdvancedSetupStore', 'writeAdvancedSetupStore']
        .map(k => [k, g[k]]);
    let store = {};
    g.KrishiStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); }
    };
    const read = new Function(functionBody('readAdvancedSetupStore').slice(1, -1));
    const write = new Function('store', functionBody('writeAdvancedSetupStore').slice(1, -1));
    const saveLast = new Function('cfg', functionBody('saveAdvancedSetupConfig').slice(1, -1));
    g.readAdvancedSetupStore = read;
    g.writeAdvancedSetupStore = write;
    const KEY = 'krishi_last_practice_config';

    try {
        assert.deepStrictEqual(read(), { last: null, presets: [] }, 'a fresh install reads clean');

        // Backward compatibility: before presets existed the whole value WAS the last config.
        // Getting this wrong would silently reset everyone's remembered setup on upgrade.
        store[KEY] = JSON.stringify({ subject: 'Agronomy', count: 30, incWrong: true });
        const legacy = read();
        assert.strictEqual(legacy.last.subject, 'Agronomy', 'a pre-presets value is read as `last`');
        assert.strictEqual(legacy.last.count, 30);
        assert.deepStrictEqual(legacy.presets, []);

        // Round-trip, and the last config survives a preset write.
        write({ last: { subject: 'Horticulture' }, presets: [{ name: 'Morning drill', cfg: { count: 10 } }] });
        assert.strictEqual(read().last.subject, 'Horticulture');
        assert.strictEqual(read().presets[0].name, 'Morning drill');
        saveLast({ subject: 'Botany' });
        assert.strictEqual(read().presets.length, 1, 'saving the last config must not drop saved setups');
        assert.strictEqual(read().last.subject, 'Botany');

        // No new storage key. That key is already in the sync key list, the cloud field map,
        // collect and apply - a brand-new key persisted locally but absent from the cloud payload
        // is exactly the shape that builds an endless save -> sync -> save loop.
        assert.deepStrictEqual(Object.keys(store), [KEY], 'only the one already-synced key is written');
        for (const fn of ['readAdvancedSetupStore', 'writeAdvancedSetupStore', 'saveAdvancedSetupConfig',
            'saveAdvancedSetupPreset', 'applyAdvancedSetupPreset', 'deleteAdvancedSetupPreset']) {
            const keys = [...functionBody(fn).matchAll(/'(krishi_[a-z_]+)'/g)].map(m => m[1]);
            assert.deepStrictEqual([...new Set(keys)].filter(k => k !== KEY), [],
                fn + '() touches a krishi_* key the sync layer does not know about'
            );
        }

        // Capped, because this value is part of a Firestore document with a hard 1 MB ceiling.
        write({ last: null, presets: Array.from({ length: 30 }, (_, i) => ({ name: 'p' + i, cfg: {} })) });
        assert.strictEqual(read().presets.length, 8, 'the saved-setup list is bounded');

        // Corrupt or hostile values must not take the page down with them.
        store[KEY] = '{not json';
        assert.deepStrictEqual(read(), { last: null, presets: [] }, 'unparseable reads as empty');
        store[KEY] = JSON.stringify({ last: 'a string', presets: 'not an array' });
        assert.deepStrictEqual(read(), { last: null, presets: [] }, 'wrong types read as empty');
        store[KEY] = JSON.stringify({ presets: [{ name: 'ok', cfg: {} }, { name: 'no cfg' }, null] });
        assert.strictEqual(read().presets.length, 1, 'half-written presets are dropped, not rendered');
        store[KEY] = JSON.stringify([1, 2, 3]);
        assert.deepStrictEqual(read(), { last: null, presets: [] }, 'an array is not a config');
    } finally {
        for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
    }
});

test('every control on the Advanced Setup page refreshes the live preview', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const start = html.indexOf('id="page-practice-config"');
    const end = html.indexOf('id="page-mock"', start);
    assert.ok(start > -1 && end > start, 'page-practice-config moved - retarget this test');
    const page = html.slice(start, end);

    // This is the fault the whole batch started from: six of the ten controls had no change
    // handler at all, so the four counts and the pool they described only ever updated when the
    // subject changed. Picking a difficulty, dragging the slider or unticking an Include box
    // changed nothing on screen until Start either ran or produced a toast.
    const WIRED = ['topic', 'difficulty', 'count', 'count-all', 'timer', 'timer-min',
        'per-q-timer', 'per-q-sec', 'inc-wrong', 'inc-bookmarks', 'inc-unattempted',
        'inc-custom', 'inc-due'];
    for (const name of WIRED) {
        const tag = new RegExp('<(?:select|input)[^>]*id="prac-cfg-' + name + '"[^>]*>').exec(page);
        assert.ok(tag, 'prac-cfg-' + name + ' is missing from the page');
        assert.match(tag[0], /on(?:change|input)="[^"]*updateSizingDiagnosticsInSetup\(\)/,
            'prac-cfg-' + name + ' changes the pool, so it must refresh the preview'
        );
    }
    // The subject select refreshes through onPracticeSubjectChanged(), which has to repopulate
    // the topic list first and ends with the same refresh.
    assert.match(page, /id="prac-cfg-subject" onchange="onPracticeSubjectChanged\(\)"/);
    assert.match(functionBody('onPracticeSubjectChanged'), /updateSizingDiagnosticsInSetup\(\);\s*\n\s*\}/,
        'onPracticeSubjectChanged() must end by refreshing the preview'
    );

    // The nodes the refresher writes into.
    for (const id of ['prac-cfg-cnt-wrong', 'prac-cfg-cnt-bookmarks', 'prac-cfg-cnt-unattempt',
        'prac-cfg-cnt-custom', 'prac-cfg-cnt-due', 'prac-cfg-preview', 'prac-cfg-warn',
        'prac-cfg-start', 'prac-cfg-presets', 'prac-cfg-count-row']) {
        assert.ok(page.includes('id="' + id + '"'), id + ' is missing, so its update is a silent no-op');
    }
    assert.match(page, /class="prac-cfg-start-label"/, 'the Start button needs a label node to retitle');
    assert.match(page, /<option value="weak">/, 'the derived difficulty band needs an option');
    assert.match(page, /onclick="targetWeakAreasInSetup\(\)/, 'the weak-area shortcut must be reachable');
    assert.match(page, /onclick="saveAdvancedSetupPreset\(\)/, 'so must saving a setup');
});

test('translating the Start button must not delete the node that carries the live count', () => {
    // Found in the browser, not in the source: translateAppLabels() runs at boot and did
    // `btn.textContent = prefix + labels.startPractice` for anything whose text included
    // "Start Practice Challenge". Assigning textContent drops every child, so the
    // .prac-cfg-start-label span was gone before the page was ever opened and every later
    // retitle silently found null. The button looked right, which is why source review missed it.
    const body = functionBody('translateAppLabels');
    const branch = body.slice(body.indexOf("orig === '🎯 Start Practice'"));
    const block = branch.slice(0, branch.indexOf('// Save Question'));
    assert.match(block, /querySelector\(\s*'\.prac-cfg-start-label'\s*\)/,
        'the translator must look for the label span'
    );
    assert.match(block, /startLabel\.textContent\s*=\s*labels\.startPractice/,
        'and translate the span, leaving the button structure intact'
    );
    assert.match(block, /startLabel\.dataset\.baseText\s*=\s*labels\.startPractice/,
        'and record the translated verb so the count renderer can rebuild it in that language'
    );
    // The old destructive write may only survive as the no-span fallback.
    const destructive = [...block.matchAll(/btn\.textContent\s*=/g)].length;
    assert.strictEqual(destructive, 1, 'exactly one textContent write, in the else branch');
    assert.ok(block.indexOf('btn.textContent =') > block.indexOf('startLabel.textContent'),
        'the destructive write must be the fallback, not the default path'
    );

    // And the markup must not leave the translator to cache a label that is already dynamic.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const tag = /<button id="prac-cfg-start"[^>]*>/.exec(html);
    assert.ok(tag, 'prac-cfg-start button is missing');
    assert.match(tag[0], /data-original-text="⚡ Start Practice Challenge"/,
        'pre-declare data-original-text, or whichever ran first decides what the button "said"'
    );
});

// ---------------------------------------------------------------------------------------------
// Rich question text (q.q plain + q.qHtml optional)
//
// The Creator's Quill editors used to write their HTML straight into q.q, and nearly every other
// reader in the app puts q.q into .textContent - so a question typed in the Creator appeared on
// the quiz screen as a literal "<p>dfgdsgdfsg</p>". The fix keeps q.q plain and canonical (search,
// dedupe, validation, export and the `q.id || q.q` SM2 fallback all read it) and stores the markup
// beside it in q.qHtml, only when it carries formatting.
// ---------------------------------------------------------------------------------------------

test('rich markup is only stored when it says more than the plain text does', () => {
    const g = globalThis;
    const saved = ['creatorPlainText', 'escapeCreatorHtml'].map(k => [k, g[k]]);
    try {
        g.creatorPlainText = new Function('html', functionBody('creatorPlainText').slice(1, -1));
        g.escapeCreatorHtml = new Function('s', functionBody('escapeCreatorHtml').slice(1, -1));
        const adds = new Function('html', 'plain', functionBody('richTextAddsFormatting').slice(1, -1));

        // The reported bug: Quill wraps even untouched typing, so this pair must NOT be stored -
        // otherwise every question in the bank carries a redundant second copy to the cloud.
        assert.strictEqual(adds('<p>dfgdsgdfsg</p>', 'dfgdsgdfsg'), false);
        assert.strictEqual(adds('hello', 'hello'), false);
        assert.strictEqual(adds('', ''), false);
        assert.strictEqual(adds('<p><br></p>', ''), false, 'an untouched Quill editor is not formatting');
        assert.strictEqual(adds('   ', 'x'), false);
        // Near misses that a plain string comparison would have stored for nothing: a trailing
        // space, or an &nbsp; where the plain copy holds an ordinary space.
        assert.strictEqual(adds('<p>trailing </p>', 'trailing'), false);
        assert.strictEqual(adds('<p>a&nbsp;b</p>', 'a b'), false);
        assert.strictEqual(adds('<p>N &lt; P &amp; K</p>', 'N < P & K'), false);

        assert.strictEqual(adds('<p><b>bold</b> word</p>', 'bold word'), true);
        assert.strictEqual(adds('<p>a<br>b</p>', 'a b'), true, 'a line break is formatting');
        assert.strictEqual(adds('<p>one</p><p>two</p>', 'one two'), true, 'two paragraphs are structure the plain text cannot hold');
        assert.strictEqual(adds('<ul><li>a</li><li>b</li></ul>', 'a b'), true);

        // creatorPlainText() decodes entities, and &amp; has to be decoded last: doing it first
        // turns "&amp;lt;" into a real "<" and a question about an inequality comes back as markup.
        assert.strictEqual(g.creatorPlainText('<p>a &amp;lt; b</p>'), 'a &lt; b');
        assert.strictEqual(g.creatorPlainText('<p>N &lt; P &amp; K</p>'), 'N < P & K');
        assert.strictEqual(g.creatorPlainText('<p>माटो&nbsp;परीक्षण</p>'), 'माटो परीक्षण');
        // Block tags become a space, inline tags become nothing. Both halves matter: the first
        // keeps two paragraphs from running together, and the second keeps formatting applied
        // inside a word from splitting it - this text is what search, dedupe and export read.
        assert.strictEqual(g.creatorPlainText('<p>one</p><p>two</p>'), 'one two');
        assert.strictEqual(g.creatorPlainText('<ul><li>a</li><li>b</li></ul>'), 'a b');
        assert.strictEqual(g.creatorPlainText('<p>H<sub>2</sub>O is <b>wa</b>ter</p>'), 'H2O is water');
        assert.strictEqual(g.creatorPlainText('<p>Fe is a <i>micro</i>nutrient</p>'), 'Fe is a micronutrient');
    } finally {
        for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
    }
});

test('the sanitiser parses into an inert node and keeps no attribute at all', () => {
    const body = functionBody('sanitizeRichText');
    // Parsed through a <template>, whose content is an inert fragment: no script runs, no
    // <img src> is fetched, no onerror fires. Assigning to a live element's innerHTML would
    // do all three, so this must never be "simplified".
    assert.match(body, /createElement\('template'\)/);
    assert.doesNotMatch(body, /createElement\('div'\)/, 'a live <div> is not an inert parse target');
    for (const tag of ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'SVG']) {
        assert.ok(body.includes("'" + tag + "'"), tag + ' must be dropped with its contents');
    }
    // Attributes go wholesale rather than by an on* blacklist: `style` alone can lay an invisible
    // box over the answer buttons, and href/src reach the network.
    assert.match(body, /attributes\).*removeAttribute\(a\.name\)/s);
    const allowed = /const ALLOWED = \[([^\]]*)\]/.exec(body);
    assert.ok(allowed, 'the allowlist must stay an explicit list');
    const tags = allowed[1].match(/'([A-Z0-9]+)'/g).map(s => s.replace(/'/g, ''));
    assert.deepStrictEqual(tags.filter(t => ['A', 'IMG', 'SPAN', 'DIV', 'TABLE', 'FONT'].includes(t)), [],
        'the allowlist is text formatting only - anything else is unwrapped');
    // Unwrapped, not deleted: an unexpected wrapper must not swallow the words inside it, or a
    // question synced from another device loses its text and not just its styling.
    assert.match(body, /while \(node\.firstChild\) parent\.insertBefore/);
    // node has no DOM, and returning unchecked markup there would be worse than losing the tags.
    assert.match(body, /typeof document === 'undefined'/);

    const g = globalThis;
    const saved = ['creatorPlainText', 'escapeCreatorHtml', 'richTextMaxLen'].map(k => [k, g[k]]);
    try {
        g.creatorPlainText = new Function('html', functionBody('creatorPlainText').slice(1, -1));
        g.escapeCreatorHtml = new Function('s', functionBody('escapeCreatorHtml').slice(1, -1));
        g.richTextMaxLen = new Function(functionBody('richTextMaxLen').slice(1, -1));
        const clean = new Function('html', functionBody('sanitizeRichText').slice(1, -1));
        assert.strictEqual(clean('<img src=x onerror=alert(1)>'), '', 'the no-DOM path yields text, never markup');
        assert.strictEqual(clean('plain text'), 'plain text');
        assert.strictEqual(clean('a < b'), 'a &lt; b', 'text that merely looks like a tag is escaped');
        assert.ok(g.richTextMaxLen() > 0 && g.richTextMaxLen() < 100000);
    } finally {
        for (const [k, v] of saved) { if (v === undefined) delete g[k]; else g[k] = v; }
    }
});

test('nothing renders a question or explanation as unsanitised HTML', () => {
    // The Manage list used to do a bare `qEl.innerHTML = q.q`, which ran whatever markup arrived
    // from OCR, an imported file, or a peer device over cloud sync.
    const offenders = APP_JS.split('\n')
        .map((text, i) => ({ line: i + 1, text: text.trim() }))
        .filter(o => !o.text.startsWith('//') && !o.text.startsWith('*'))   // prose, not code
        .filter(o => /\.innerHTML\s*=/.test(o.text))
        .filter(o => /\bq\.(q|expl)\b|\bquestion\.(q|expl)\b/.test(o.text))
        .filter(o => !/sanitizeRichText|escapeCreatorHtml/.test(o.text));
    assert.deepStrictEqual(offenders, [],
        'js/app.js assigns a question field to innerHTML without sanitising it');
    // And the readers that used .textContent (which showed the tags as text) go through the
    // shared helper instead, so a formatted question actually renders.
    for (const fn of ['setRichTextContent']) {
        assert.ok(APP_JS.includes('function ' + fn + '('), fn + '() is missing');
    }
    const uses = (APP_JS.match(/setRichTextContent\(/g) || []).length;
    assert.ok(uses >= 8, 'expected every question/explanation reader to route through the helper, saw ' + uses);
    assert.match(functionBody('setRichTextContent'), /classList\.add\('rich-text-body'\)/);
    assert.match(functionBody('setRichTextContent'), /classList\.remove\('rich-text-body'\)/);
    const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');
    assert.match(css, /\.rich-text-body > p \{ margin: 0; \}/,
        'without this Tailwind preflight leaves every paragraph flush against the next');
    assert.match(css, /\.rich-text-body ul \{ list-style: disc/,
        'the sanitiser strips Quill list classes, so the markers have to come from here');
    assert.match(css, /\.quiz-review-expl > strong \{/,
        'a <strong> the user typed inside an explanation must not be restyled as the block heading');
    // <p> cannot nest inside <p>, and the rich version of a question is made of <p> elements.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const id of ['q-text', 'tinder-card-q', 'tinder-card-expl', 'cr-preview-q']) {
        assert.match(html, new RegExp('<div id="' + id + '"'), id + ' must be a <div> to hold rich text');
    }
});

test('the plain text stays canonical, and a stale rich copy is dropped rather than rendered', () => {
    // q.q is what search, dedupe, validation, export and the `q.id || q.q` SM2 fallback read, so
    // the Creator must store the plain text there and the markup separately.
    const collect = functionBody('collectFormQuestion');
    assert.match(collect, /splitRichText\(document\.getElementById\('cr-q'\)\.value\)/);
    assert.match(collect, /splitRichText\(document\.getElementById\('cr-expl'\)\.value\)/);
    assert.match(collect, /q: qParts\.plain/);
    assert.match(collect, /qHtml: qParts\.html \|\| undefined/);
    assert.match(collect, /expl: explParts\.plain/);
    assert.match(collect, /explHtml: explParts\.html \|\| undefined/);

    // saveData() re-runs normalizeQuestion() over every customQuestion, so a key it does not
    // copy is erased on the very next save.
    const norm = functionBody('normalizeQuestion');
    assert.match(norm, /qHtml: qHtml \|\| undefined/);
    assert.match(norm, /explHtml: explHtml \|\| undefined/);
    // Legacy rows still hold Quill's HTML in q.q. One cheap regex, false for every already
    // migrated row, so re-running it over the whole bank on each save costs nothing.
    assert.match(norm, /RICH_TAG_RE\.test\(q\)/);
    assert.match(norm, /RICH_TAG_RE\.test\(expl\)/);
    assert.match(norm, /q = split\.plain; qHtml = split\.html;/);
    // The invariant that keeps the field-level merge honest: deepMergeCustomQuestion() spreads
    // the cloud copy and only overwrites keys the local object HAS, so a qHtml the local side
    // deliberately dropped comes back from an older peer - and the rich copy is what renders.
    assert.match(norm, /if \(qHtml && creatorPlainText\(qHtml\) !== q\) qHtml = '';/);
    assert.match(norm, /if \(explHtml && creatorPlainText\(explHtml\) !== expl\) explHtml = '';/);
    assert.match(functionBody('splitRichText'), /creatorPlainText\(html\)/,
        'plain must be derived from the sanitised html, or that invariant fires on good data');

    // Bulk edit shows the plain text in a one-line <input>. It used to show the raw markup and
    // save it back verbatim, which turned "<p>x</p>" into permanent literal text.
    const rows = functionBody('showEditMCQPage');
    assert.match(rows, /value="\$\{escapeCreatorHtml\(creatorPlainText\(q\.q \|\| ''\)\)\}" id="ed-q-/);
    assert.match(rows, /value="\$\{escapeCreatorHtml\(creatorPlainText\(q\.expl \|\| ''\)\)\}" id="ed-expl-/);
    const collectEdits = functionBody('collectEditedMCQs');
    assert.match(collectEdits, /if\(qText\.value !== creatorPlainText\(q\.q \|\| ''\)\) delete q\.qHtml;/);
    assert.match(collectEdits, /delete q\.explHtml;/);

    // Reopening a question in the Creator must hand Quill the markup, and must escape when there
    // is none - a plain question containing "<" would otherwise be parsed as markup on reopen.
    const load = APP_JS.slice(APP_JS.indexOf('const qLoad = '), APP_JS.indexOf('const qLoad = ') + 500);
    assert.match(load, /q\.qHtml \? sanitizeRichText\(q\.qHtml\) : escapeCreatorHtml\(q\.q \|\| ''\)/);
    assert.match(load, /q\.explHtml \? sanitizeRichText\(q\.explHtml\) : escapeCreatorHtml\(q\.expl \|\| ''\)/);
});

test('every off-scale Tailwind shade in index.html is declared in the config', () => {

    // Tailwind only emits a rule for a shade it knows. `dark:text-indigo-455` and
    // `dark:text-slate-350` produced no CSS at all, so the element kept whatever it inherited -
    // no error, no warning, just the wrong colour. The config block exists precisely to back
    // the off-scale shades this markup uses; these two had been added to the markup without it.
    //
    // Scope is index.html. js/app.js builds class strings too and still has its own undeclared
    // shades; widening this test is a separate change.
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const SCALE = new Set([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
    const COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow',
        'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple',
        'fuchsia', 'pink', 'rose'];

    const cfgStart = html.indexOf('tailwind.config');
    const cfgEnd = html.indexOf('boxShadow', cfgStart);
    assert.ok(cfgStart > -1 && cfgEnd > cfgStart, 'the tailwind.config colour block moved - retarget this test');
    const cfg = html.slice(cfgStart, cfgEnd);

    const declared = {};
    for (const c of COLORS) {
        const m = new RegExp(c + '\\s*:\\s*\\{([^}]*)\\}').exec(cfg);
        declared[c] = new Set(m ? [...m[1].matchAll(/(\d+)\s*:/g)].map(x => Number(x[1])) : []);
    }

    const missing = new Set();
    for (const m of html.matchAll(new RegExp('-(' + COLORS.join('|') + ')-(\\d{2,3})\\b', 'g'))) {
        const shade = Number(m[2]);
        if (!SCALE.has(shade) && !declared[m[1]].has(shade)) missing.add(m[1] + '-' + shade);
    }
    assert.deepStrictEqual([...missing], [],
        'these classes render nothing - add them to tailwind.config at index.html:46 or use a ' +
        'shade on the default scale'
    );

    // The two that started this, pinned by name so a config rewrite cannot quietly drop them.
    assert.ok(declared.indigo.has(455) && declared.slate.has(350), 'indigo-455 and slate-350 stay declared');
});

// The hardware back button closed the whole app on one press for weeks. The JS handler was fine;
// @capacitor/app - the plugin that owns Android's OnBackPressedCallback, since Capacitor 5's core
// has no back handling of its own - had been dropped from package.json with the Cap 6 -> 5
// downgrade, so Plugins.App was undefined and the listener never registered. Nothing logged.
test('the back button plugin stays installed, and on the version Capacitor 5 can load', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);

    assert.ok(deps['@capacitor/app'],
        '@capacitor/app is gone from package.json again - without it Android runs its default ' +
        'onBackPressed and a single back press finishes the Activity');
    // Pinned to a 5.x line: a 6.x plugin against Capacitor 5 core is exactly how the Google
    // sign-in "missing initial state" bug was introduced.
    const core = String(deps['@capacitor/core'] || '').replace(/[^\d.]/g, '');
    for (const p of ['@capacitor/app', '@capacitor/status-bar', '@capacitor/haptics']) {
        if (!deps[p]) continue;
        assert.strictEqual(String(deps[p]).replace(/[^\d.]/g, '').split('.')[0], core.split('.')[0],
            p + ' must share a major version with @capacitor/core');
    }

    // cap sync writes the gradle include list (committed) and capacitor.plugins.json (gitignored).
    // Without an entry in both, the plugin's Java class is never registered and the JS handle stays
    // undefined - which is exactly how this failed: installed in npm, invisible to Android.
    const gradle = fs.readFileSync(path.join(ROOT, 'android', 'capacitor.settings.gradle'), 'utf8');
    assert.match(gradle, /include ':capacitor-app'/,
        'run `npx cap sync android` - the App plugin is not in the Android build');

    const pluginsJson = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'capacitor.plugins.json');
    if (fs.existsSync(pluginsJson)) {          // absent on a fresh clone until the first cap sync
        const classpaths = JSON.parse(fs.readFileSync(pluginsJson, 'utf8')).map(r => r.classpath).join(' ');
        assert.match(classpaths, /com\.capacitorjs\.plugins\.app\.AppPlugin/,
            'run `npx cap sync android` - AppPlugin is not registered natively');
        assert.match(classpaths, /GoogleAuth/,
            'the Google sign-in plugin must survive every cap sync');
    }
});
test('one back press runs one cascade, shared by the native and the web caller', () => {
    const defIdx = APP_JS.indexOf('window.krishiHandleBack = function');
    const iifeIdx = APP_JS.indexOf('function initCapacitorNativeFeatures()');
    assert.ok(defIdx > -1, 'window.krishiHandleBack is gone');
    assert.ok(iifeIdx > -1 && defIdx < iifeIdx,
        'krishiHandleBack must stay above initCapacitorNativeFeatures() - that IIFE returns early ' +
        'on web, so anything defined inside it is invisible to the browser back button');

    // The native listener must delegate, not carry its own copy of the cascade.
    const listener = APP_JS.slice(APP_JS.indexOf("AppPlugin.addListener('backButton'"));
    const body = listener.slice(0, listener.indexOf('console.log(\'[BackButton]'));
    assert.match(body, /window\.krishiHandleBack\s*&&\s*window\.krishiHandleBack\(\)/);
    assert.match(body, /AppPlugin\.exitApp\(\)/, 'the double-press exit stays native-only');
    assert.doesNotMatch(body, /quiz-map-modal|nav-bottom-sheet/,
        'the cascade was duplicated back into the listener - the two callers will drift apart');

    // A missing plugin must never be silent again.
    assert.match(APP_JS, /console\.error\('\[BackButton\] @capacitor\/app missing/);

    // Order matters: the Question Map opens on top of live gameplay, so it has to be tested before
    // the exam-exit prompt, and the exam prompt before the plain "go home" branch.
    const cascade = functionBody('krishiHandleBack');
    const at = (s) => { const i = cascade.indexOf(s); assert.ok(i > -1, s + ' left the cascade'); return i; };
    assert.ok(at('quiz-map-modal') < at('.modal-overlay:not(.hidden)'));
    assert.ok(at('.modal-overlay:not(.hidden)') < at('page-mcq'));
    assert.ok(at('page-mcq') < at("navigate('page-home')"));
    assert.match(cascade, /return false;\s*\}?\s*$/,
        'the cascade must end in `return false` - that is how a caller learns back means "leave"');
});
test('the cascade closes the top-most thing and only then reports "leave"', () => {
    const run = new Function('document', 'window', 'navigate', functionBody('krishiHandleBack').slice(1, -1));

    const node = (classes) => {
        const set = new Set(classes || []);
        return { _set: set, classList: {
            contains: c => set.has(c), add: c => set.add(c), remove: c => set.delete(c) } };
    };
    const dom = (o) => {
        const ids = {
            'nav-bottom-sheet': node(o.sheetOpen ? ['sheet-open'] : []),
            'nav-sheet-backdrop': node(['sheet-backdrop-active']),
            'quiz-map-modal': node(o.mapOpen ? [] : ['hidden']),
            'page-mcq': node(o.examLive ? [] : ['hidden'])
        };
        const page = o.activePage ? Object.assign(node(['page', 'active']), { id: o.activePage }) : null;
        const modal = o.modalOpen ? node(['modal-overlay']) : null;
        return { ids, page, modal, doc: {
            getElementById: id => ids[id] || null,
            querySelector: sel => sel.indexOf('.page.active') === 0 ? page
                                : sel.indexOf('.modal-overlay') === 0 ? modal : null
        } };
    };

    // Home, nothing open: the only case where back means leave.
    let d = dom({ activePage: 'page-home' });
    assert.strictEqual(run(d.doc, {}, () => assert.fail('must not navigate')), false);

    // A sub-page goes home instead of leaving.
    d = dom({ activePage: 'page-settings' });
    let went = null;
    assert.strictEqual(run(d.doc, {}, p => { went = p; }), true);
    assert.strictEqual(went, 'page-home');

    // The sheet outranks everything, and its own closer is preferred.
    d = dom({ sheetOpen: true, activePage: 'page-home' });
    let closed = false;
    assert.strictEqual(run(d.doc, { closeNavSheet: () => { closed = true; } }, () => {}), true);
    assert.ok(closed);

    // Mid-exam with the Question Map open: the map closes, and the "exit the exam?" prompt must
    // NOT be the thing the user is shown.
    d = dom({ mapOpen: true, examLive: true, activePage: 'page-practice' });
    let mapBack = false;
    assert.strictEqual(run(d.doc,
        { krishiQuestionMapBack: () => { mapBack = true; },
          confirmExitExam: () => assert.fail('the exam prompt jumped the Question Map') }, () => {}), true);
    assert.ok(mapBack);

    // Same page, map already closed: now the exam prompt is correct, and no navigation happens.
    d = dom({ examLive: true, activePage: 'page-practice' });
    let asked = false;
    assert.strictEqual(run(d.doc, { confirmExitExam: () => { asked = true; } },
        () => assert.fail('an exam must not be dropped without the prompt')), true);
    assert.ok(asked);

    // A plain modal closes by getting .hidden back.
    d = dom({ modalOpen: true, activePage: 'page-home' });
    assert.strictEqual(run(d.doc, {}, () => {}), true);
    assert.ok(d.modal._set.has('hidden'));
});
test('the web half guards with history and never touches the URL', () => {
    const i = APP_JS.indexOf('function initWebBackButton()');
    assert.ok(i > -1, 'initWebBackButton() is gone - browser Back leaves the site again');
    const web = APP_JS.slice(i, APP_JS.indexOf("console.log('[BackButton] Web/PWA"));

    // Native owns the button there; running both would double-handle one press.
    assert.match(web, /isNativePlatform\(\)\)\s*return/);
    assert.match(web, /addEventListener\('popstate'/);
    // A URL argument would put a new path in the address bar, which Hosting would then have to
    // rewrite on reload. Two arguments only.
    assert.match(web, /history\.pushState\(\{[^}]*\},\s*''\s*\)/);
    assert.doesNotMatch(web, /history\.pushState\([^)]*,[^)]*,[^)]*\)/, 'pushState must take no URL');
    // Handled press -> the guard goes straight back, so the user stays put.
    assert.match(web, /krishiHandleBack\(\)\)\s*\{\s*\n\s*pushGuard\(\)/);
    // Unhandled press -> the guard is *not* replaced immediately (that is what lets a second press
    // leave), but it must come back on a timer or the button would stay dead afterwards.
    assert.match(web, /rearm\s*=\s*setTimeout\(function\(\)\s*\{\s*rearm\s*=\s*null;\s*pushGuard\(\);\s*\}/);
    assert.match(web, /pushGuard\(\);\s*$/, 'the guard has to be armed once at startup');
});

// ── Creator ▸ Manage tab ────────────────────────────────────────────────────────
// Every bug below was silent: a mass delete that looked like a filtered one, three delete buttons
// that did nothing at all inside the APK, an undo key written on every delete and never read, and
// a tab counter frozen at 0 since it was written.

test('"Select shown" selects the shown rows, not the whole bank', () => {
    const body = codeOf('selectAllManage');
    // getCustomQuestions() here is the bug: it returns the entire bank regardless of the search
    // box, the subject filter and the chips, so three visible rows selected 500 and the next
    // Delete took the bank.
    assert.doesNotMatch(body, /getCustomQuestions\(\)/,
        'selectAllManage() is back to selecting the whole bank instead of the filtered list');
    assert.match(body, /manageListState\.filtered/);
    // The ticks the user can see come from these checkboxes; a generic input[type=checkbox] sweep
    // would also tick whatever a row's editor happens to contain.
    assert.match(body, /input\[data-role="pick"\]/);
    assert.match(body, /updateManageSelectionBar\(\)/);
});

test('the bulk bar names the selected rows the current filter is hiding', () => {
    const body = functionBody('updateManageSelectionBar');
    // A selection survives a filter change on purpose, so "12 selected" beside three visible ticks
    // has to say where the other nine are - that count is the only warning before a bulk delete.
    assert.match(body, /manageListState\.filtered/);
    assert.match(body, /not shown by this filter/);
    // Ids of questions that no longer exist must not sit in the selection inflating the count.
    assert.match(body, /selectedManageQIds\s*=\s*selectedManageQIds\.filter/);
});

test('the Manage tab counter has a writer, and it runs before the tab is opened', () => {
    const body = functionBody('updateManageCount');
    assert.match(body, /getElementById\('manage-count'\)/,
        'nothing writes #manage-count again - the tab label is back to a hard-coded (0)');
    // Deleted rows are still in customQuestions (soft delete), so the label has to filter them out
    // or it would count the recycle bin as part of the bank.
    assert.match(body, /!q\.deleted/);
    assert.match(functionBody('switchCreatorTab'), /updateManageCount\(\)/);
    assert.match(functionBody('initCreatorPage'), /updateManageCount\(\)/);
});

test('no destructive Manage action goes through native confirm()', () => {
    // confirm() returns false without asking anything inside the Android WebView - the same trap
    // that made the old back button do nothing. Every one of these buttons was dead in the APK,
    // which is the only place the bank is actually managed.
    ['deleteSelectedQuestions', 'dupScanDeleteGroup', 'dupScanDeleteAll', 'restoreAllManageTrash'].forEach(name => {
        const body = codeOf(name);
        assert.doesNotMatch(body, /(^|[^.\w])confirm\s*\(/,
            name + '() is back on native confirm() - the button does nothing in the APK');
        assert.match(body, /manageConfirm\(/, name + '() no longer asks before deleting');
    });
    // And the shared wrapper must not "fall back" to confirm() when the dialog is missing: that
    // would be an invisible no-op on Android, i.e. a delete button that silently does nothing.
    const wrapper = codeOf('manageConfirm');
    assert.doesNotMatch(wrapper, /(^|[^.\w])confirm\s*\(/);
    assert.match(wrapper, /showConfirmDialog/);
    assert.match(wrapper, /showToast\(/, 'a missing dialog must say so, not swallow the action');
});

test('the delete undo snapshot stores ids, and undo flips back exactly those', () => {
    // It used to store a copy of the whole customQuestions array on every bulk delete - hundreds of
    // KB for a real bank - and nothing anywhere ever read the key back.
    const remember = codeOf('rememberManageDelete');
    assert.match(remember, /krishi_last_manage_backup/);
    assert.match(remember, /ids:\s*ids/);
    assert.doesNotMatch(remember, /customQuestions/, 'the undo snapshot is copying the whole bank again');

    const bank = [
        { id: 1, deleted: true },   // deleted by this action -> restored
        { id: 2, deleted: true },   // not in the snapshot     -> left in the bin
        { id: 3, deleted: false }   // in the snapshot but already back -> not re-stamped
    ];
    let saved = 0, written = null;
    const run = new Function('Storage', 'localData', 'hideManageUndoBar', 'showToast', 'saveData',
        'scheduleRenderQuestionList', 'updatePracticePage',
        functionBody('undoManageDelete').slice(1, -1));
    run({ getJSON: () => ({ t: 1, ids: [1, 3] }), setJSON: (k, v) => { written = v; } },
        { customQuestions: bank }, () => {}, () => {}, () => { saved++; }, () => {}, () => {});

    assert.strictEqual(bank[0].deleted, false, 'the deleted question was not restored');
    assert.ok(bank[0].updatedAt > 0, 'a restore has to bump updatedAt or the peer keeps its tombstone');
    assert.strictEqual(bank[1].deleted, true, 'undo restored a question this delete never touched');
    assert.strictEqual(bank[2].updatedAt, undefined, 'an already-restored row was re-stamped for nothing');
    assert.strictEqual(saved, 1);
    // Cleared, so a second Undo tap cannot resurrect rows deleted again in between.
    assert.deepStrictEqual(written && written.ids, []);
});

test('search matches options, explanation, topic and tags - not just the question text', () => {
    const cache = new Map();
    // Both real bodies, so the tag path is exercised rather than stubbed: manageHaystack() calls
    // manageTagsOf(), which routes every tag list through normalizeQuestionTags().
    const normTags = tagNormalizer();
    const tagsOf = new Function('normalizeQuestionTags', 'q',
        functionBody('manageTagsOf').slice(1, -1)).bind(null, normTags);
    const hay = new Function('manageSearchCache', 'manageTagsOf', 'q',
        functionBody('manageHaystack').slice(1, -1)).bind(null, cache, tagsOf);
    const q = {
        id: 7, updatedAt: 100, q: 'Which nutrient is Urea?', sub: 'Soil Science',
        topic: 'Fertilizers', expl: 'Urea carries 46% Nitrogen.',
        opts: ['Potash', '<b>Nitrogen</b>', 'Phosphorus', ''],
        // A string, not an array: that is what a CSV import hands over, and normalizeQuestionTags()
        // is the one place that shape is fixed.
        tags: 'kharif, PSC 2078'
    };
    const s = hay(q);
    // A word you remember a question by usually lives in an option or the explanation. The old
    // cache held q.q alone, so searching for any of these found nothing.
    ['nitrogen', 'phosphorus', 'fertilizers', 'soil science', '46%', 'kharif', 'psc 2078'].forEach(t =>
        assert.ok(s.includes(t), 'the haystack is missing "' + t + '"'));
    assert.ok(!s.includes('<b>'), 'markup leaked into the search text');

    // Fields are newline-joined so a match can never span two of them; terms are split on
    // whitespace, so no single term can contain the separator.
    assert.ok(!s.includes('urea? soil'), 'two fields ran together into one matchable string');

    // Versioned on updatedAt: the inline editor rewrites a question in place, and a plain
    // id -> text cache would keep matching the words the question no longer contains.
    q.q = 'Which nutrient is Potash?';
    q.opts = ['Potash'];
    q.expl = '';
    q.topic = '';
    q.tags = [];
    assert.ok(hay(q).includes('nitrogen'), 'the cache stopped being a cache');
    q.updatedAt = 200;
    const after = hay(q);
    assert.ok(!after.includes('nitrogen'), 'an edited question still matches its old words');
    assert.ok(!after.includes('kharif'), 'a removed tag still matches');
});

test('duplicating a question keeps the plain/HTML pair and cannot collide on id', () => {
    const body = codeOf('duplicateCustomQuestion');
    // `id: Date.now()` collided when two duplicates were made inside the same millisecond, and
    // every id lookup in this tab (edit, delete, restore) then hit whichever came first.
    assert.doesNotMatch(body, /id:\s*Date\.now\(\)\s*,/, 'the duplicate id is back to a bare Date.now()');
    assert.match(body, /id:\s*Date\.now\(\)\s*\+\s*Math\.random\(\)/);
    // normalizeQuestion() blanks a qHtml whose plain projection no longer equals q.q. The old copy
    // appended " (Copy)" to q only, so the duplicate silently lost its formatting on the next save.
    assert.match(body, /splitRichText\(/);
    assert.match(body, /pair\.plain\s*===\s*plain/);
});

test('sorting the Manage list cannot reorder the saved bank', () => {
    // manageListState.filtered is the `all` array itself when nothing is filtered out, and that
    // array is localData.customQuestions - an in-place sort would reorder what gets saved.
    const bank = [{ id: 3, updatedAt: 30 }, { id: 1, updatedAt: 10 }, { id: 2, updatedAt: 20 }];
    const sort = new Function('manageListState', 'repeatCountOf', 'list',
        functionBody('sortManageList').slice(1, -1));
    const out = sort({ sort: 'newest' }, () => 1, bank);
    assert.deepStrictEqual(out.map(q => q.id), [3, 2, 1]);
    assert.deepStrictEqual(bank.map(q => q.id), [3, 1, 2], 'sortManageList() sorted the bank in place');
    assert.deepStrictEqual(sort({ sort: 'oldest' }, () => 1, bank).map(q => q.id), [1, 2, 3]);
});

test('the recycle bin restores and never purges, and the editor keeps every id', () => {
    // `deleted: true` IS the CRDT tombstone the union merge relies on. Splicing a row out of
    // customQuestions would let the peer that still has it hand it straight back on the next sync.
    ['restoreCustomQuestion', 'restoreAllManageTrash', 'toggleManageTrash'].forEach(name => {
        const body = codeOf(name);
        assert.doesNotMatch(body, /\.splice\(|customQuestions\s*=\s*/,
            name + '() is removing rows from the bank - that breaks the delete tombstone');
    });
    // A restore has to bump updatedAt or the peer's tombstone wins and the question disappears again.
    assert.match(codeOf('restoreCustomQuestion'), /deleted\s*=\s*false[\s\S]*updatedAt\s*=\s*Date\.now\(\)/);

    const save = codeOf('saveManageRowEdit');
    // validateCreatorEntry() also runs duplicate detection, which would match the question against
    // itself and refuse every edit. validateImportQuestion() is what saveData() itself uses.
    assert.doesNotMatch(save, /validateCreatorEntry\(/);
    assert.match(save, /validateImportQuestion\(/);
    // Object.assign onto the existing row, never a replacement object: the id is what the SM2
    // engine keys a question's whole review history on.
    assert.match(save, /Object\.assign\(q,\s*draft\)/);
    assert.doesNotMatch(save, /draft\.id/, 'the inline editor is writing an id - that orphans the SM2 record');
    // The pair invariant, applied here rather than left for normalizeQuestion() to notice a save later.
    assert.match(save, /creatorPlainText\(q\.qHtml\)\s*!==\s*draft\.q/);
    assert.match(save, /creatorPlainText\(q\.explHtml\)\s*!==\s*draft\.expl/);

    // normalizeQuestion() resolves the answer from `correctAnswerIndex` before `ans`, so an edit
    // that only writes `ans` is undone by the very next saveData(): the tick moved and reverted
    // on its own. Verified against the real key order in that function.
    const ansKeys = APP_JS.slice(APP_JS.indexOf('let ansKeys = ['), APP_JS.indexOf('];', APP_JS.indexOf('let ansKeys = [')));
    assert.ok(ansKeys.indexOf("'correctAnswerIndex'") < ansKeys.indexOf("'ans'"),
        'the alias no longer outranks ans - this contract can be simplified');
    assert.match(save, /q\.correctAnswerIndex\s*=\s*draft\.ans/,
        'saveManageRowEdit() leaves the stale correctAnswerIndex alias to win on the next save');
});

/**
 * The real normalizeQuestionTags(), with the module-level cap injected as a parameter so this test
 * follows the source instead of hard-coding the number next to it.
 */
function tagNormalizer() {
    const cap = /const\s+MANAGE_TAG_MAX\s*=\s*(\d+)/.exec(APP_JS);
    assert.ok(cap, 'MANAGE_TAG_MAX is gone - update tests/cloud_sync_contract.test.js');
    return new Function('MANAGE_TAG_MAX', 'raw', functionBody('normalizeQuestionTags').slice(1, -1))
        .bind(null, Number(cap[1]));
}

test('tags are coerced to a clean array whatever shape they arrive in', () => {
    const norm = tagNormalizer();
    // The shape that mattered: a CSV column is one string, and `raw.tags || []` handed it straight
    // through - so every reader that does q.tags.forEach rendered one badge per character.
    assert.deepStrictEqual(norm('kharif, PSC 2078'), ['kharif', 'PSC 2078']);
    assert.deepStrictEqual(norm('a;b\nc'), ['a', 'b', 'c']);
    assert.deepStrictEqual(norm(null), []);
    assert.deepStrictEqual(norm(42), []);
    assert.deepStrictEqual(norm(['  weeds  ', '']), ['weeds']);
    // '#weeds' and 'weeds' are one tag: the row badges draw the hash themselves, and a bank holding
    // both spellings could not be filtered by either.
    assert.deepStrictEqual(norm(['#weeds', 'Weeds', 'WEEDS']), ['weeds']);
    // Capped, so one bad import cannot put 400 tags on a row and blow the row layout apart.
    const cap = Number(/const\s+MANAGE_TAG_MAX\s*=\s*(\d+)/.exec(APP_JS)[1]);
    const many = norm(Array.from({ length: cap + 30 }, (_, i) => 't' + i));
    assert.strictEqual(many.length, cap);
    assert.ok(norm(['x'.repeat(400)])[0].length <= 40, 'a single tag is not length-capped');
});

test('normalizeQuestion routes tags through the normaliser and keeps them across a save', () => {
    const body = functionBody('normalizeQuestion');
    // saveData() re-runs normalizeQuestion() over the whole bank, so a key it does not copy is gone
    // on the very next save - the trap that already ate importBatchId and repeatCount.
    assert.match(body, /tags:\s*normalizeQuestionTags\(raw\.tags\)/,
        'normalizeQuestion() is back to trusting raw.tags as-is');
    assert.doesNotMatch(codeOf('normalizeQuestion'), /tags:\s*raw\.tags\s*\|\|\s*\[\]/);
});

test('the Tags column the CSV export writes is a column the CSV import reads back', () => {
    const bundle = codeOf('buildQuestionBundle');
    assert.match(bundle, /Status,Tags/, 'the CSV export dropped its Tags column');
    // Export-then-reimport is the normal backup round trip. Writing a column no importer maps means
    // the file looks complete and silently loses every tag on the way back in.
    const csvIn = codeOf('parseCSVQuestions');
    assert.match(csvIn, /cl === "tags"/, 'parseCSVQuestions() has no mapping for the Tags column');
    assert.match(csvIn, /colMap\.tags !== -1.*raw\.tags = cols\[colMap\.tags\]/s,
        'the mapped Tags column is never read into the row');
});

/** The real commitManageBulkEdit(), with every global it touches injected and recorded. */
function bulkCommitter(brokenIds) {
    const broken = new Set(brokenIds || []);
    const log = { saved: 0, closed: 0, toasts: [], cache: new Map() };
    log.cache.set('seed', 1);
    const raw = new Function(
        'manageTagsOf', 'normalizeQuestionTags', 'manageSearchCache', 'manageIssuesOf',
        'closeManageBulkEdit', 'saveData', 'scheduleRenderQuestionList', 'updateManageSelectionBar',
        'showToast', 'updatePracticePage', 'picked', 'patch',
        functionBody('commitManageBulkEdit').slice(1, -1));
    const norm = tagNormalizer();
    const tagsOf = new Function('normalizeQuestionTags', 'q',
        functionBody('manageTagsOf').slice(1, -1)).bind(null, norm);
    log.run = (picked, patch) => raw(
        tagsOf, norm, log.cache,
        q => (broken.has(q.id) ? ['Needs 2 options.'] : []),
        () => { log.closed++; }, () => { log.saved++; }, () => {}, () => {},
        m => log.toasts.push(String(m)), () => {}, picked, patch);
    return log;
}

const KEEP = { sub: '', diff: '', status: '', topic: '', clearTopic: false, tags: [], tagMode: 'add' };

test('bulk edit writes the subject alias, never blanks sub, and leaves the question body alone', () => {
    const code = codeOf('commitManageBulkEdit');
    // normalizeQuestion() resolves the subject from `sub` but regenerates `subject` from it, and any
    // reader between this write and the next saveData() sees whichever of the two was not updated.
    assert.match(code, /q\.sub\s*=\s*patch\.sub/);
    assert.match(code, /q\.subject\s*=\s*patch\.sub/, 'bulk edit leaves the stale subject alias behind');
    // Only written when patch.sub is truthy: normalizeQuestion() falls back to raw.topic when sub is
    // empty, so a blank subject silently re-files every question under its own topic.
    assert.match(code, /if\s*\(patch\.sub\)/);
    // The fields that are per-question by nature. A bulk write over the text, the options or the
    // answer index is only ever a mistake, and there is no undo strip for an edit.
    [[/q\.q\s*=/, 'question text'], [/q\.opts\s*=/, 'options'], [/q\.ans\s*=/, 'answer index'],
     [/q\.correctAnswerIndex\s*=/, 'answer alias'], [/q\.qHtml\s*=/, 'rich text']].forEach(pair =>
        assert.doesNotMatch(code, pair[0], 'bulk edit writes a per-question field: ' + pair[1]));
});

test('bulk edit only writes the fields that were not left on "keep"', () => {
    const log = bulkCommitter();
    const q = { id: 1, q: 'Q', opts: ['a', 'b'], ans: 1, sub: 'Agronomy', topic: 'Weeds',
                difficulty: 'Hard', status: 'draft', marks: 2, tags: ['old'], updatedAt: 5 };
    log.run([q], Object.assign({}, KEEP));
    assert.deepStrictEqual(
        { sub: q.sub, topic: q.topic, difficulty: q.difficulty, status: q.status, tags: q.tags },
        { sub: 'Agronomy', topic: 'Weeds', difficulty: 'Hard', status: 'draft', tags: ['old'] },
        'an all-keep apply still rewrote fields');
    assert.strictEqual(q.ans, 1);
    assert.strictEqual(q.marks, 2);
    // updatedAt still moves: it is what the CRDT merge and both memo signatures key on.
    assert.ok(q.updatedAt > 5, 'updatedAt did not move, so the cloud merge cannot see this edit');
    assert.strictEqual(log.saved, 1);
    assert.strictEqual(log.closed, 1, 'the bulk form was left open over a finished apply');
    assert.ok(!log.cache.has(1), 'the search index kept its stale entry for the edited row');
});

test('the three bulk tag modes add, replace and remove without duplicating case variants', () => {
    const seed = () => [{ id: 1, tags: ['Kharif', 'formula'], sub: 'A' },
                        { id: 2, tags: [], sub: 'A' }];
    const add = seed();
    bulkCommitter().run(add, Object.assign({}, KEEP, { tags: ['KHARIF', 'PSC 2078'], tagMode: 'add' }));
    // Add is a union, not a concat: the same tag in another case must not land twice.
    assert.deepStrictEqual(add[0].tags, ['Kharif', 'formula', 'PSC 2078']);
    assert.deepStrictEqual(add[1].tags, ['KHARIF', 'PSC 2078']);

    const rep = seed();
    bulkCommitter().run(rep, Object.assign({}, KEEP, { tags: ['only'], tagMode: 'replace' }));
    assert.deepStrictEqual(rep[0].tags, ['only'], 'replace kept the old tags');
    assert.deepStrictEqual(rep[1].tags, ['only']);

    const rem = seed();
    bulkCommitter().run(rem, Object.assign({}, KEEP, { tags: ['kharif'], tagMode: 'remove' }));
    assert.deepStrictEqual(rem[0].tags, ['formula'], 'remove is case sensitive');
    assert.deepStrictEqual(rem[1].tags, []);

    // An empty tag box is "keep", never "clear all" - the mode select stays set from the last apply.
    const none = seed();
    bulkCommitter().run(none, Object.assign({}, KEEP, { tags: [], tagMode: 'replace' }));
    assert.deepStrictEqual(none[0].tags, ['Kharif', 'formula'], 'an empty tag box wiped the tags');
});

test('bulk edit clears a topic only when asked, and clearing outranks a typed topic', () => {
    const a = { id: 1, topic: 'Weeds', sub: 'A', tags: [] };
    bulkCommitter().run([a], Object.assign({}, KEEP, { topic: 'Seeds' }));
    assert.strictEqual(a.topic, 'Seeds');
    const b = { id: 2, topic: 'Weeds', sub: 'A', tags: [] };
    bulkCommitter().run([b], Object.assign({}, KEEP, { topic: 'Seeds', clearTopic: true }));
    assert.strictEqual(b.topic, '', 'the clear checkbox lost to the leftover text in the input');
    // Blanking the topic must not reach `sub`: normalizeQuestion() falls back to raw.topic for the
    // subject, so a question with neither would be re-filed under "General".
    assert.strictEqual(b.sub, 'A');
});

test('bulk edit counts the demotions saveData() is about to make, before it saves', () => {
    const code = codeOf('commitManageBulkEdit');
    const issues = code.indexOf('manageIssuesOf');
    const save = code.indexOf('saveData()');
    assert.ok(issues > -1 && save > -1 && issues < save,
        'the demote count is read after saveData(), which has already re-stamped status');
    const log = bulkCommitter([2]);
    const picked = [{ id: 1, status: 'draft', sub: 'A', tags: [] },
                    { id: 2, status: 'draft', sub: 'A', tags: [] }];
    log.run(picked, Object.assign({}, KEEP, { status: 'published' }));
    const msg = log.toasts.join(' ');
    assert.match(msg, /2 question\(s\) updated/);
    // saveData() re-stamps status='revision' on anything validateImportQuestion rejects, so a silent
    // toast here reads as "the bulk edit did nothing" when the row snaps back on the next render.
    assert.match(msg, /1 still/, 'the invalid row was promoted with no warning');
    const clean = bulkCommitter();
    clean.run([{ id: 1, status: 'draft', sub: 'A', tags: [] }],
        Object.assign({}, KEEP, { status: 'published' }));
    assert.doesNotMatch(clean.toasts.join(' '), /still/, 'a clean promote still warned about demotions');
});

test('selection export shares the download builder and ships only the picked ids', () => {
    const code = codeOf('exportSelectedManageQuestions');
    // Must go through the shared builder: a second inline CSV/JSON writer drifts from the importer,
    // and the old hand-rolled one never revoked its object URL.
    assert.match(code, /downloadQuestionBundle\(/, 'selection export hand-rolls its own blob');
    assert.match(code, /selectedManageQIds\.includes\(q\.id\)/, 'export ignores the selection');
    assert.match(code, /if\s*\(!picked\.length\)/, 'exporting an empty selection writes an empty file');
    assert.match(codeOf('downloadQuestionBundle'), /revokeObjectURL/, 'the export blob is never freed');
    // The CSV header and the row builder must stay the same length or every column shifts by one.
    const bundle = codeOf('buildQuestionBundle');
    const header = /'(Question,[^']*)'/.exec(bundle);
    assert.ok(header, 'the CSV header literal moved - update tests/cloud_sync_contract.test.js');
    const cols = header[1].split(',').length;
    const row = /const row = \[([\s\S]*?)\]\.map/.exec(bundle);
    assert.ok(row, 'the CSV row builder moved - update tests/cloud_sync_contract.test.js');
    // Blank out string literals first: one of the cells is `.join(', ')`, whose comma is not a separator.
    const cells = row[1].replace(/'(?:[^'\\]|\\.)*'/g, "@")
        .split(',').filter(s => s.trim()).length;
    assert.strictEqual(cells, cols, 'the CSV row has ' + cells + ' cells for ' + cols + ' headers');
});

/** The real manageHealthStats(), memo kept alive across calls in a closure. */
function healthStats(bank, calls) {
    const norm = tagNormalizer();
    const tagsOf = new Function('normalizeQuestionTags', 'q',
        functionBody('manageTagsOf').slice(1, -1)).bind(null, norm);
    const factory = new Function('localData', 'manageIssuesOf', 'manageHasExplanation',
        'repeatCountOf', 'manageTagsOf',
        'let _manageHealthCache = {}; return function()' + functionBody('manageHealthStats') + ';');
    return factory({ customQuestions: bank },
        q => { calls.issues++; return q._broken ? ['Needs 2 options.'] : []; },
        q => !q._noexpl,
        q => q._repeat || 1,
        tagsOf);
}

test('bank health counts overlapping problems once and reads "clean" as the AND of them', () => {
    const bank = [
        { id: 1, sub: 'Agronomy', topic: 'T', marks: 2, _broken: true },
        { id: 2, sub: 'Agronomy', topic: 'T', _noexpl: true },
        { id: 3, sub: 'Soil', topic: 'T', _broken: true, _noexpl: true },
        { id: 4, sub: 'Soil', topic: 'T', tags: ['kharif'] },
        { id: 5, sub: 'Soil', deleted: true, _broken: true },
        { id: 6, status: 'draft', _repeat: 3, marks: 0 },
        null,
    ];
    const calls = { issues: 0 };
    const st = healthStats(bank, calls)();
    assert.deepStrictEqual({
        total: st.total, binned: st.binned, fix: st.fix, noexpl: st.noexpl, clean: st.clean,
        draft: st.draft, repeat: st.repeat, tagged: st.tagged, notopic: st.notopic,
        marks: st.marks, score: st.score,
    }, {
        // q3 is broken AND unexplained, so the chips add up to 4 over 5 live questions: `clean` has to
        // be counted in the same pass or the readiness score reads 20% instead of 40%.
        total: 5, binned: 1, fix: 2, noexpl: 2, clean: 2,
        draft: 1, repeat: 1, tagged: 1, notopic: 1, marks: 6, score: 40,
    });
    assert.deepStrictEqual(st.bySub, [['Agronomy', 2], ['Soil', 2], ['General', 1]],
        'per-subject bars must be biggest-first, alphabetical on a tie, and skip the bin');
});

test('bank health memoises on the bank signature, not on the render', () => {
    // renderQuestionList() runs this on every keystroke in the search box, and it walks the whole bank
    // through validateImportQuestion. Without the memo a 4,000-question bank retypes as a freeze.
    const bank = [{ id: 1, sub: 'A', updatedAt: 10 }, { id: 2, sub: 'A', updatedAt: 20 }];
    const calls = { issues: 0 };
    const stats = healthStats(bank, calls);
    const first = stats();
    assert.strictEqual(calls.issues, 2);
    assert.strictEqual(stats(), first, 'the second call rebuilt the stats object');
    assert.strictEqual(calls.issues, 2, 'the memo re-validated the bank anyway');
    // An edit has to invalidate it: the stats object is also the identity renderManageHealth() diffs on.
    bank[1].updatedAt = 21;
    assert.notStrictEqual(stats(), first, 'an edited question left the health card showing stale counts');
    bank.push({ id: 3, sub: 'A', updatedAt: 21 });
    const grown = stats();
    assert.strictEqual(grown.total, 3, 'a new question did not invalidate the memo');
});

test('the bulk edit form cannot outlive the selection it writes to', () => {
    const bar = codeOf('updateManageSelectionBar');
    assert.match(bar, /if\s*\(!show\s*&&\s*manageListState\.bulk\)\s*closeManageBulkEdit\(\)/,
        'an emptied selection leaves the bulk form open, so Apply hits rows nobody has ticked');
    assert.match(bar, /refreshManageBulkEditCount\(n\)/,
        'the "Apply to N" labels are not refreshed when the selection changes size');
    // Refresh, not rebuild: a rebuild between two keystrokes would eat the tags the user is typing.
    assert.doesNotMatch(codeOf('refreshManageBulkEditCount'), /buildManageBulkEditForm/);
    assert.match(codeOf('refreshManageBulkEditCount'), /data-bulk-count/);
    // Trash mode shows other people's rows by id; a bulk apply there would write to the wrong bank.
    assert.match(codeOf('toggleManageTrash'), /closeManageBulkEdit\(\)/);
    assert.match(codeOf('openManageBulkEdit'), /manageListState\.trash/);
});
