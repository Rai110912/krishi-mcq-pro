# Data Safety Pack — Implementation Plan

> **Status:** PLANNED — awaiting execution go-ahead
> **Goal:** Make Cloud Sync bulletproof: any bad merge / accidental wipe / corrupt state becomes reversible in 2 taps.
> **Depends on:** v164 deployed ✓ · Restore/Export feature (shipped v162) ✓

---

## Component Overview

| # | Feature | Storage | Effort |
|---|---------|---------|--------|
| 1 | **Cloud Snapshots** ("Time Machine") | Firestore `users/{uid}/snapshots` | ~2-3 hrs |
| 2 | **Auto Local Rotation** | IndexedDB `KrishiAppDB → krishi_daily_backups` | ~1 hr |
| 3 | **Sync Dashboard** | UI only (reuses existing buffers) | ~1 hr |

New sidecar module: `js/data_safety.js` (follows established `window.*` pattern)
Feature flag: `krishi_data_safety_enabled` (kill switch, default ON)

---

## 1️⃣ Cloud Snapshots (Time Machine)

### Write path
- Trigger: after successful `performCloudSync` AND after listener-driven merges
- Throttle: minimum **30 min** between auto-snapshots + forced snapshot on manual "Create restore point"
- Skip-if-unchanged: compare `updatedAt` + total-counter hash vs last snapshot; skip when identical
- Payload: `collectAllAppData()` output minus bulky logs (`timingLog` truncated to last 500 entries)
- Doc shape: `users/{uid}/snapshots/{YYYYMMDD_HHmm}` → `{ payload, createdAt, statsSummary, size }`
- Size guard: reuse `assertPayloadFits()` — too big ⇒ skip + `krishiLogSilent('snapshot.skipped')` (never blocks normal sync)
- Retention: keep newest **10**, batch-delete older (same pattern as session pruning)

### Read path (restore)
- Settings → Sync section → "🛟 Restore Points" opens modal listing snapshots
  (date, solved-count summary, size)
- Tap Restore → `confirm()` → `applyAllAppData(payload)` → mark `krishi_sync_pending`
  → `scheduleCloudSync('Snapshot restored')` → toast
- Same safety rails as JSON Import (empty-collection guards apply automatically)

### Rules impact
None — `users/{uid}` wildcard already covers subcollections.

---

## 2️⃣ Auto Local Backup Rotation

- On first app open of each calendar day: `collectAllAppData()` → JSON → IndexedDB
  store `krishi_daily_backups`, key = `b_{YYYY-MM-DD}`
- Retention: keep **7** most recent; delete rest
- Zero network dependency — survives hosting/Firestore outages completely
- Restored via same modal, "Local backups" tab
- Write wrapped in try/catch + silent-failure telemetry

---

## 3️⃣ Sync Dashboard

New card in profile-sync-actions area:

```
┌────────────────────────────────────────────┐
│ 📊 Sync Activity          [Refresh]        │
│ ✅ 14:02 Merged 3 collections (delta)      │
│ ✅ 13:41 Snapshot created (412 KB)         │
│ ⚠️ 12:58 Listener error → retry queued     │
│ …last 20 events                            │
│ 💾 Backup: ~340 KB / 900 KB                │
│ 🛟 Last snapshot: today 13:41              │
│ [Create restore point] [🛟 Restore…]       │
└────────────────────────────────────────────┘
```

- Events source: existing `logSyncActivity()` buffer (render-only, zero extra writes)
- Includes pending offline-queue count and current meter value

---

## File Touch List

| File | Change |
|------|--------|
| `js/data_safety.js` | NEW — snapshots + rotation + dashboard logic (~400 lines) |
| `index.html` | Script tag, dashboard card, restore modal markup |
| `sw.js` | Precache entry for new JS file |
| `firestore.rules` | None needed (wildcard covers) |
| `js/app.js` | Hook calls: post-success snapshot trigger points (2 sites), expose `logSyncActivity` buffer if not global |

## Verification Checklist

- [ ] Practice → sync → snapshot appears in Firestore within throttle window
- [ ] Change data → wait <30 min → NO duplicate snapshot (skip-if-unchanged works)
- [ ] Create 11th snapshot → oldest pruned (count stays ≤10)
- [ ] Wipe local stats manually (devtools) → Restore from snapshot → data back + pushed to cloud
- [ ] Airplane mode → daily local backup still written; dashboard shows offline queue
- [ ] Kill switch OFF → zero snapshot writes, dashboard hidden
- [ ] Payload >900KB account → snapshot skipped gracefully, sync unaffected

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Extra Firestore writes | 30-min throttle + skip-if-unchanged ⇒ typically ≤2/day |
| Storage growth | 10-snapshot cap ≈ max ~5-8 MB per user |
| Restore applies stale payload over newer data | Confirm dialog states date clearly; post-restore full delta push reconciles |
| Large payloads slow modal open | List renders summaries only; full payload fetched on selection |

## Rollback

Kill switch flag OFF = feature fully dormant. Code removal optional later;
no schema dependencies outside its own subcollection/store.
