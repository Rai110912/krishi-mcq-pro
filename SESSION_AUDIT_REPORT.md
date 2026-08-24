# Session Audit Report — For Independent Recheck (opus 5)

> **Scope:** All changes from session v162 → v173 (2026-08-23/24)
> **Branch:** `feat/home-polish-appearance-controls`
> **Commits:** `b48ebb6`, `33c4964`, `920a005`, `2f813c4`, `0f65377`, `1b4094d`, `29adf67`, `71d4b42` (+ earlier auto-deploy commits captured mid-session fixes)
> **How to verify:** every item lists exact anchor(s) and a grep/device check.

---

## A. REMOVALS (verify absence)

| # | What | Anchor | Verify |
|---|------|--------|--------|
| A1 | Dead `KrishiE2EEEngine` class removed | `js/pwa_helpers.js` | `git log -S KrishiE2EEEngine --oneline`; live grep: zero refs outside halt-guard |
| A2 | Dead `config.count` writes removed | `js/app.js startSmartPracticeMode` | grep `config.count\s*=` → 0 matches |
| A3 | Duplicate `updateOfflineQueueBadge` merged | `js/app.js ~L1494` (single def), old def near `enableCloudSync` gone | grep `function updateOfflineQueueBadge` → exactly 1 |
| A4 | Duplicate smart-label blocks consolidated | `updateSmartModeLabels()` defined once before `updateHomePage()`; called from `updateHomePage` + `updatePracticePage` | grep `updateSmartModeLabels(` → 3 hits (1 def + 2 calls); grep `revision dued` → 0 |

## B. SECURITY

| # | What | Anchor | Verify |
|---|------|--------|--------|
| B1 | `sync_pins` rules tightened | `firestore.rules` L19-45 | Deployed live. Rules: create requires ownerUid==auth.uid + field types; get denied when `expiresAt <= now`; list=false; update/delete owner-only |
| B2 | Anonymous→permanent upgrade | `js/app.js krishiLinkIfAnonymousOrSignIn` (~L2355) | All sign-in sites route through it. grep `signInWithCredential(|signInWithPopup(` → only inside helper + its non-anon branch |
| B3 | Deep-link path upgraded too | appUrlOpen handler (`auth?token=`) | calls helper, not raw signInWithCredential |
| B4 | Account-switch guard | `onAuthStateChanged` top block; marker `krishi_prev_real_uid` | Two real accounts ⇒ confirm dialog; cancel ⇒ signOut; confirm ⇒ `krishiWipeLocalStudyData({signOut:false})` + marker adopt + reload |
| B5 | Handoff banner input escaping | `renderHandoffBanner` local `esc()` on deviceName/subject; questionIdx int-coerced | Inject `'"><img onerror>` as custom device name → renders inert text |

## C. SYNC CORRECTNESS

| # | What | Anchor | Verify |
|---|------|--------|--------|
| C1 | Offline badge resurrected | single `updateOfflineQueueBadge` renders `sync-pending-badge` when `krishi_sync_pending_count>0`; legacy div hidden | Set pending_count=2 in DevTools → call fn → amber `(2)` appears on Sync Now btn |
| C2 | Session pruning | `initCloudSync`: `__krishiSessionPruneDone__` guard; keeps newest 10 by `lastActive`, protects current session, batch 400 | Console shows `[Presence] Pruned N stale session doc(s)` when >10 existed |
| C3 | Restore = full overwrite, NOT delta | `__krishiDataSafetyHooks.fullPush` uses `ref.set(payload,{merge:true})` (conflict-modal 'local' pattern). Reason: CRDT LWW would let newer cloud timestamps silently undo an older-snapshot restore | After restore, cloud doc updatedAt jumps; restored values persist across subsequent listener merges |
| C4 | Snapshot retention newest-first | `pruneSnapshots` has `.orderBy('createdAt','desc')` BEFORE limit | Create 12 snapshots → oldest pruned, newest 10 remain |
| C5 | Snapshot dedup signature excludes updatedAt | `signatureOf` has no `p.updatedAt` term | Two syncs with unchanged data ≥30min apart → second skipped (console absent `[DataSafety] Snapshot saved`) |

## D. DATA SAFETY PACK (`js/data_safety.js`, new file)

| # | What | Anchor | Verify |
|---|------|--------|--------|
| D1 | Kill switch | `krishi_data_safety_enabled==='false'` disables all writes/UI wiring actions | Flag OFF → no snapshot/local-backup writes |
| D2 | Hooks bridge | `window.__krishiDataSafetyHooks = {collect, apply, pushPending, fullPush}` defined in app.js near offline-badge export | grep 1 definition; data_safety reads via hooks() |
| D3 | Trigger points | `KrishiDataSafety.onSyncSuccess({firestore,uid})` at **5** setSyncStatus('Synced') success sites + `setContext` right after listeners attach in `initCloudSync` | grep `onSyncSuccess` → 5; `setContext` → 1 |
| D4 | Local rotation | Daily key `krishi_lb_YYYY-MM-DD` via LZString-compressed collect payload; keep 7; hourly interval + boot | `krishi_lb_last_day` == today after first open |
| D5 | Size guards | snapshot skips >900KB JSON with `snapshot.too_big` telemetry; restore path throws actionable error | — |

## E. TELEMETRY & LOGGING

| # | What | Anchor | Verify |
|---|------|--------|--------|
| E1 | Central sink | `pwa_helpers.js` top: `window.krishiLogSilent` (console.warn ≤3 per context + ring buffer 50), `window.krishiGetSilentFailures()` | DevTools: force a localStorage failure → `[KrishiSilent]` warn |
| E2 | Wired sites | pwa_helpers ×6, krishi_idb ×3, sqlite_db ×5 (queue push/drain, parse×3), ambient_player ×1, sw.update ×1 | grep `krishiLogSilent &&` counts per file match plan |
| E3 | Intentional silent exceptions | pwa_helpers offline-fetch probe, ambient node-stop/disconnect cleanups, data_safety listLocalBackups/renderDashboard guards | Documented — do NOT flag these as missing logs |

## F. ANIMATION / UI FIXES

| # | What | Anchor | Verify |
|---|------|--------|--------|
| F1 | Dome leak | `init3DSyllabusDome`: teardown stored BOTH on canvas `_krishi3DCleanup` and `window._krishiDomeCleanup`; re-init invokes prior teardown; draw() parentNode-gone path clears slot | Navigate analytics 5× → `getEventListeners(window)` mouseup count stays constant |
| F2 | EliteAnimsConfig null-guard | laser frequency line uses `(window.EliteAnimsConfig && window.EliteAnimsConfig.throttled)` | grep single-line form present |
| F3 | Resize debounce | bg canvas resize wrapped, 150ms, comment explains keyboard storms | Rapid rotate → one realloc per burst |
| F4 | Ambient grid injection-safe | `_escAttr` + delegated click/input on container (`__krishiAmbientWired`), no inline handlers with user data | Custom sound named `a'b"c` works + cannot break out |
| F5 | QR retry cap | `__krishiQrRetries` max 5, resets on success | Rename QRCode global → max 5 warns then stops |

## G. SMART ENGINE ZONE

| # | What | Anchor | Verify |
|---|------|--------|--------|
| G1 | Weak mode FSRS prioritization | `startSmartPracticeMode('weak')`: subject pool → recorded questions only, EXCLUDES `status==='mastered'`, sort due-first → lapses desc → stability asc; <5 candidates ⇒ random fallback | Device: weak tile toast says `memory-weakest` when FSRS data exists |
| G2 | SM2 engine-missing guard | explicit unavailable-toast + return (previously false "सबै कण्ठ छन्") | Temporarily undefine engine → correct warning |
| G3 | Shared labels fn | see A4 | — |
| G4 | Naming | User-visible strings now FSRS (toast, card title, review label, queues heading, report string). Internal class name stays `KrishiSM2Engine` (documented debt) | grep `SM-2 Memory\|SM-2 Review\|SM-2 QUEUES` → 0 |
| G5 | Simulation Net Score | Result: hidden `res-net-score-wrap` unhidden when negativeMarking==='on'; `res-weighted-tile` hidden simultaneously; mock history records `max(0,weightedScore)` instead of raw acc | Run simulation with wrongs → headline ⚖️ Net Score visible; normal practice → wrap hidden, tile shown |

## H. BUILD / INFRA

| # | What | Anchor | Verify |
|---|------|--------|--------|
| H1 | Tests gate builds | `build_only.bat` step [1.5/5], `deploy_updates.bat` step [2.5/8] run `npm test` | Break a test → build aborts |
| H2 | Rules deploy with hosting | Live mode cmd = `firebase deploy --only hosting,firestore:rules` | read bat line |
| H3 | assets/ synced | `sync-assets.js DIRS_TO_COPY=['assets','js']` | www/assets/lottie contains all 5 files |
| H4 | www/ untracked | `.gitignore` `www/` | `git ls-files www` → empty |
| H5 | Version truth | Runtime badge fetches version.json (`initVersionBadge`); `bump_version.js` also patches static badge; exportStudyReport uses runtime value | Badge equals version.json after load |

## I. KNOWN-PENDING (explicitly NOT done — flagged so rechecker doesn't mark as missed bugs)

1. **Hybrid login restoration** — plan only: `HYBRID_LOGIN_RESTORE_PLAN.md` (needs SHA-1 + Firebase console + APK rebuild; user-side)
2. **v164+ login retest on phone** — earlier attempt failed due to stale cached code pre-dating fixes; fixes are live since v164
3. **Conflict-modal end-to-end 2-device test** — user-side
4. **P4 custom-question sharding** — decision deferred until backup-meter data justifies it (`DATA_SAFETY_PACK_PLAN.md` unrelated; sharding plan summarized in chat)
5. **Intentional design debts kept**: `KrishiSM2Engine` internal naming; two storage wrappers; `app.js` monolith; voice stub shim

## J. REGRESSION SURFACE MAP (highest-risk interactions for rechecker to probe first)

1. Switch-account wipe ↔ running sync listener (teardown ordering)
2. Restore fullPush ↔ live onSnapshot echo (guarded by hasPendingWrites/fromCache — confirm no flicker during restore)
3. Snapshot write ↔ 900KB-capped accounts (skip must not block normal sync)
4. Weak-mode prioritization ↔ custom questions with numeric ids vs `q.q` fallback keys
5. OTA engine ↔ frequent version bumps (v162→v173 in one day)

*Report ends. Every claim above is anchored to greppable symbols — no line-number trust required.*
