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

test('every compressed field is decoded again on the way in', () => {
    const merge = functionBody('mergeCloudAndLocalData');

    // Two decode shapes exist on purpose: array-shaped fields share a loop that also
    // coerces with Array.isArray(), and sm2 is decoded on its own because it is a map.
    const arrayList = merge.match(/\[([^\]]*)\]\.forEach\(field => \{\s*\r?\n\s*decodeCompressed/);
    assert.ok(arrayList, 'the array-shaped decode loop was restructured - update this test');
    const loopFields = arrayList[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));

    compressedCloudFields().forEach(field => {
        const decoded = loopFields.includes(field) ||
            new RegExp('decodeCompressed\\(\\s*[\'"]' + field + '[\'"]').test(merge);
        assert.ok(decoded,
            field + ' is compressed on write but never decoded in mergeCloudAndLocalData(). ' +
            'The merge would then read a compressed string: `{ ...aString }` does not throw, ' +
            'it silently yields {0:"a",1:"b",...} and that gets written down as the ' +
            'user\'s data.');
    });

    // sm2 is a map, not an array, so it must not be swept into the array coercion: the
    // Array.isArray() guard there would replace a decoded schedule with [].
    assert.ok(!loopFields.includes('sm2'),
        'sm2 is an object keyed by question id. Coercing it with Array.isArray() blanks the ' +
        'whole review schedule.');
    assert.match(merge, /decodeCompressed\(\s*'sm2'\s*,\s*'\{\}'\s*\)/,
        'sm2 must decode with an object fallback - \'[]\' would hand the sm2 union an array.');
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
    // eslint-disable-next-line no-new-func
    new Function('local', 'cloud', 'merged', 'mergeCRDTLogs', src)(
        localState, cloudState, merged, crdt
    );
    return merged;
}

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

    assert.match(body, /practice-active-state-panels/, 'the live-quiz panel is the primary signal');
    assert.match(body, /practice-result-panel/,
        'the summary screen is reachable with the panels still up; syncing there is correct ' +
        'and must not be deferred');
    assert.match(body, /isFinishing/,
        'a session already finishing is not a live question - deferring its final write is ' +
        'exactly the write that matters most');

    assert.doesNotMatch(body, /\bquizVisible\(|\bliveSession\(|\bresultsVisible\(/,
        'those helpers live inside the IIFE at js/app.js:22514 and are not in scope here. ' +
        'Calling one would throw a ReferenceError inside the debounce timer, where nothing ' +
        'catches it - the sync would simply stop.');
});

// ── Every reader of a now-compressed field must be type-guarded ──────────────────

test('the cloud-vault restore will not hand a compressed sm2 to the engine', () => {
    const body = functionBody('restoreFromCloudVault');
    const line = (body.split(/\r?\n/).find(l => l.includes('KrishiSM2Engine._saveData')) || '');
    assert.ok(line, 'the vault restore no longer writes sm2 - update this test');
    assert.match(line, /typeof d\.sm2 === 'object'/,
        'the vault stores collectAllAppData() raw, so d.sm2 is an object today - but sm2 is now ' +
        'on COMPRESSED_CLOUD_FIELDS, and _saveData() does not validate. Passing the compressed ' +
        'string would replace the entire review schedule with it, and nothing would throw.');
    assert.match(line, /!Array\.isArray\(d\.sm2\)/,
        'an array would be written down as a schedule keyed 0,1,2...');
});

test('a cloud sm2 of the wrong shape is normalised, not spread', () => {
    const merge = functionBody('mergeCloudAndLocalData');
    const guardAt = merge.indexOf("decodeCompressed('sm2'");
    assert.ok(guardAt > -1, "the sm2 decode moved - update this test");
    const guard = merge.slice(guardAt, guardAt + 400);

    assert.match(guard, /Array\.isArray\(cloud\.sm2\)/,
        'the union at merged.sm2 spreads cloud.sm2. An array spreads to {0:...,1:...} and a ' +
        'decode that returned one - from a peer that wrote the field as a list, or a truncated ' +
        'blob - would be written down as the schedule.');
    assert.match(guard, /cloud\.sm2 = \{\}/, 'the fallback has to be an object, matching the union');
    assert.ok(merge.indexOf('...(cloud.sm2') > guardAt,
        'the guard must run BEFORE the union reads cloud.sm2, or it guards nothing');
});
