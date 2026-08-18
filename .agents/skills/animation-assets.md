# Animation Asset Management Specification

This document is the official technical skill specification for Animation Asset Management in the Android learning/MCQ application. It guarantees that all animation assets remain discoverable, versioned, cacheable, replaceable, offline-first, and performant, without jeopardizing existing production components.

---

## 1. Vision

The Animation Asset Intelligence System is designed to securely and efficiently manage Rive assets, Lottie files, 3D models/textures, audio, and haptic patterns. 

The system guarantees that assets are:
**DISCOVERABLE • VERSIONED • REUSABLE • CACHEABLE • REPLACEABLE • DEVICE-AWARE • OFFLINE-FIRST • PERFORMANCE-AWARE**

---

## 2. Asset Architecture

The logical asset structure categorizes files by engine and semantic purpose. *(Note: Do not automatically create these directories; future implementations must adapt to or safely migrate the existing project structure).*

```text
assets/
└── animations/
    ├── rive/
    │   ├── characters/
    │   ├── reactions/
    │   ├── rewards/
    │   └── states/
    ├── lottie/
    │   ├── feedback/
    │   ├── rewards/
    │   ├── progress/
    │   ├── streak/
    │   ├── loading/
    │   └── achievements/
    ├── 3d/
    │   ├── characters/
    │   ├── scenes/
    │   ├── models/
    │   ├── materials/
    │   └── textures/
    ├── audio/
    │   ├── feedback/
    │   ├── rewards/
    │   └── characters/
    └── haptics/
```

---

## 3. Asset Identity

Assets must NEVER be identified by their raw file paths in business logic. They must use **Unique Semantic IDs** that are stable, human-readable, and version-independent.

**Examples:**
- `rive.character.learning.idle`
- `lottie.feedback.correct`
- `lottie.reward.xp`
- `threeD.scene.levelUp`

---

## 4. Asset Metadata

Every registered asset carries non-PII metadata for the Orchestrator to evaluate:
- `assetId`: Semantic ID.
- `assetType`: e.g., `.riv`, `.json`, `.glb`.
- `renderer`: Target engine.
- `version`: SemVer string.
- `minimumAppVersion`: Required app build.
- `fileSize`: Bytes.
- `estimatedMemory`: Expected RAM footprint.
- `estimatedGpuCost`: Expected GPU overhead.
- `supportedDeviceTier`: `LOW`, `MEDIUM`, `HIGH`, `ULTRA`.
- `offlineAvailable`: Boolean.
- `fallbackAssetId`: Alternative semantic ID.
- `preloadPolicy`: Caching instruction.

---

## 5. Versioning

A strict Semantic Versioning (`MAJOR.MINOR.PATCH`) strategy applies to assets (e.g., `learning_character_v2.1.0.riv`).
- **MAJOR:** Breaks state machine inputs/triggers.
- **MINOR:** Adds new animations/states but maintains backward compatibility.
- **PATCH:** Visual tweaks (colors, pacing) without logic changes.

*An asset update must never silently break older animation events referencing earlier versions.*

---

## 6. Asset Compatibility

Before replacing an existing asset dynamically or via an OTA update, the system must verify:
- File exists and parses correctly.
- Expected state machine and inputs exist.
- Required minimum app version is met.
- A valid fallback is available if the load fails.
*Rule: Never replace an asset blindly.*

---

## 7. Reference Safety & Existing Asset Protection

Before moving, deleting, or renaming ANY existing asset, developers must:
1. Search the entire project (`grep / Find in Files`).
2. Verify references in Java/Kotlin, JSON/XML configs, Navigation graphs, Compose resources, and existing 3D scenes.
3. **If references are found, do not break them.** The existing implementation is production-critical.

---

## 8. Device-Aware Assets

Assets are tagged for specific device capability tiers: `LOW`, `MEDIUM`, `HIGH`, `ULTRA`.
The system dynamically selects the appropriate variant. For example:
- **Ultra/High:** High-poly 3D models, complex Rive meshes.
- **Medium:** Standard Lotties, optimized 3D.
- **Low:** Minimal vectors, no shadows, or degraded to Native CSS.

---

## 9. Performance Metadata

Expensive assets carry a performance cost tag (`LOW`, `MEDIUM`, `HIGH`, `EXTREME`). 
The Orchestrator actively prevents crashes by overriding selections:
`[LOW-END DEVICE] + [EXTREME-COST 3D ASSET] = Select Rive/Lottie fallback`

---

## 10. Offline-First

**Core animation assets must be bundled with the APK/AAB.**
The application must NOT depend on network access for:
- Correct/wrong feedback
- XP and Streak visualizations
- Basic rewards
- Core character reactions

Remote asset updates are optional. If remote fetching fails, the system instantly uses the bundled local asset.

---

## 11. Caching

Safe caching prevents excessive storage consumption and duplicate files in memory.
- **Cache Key:** Hash of `AssetId + Version`.
- **Expiration:** Unused remote assets expire after 30 days.
- **Maximum Cache Size:** Strict MB limits for the animation cache directory.
- **Cleanup:** LRU (Least Recently Used) cache eviction.

---

## 12. Preloading Strategy

- **`PRELOAD`:** (App Startup) Critical, lightweight UI feedback assets (e.g., `lottie.feedback.correct`).
- **`LAZY_LOAD`:** (Screen Entry) Assets likely needed soon (e.g., end-of-session rewards).
- **`ON_DEMAND`:** (Event Trigger) Heavy, rare assets (e.g., huge 3D level-up scenes).

---

## 13. Asset Fallback Chain

If an asset is missing, corrupted, or too expensive for the current device, it cascades down the rendering chain:
`Primary Asset (3D)` ↓ `Alternative (Rive)` ↓ `Lighter Renderer (Lottie)` ↓ `Native Animation` ↓ `Static UI`

---

## 14. Asset Integrity

The system automatically verifies assets before use, detecting:
- Missing files / 404s.
- Corrupted binary data.
- Missing required Rive state machines or Lottie compositions.
*Result:* Invalid assets fail safely and trigger the fallback chain without crashing the app.

---

## 15. Animation Asset Registry

The `AnimationAssetRegistry` is a centralized logical registry. Business logic must **never** reference arbitrary file paths. 
The Registry is exclusively responsible for:
- Registering assets.
- Resolving Semantic IDs.
- Selecting device variants and fallbacks.
- Reporting failures to analytics.

---

## 16. Future AI Asset Selection

The architecture prepares an optional `AnimationAssetSelector` interface. In the future, an on-device AI may evaluate inputs (Application Event + Device Capability + Learning State) to *recommend* a specific asset variant. 

**Absolute Constraint:** AI must NEVER override MCQ correctness, security policies, accessibility settings, offline requirements, or performance safety limits.

---

## 17. Asset Governance

- Every production asset must have an explicit owner/feature source.
- Every asset must have a version and a guaranteed fallback.
- Experimental/Dev assets must be strictly isolated from Production assets.
- Periodic cleanup routines must identify and purge duplicate or orphaned assets.

---

## 18. Development vs Production

- **DEV / STAGING:** Debug-only animations or experimental `.riv` files can be side-loaded.
- **PRODUCTION:** Assets are strictly bundled and signed. Experimental assets must never accidentally ship to end-users.

---

## 19. Testing

The Asset Registry must pass tests for:
- [ ] Missing, corrupted, or wrong-version assets.
- [ ] Missing fallback chains.
- [ ] Unsupported/low-end devices (Verify tier downgrades).
- [ ] Offline mode (Verify bundled assets load).
- [ ] Cache eviction policies.
- [ ] Memory pressure (Verify large asset rejection).
- [ ] Accessibility overrides (Reduced motion).

---

## 20. Golden Rules

**NEVER:**
- Break an existing asset reference.
- Delete an asset without deep dependency analysis.
- Load massive assets unnecessarily or block the main thread.
- Make core learning feedback dependent on the network.
- Allow an asset parse failure to crash the application.
- Embed business logic inside an animation file.

**ALWAYS:**
- Use stable semantic IDs instead of file paths.
- Maintain a robust fallback chain.
- Respect device capabilities and memory budgets.
- Respect user accessibility settings.
- **Protect existing production assets at all costs.**
