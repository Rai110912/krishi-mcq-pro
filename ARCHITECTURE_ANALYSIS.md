# Krishi MCQ Pro — Architecture & Codebase Analysis

> **Read-only analysis.** No code was modified, refactored, or generated to produce this document. It is a mental model of the entire application, intended to be reused so future work needs no re-explanation.
>
> **Analyst role:** Senior Software Architect + Codebase Analyst + Debugging Lead.
> **Date of analysis:** 2026-08-22.
> **Primary concern flagged by owner:** historical *sync popups* and *UI flickering* — traced end-to-end in Sections 6 & 7.

---

## How to read this document

Every non-trivial conclusion is tagged with a confidence label:

- **[CONFIRMED]** — read directly from the code; cited by file (and function/line where stable).
- **[LIKELY]** — strongly implied by the code but depends on runtime conditions I could not execute.
- **[UNCERTAIN]** — needs verification before you act on it; I tell you exactly how to verify.

### ⚠️ Critical caveat about line numbers

`js/app.js` (~16,500 lines) **was being actively edited during this analysis.** Observed line numbers drifted by ~180 lines between reads, and several root-cause candidates I identified early were fixed in real time, with new code comments matching the diagnoses. Therefore:

- **Function/behaviour citations are reliable.** I cite by *function name* and *code pattern*, which are stable.
- **Line numbers are point-in-time ("as-of-read") and may already be stale.** Re-locate by symbol search, not by line, before editing.
- Where I say a bug is "already fixed," that means the current on-disk file already contains the fix — verify it still does before relying on it.

---

## 1. Executive Summary

**[CONFIRMED]** Krishi MCQ Pro (`package.json` name `krishi-mcq-pro`) is a **bilingual (Nepali/English) offline-first MCQ exam-prep app** for the Nepali Civil Service **Agriculture (कृषि)** exam. It is built as a **vanilla-JavaScript Progressive Web App wrapped with Capacitor 5.7** for native Android/iOS packaging — *not* Flutter, React, or any SPA framework. UI is a single HTML document (`index.html`) whose `.page` sections are shown/hidden by a `navigate(pageId)` router; styling is Tailwind loaded locally (`js/libs/tailwindcss.js`).

**[CONFIRMED]** The canonical web root is the **project root directory** (`capacitor init … --web-dir=.` in `package.json`), so `index.html`, `sw.js`, and `js/` at the root are the live app. Any `www/` or `android/` copies are build artifacts, not the source of truth.

**[CONFIRMED]** The app is architecturally ambitious for a vanilla-JS project. It includes: a full **Firestore-based multi-device cloud sync layer** with CRDT-style last-write-wins merge logs, end-to-end encryption, device presence/handoff, and PIN pairing; a **FSRS spaced-repetition engine** (branded "SM2"); a **multi-tier storage stack** (in-memory cache → Web Worker + IndexedDB → localStorage fallback, plus native SQLite); a **centralized animation orchestrator** with priority/dedup/accessibility handling; and a **procedural Web-Audio ambient sound engine**.

**[CONFIRMED]** The **voice assistant has been fully removed.** `js/voice_assistant.js` is a 9-line no-op stub; `app.js` and `index.html` contain zero references to any speech API. See Section 9.

### Health snapshot

- **Sync subsystem (the flicker/popup concern):** **[CONFIRMED]** The most severe historical bugs are **already fixed in the current file** — a `ReferenceError` that silently killed manual "Sync Now" (`cloudC` undeclared), a latched `syncInProgress` flag, a whole-payload echo push-back, a "multi-render storm," an undefined-key E2EE decrypt crash, and an `index.html` cache-wipe-on-every-load. I also verified that `initCloudSync()` is **idempotent**, which clears the "stacked listeners" theory outright. **[LIKELY]** Residual candidates are milder and localized: a now-reachable-for-the-first-time conflict modal, a per-snapshot `innerHTML` rebuild of the device list, a doubled `updateSyncUI()` call per snapshot, and a boot-time storage race. Full detail in Sections 6 & 10.
- **Animation system:** **[CONFIRMED]** Generally well-engineered and defensive (RAF self-termination, `document.hidden` guards, dpr caps, accessibility tiers). Overwhelmingly **KEEP**. One **FIX-LATER**: two 3D widgets leak `window` listeners on re-render. Section 8.
- **Storage:** **[CONFIRMED]** Robust, with migration and incognito fallbacks. One **[LIKELY]** boot-race window. Section 5.
- **Technical debt:** the removed voice feature's dead script/stub; two parallel storage-wrapper abstractions; `app.js` monolith size. Section 11.

**Bottom line:** This is a mature, feature-dense codebase whose highest-risk area (sync-driven UI churn) has been the subject of recent, targeted fixes. The remaining risks are lower-severity and well-localized. Recommended work order is in Section 13; pre-flight verification checklist in Section 14.

---

## 2. Architecture Map

### 2.1 Runtime shape [CONFIRMED]

```
Capacitor native shell (Android/iOS)  ──wraps──▶  WebView
                                                    │
                                          index.html (single document)
                                                    │
        ┌───────────────────────────────────────────┼───────────────────────────────────────────┐
        │                                            │                                           │
   Presentation                                Application logic                            Persistence
   .page divs                                  js/app.js (~16.5k lines)                     KrishiStorage (idb)
   navigate(pageId)                            + pwa_helpers.js (SM2/FSRS)                   Web Worker + IndexedDB
   Tailwind (local)                            + module scripts (below)                     localStorage (fallback)
   Lucide icons                                                                             KrishiSQLite (native)
        │                                            │                                           │
        └───────────── AnimationOrchestrator ◀───────┤                                    Service Worker (sw.js)
                        (event-driven)               │                                     offline cache
                                                     ▼
                                          Firebase compat SDK
                                    (app / auth / firestore / database)
                                                     │
                                        Firestore: users/{uid} + subcollections
                                        (sync, presence, handoff, active_session)
```

### 2.2 Script load order & module boundaries [CONFIRMED — from `index.html`]

The app is composed of one giant core (`js/app.js`) plus focused sidecar modules, each attaching to `window.*`:

| Module file | Global(s) exposed | Responsibility |
|---|---|---|
| `js/app.js` | hundreds (router, sync, MCQ engine, pages) | Core application. Monolith. |
| `js/pwa_helpers.js` | `KrishiSM2Engine`, PWA helpers | Spaced-repetition (FSRS) engine, install/PWA glue. |
| `js/krishi_idb.js` | `KrishiStorage` | Synchronous-facade storage over a Web Worker + IndexedDB. |
| `js/krishi_worker.js` | (worker) | IndexedDB read/write off the main thread. |
| `js/sqlite_db.js` | `KrishiSQLite`, `OfflineQueue` | Native SQLite question store + offline sync queue. |
| `js/animation_orchestrator.js` | `AnimationOrchestrator` | Central animation dispatch (priority/dedup/a11y). |
| `js/lottie_adapter.js` | `LottieAdapter` | Lottie playback with validation + CSS fallback. |
| `js/elite_animations_controller.js` | `EliteAnimsConfig`, FPS engine | User-tunable visual config, FPS auto-throttle, haptics. |
| `js/elite_3d_engine.js` | `Elite3D`, `init3D*` | Canvas 3D widgets (crop growth, syllabus dome, season carousel). |
| `js/canvas_charts.js` | chart draw fns | Growth curve, radar, heatmap, water-wave, neural map. |
| `js/spatial_minimap.js` | (IIFE) | Floating section-nav HUD on the Practice page. |
| `js/ambient_player.js` | `ambient*`, `KrishiAmbientSounds` | Procedural Web-Audio study sounds. |
| `js/voice_assistant.js` | `toggleVoiceAssistant` … | **Stub only** — feature removed. |
| `js/firebase-*-compat.js` | `firebase` | Firebase compat SDK (app/auth/firestore/database). |
| `js/libs/*` | Tailwind, Lucide, QRCode, html5-qrcode, lz-string, lottie | Vendored libraries. |

**[CONFIRMED]** Communication between core and sidecars is via `window.*` globals and `CustomEvent`s (e.g. `krishi-question-rendered`, `krishi-answer-checked`, `krishi-quiz-finished`, `elite-animations-config-updated`, `animOrchestrator:cleanup`). This is loose coupling by global namespace — flexible but with no static guarantees that a global exists when called (most call sites use `typeof window.fn === 'function'` guards, which is the correct defensive pattern here).

### 2.3 Data stores [CONFIRMED]

- **Client:** IndexedDB (`KrishiAppDB` / `krishi_keyvalue`, via worker) is the primary local KV store; `localStorage` is migration source + incognito fallback; native SQLite (`KrishiQuestionsDB`) holds imported question banks on device; the Service Worker cache holds the offline app shell.
- **Cloud:** Firestore `users/{uid}` document holds the synced payload, with subcollections `sessions/{sessionId}` (presence), `active_session/progress` (live handoff), and device/handoff signaling docs.

---

## 3. Feature Map

**[CONFIRMED]** unless noted. Features are grouped by user-facing area.

### Practice & Assessment
- **MCQ practice sessions** — configurable by subject/difficulty/count; per-question and whole-session timers.
- **Mock exams** — timed, weighted scoring with a negative-marking penalty (0.2 factor observed in `finishSession()`).
- **Spaced repetition** — FSRS scheduler (`KrishiSM2Engine`) records each non-mock answer; drives review scheduling.
- **Confidence capture** — auto-derived from reaction time (<3s High, <5s Medium, else Low) in `renderMCQ()`.
- **Bookmarks & "wrong" review** — CRDT-tracked sets with add/remove logs (Section 6).
- **Custom questions** — user-authored questions stored in IndexedDB (`KrishiDB`), merged field-by-field on sync.
- **Question import** — PDF.js / Tesseract OCR / Quill pipeline (lazy-loaded) for building question banks; native SQLite storage.

### Progress & Analytics
- **Stats & progression** — solved/correct counters, XP, levels; delta-counter model against a baseline (Section 5/6).
- **Streaks** — per-day activity map.
- **Analytics visualizations** — growth curve, subject radar, 105-day heatmap calendar, "neural mindmap," 3D crop-growth/syllabus-dome/seasonal-carousel (Section 8).

### Sync & Multi-device
- **Cloud sync** — Firestore real-time (`onSnapshot`) with CRDT LWW merge; anonymous-auth fallback.
- **End-to-end encryption** — AES-GCM with PBKDF2 key derivation for the synced payload.
- **Device presence & handoff** — see who's online; hand off an active session between devices.
- **PIN pairing** — link devices; QR code generated in the sync UI.
- **Midnight vault backups** — periodic cloud snapshot.
- **Offline queue** — mutations captured offline (`sqlite_db.js`) and drained on reconnect.

### Ambience & UX
- **Ambient study sounds** — 9 procedurally synthesized soundscapes + custom URL, sleep timer (`ambient_player.js`).
- **Animation system** — centralized orchestrator; Lottie-or-CSS feedback; user-tunable visual intensity; FPS auto-throttle; haptics.
- **Theming** — light/dark, adjustable card opacity/glassmorphism.
- **Settings** — segmented tabs (General / Visuals / Sound), accordions (Gemini / Sync / Backup).

### Removed / inactive
- **Voice assistant & hands-free exam** — **[CONFIRMED] fully removed**; stub file only (Section 9).

---

## 4. File Responsibility Map

**[CONFIRMED]** All paths relative to the project root (which is the Capacitor web root).

### Root
| File | Lines (approx) | Responsibility | Notes |
|---|---|---|---|
| `index.html` | ~3,500 | Single-document UI: 17 `.page` sections, ~20 overlay/modal containers, settings accordions, script tags. Also contains the SW update-check block. | Lines 22–36 hold the SW update logic; a prior bug (hardcoded `agriculture-exam-v63` cache prefix that deleted the app's own live cache on every load) is **already removed**. |
| `sw.js` | — | Service Worker: offline app-shell cache, background-sync trigger messaging. | **[CONFIRMED]** exists at root; the `./sw.js` registration in `app.js` therefore resolves correctly. |
| `package.json` | — | `name: krishi-mcq-pro`, `main: js/app.js`, `@capacitor/core ^5.7.0`; `capacitor:init` uses `--web-dir=.`. | This is the proof that **root is canonical**. |

### `js/` — application code
| File | Lines | Responsibility |
|---|---|---|
| `app.js` | ~16,540 | **Monolith core.** Router (`navigate`), page renderers, MCQ engine, session/timer logic, all Firebase sync (init/listeners/merge/push), stats & progression, bookmarks, settings, import pipeline, SW registration, ambient background canvas, batched render dispatcher. |
| `pwa_helpers.js` | — | `KrishiSM2Engine` — FSRS-based spaced repetition (name says SM2, algorithm is FSRS); PWA install/update helpers. |
| `krishi_idb.js` | 168 | `KrishiStorage`: synchronous-looking KV facade (Map cache) backed by a Web Worker + IndexedDB, with localStorage migration and incognito fallback. |
| `krishi_worker.js` | 124 | The IndexedDB worker: `init` / `set` / `remove` / `clear` on `KrishiAppDB → krishi_keyvalue` (keyPath `key`). |
| `sqlite_db.js` | 268 | `KrishiSQLite` (native-only, Capacitor plugin; table `questions`, indices on subject and sub+difficulty) + `OfflineQueue` (localStorage-backed, drains on `online`). Explicitly a **parallel** module — does not replace the `questions.json` flow. |
| `animation_orchestrator.js` | 674 | `AnimationOrchestrator`: event types, 5 priority tiers, dedup windows, queue with expiry, conflict rules, accessibility levels, 6s safety timeouts, global cancel. Frozen object. |
| `lottie_adapter.js` | 123 | `LottieAdapter.play(assetId)` → validates asset (HTTP + JSON shape + layers/dimensions), returns `true` if Lottie took over, `false` to force caller's CSS fallback. Respects perf/a11y settings. |
| `elite_animations_controller.js` | 341 | `EliteAnimsConfig` persistence, app-opacity/glassmorphism CSS variables, dark-mode MutationObserver, haptic intensity wrapper, **FPS auto-throttle engine**, settings tab switcher, tuning-panel UI sync. |
| `elite_3d_engine.js` | 571 | `Elite3D` rotation/projection math + three canvas widgets: `init3DCropGrowthSandbox`, `init3DSyllabusDome`, `init3DSeasonalCarousel`. Drag-to-rotate with auto-spin resume. |
| `canvas_charts.js` | 475 | `drawGrowthChart`, `drawRadarChart`, `drawHeatmapCalendar`, `animateWaterWave`, `drawNeuralMap`. Extracted out of `app.js` (stubs/comments remain there noting the move). |
| `spatial_minimap.js` | 160 | Floating right-side section-navigation HUD for the Practice page: 5 anchors, IntersectionObserver highlighting, MutationObserver visibility, smooth warp-scroll. |
| `ambient_player.js` | 612 | Procedural Web-Audio ambient engine: 9 synthesized soundscapes + custom URL loader, per-sound gain, sleep timer with 60-step fade, persisted active-state, settings-grid renderer. |
| `voice_assistant.js` | 9 | **Dead stub.** All exports are empty functions / `null`. |
| `firebase-app-compat.js`, `firebase-auth-compat.js`, `firebase-firestore-compat.js`, `firebase-database-compat.js` | vendored | Firebase compat SDK, self-hosted (offline-capable install). |

### `js/libs/` — vendored third-party
`tailwindcss.js`, `lucide.js`, `qrcode.min.js`, `html5-qrcode.min.js`, `lz-string.min.js`, `lottie.min.js`. **[CONFIRMED]** All local — no CDN dependency at runtime, consistent with the offline-first goal.

---

## 5. Data Flow

### 5.1 Storage layering [CONFIRMED — `krishi_idb.js`, `krishi_worker.js`, `app.js`]

There are **four distinct persistence paths**, and knowing which one a given write takes matters for debugging:

```
app code
   │  KrishiStorage.getItem/setItem      ← synchronous API, never awaits
   ▼
in-memory Map cache  ──postMessage──▶ krishi_worker.js ──▶ IndexedDB (KrishiAppDB)
   │
   └─ if worker unavailable (incognito / IDB blocked) ──▶ localStorage directly

app code (batched)
   │  Storage.* wrapper in app.js (requestIdleCallback batching)
   ▼
   (delegates down to KrishiStorage)

custom questions ──▶ KrishiDB (separate IndexedDB)
imported banks   ──▶ KrishiSQLite (native only)
offline mutations──▶ OfflineQueue (localStorage: krishi_offline_sync_queue)
```

**[CONFIRMED]** `KrishiStorage.getItem()` reads *only* the in-memory Map (`krishi_idb.js` line ~135: `return cache.has(key) ? cache.get(key) : null;`). It is synchronous by design so it can be a drop-in for `localStorage`.

**[CONFIRMED]** `init()` (line ~65) hydrates that Map from IndexedDB via the worker, then migrates any surviving `krishi_*` localStorage keys into IDB and deletes them from localStorage (freeing the 5 MB quota). `touchedKeys` and `isCleared` guard against writes that land *during* the async init so hydration can't clobber newer values. A 3-second worker timeout prevents indefinite hangs.

**[LIKELY — boot race]** Any `getItem` executed **before** `init()` resolves returns `null` even when data exists in IndexedDB. Since `init()` awaits a `postMessage` round trip, this window is real. Consequences would look like "settings/stats momentarily appear as defaults on cold start," which is exactly the class of symptom that produces first-paint flicker. See Section 10, Hotspot H-5. *Verification:* instrument `getItem` to log when `isInitialized === false`, then cold-start the app.

### 5.2 Question data flow [CONFIRMED]

`questions.json` (bundled) is the primary bank; `KrishiDB` holds user-authored custom questions; `KrishiSQLite` holds imported banks on native. `sqlite_db.js` explicitly documents itself as a *parallel* module that does **not** replace the JSON flow — so both paths coexist and the merge/dedup responsibility lives in `app.js`.

### 5.3 Session flow [CONFIRMED — `app.js`]

```
setupMCQSession(questions, isMock, timerSec, skipNavigate)
   ├─ startTimer() / startQuestionTimer()
   ▼
renderMCQ()
   ├─ dispatch CustomEvent 'krishi-question-rendered'
   ├─ broadcast handoff state to Firestore (per render)
   └─ reaction-time clock starts (confidence auto-calc)
   ▼
option click ──(50 ms)──▶ submitMCQAnswer()
   ├─ isCorrect = selectedOption === q.ans
   ├─ CRDT wrong-log append (if incorrect)
   ├─ AnimationOrchestrator.dispatch('animation.correct' | 'animation.wrong')
   │      └─ LottieAdapter.play() → false ⇒ CSS fallback (glow-correct / shake-wrong)
   ├─ dispatch 'krishi-answer-checked'
   ├─ KrishiSM2Engine.recordAnswer()  [skipped when isMock]
   └─ auto-advance after 1.5 s (if enabled)
   ▼
finishSession()   [guarded by isFinishing]
   ├─ weightedScore (negative-marking factor 0.2)
   ├─ accuracy ring animation via SVG strokeDashoffset
   ├─ subject performance matrix
   └─ dispatch 'krishi-quiz-finished'

savePracticeProgress()  ← called throughout
   ├─ skips fresh/untouched sessions ("prevents ghost popups" — per code comment)
   ├─ writes krishi_saved_practice locally
   └─ debounced 3 s write to users/{uid}/active_session/progress
```

**[CONFIRMED]** The `savePracticeProgress()` guard that skips untouched sessions carries an explicit comment about preventing "ghost popups" — evidence that resume-prompt spam was a known, already-addressed symptom.

### 5.4 Stats: the delta-counter model [CONFIRMED — `mergeCloudAndLocalData`]

Rather than syncing absolute totals (which lose data when two devices both advance), the app stores a **baseline** (`krishi_stats_baseline`) and syncs **deltas** against it. On merge, lifetime counters are additionally protected with `Math.max`, so a merge can never *reduce* a total. Guards observed:

- `if (!cloud.stats) return local;` — a cloud doc without stats can't zero the device.
- `Math.max` on lifetime counters and on `progression.xp`.
- Custom-question merge **throws** if the merged array is shorter than `max(local.length, cloud.length)` — a deliberate data-loss tripwire.
- Streak day-map merged by per-day `max`; SM2 records merged by `lastAnswered`.

This is a genuinely careful design and should be treated as load-bearing: **do not "simplify" the merge to absolute values.**

---

## 6. Firebase & Cloud Sync — End-to-End Analysis

This is the section that matters most for the reported *sync popups* and *flickering*. I traced it from auth through listener through merge through UI repaint.

### 6.1 Firestore data shape [CONFIRMED]

```
users/{uid}                          ← the synced payload document
users/{uid}/sessions/{sessionId}      ← device presence (heartbeat every 30 s)
users/{uid}/active_session/progress   ← live session state for handoff (debounced 3 s)
(+ device-disconnect and handoff signaling docs)
```

**[CONFIRMED]** Payload may be LZString-compressed (`js/libs/lz-string.min.js`) and/or E2EE-wrapped, marked by an `__e2ee__` flag. Merge code is compression-aware.

### 6.2 Initialization — `initCloudSync()` [CONFIRMED]

1. Resolve `uid` via `getCloudUID`; fall back to **anonymous auth** if no signed-in user.
2. Write presence doc at `users/{uid}/sessions/{sessionId}`.
3. Start `sessionTouchInterval = setInterval(updateSessionDoc, 30000)` — presence heartbeat.
4. Start `safariPeriodicSyncInterval = setInterval(performCloudSync, 180000)` — a 3-minute polling fallback for browsers with unreliable listeners.
5. Attach the **main payload listener**, a **presence listener**, a **device-disconnect listener**, and a **handoff listener**.

**[CONFIRMED]** `disableCloudSyncSilently()` is the counterpart: unsubscribes every listener, clears both intervals, deletes the presence doc. Its existence is good hygiene — but see H-3 below for the case where re-init happens *without* it running first.

### 6.3 The main listener — hardened, and how [CONFIRMED]

```js
window.syncListenerUnsubscribe = firestore.collection('users').doc(uid)
  .onSnapshot(async doc => {
      let ownsSyncLock = false;
      try {
          if (syncInProgress) return;                       // re-entrancy guard
          if (doc.metadata.hasPendingWrites) return;        // ignore our own echo
          // fromCache guard: ignore cache-only "missing document" snapshots
          if (rawData && rawData.__e2ee__) {                // E2EE: halt, don't crash
              setSyncStatus('Sync failed'); return;
          }
          ownsSyncLock = true; syncInProgress = true;
          … mergeCloudAndLocalData → detectPeerChangesAndNotify → applyAllAppData
          … getDifferentialSyncDelta → push back { ...delta, updatedAt: now }
          setSyncStatus('Synced'); updateSyncUI(); krishiScheduleSyncRender();
      } catch (e) {
          setSyncStatus('Sync failed');
      } finally {
          if (ownsSyncLock) syncInProgress = false;          // cannot latch
      }
  }, err => { setTimeout(() => { /* re-init if still failing & online */ }, 5000); });
```

**Four historical flicker/popup root causes are visibly fixed here** — I am confident these were the primary offenders:

| Historical bug | Symptom it produced | Current state |
|---|---|---|
| `syncInProgress` set to `true` then left latched when an exception was thrown mid-merge | Sync silently dead for the rest of the session; "Syncing…" stuck; retries pile up | **[CONFIRMED FIXED]** — `try/finally` + `ownsSyncLock` |
| Push-back of the **entire merged payload** (`{...mergedPayload}`) | Own write echoes back as a new snapshot → merge → push → **infinite render loop = flicker** | **[CONFIRMED FIXED]** — now pushes `{...delta, updatedAt}` only |
| `decryptPayload(rawData, key)` called with `key` **undefined** on the E2EE path | Thrown error every snapshot → repeated failure toasts | **[CONFIRMED FIXED]** — path halts with a status set, no call |
| Multiple independent render calls per snapshot ("multi-render storm" per the code comment) | Visible multi-stage repaint = flicker | **[CONFIRMED FIXED]** — replaced by single batched RAF `krishiScheduleSyncRender()` |

### 6.4 The merge — `mergeCloudAndLocalData(cloud)` [CONFIRMED]

CRDT-flavoured, last-write-wins with tie-breaking:

- **`mergeCRDTLogs`** — LWW by `timestamp`, tie-broken by a monotonic `_rev` counter.
- **Bookmarks / wrong-answer sets** — set-union of items, then add/remove logs applied. Deletion handling deliberately removes **both** the numeric-typed and string-typed forms of an id (defensive against historical type drift in stored ids).
- **Stats** — delta counters vs baseline, with the `Math.max` and `if (!cloud.stats)` guards from §5.4.
- **Custom questions** — `deepMergeCustomQuestion` does **field-level** LWW, then a length tripwire throws on shrinkage.
- **Streaks** — per-day `max`. **SM2 records** — newest `lastAnswered` wins.

### 6.5 Two sync entry points [CONFIRMED]

| Path | Trigger | Behaviour |
|---|---|---|
| `syncCloudNow(silent = false)` | User taps **Sync Now**; also called silently by `OfflineQueue` on reconnect | Shows `#sync-spinner` when not silent → `checkForSyncConflicts()` → if conflict **and** not silent, `promptConflictModal()`; else `performSmartMerge()` |
| `performSmartMerge(cloudData, shouldPushAfter = true)` | Listener and manual path | Heavier: merge → `applyAllAppData` → `updateSyncUI` + `updateHomePage` + `updatePracticePage` + `updateStatsRibbon` + `scheduleRenderQuestionList(true)` → `pushLocalToCloud` |

**[CONFIRMED]** `checkForSyncConflicts(local, cloud)` previously referenced an **undeclared `cloudC`**, throwing a `ReferenceError` that aborted the function and *silently killed the entire manual "Sync Now" path*. It is **now fixed** — the current file declares `const cloudC = (cloud.customQuestions || []).length;` and carries a comment describing exactly that failure. It also has a **fresh-device bypass**: returns `null` (no conflict) when all local counters are zero, so a brand-new device adopts cloud data without prompting.

**[LIKELY — new consequence of that fix]** Because the conflict modal was previously **unreachable**, it is now reachable for the first time. Any pre-existing bug in `promptConflictModal()` (or any code path that calls `syncCloudNow(false)` more than once) will surface as a **conflict popup appearing repeatedly** — i.e. it could *look like* the old popup bug returning, while actually being newly-exposed code. This deserves explicit manual testing. See H-1.

### 6.6 UI coupling — where flicker is manufactured [CONFIRMED]

- **`setSyncStatus(status)`** writes `krishi_sync_status` and then calls `updateSyncUI()`. Because the listener also calls `updateSyncUI()` explicitly, a single snapshot triggers **`updateSyncUI()` at least twice**.
- **`updateSyncUI()`** repopulates sync stats, sets badge classes, regenerates the pairing QR (guarded by a `data-key` attribute so it only re-renders when the key actually changed), retries itself via `setTimeout(updateSyncUI, 300)` if the `QRCode` global isn't loaded yet, and calls `updateProfileSyncUI()` + `updateOfflineQueueBadge()`.
- **Presence listener** rebuilds its device list with `listContainer.innerHTML = ''` on **every** snapshot — including the 30-second heartbeat writes from every device. With N devices online, that's a full teardown/rebuild of that list roughly every 30/N seconds.
- **`renderHandoffBanner(data)`** creates `#krishi-handoff-banner` with classes `animate-bounce z-[99999]` and resets `innerHTML` on each call. Gated by `sessionId !== currentSessionId`, `!active`, and a 600,000 ms (10-minute) freshness window.
- **`krishiScheduleSyncRender()`** is the good part: a single RAF pass over module-level dirty flags `_krishiDirty = { home, practice, profiles, planner, questions, appearance }`, rendering **only the active page if dirty**, with an explicit **quiz-active guard** (if `practice-active-state-panels` is not hidden, it refuses to rebuild — protecting an in-progress quiz from being wiped by a sync).

**Assessment:** the *systemic* flicker engine (echo loop + render storm) is gone. What remains is **localized churn**: repeated `updateSyncUI()` calls per snapshot and `innerHTML` teardown in the presence list. **[LIKELY]** these are individually visible as small flashes rather than whole-screen flicker.

### 6.6a Additional hardening found while verifying [CONFIRMED]

Several defensive measures I did not expect, all of which should be preserved:

- **`initCloudSync()` is idempotent.** Every listener and interval is unsubscribed/cleared before being re-created (L3068, L3073, L3107, L3116, L3183, L3422). This is what makes the 5 s retry safe — see H-3.
- **`assertPayloadFits(payload, label)`** (L14724–14734) refuses any write over a **900 KB soft limit** against Firestore's hard 1 MiB document cap, throwing rather than letting the write fail. The comment states the reasoning: *"Refuse an oversized write rather than let it fail and leave the user believing their data is backed up."* This is the kind of guard that prevents silent data loss and should not be relaxed.
- **Single-flight auth init.** `firebaseAuthInitPromise` caches the in-flight promise and nulls it on failure (L2132–2136) so concurrent callers can't double-initialize.
- **Firestore offline persistence enabled exactly once**, guarded by `window.__krishiFirestorePersistenceEnabled__` (L2145) — calling it twice throws in the Firebase SDK.
- **Auth persistence explicitly locked to LOCAL** (L2189–2197) with the comment "survives WebView cache sweeps" — a real Capacitor concern, correctly addressed.
- **Presence listener failure degrades gracefully**: on error it writes an explanatory "Presence listener paused. Authenticating..." message into the device list (L3175–3181) instead of leaving it blank. *(Minor [CONFIRMED] typo in that string: the class attribute contains `text-rose-500\80` where `text-rose-500/80` was intended, so that opacity variant won't apply.)*
- **Retry gating** on `navigator.onLine && krishi_sync_status === 'Sync failed'` so the auto-retry stops the moment a sync succeeds.


### 6.7 Security observations [CONFIRMED]

- E2EE uses **AES-GCM with PBKDF2** key derivation — appropriate primitives.
- The E2EE branch currently **halts rather than decrypting** (§6.3). That is safe, but it means **E2EE payloads are effectively not being consumed**; a device that has ever written an encrypted payload will show "Sync failed" instead of syncing. **[LIKELY]** this is a deliberate temporary stop-gap, not the intended end state. Confirm the intended E2EE lifecycle before touching sync.
- Anonymous-auth fallback means data can be written under an ephemeral uid. **[UNCERTAIN]** whether Firestore security rules restrict `users/{uid}` to its owner — I could not see the rules from the client code. **Verify server-side rules before shipping**; client-side sync logic cannot enforce this.
- **[CONFIRMED]** Firebase config keys exist in the client (necessarily so for a web app). I am deliberately not reproducing any key values here. Web API keys are not secrets, but Firestore rules are the actual access control — see above.

---

## 7. UI & Rendering Analysis

### 7.1 Navigation model [CONFIRMED]

A single document holds **17 `.page` sections**; `navigate(pageId)` toggles an `active` class. There is no route table, no history integration beyond what `app.js` implements manually, and no virtual DOM. Consequences:

- **Every page's DOM exists simultaneously.** Renderers must therefore self-guard on "am I the active page?" — and the well-written ones do (`canvas_charts.js` opens each draw function with `if (document.hidden) return;` and `if (page && !page.classList.contains('active')) return;`).
- **[CONFIRMED]** An `IntersectionObserver`-based **DOM pruner** exists to detach off-screen nodes, plus an FPS monitor and RAF throttling — real mitigations for the all-pages-mounted cost.

### 7.2 Overlay / modal system [CONFIRMED]

~20 overlay containers in `index.html`, shown by class toggling. There is **no central modal manager** — no single owner of "which overlay is open," no z-index registry, no focus trap coordinator. Observed z-index values are ad-hoc and very high (`z-[99999]` for the handoff banner, `999999` for the Lottie container). **[LIKELY]** This is the structural reason popup regressions have historically been hard to reason about: any module can independently create a fixed-position overlay, so "why did two things appear at once" has no single place to look.

### 7.3 The batched render dispatcher [CONFIRMED — the strongest piece of the rendering layer]

`krishiScheduleSyncRender()` implements exactly the right pattern for this architecture:

1. **Dirty flags, not imperative calls** — callers mark `_krishiDirty.home = true` rather than invoking a renderer.
2. **Single RAF coalescing** — many marks in one tick produce one paint.
3. **Active-page-only rendering** — off-screen pages are skipped entirely.
4. **Quiz-active guard** — refuses to rebuild while a session panel is visible.

The in-code comment ("Single batched RAF render — replaces the previous multi-render storm") confirms this replaced the historical flicker source.

### 7.4 Residual rendering churn [LIKELY]

| Site | Pattern | Why it can flicker |
|---|---|---|
| Presence listener (`initCloudSync`) | `listContainer.innerHTML = ''` then rebuild, per snapshot | Heartbeats every 30 s per device ⇒ periodic list teardown; any element with a CSS transition restarts it |
| `setSyncStatus` + listener | `updateSyncUI()` called ≥2× per snapshot | Badge/QR/stat text repainted twice in quick succession |
| `renderHandoffBanner` | `innerHTML` reset + `animate-bounce` re-added | Re-entering the function restarts the bounce from frame 0, reading as a jump |
| `updateSyncUI` QR retry | `setTimeout(updateSyncUI, 300)` when `QRCode` undefined | If the lib never loads, this is an unbounded 300 ms self-repaint loop |
| `checkPageVisibility` (`spatial_minimap.js`) | MutationObserver on `page-practice` `class`/`style` + scroll listener | Fires on any class/style mutation of that page, not just visibility changes |
| `applyAppOpacity` (`elite_animations_controller.js`) | MutationObserver on `documentElement` **all attributes** | Observes `{ attributes: true }` with no `attributeFilter`, then filters to `class` inside the callback — every attribute mutation on `<html>` invokes it |

**[UNCERTAIN]** Which of these is *perceptible* depends on device performance and how many devices are paired. To verify: open DevTools → Rendering → **Paint flashing**, then leave the Profile/Sync page open for two minutes with a second device online. The presence-list rebuild should light up on a ~30 s cadence.

### 7.5 Loading & error states [CONFIRMED]

- `#sync-spinner` for non-silent manual sync.
- `setSyncStatus()` drives a textual status badge ('Synced' / 'Sync failed' / etc.) persisted to `krishi_sync_status`, so status survives reload.
- `showToast()` is the global transient-message channel (used by ambient player, animation config reset, etc.).
- **[CONFIRMED]** Error handling in the sync path is now non-fatal by construction (`try/catch/finally` + fire-and-forget animation dispatch). Elsewhere, `try { … } catch(e) {}` swallowing is common (e.g. `krishi_idb.js` fallback paths) — pragmatic for resilience, but it means storage failures degrade silently.

---

## 8. Animation Analysis

Per your instruction, **nothing is marked for removal merely because I'd have built it differently.** Classifications: **KEEP** (good as-is) / **ADAPT** (good, improvable) / **REWORK** (poor) / **FIX LATER** (broken) / **REMOVE** (redundant) / **FUTURE** (missing, worth adding).

### 8.1 `AnimationOrchestrator` — the central layer → **KEEP** [CONFIRMED]

674 lines, `Object.freeze`d. Genuinely well-engineered; treat as the correct abstraction and route new animations through it rather than around it.

- **Event types:** correct, wrong, xp, streak, achievement, levelUp, sessionComplete.
- **Priority tiers:** CRITICAL 100 → HIGH → NORMAL → LOW → MICRO 20.
- **Dedup windows:** 100 ms default, 250 ms for NORMAL, 50 ms for MICRO — kills double-fire from rapid taps.
- **Queue** with 5 s expiry, so a stalled queue can't replay stale animations later.
- **Conflict management:** `canPlayNow()` makes HIGH-and-above wait behind CRITICAL; body gets `suppress-micro-interactions` during CRITICAL so small effects don't fight a big one.
- **Safety:** `executeAnimation` has a 6 s timeout + `cleanupActive`; `cancelAll` on the `animOrchestrator:cleanup` event; queue cleared on `visibilitychange → hidden`.
- **Accessibility:** `getAccessibilityLevel()` → `full` / `reduced` / `off`, derived from `getPerfSettings()`, an app-level `reduceMotion` setting, **and** the OS `prefers-reduced-motion` media query.
- **`dispatch()` never throws** — fire-and-forget. This is why a broken animation cannot break answer submission.

### 8.2 Answer feedback (correct / wrong) → **KEEP** [CONFIRMED]

`submitMCQAnswer()` dispatches through the orchestrator; `LottieAdapter.play()` returns a boolean and the caller runs `glow-correct` / `shake-wrong` CSS when it returns `false`. The **fallback contract is explicit and correct** — the animation degrades rather than disappearing.

### 8.3 `LottieAdapter` → **KEEP** [CONFIRMED — `lottie_adapter.js`]

Validates before committing: HTTP status, JSON parse, `Array.isArray(json.layers) && layers.length > 0`, `json.w`, `json.h`, `json.op !== undefined`. Destroys the previous animation and clears the container before loading a new one (no overlapping renders). Wraps in an explicitly-sized flex child so flexbox can't collapse it to 0×0 — a real bug class, handled. Honours `perfMode === 'battery'`, `reduceMotion`, `animIntensity === 'off'` by returning `false` (⇒ CSS fallback) rather than silently doing nothing.

**[CONFIRMED]** The five expected assets **do exist**: `assets/lottie/achievement.json`, `streak.json`, `correct.json`, `wrong.json`, `levelup.json`. So the Lottie layer is live, not dead weight. (I did not validate their internal JSON shape — the adapter does that at runtime and falls back safely if any is malformed.)


### 8.4 Accuracy ring on results screen → **KEEP** [CONFIRMED]

`finishSession()` animates an SVG circle via `strokeDashoffset`. Compositor-friendly, standard technique, no JS per frame.

### 8.5 FPS auto-throttle engine → **KEEP** [CONFIRMED — `elite_animations_controller.js` L238–284]

Samples every 500 ms, keeps a 6-sample (3 s) history; if ≥4 of 6 samples are < 55 fps it sets `EliteAnimsConfig.throttled = true` and adds `.fps-throttled` to `<html>`; recovers only when **all** samples ≥ 58 fps. The asymmetric thresholds give proper hysteresis (no oscillation). When `document.hidden` or the feature is off, it sleeps via `setTimeout(…, 1000)` instead of spinning RAF — explicitly to conserve battery. Downstream consumers respect it (e.g. laser pulse frequency halves when throttled, `elite_3d_engine.js` L378).

### 8.6 Canvas charts → **KEEP** [CONFIRMED — `canvas_charts.js`]

| Animation | Verdict | Notes |
|---|---|---|
| `drawGrowthChart` | **KEEP** | Static draw, not a loop. Guards `document.hidden` + active-page. DPR capped at 2 (1.25 on battery) and only resizes the canvas when dimensions actually change — avoids the classic "resize clears canvas every frame" bug. |
| `drawRadarChart` | **KEEP** | Same guards/DPR discipline. Has an explicit division-by-zero fallback (`numAxes` defaults to 4). |
| `drawHeatmapCalendar` | **KEEP** | 105 day-squares built into a `DocumentFragment` before a single append — correct batching. |
| `animateWaterWave` | **ADAPT** | Correct: `dataset.waveRunning` prevents duplicate RAF loops; exits when `document.hidden` or the node is detached. Improvable: it recomputes a per-pixel `Math.sin` loop across the fill width **twice per frame** (two wave layers, `for x = 0 … fillWidth`). On a wide screen that's ~1,500 sin calls/frame. Cheap win later: step x by 3–4 px and let `lineTo` interpolate. |
| `drawNeuralMap` | **ADAPT** | Good: self-terminates on detach, throttles to ~3 fps when hidden. Improvable: `window.addEventListener('resize', init)` is bound once via a `__krishi_resize_bound__` flag (good), but `init()` calls `ctx.scale(dpr, dpr)` **cumulatively** rather than `setTransform` — repeated resizes compound the scale. Also superseded in practice by `init3DSyllabusDome` (see 8.7). |

### 8.7 3D canvas widgets → mixed [CONFIRMED — `elite_3d_engine.js`]

All three share the `Elite3D` rotate/project math, drag-to-rotate with 3-second auto-spin resume, `document.hidden` throttling to ~3 fps, an `krishi_elite_animations` kill switch, and DPR-aware `setTransform` sizing. The math module itself is clean and reusable.

| Widget | Verdict | Detail |
|---|---|---|
| `init3DCropGrowthSandbox` | **KEEP** | The only one that does cleanup properly: stores `canvas._krishi3DCleanup` and calls it at the top of re-init, removing all six listeners and cancelling the RAF. This is the pattern the other two should copy. Progressive model generation (stem → leaves at 15%/40% → flower at 100%) is a nice touch. |
| `init3DSyllabusDome` | **FIX LATER** | **Leaks listeners.** It adds `window.addEventListener('mouseup', onUp)` and `('touchend', onUp)` but has **no** `_krishi3DCleanup` and no guard against re-initialization. Its `draw()` removes those window listeners *only* when `canvas.parentNode` is null — but the call site in `app.js` (~L15570) does `mapCard.innerHTML = '…'` **and then** calls `init3DSyllabusDome(...)` on the fresh canvas. The old canvas is detached, so its RAF will eventually notice and clean up — but until the next frame fires, and for every rebuild, a new pair of window listeners plus a new RAF loop is created. **[LIKELY]** repeated visits to the analytics page accumulate `mouseup`/`touchend` handlers and concurrent RAF loops. This is the single clearest animation defect I found. Also: `window.EliteAnimsConfig.throttled` is dereferenced (L378) without the `window.EliteAnimsConfig &&` guard used on the line above — a `TypeError` if the controller script fails to load. |
| `init3DSeasonalCarousel` | **ADAPT** | Same missing-cleanup shape but far lower exposure: no drag listeners, only a RAF and a `window.rotateSeasonal3DCarousel` global that is **reassigned** on each init (so no handler pile-up). Lerp spin (`currentAngle += (target - current) * 0.08`) is a good springy feel. Uses `ctx.roundRect` — **[UNCERTAIN]** availability on your minimum Android WebView; it's widely supported on modern Chromium but throws on older ones, which would kill the RAF loop silently. Worth a capability check. |

### 8.8 Ambient background canvas → **ADAPT** [CONFIRMED — `app.js` ~L15586–15604]

A full-viewport `#weather-ambient-canvas` inserted as `document.body.firstChild`, with seasonal particles, weather-front transitions and sparks. Gated behind `krishi_elite_animations`. Improvable, not broken: `initBgCanvas` is bound to `window.resize` with no debounce, and resizing a full-screen canvas is one of the more expensive operations available. On a phone this fires during keyboard show/hide and orientation change.

### 8.9 Spatial minimap → **KEEP** [CONFIRMED — `spatial_minimap.js`]

Transform/opacity-only transitions (compositor-friendly), IntersectionObserver with a `-20% 0px -60% 0px` rootMargin for a middle-of-viewport focus band, smooth `window.scrollTo` with a 70 px header offset, haptic + sound feedback, `aria-label` on each dot. Accessible and cheap. One nit (**ADAPT**): the MutationObserver watches `class` **and** `style`, and `checkPageVisibility` then does a `getComputedStyle` read on every fire — a forced style recalculation triggered by unrelated mutations.

### 8.10 UI micro-interactions → **KEEP** [CONFIRMED]

Settings tab switching, accordion expansion (`maxHeight` + `opacity` transitions), tuning-panel collapse, minimap dot scaling, heatmap square `hover:scale-125`, haptics scaled by `EliteAnimsConfig.hapticIntensity` (off/soft/medium/strong, with `navigator.vibrate` duration mapping). Consistent and appropriately restrained.

**One note on the haptic wrapper** (`elite_animations_controller.js` L216–236): it captures `const originalHaptic = window.triggerHaptic` at load time and replaces the global. If `app.js` defines `triggerHaptic` **after** this script runs, `originalHaptic` is `undefined` and the whole wrapper body is skipped — including the `navigator.vibrate` call, since it sits *inside* the `if (typeof originalHaptic === 'function')` block. **[UNCERTAIN — verify load order]** If haptics feel dead, this is the first place to look. Purely a load-order question; I did not confirm which script defines it first.

### 8.11 Page transitions → **KEEP** [CONFIRMED]

`EliteAnimsConfig.pageTransitionStyle` (default `'slide'`, control `#select-page-transition`) **is consumed** — in `navigate()` at `app.js` ~L3877–3896. The implementation is better than I initially assumed:

- **Direction-aware:** `newIdx > oldIdx ? 'slide-in-right' : 'slide-in-left'` — bi-directional, so back-navigation slides the correct way.
- **Three styles:** `slide`, `fade`, `zoom`, each adding a class then removing it after 360 ms.
- **Accessibility/performance override:** `if (ps.reduceMotion || ps.perfMode === 'battery') style = 'none';` — the transition self-disables. This is the OS/app reduce-motion respect I said was *missing* from the standalone canvas loops; `navigate()` does it correctly and is the model to copy.
- Only fires when actually changing page (`activePage && activePage.id !== pageId`).


### 8.12 Missing → **FUTURE** (suggestions only, not requests to implement)

- **Skeleton/shimmer placeholders** for the question list and stats while `KrishiStorage` hydrates — this would directly mask the boot race in §5.1.
- **Reduced-motion parity for canvas loops:** the orchestrator and `navigate()` both honour reduce-motion / battery mode, but the standalone canvas loops (`animateWaterWave`, ambient background, the three 3D widgets) check only the app's own `krishi_elite_animations` flag. A user with OS reduce-motion enabled still gets spinning 3D and animated waves. The fix pattern already exists in `navigate()` — reuse `getPerfSettings()` there.
- **A single `prefers-reduced-motion` media-query listener** that flips one CSS class, so future animations inherit the behaviour instead of each re-implementing the check.

---

## 9. Voice Assistant Analysis

**[CONFIRMED] The voice assistant and hands-free exam mode have been completely removed.** This is not a partially-disabled feature — it is fully excised, and cleanly so.

`js/voice_assistant.js` is 9 lines in its entirety:

```js
// Krishi MCQ Pro - Voice Assistant Feature Completely Removed
window.toggleVoiceAssistant = function() {};
window.handleVoiceConfigChange = function() {};
window.syncVoiceUI = function() {};
window.toggleHandsFreeExam = function() {};
window.krishiVoiceEngine = null;
window.krishiVoiceAssistant = null;
window.krishiHandsFreeExam = null;
```

Verification performed:

- **[CONFIRMED]** `app.js` contains **zero** matches for `VoiceAssistant`, `voiceEngine`, `krishiVoice`, `handsFree`, `HandsFree`, `speechSynthesis`, or `SpeechRecognition`.
- **[CONFIRMED]** `index.html` contains exactly **one** voice-related line — the script tag at L3611 (`./js/voice_assistant.js?v=4bcle5g`). There are no voice buttons, toggles, or settings rows left in the markup.

**Assessment:** the stub is a **defensive no-op shim**, not an oversight. Keeping empty functions on `window` means any surviving inline `onclick="toggleVoiceAssistant()"` or cached HTML from a previous app version fails silently instead of throwing `ReferenceError`. Given the Service Worker caches the app shell, an old cached `index.html` could genuinely still reference these — so the shim has real value during the transition window.

**Recommendation (low priority, not urgent):** once you're confident no cached shells reference it, the script tag and file can be deleted together. Until then, leave it. See Section 11.

**Audio subsystem — `ambient_player.js` → healthy** [CONFIRMED]

Unrelated to voice, but this is the app's other audio surface, so I cover it here.

- **Fully procedural.** 9 soundscapes synthesized live via Web Audio — brown/pink/white noise buffers, biquad filters, LFO tremolo, FM synthesis, scheduled envelopes. **Zero audio files**, which is why it works offline. Genuinely elegant: Chitwan rain (bandpass brown noise + random drip pops), Himalayan wind (pink noise + 0.15 Hz LFO gusts), 8 Hz alpha binaural beat (L 200 Hz / R 208 Hz via channel merger), singing bowl (FM cluster at 432/528/639 Hz with 6 s metal decay), campfire, river, forest birds, 80 BPM lo-fi kick/hi-hat, thunderstorm.
- **Correct lazy AudioContext.** `getCtx()` creates on first use and calls `resume()` if suspended — the right way to satisfy autoplay policy.
- **Deliberately does not auto-restore** on load (the `DOMContentLoaded` handler is an empty comment-only block) *specifically* to avoid autoplay-policy violations, even though state is persisted to `krishi_ambient_state`. That is the correct trade-off, and the comment says so.
- **Sleep timer** fades `masterGain` over 60 one-second steps, then stops all sources and restores gain to 1.0.
- **Self-terminating schedulers.** Every recursive `setTimeout` loop (drip, crackle, chirp, strike, thunder, beat scheduler) begins with `if (!activeSources[id]) return;` — so stopping a sound reliably ends its scheduler. No leak.
- **[LIKELY] Minor issue — custom-URL XSS/quoting surface:** `ambientRenderGrid()` interpolates user-supplied `sound.label` and `sound.url` directly into an `innerHTML` template inside `onclick="ambientToggleSound('${sound.id}','${sound.url || ''}')"`. A URL or name containing a quote character breaks the handler; a crafted one could inject script. Impact is limited (self-inflicted, local-only, requires the user to type it), but it is the one place in this file I'd flag. Not urgent; noted for Section 10 (H-7).
- **[CONFIRMED]** `customUrl` sets `crossOrigin = 'anonymous'` before `createMediaElementSource` — necessary, and correctly done.

---

## 10. Bug & Risk Hotspots

Ordered by my assessment of severity × likelihood. Each entry: what it is, where, why it matters, and how to verify. **None of these were fixed by me** — this is a diagnosis list.

### H-1 — Conflict modal is newly reachable *(highest priority to test)*
**[LIKELY]** · `checkForSyncConflicts()` / `promptConflictModal()` / `syncCloudNow()` in `app.js`

The `cloudC` `ReferenceError` used to abort `checkForSyncConflicts()` before it could ever return a conflict, which silently disabled both the manual sync path *and* the conflict modal. With `cloudC` now declared, the modal can fire **for the first time in this code's history**. Its behaviour is therefore effectively untested. If anything calls `syncCloudNow(false)` repeatedly — a retry loop, a rapid double-tap, an offline-queue drain that isn't fully silent — the result is a **repeating conflict popup** that would look exactly like the historical bug returning.

*Verify:* with two devices holding divergent data, tap **Sync Now** and confirm the modal appears **once**, both buttons resolve it, and it cannot be re-triggered while open. Check every call site of `syncCloudNow` for `silent` correctness.

### H-2 — Presence-list rebuild on every snapshot
**[CONFIRMED] pattern, [LIKELY] visible impact** · presence listener inside `initCloudSync()`

`listContainer.innerHTML = ''` followed by a full rebuild, on every presence snapshot. Each paired device heartbeats every 30 s (`sessionTouchInterval`), and every heartbeat is a snapshot. With 3 devices online that's a teardown/rebuild roughly every 10 seconds, restarting any CSS transition on those nodes and discarding scroll/focus state within the list.

*Verify:* DevTools → Rendering → **Paint flashing**, sit on the sync/profile page for two minutes with a second device online.

### H-3 — 5-second error-retry re-init — **investigated and largely cleared**
**[CONFIRMED — not the bug I suspected]** · error callback at `app.js` L3322–3331; guards at L3068, L3073, L3107, L3116, L3183, L3422

I flagged this as the most likely residual cause of the reported flicker, then verified it. **The concern does not hold.** The error callback does re-run `initCloudSync()` after 5 s without calling `disableCloudSyncSilently()` first — but `initCloudSync()` is **idempotent by construction**: it clears or unsubscribes every prior resource before re-creating it.

```
L3068  if (sessionTouchInterval) clearInterval(sessionTouchInterval);
L3073  if (window.deviceDisconnectListenerUnsubscribe) { …() }
L3107  if (window.safariPeriodicSyncInterval) clearInterval(…);
L3116  if (window.presenceListenerUnsubscribe) { …() }
L3183  if (window.syncListenerUnsubscribe) { …() }
L3422  if (window.handoffListenerUnsubscribe) { …() }
```

All four listeners and both intervals are torn down on re-entry, so **listeners and intervals cannot stack** across retries. The retry is additionally gated on `navigator.onLine && krishi_sync_status === 'Sync failed'`, so it stops as soon as a sync succeeds.

**Residual risk is low but non-zero [LIKELY]:** the retry has **no backoff and no attempt cap**. Under a persistently failing condition that is *not* an offline condition — expired credentials, a permission-denied from Firestore rules, or a payload rejected by the size guard — this becomes an indefinite 5-second loop of full sync re-initialization. Each cycle re-attaches four listeners, re-writes the presence doc, and calls `setSyncStatus('Sync failed')` → `updateSyncUI()`. That is a plausible flicker source on a *permanently* broken account, though not on a merely flaky connection.

*Recommended (small):* exponential backoff with a cap, and don't retry on non-transient error codes such as `permission-denied`.

*Correction note:* this entry originally asserted stacked listeners as the leading suspect. Verifying the code disproved it. With H-3 downgraded, **H-1 and H-2 become the leading residual candidates.**


### H-4 — `updateSyncUI()` runs ≥2× per snapshot
**[CONFIRMED]** · `setSyncStatus()` + the listener body

`setSyncStatus('Synced')` internally calls `updateSyncUI()`; the listener then calls `updateSyncUI()` again on the next line. Every status change therefore repaints the badge, sync stats, profile sync block and offline-queue badge twice in immediate succession. Low severity in isolation, but it doubles the cost of H-2 and H-3.

*Verify:* counter log inside `updateSyncUI`.

### H-5 — `KrishiStorage` boot race
**[LIKELY]** · `krishi_idb.js` — `getItem()` L133–136 vs `init()` L65

`getItem()` reads only the in-memory Map, and the Map is empty until the async `init()` round-trip completes. Any read before then returns `null`, so first paint can render defaults and then visibly correct itself once hydration lands — a first-load flicker with a completely different cause from the sync ones.

*Verify:* add a temporary `console.warn` in `getItem` when `isInitialized === false`, cold-start with a cleared cache, and check whether any read occurs in that window. Also confirm whether `init()` is `await`ed before the first render pass.

### H-6 — `init3DSyllabusDome` listener + RAF leak
**[LIKELY]** · `elite_3d_engine.js` L244–436, call site `app.js` ~L15570

No `_krishi3DCleanup`, no re-init guard, and the call site replaces `mapCard.innerHTML` before re-initializing. Each visit to the analytics page adds a `mouseup` and a `touchend` handler on `window` plus a new RAF loop; the old loop only self-cancels on its next frame after detach. Also `window.EliteAnimsConfig.throttled` at L378 is dereferenced without the null-guard used on L377 — a `TypeError` (and a dead animation) if the controller script fails to load.

*Verify:* `getEventListeners(window)` in the DevTools console after navigating to analytics five times; count `mouseup` entries.

### H-7 — Ambient custom-sound `innerHTML` interpolation
**[LIKELY]** · `ambient_player.js` `ambientRenderGrid()` L557–577

User-supplied `label` and `url` are interpolated into an HTML string and into single-quoted inline `onclick` arguments. A quote character breaks the handler; a crafted string can inject script. Self-inflicted and local-only, so impact is low — but it's the one injection surface I found.

*Verify:* add a custom sound named `a'b"c` and observe the card.

### H-8 — Unthrottled full-viewport canvas resize
**[CONFIRMED]** · `app.js` ~L15596–15601

`window.addEventListener('resize', initBgCanvas)` with no debounce, where `initBgCanvas` reassigns `width`/`height` on a full-screen canvas. On mobile this fires repeatedly during keyboard show/hide and rotation — each one a full buffer reallocation and clear.

### H-9 — `drawNeuralMap` cumulative DPR scaling
**[CONFIRMED]** · `canvas_charts.js` L348–353

`init()` uses `ctx.scale(dpr, dpr)` rather than `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`. Because `init` is also the resize handler, each resize multiplies the transform again, so the map progressively zooms out of frame. Every other draw function in the file correctly uses `setTransform` — this one is the outlier. Mitigating factor: `init3DSyllabusDome` normally takes precedence at the call site, so `drawNeuralMap` only runs as a fallback.

### H-10 — `ctx.roundRect` compatibility
**[UNCERTAIN]** · `elite_3d_engine.js` L539

`roundRect` is relatively recent. If the minimum-supported Android WebView lacks it, the call throws inside the RAF loop and the seasonal carousel silently stops rendering (no visible error, just a blank canvas).

*Verify:* check your Capacitor `minSdkVersion` / target WebView version, or wrap in a capability probe during testing.

### H-11 — Global-namespace coupling with no contract
**[CONFIRMED]** · architecture-wide

Cross-module communication is entirely `window.*` globals plus `CustomEvent`s. Most call sites guard with `typeof … === 'function'`, which is correct — but there are exceptions (H-6's `EliteAnimsConfig.throttled`; the `originalHaptic` load-order dependency in §8.10). A script-order change or one failed script load produces failures that are silent and non-local.

### H-12 — Duplicated app copies in the repo
**[CONFIRMED] existence, [UNCERTAIN] staleness** · `www/`, `temp.html`

`www/index.html`, `www/js/app.js`, `www/js/elite_animations_controller.js` and a root `temp.html` all contain near-identical copies of live code (they matched the same `pageTransitionStyle` search). Since `--web-dir=.` makes the **root** canonical, `www/` is a build artifact and `temp.html` is a scratch file. The risk is editing the wrong copy, or a stale `www/` shipping in a native build.

*Verify:* diff `www/js/app.js` against `js/app.js`; confirm your build regenerates `www/` rather than reading it as source; consider gitignoring both.

---

## 11. Technical Debt

Debt here means "costs you time later," not "written badly." Several items are deliberate trade-offs that I'd keep.

### Structural
1. **`app.js` is a ~16,500-line monolith.** [CONFIRMED] It holds the router, all sync, the MCQ engine, every page renderer, settings, and the import pipeline. Consequences: no module boundaries to reason about, symbol collisions are possible, and — as this analysis demonstrated — line references go stale within hours. The extraction pattern is already established and working (`canvas_charts.js` and `elite_3d_engine.js` were pulled out, leaving "moved to external module" comments behind). Continuing that pattern incrementally, sync layer first, is the highest-leverage structural work available. **Not urgent; do it opportunistically, never as a big-bang rewrite.**
2. **Two parallel storage wrappers.** [CONFIRMED] `KrishiStorage` (`krishi_idb.js`) and a second `Storage` batching wrapper inside `app.js` that adds `requestIdleCallback` coalescing on top. Two abstractions over the same substrate means a reader must know which one a given call site uses to predict write timing. Worth collapsing into one eventually — the batching belongs *inside* `KrishiStorage`.
3. **No central overlay/modal manager.** [CONFIRMED] ~20 overlays, ad-hoc z-indices up to `999999`, and any module free to append a fixed-position element to `<body>`. This is the structural reason popup bugs have been hard to localize (§7.2).
4. **Duplicated app copies** — `www/`, `temp.html` (H-12).

### Naming & clarity
5. **`KrishiSM2Engine` implements FSRS, not SM-2.** [CONFIRMED] The algorithms are meaningfully different. The name will mislead anyone tuning scheduling parameters. Cheap to fix with an alias; worth doing before anyone touches review scheduling.
6. **"Elite" prefix is doing two jobs.** `krishi_elite_animations` is a genuine feature kill switch, while `EliteAnimsConfig` is the tuning object. Related but not the same scope.

### Dead & transitional code
7. **`voice_assistant.js` stub + its script tag.** [CONFIRMED] Intentional shim for cached shells (§9). Remove both together once you're confident no cached `index.html` references the functions. Low priority.
8. **`drawNeuralMap` is a fallback that's normally shadowed** by `init3DSyllabusDome` [CONFIRMED] — so its DPR bug (H-9) is latent rather than active. Either fix it or retire it deliberately; leaving a broken fallback is the worst of the three options.
9. **"Moved to external module" comment stubs** in `app.js` (~L15477, ~L15583). Harmless breadcrumbs; fine to keep.

### Behavioural / correctness
10. **E2EE path halts instead of decrypting.** [CONFIRMED] Safe, but it means encrypted payloads are unusable and any device that wrote one reports "Sync failed" (§6.7). This is the most significant *functional* gap in the codebase — decide whether E2EE is being finished or removed, because "halted" is not a stable end state.
11. **Silent `catch(e) {}` blocks.** [CONFIRMED] Common in storage fallbacks. Deliberate for resilience, but storage failures are then invisible. A single central `logSilentFailure()` would preserve the resilience while giving you telemetry.
12. **No automated tests of any kind.** [CONFIRMED] No test runner, no config, no test directory. For a codebase with CRDT merge logic and delta counters, this is the debt I'd weight highest after H-1/H-3. `mergeCloudAndLocalData` is pure-ish and highly testable — a handful of unit tests over it (both-devices-advanced, cloud-missing-stats, custom-question shrinkage tripwire, bookmark add/remove ordering, streak day-max) would protect the most dangerous code in the app for very little effort.
13. **Manual cache-version strings.** [CONFIRMED] Script tags carry hand-maintained query strings (`?v=58`, `?v=4bcle5g`) and `sw.js` carries its own version. These must be bumped by hand and in sync; the historical `agriculture-exam-v63` incident (a hardcoded prefix in `index.html` deleting the live cache on every load) came from exactly this class of manual coordination.

### Deliberate trade-offs I would **not** change
- **Vendored libraries in `js/libs/`** — required for true offline operation. Keep.
- **Vanilla JS, no framework** — the app works and a framework migration would be a total rewrite. Keep.
- **Procedural audio instead of audio files** (`ambient_player.js`) — zero bytes shipped, works offline, sounds good. Keep.
- **Synchronous `getItem` facade over async IndexedDB** — the ergonomics win is real; just close the boot-race window (H-5) rather than removing the facade.
- **`dispatch()` never throws** in the orchestrator — deliberate isolation of decorative code from functional code. Keep.

---

## 12. Project Memory

The durable mental model. If you read only one section before starting work, read this one.

### Identity
Krishi MCQ Pro (`krishi-mcq-pro`) — offline-first, bilingual Nepali/English MCQ prep app for the **Nepal Civil Service Agriculture (कृषि)** exam. **Vanilla JS + Capacitor 5.7.** No framework. No build step for the app code.

### Non-negotiable facts
- **The project root is the canonical web root** (`--web-dir=.`). Edit `index.html`, `sw.js`, `js/*` at the root. `www/` is a build artifact; `temp.html` is scratch. Never edit those.
- **`app.js` is ~16,500 lines and actively changing.** Locate code by symbol search, never by remembered line number.
- **Single-document app.** All 17 pages exist in the DOM at once; `navigate(pageId)` toggles `active`. Every renderer must self-guard on active-page.
- **Cross-module contract is `window.*` globals + `CustomEvent`s.** Always guard with `typeof window.fn === 'function'`.
- **Storage reads are synchronous but hydration is async.** `KrishiStorage.getItem()` hits an in-memory Map only.

### The sync model in one paragraph
Firestore `users/{uid}` holds the payload (possibly LZString-compressed, possibly E2EE-wrapped). A single `onSnapshot` listener merges cloud into local using **CRDT last-write-wins logs** (`timestamp`, tie-broken by `_rev`), **delta counters against `krishi_stats_baseline`** for stats, `Math.max` floors on lifetime counters and XP, set-union plus add/remove logs for bookmarks/wrong-answers, and field-level LWW for custom questions with a **length tripwire that throws on shrinkage**. It then pushes back a **delta only** (never the whole payload — that caused an echo loop). Presence lives at `sessions/{sessionId}` with a 30 s heartbeat; live session handoff at `active_session/progress`, debounced 3 s. A 180 s polling interval backs up unreliable listeners.

### Load-bearing invariants — do not "simplify" these
1. **Delta counters, not absolute totals.** Absolute sync loses data when two devices both advance.
2. **`Math.max` on lifetime counters / XP.** A merge must never reduce a total.
3. **Push deltas, never the merged payload.** Whole-payload push-back = infinite echo = flicker.
4. **`try/finally` + `ownsSyncLock` around `syncInProgress`.** Without it, one thrown error latches sync off for the session.
5. **`hasPendingWrites` and `fromCache` guards** in the listener. Removing them reintroduces self-echo.
6. **The custom-question length tripwire.** It is a data-loss alarm, not defensive clutter.
7. **`krishiScheduleSyncRender()`'s quiz-active guard.** It prevents a sync from wiping an in-progress quiz.
8. **`savePracticeProgress()` skipping untouched sessions.** Prevents "ghost popup" resume prompts.
9. **`AnimationOrchestrator.dispatch()` never throwing.** Keeps decorative failures out of the answer path.
10. **`LottieAdapter.play()` returning a boolean.** The caller's CSS fallback depends on it.

### Bugs already fixed (do not reintroduce)
Latched `syncInProgress`; whole-payload echo push-back; multi-render storm; `decryptPayload(rawData, undefined)`; undeclared `cloudC` in `checkForSyncConflicts` (which silently killed manual Sync Now *and* the conflict modal); `index.html` hardcoded `agriculture-exam-v63` cache prefix wiping the live cache on every load.

### Known-good subsystems (leave alone unless asked)
`AnimationOrchestrator`; `LottieAdapter`; `ambient_player.js`; `spatial_minimap.js`; the FPS auto-throttle engine; `krishiScheduleSyncRender()`; `init3DCropGrowthSandbox` (the cleanup reference implementation); `navigate()`'s transition block (the reduce-motion reference implementation).

### Terminology traps
- **"SM2"** (`KrishiSM2Engine`) is actually **FSRS**.
- **"Elite"** = the premium-visuals feature family; `krishi_elite_animations !== 'false'` is its kill switch.
- **Voice assistant is removed**, not disabled. The stub exists only to protect cached shells.

### Storage keys worth knowing
`krishi_stats_baseline`, `krishi_saved_practice`, `krishi_sync_status`, `krishi_elite_animations`, `krishi_elite_anims_config`, `krishi_auto_advance`, `krishi_ambient_state`, `krishi_ambient_custom`, `krishi_offline_sync_queue`. IndexedDB: `KrishiAppDB → krishi_keyvalue`. Native SQLite: `KrishiQuestionsDB → questions`.

---

## 13. Recommended Priority Order

Sequenced so each step de-risks the next. **Nothing here has been started — awaiting your go-ahead per task.**

### Phase 0 — Verify before touching anything (no code changes)
1. Confirm the fixes described in §6.3/§6.5 are still present on disk (the file was changing during analysis).
2. Run the Section 14 checklist.
3. Decide the **E2EE question**: finish it or remove it? Everything in sync depends on that answer.

### Phase 1 — Close out the reported symptom (highest value)
4. **H-1** — manually test the newly-reachable conflict modal end to end. Now the leading suspect, since H-3 was investigated and cleared.
5. **H-2** — replace the presence-list `innerHTML` teardown with keyed reconciliation, or skip the rebuild when the device set is unchanged.
6. **H-4** — remove the duplicate `updateSyncUI()` call per snapshot. One-line change, halves sync repaint cost.
7. **H-3 (residual only)** — add backoff + an attempt cap to the 5 s retry, and skip retry on non-transient error codes.

### Phase 2 — Boot-time correctness
8. **H-5** — ensure `KrishiStorage.init()` is awaited before first render, or add skeleton states. Removes a whole class of first-paint flicker.

### Phase 3 — Contained animation defects
9. **H-6** — give `init3DSyllabusDome` the `_krishi3DCleanup` treatment already proven in `init3DCropGrowthSandbox`; add the missing `EliteAnimsConfig` null-guard.
10. **H-9** — `ctx.scale` → `ctx.setTransform` in `drawNeuralMap` (or retire it deliberately).
11. **H-8** — debounce the ambient-canvas resize handler.
12. **H-10** — probe `ctx.roundRect` support on your minimum WebView.

### Phase 4 — Durability
13. Add unit tests around `mergeCloudAndLocalData` (debt #12). Highest long-term ROI in the whole list.
14. **H-7** — escape user input in `ambientRenderGrid()`.
15. Alias `KrishiSM2Engine` → FSRS naming (debt #5).
16. Reduce-motion parity for the canvas loops (§8.12), reusing the `navigate()` pattern.

### Phase 5 — Structural, opportunistic only
17. Extract the sync layer out of `app.js` into `js/krishi_sync.js`, continuing the established pattern.
18. Collapse the two storage wrappers into one (debt #2).
19. Introduce a minimal overlay manager (debt #3).
20. Resolve `www/` and `temp.html` duplication (H-12); remove the voice stub (debt #7).

**Explicitly deferred:** framework migration, replacing the animation system, rewriting the merge algorithm. None are justified by anything I found.

---

## 14. What to Verify Before Modifying

A pre-flight checklist. Items marked **⚠️** are blocking — resolve them before any sync-related edit.

### File & environment
- [ ] **⚠️ Confirm you are editing the root copy**, not `www/` or `temp.html`. (`--web-dir=.` makes root canonical.)
- [ ] **⚠️ Re-read the target function immediately before editing.** `app.js` line numbers in this document are as-of-2026-08-22 and drifted ~180 lines *during* the analysis. Locate by symbol.
- [ ] Confirm whether anyone/anything else is actively editing `app.js` — concurrent edits were observed.
- [ ] Check git status / working-tree cleanliness so the in-flight fixes aren't accidentally reverted.

### Sync-specific (before touching §6 code)
- [ ] **⚠️ Verify the six fixes are still present:** `cloudC` declared; `try/finally` + `ownsSyncLock`; delta-only push-back; E2EE branch halting; `hasPendingWrites` guard; `fromCache` guard.
- [ ] **⚠️ Decide the E2EE lifecycle** (finish vs. remove). The current halt-on-`__e2ee__` behaviour means encrypted payloads never sync.
- [ ] **⚠️ Confirm Firestore security rules** restrict `users/{uid}` to its owner. I could not see the rules from client code, and anonymous auth is in play. Client logic cannot substitute for rules.
- [ ] Read the listener's error callback and determine whether it tears down before re-init (H-3). **— already done: it doesn't need to; `initCloudSync()` is idempotent. Remaining ask is backoff, not teardown.**
- [ ] Enumerate every `syncCloudNow` call site and confirm the `silent` flag is correct at each (H-1).
- [ ] Confirm `krishi_stats_baseline` semantics before touching stats — the delta model breaks if the baseline is reset at the wrong moment.

### Storage
- [ ] Determine whether `KrishiStorage.init()` is awaited before the first render (H-5).
- [ ] Confirm which of the two storage wrappers a given call site uses — write timing differs (debt #2).
- [ ] Check IndexedDB worker version string (`krishi_worker.js?v=58`) against `sw.js`'s cache version before shipping.

### Animation
- [ ] Confirm script load order for `triggerHaptic` — the wrapper in `elite_animations_controller.js` captures the original at load time (§8.10).
- [ ] Verify `ctx.roundRect` support on your minimum Android WebView (H-10).
- [ ] Before changing any animation, check whether it already routes through `AnimationOrchestrator`; if so, extend the orchestrator rather than bypassing it.

### General
- [ ] Confirm the SW cache version bump strategy before changing any cached asset — the historical cache-wipe bug came from manual version coordination (debt #13).
- [ ] There are **no automated tests**. Every change must be verified manually; plan the verification steps *before* editing.

### How to reproduce the flicker/popup symptom (for whoever fixes it)
1. Pair two devices to the same account with divergent progress.
2. Open the sync/profile page on device A. DevTools → Rendering → **Paint flashing** on.
3. Add counter logs at the top of the payload snapshot handler, `updateSyncUI()`, and the presence snapshot handler.
4. Toggle device A offline/online every ~6 seconds for one minute (exercises H-3's 5 s retry).
5. Watch for: `updateSyncUI` count at ~2× snapshots (⇒ H-4, expected) or higher; presence list repainting on a ~30 s cadence (⇒ H-2). Snapshot-handler count climbing faster than snapshots would indicate stacked listeners — but `initCloudSync()` is idempotent, so this should *not* occur (H-3).
6. Separately: tap **Sync Now** with divergent data and confirm the conflict modal appears exactly once (⇒ H-1).

---

## Appendix — Future Work Rule

The standing procedure for every subsequent development task on this codebase.

**Before writing code:**
1. **Locate the existing implementation.** Assume the feature already exists in some form — this codebase is dense and features are often already half-built. Search by symbol.
2. **Trace dependencies both ways.** Who calls this? What globals and `CustomEvent`s does it rely on? Which pages render it?
3. **Check side effects.** Does it touch `KrishiStorage`, Firestore, the dirty flags, or the orchestrator? Sync and storage changes have blast radius far beyond their call site.
4. **Re-read the target immediately before editing** — line numbers go stale (see §14).

**While writing code:**
5. **Preserve unrelated functionality.** No opportunistic cleanup in a bug-fix change.
6. **Minimize the change surface.** Smallest diff that fully solves the problem.
7. **Reuse the existing architecture.** New animations go through `AnimationOrchestrator`. New persistence goes through `KrishiStorage`. New renders set a `_krishiDirty` flag and call `krishiScheduleSyncRender()`. New page transitions reuse `navigate()`'s reduce-motion pattern.
8. **No duplicate implementations.** If something similar exists, extend it.
9. **Respect the load-bearing invariants** in §12. If a change appears to require breaking one, stop and raise it.

**After writing code:**
10. **Verify no regressions manually** — there are no tests. State explicitly what you tested and what you could not.

**For high-risk changes** (anything touching sync, merge logic, storage, auth, or the Service Worker), present this before implementing and **wait for explicit approval**:

> **Current behaviour** — what the code does today.
> **Problem** — why that's wrong, with evidence.
> **Proposed change** — precisely what will change.
> **Why this approach** — and what alternatives were rejected.
> **Risks** — what could break, and how it would present.
> **Files affected** — complete list.

---

*End of analysis. No application code was modified in producing this document.*


