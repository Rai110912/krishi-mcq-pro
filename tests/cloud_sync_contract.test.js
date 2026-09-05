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

