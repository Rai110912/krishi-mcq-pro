# Offline-First Animation Specification

This document is the official technical skill specification for Offline-First Animation in the Android learning/MCQ application. It guarantees that the application's core visual feedback and learning experience remain fully functional without internet connectivity.

---

## 1. Vision

A futuristic offline-first architecture guarantees that learning never stops because of a bad network connection. 

**Core Principle:**
**NO INTERNET ≠ NO ANIMATION ≠ NO LEARNING**

The following must remain fully available completely offline:
- Correct-answer and Wrong-answer feedback
- XP, Streak, and Progress animations
- Basic character reactions (Rive)
- Core visual effects (Lottie)
- Essential 3D experiences (where practical)
- Native UI animations

---

## 2. Offline Architecture

The architecture routes all animation requests through a local resolver before rendering. Network access is NEVER required for basic animation feedback.

**Data Flow:**
```text
Application Event
       ↓
Animation Event Controller
       ↓
Animation Asset Registry
       ↓
Local Asset Resolver (Primary Source)
       ↓
Animation Orchestrator
       ↓
Rive / Lottie / 3D / Native
```

---

## 3. Asset Classification

Assets are classified into strict tiers to determine bundling priority:
- **CORE:** Must always be bundled in the APK/AAB (e.g., correct/wrong reactions).
- **FREQUENT:** Should normally be bundled or aggressively pre-cached.
- **OPTIONAL:** Can be loaded lazily over the network if available.
- **PREMIUM:** Can be downloaded/updated in the future but must have a local bundled fallback (e.g., heavy 3D scenes).
- **REMOTE:** Purely decorative, never required for core learning functionality.

---

## 4. Offline Asset Registry

The `OfflineAnimationRegistry` manages all local assets. It acts as the single source of truth for available animations.
**Tracked Data:**
`assetId`, `assetType`, `localPath`, `version`, `renderer`, `size`, `deviceTier`, `fallbackAssetId`, `offlineRequired`, `preloadPolicy`.
*(Business logic must not directly reference file paths).*

---

## 5. Local Asset Resolution

When an animation event occurs, the system resolves it synchronously:
1. Check local asset registry.
2. Check asset file availability on disk.
3. Check version compatibility.
4. Check device capability (RAM/GPU bounds).
5. Select the best local asset variant.
6. Render.
7. If unavailable or corrupted, immediately use fallback.
*Crucially: The system never waits for network connectivity.*

---

## 6. Fallback Chain

If an asset is unavailable offline, the system degrades gracefully:
`Preferred Animation` ↓ `Alternative Local Animation` ↓ `Lighter Renderer` ↓ `Native Animation` ↓ `Static UI Feedback`

*Example:* `3D level-up unavailable` → `Rive level-up` → `Lottie level-up` → `Native animation` → `Static level-up message`.
**The user must always receive meaningful feedback.**

---

## 7. Network Independence

Core animation events must NEVER:
- Wait for API responses or remote assets.
- Block navigation or answer selection.
- Block MCQ validation.
- Block the voice assistant.
- Block offline progress tracking.
*(Network requests may happen silently in the background for optional updates).*

---

## 8. Optional Remote Asset Updates

The architecture prepares for future over-the-air (OTA) animation updates:
`Bundled Asset` → `Optional Remote Update` → `Validate` → `Version/Integrity Check` → `Store Safely` → `Use on Future Sessions`

*Rule: If an update fails, the system silently keeps using the existing bundled local asset. Never replace a working asset with an unverified or corrupted asset.*

---

## 9. Asset Integrity

Future remote assets must be rigorously validated before replacing a local copy:
- File integrity (Checksums).
- Supported format & Version compatibility.
- Expected Rive state machine / Lottie composition / 3D metadata.
- File size limits to prevent storage bloat.
*Invalid assets must be rejected safely without crashing the app.*

---

## 10. Offline Cache

The offline cache for optional assets supports strict bounds:
- **Versioning:** Prevent stale assets.
- **Expiration:** Auto-purge unused optional assets.
- **Size limits:** Hard caps on disk space.
- **Corruption detection:** Revert to bundled assets if the cache corrupts.
*Never allow the animation cache to consume excessive storage.*

---

## 11. Preloading Strategy

Avoid startup performance degradation by preloading smartly:
- **STARTUP:** Only critical lightweight assets (e.g., UI CSS, core Lotties).
- **PRACTICE SCREEN:** Frequently used answer-feedback assets (Rive reactions).
- **RESULT SCREEN:** Reward/progress assets.
- **LEVEL-UP / 3D:** Load purely on demand.

---

## 12. Offline + Voice Assistant

Animation and voice are strictly independent. 
For `ANSWER_CORRECT` occurring offline:
`Rive reaction` + `Lottie effect` + `Local success sound` + `Offline TTS`
- If TTS is unavailable, the animation still plays.
- If the animation fails, the voice still speaks.
*Neither system blocks or waits for the other.*

---

## 13. Offline + Haptic

Haptic feedback runs entirely on device and requires no network. Optional haptic patterns are defined for Correct, Wrong, XP, Streak, Achievement, and Level-up. If haptics are disabled or unavailable, visual and audio feedback continues unaffected.

---

## 14. Offline + 3D

- Core educational 3D assets (e.g., a rotating biology model) may be bundled.
- Large, optional, decorative 3D assets must load on demand.
- If unavailable offline, default immediately to a Rive/Lottie/Native fallback.
*Never make core learning dependent on downloading large 3D assets.*

---

## 15. Offline Performance

Offline mode does not automatically mean lower quality. The system uses the exact same `Device profile` + `Performance state` + `Accessibility policy` matrix to determine animation quality, ensuring offline experiences remain rich on capable devices.

---

## 16. Offline State Awareness

The animation behavior remains visually consistent across `ONLINE`, `OFFLINE`, `LIMITED`, and `SYNCING` states. Do NOT display unnecessary network-related UI or loading animations for standard learning events simply because the app is offline.

---

## 17. Synchronization Safety

Animation state must never depend on cloud synchronization.
When a user answers correctly offline, the local database (`MCQ result`, `XP`, `Streak`) and the animation must update instantly. When background synchronization occurs later, the animation must not wait for or be blocked by that sync.

---

## 18. Conflict Protection

Idempotent event handling protects against historical replays.
If local and remote data later synchronize, animations should not replay historical events.
*Example: A level-up already celebrated offline must not automatically replay a second time simply because cloud sync finally completed in the background.*

---

## 19. Long Offline Sessions

The app may be used offline for hours (e.g., during a flight). The system protects against:
- Memory/Cache growth.
- Animation accumulation.
- Repeated asset loading overhead.
- Storage bloat from background caching.

---

## 20. Security

Remote animation assets are treated strictly as data/resources, never trusted blindly.
- Do not execute arbitrary code from animation assets.
- Never expose authentication tokens, API keys, user credentials, or personal data to animation text-runs or payloads.

---

## 21. Accessibility

Accessibility settings (`FULL`, `REDUCED`, `MINIMAL`, `OFF`) apply globally and work perfectly without network access. An offline user who requires "Reduced Motion" will still receive the correct minimal static feedback.

---

## 22. Testing Matrix

Tests must cover:
- [ ] Airplane mode / No SIM / Weak network.
- [ ] Network switching (Offline → Online, Online → Offline).
- [ ] Long offline study sessions (1+ hours).
- [ ] Missing / Corrupted local asset validation.
- [ ] Remote update failure / Cache failure.
- [ ] Voice assistant offline / Haptic offline.
- [ ] 3D asset unavailable (Fallback validation).
- [ ] Low-end device in offline mode.
- [ ] Reduced motion in offline mode.

---

## 23. Future Intelligent Offline Mode

The architecture prepares a local intelligence layer capable of choosing animation intensity, renderer, asset quality, and preload strategy entirely on-device, based on `Device Capability` + `Performance` + `Accessibility` + `Current Context`. This intelligence must operate locally and never control MCQ correctness, authentication, or security.

---

## 24. Golden Rules

1. Core animation must work offline.
2. Core learning must never depend on animation.
3. Animation must never depend on cloud sync.
4. Network failure must never break animation.
5. Remote assets must always have safe fallbacks.
6. Local assets are the foundation.
7. Performance and accessibility always override visual complexity.
8. Animation failures must never crash the application.
9. Offline progress must not cause duplicate animation events after synchronization.
10. Existing application functionality must remain untouched.
