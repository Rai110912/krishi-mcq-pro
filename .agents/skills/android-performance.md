# Android Animation Performance Specification

This document is the official technical skill specification for Animation Performance in the Android learning/MCQ application. It guarantees a smooth, responsive learning experience by enforcing strict constraints on Rive, Lottie, 3D, and native animations.

---

## 1. Vision

The performance architecture is futuristic, adaptive, and device-aware. It allows the app to provide rich sensory feedback (animations, 3D, haptics, voice) while maintaining absolutely smooth learning interactions.

**Core Principle:**
**APPLICATION PERFORMANCE > DECORATIVE ANIMATION**
The animation system must automatically reduce visual complexity when necessary to ensure the core MCQ experience never stutters.

---

## 2. Performance Targets

- **Preferred Frame Rate:** `60 FPS` for normal interaction. Up to `120 FPS` where hardware supports it.
- **Zero Tolerance:** No sustained frame drops during MCQ answering, scrolling, timer countdowns, navigation, voice assistant execution, or data synchronization.
- **Strict Thresholds:** Strict limits must be maintained for Jank, GPU/CPU overhead, and maximum heap size. Asset load times must not block the main thread.

---

## 3. Device Capability Detection

The system evaluates a `DevicePerformanceProfile` on boot.
**Tiers:** `LOW`, `MEDIUM`, `HIGH`, `ULTRA`
**Evaluation Metrics:** RAM limits, CPU concurrency, GPU class, Refresh Rate, Thermal state, Battery level, and active rendering load.
*Rule: Never collect or transmit unnecessary personal/device information for this profiling.*

---

## 4. Dynamic Quality System

The `DynamicAnimationQuality` scales seamlessly:
`ULTRA` → `HIGH` → `BALANCED` → `LOW` → `MINIMAL`

As performance deteriorates, the system dynamically reduces:
- 3D complexity / Draw calls
- Particle counts
- Shadow and lighting quality
- Texture resolution
- Animation frequency & Simultaneous effects

---

## 5. Rendering Budget

Strict budgets govern CPU, GPU, RAM, texture memory, active instances, and particle emission rates.
**When a budget is exceeded:**
1. Stop new low-priority effects immediately.
2. Reduce visual quality.
3. Cancel ongoing decorative animations.
4. Keep critical learning interactions active.

*Never sacrifice question answering, timer accuracy, navigation, data integrity, or core voice functionality.*

---

## 6. Rive Optimization

- **Reuse:** Share Rive instances and Artboards where appropriate.
- **State Machines:** Avoid unnecessary recreation of state machines.
- **Lazy Loading & Caching:** Load `.riv` files asynchronously and cache them in memory.
- **Limits:** Strict cap on simultaneous Rive renderers (e.g., max 2 active Canvas elements).
- **Disposal:** Call `.destroy()` when views detach.

---

## 7. Lottie Optimization

- **Vectors Only:** Avoid excessive layers and completely ban embedded raster images (PNGs).
- **Reuse:** Cache compositions.
- **Limits:** Limit simultaneous playback to 3 instances.
- **Disposal:** Nullify Lottie bindings on screen exit.

---

## 8. 3D Optimization

- **Constraints:** Strict budgets on polygon count, texture resolution, materials, lighting complexity, and shadows.
- **Engine Reuse:** Prefer the *existing* optimized 3D infrastructure. Do NOT introduce a new 3D engine unless rigorous future analysis demands it.
- **VRAM Safety:** Rigorously unload models and textures when a scene closes to free GPU memory.

---

## 9. Lazy Loading

Asset loading operates on a strict schedule:
- **`CRITICAL`** (Correct/Wrong feedback) → **Preload** early.
- **`FREQUENT`** (Reward icons) → **Preload** when screen becomes relevant.
- **`OCCASIONAL`** (Milestone Lottie) → **Lazy load** before trigger.
- **`RARE / EXPENSIVE`** (3D Level Up) → **On-demand** loading only.

---

## 10. Memory Management

Active protection against OOM (Out of Memory) crashes:
- No duplicate animation controllers, renderers, or unreleased textures.
- Prevent infinite caching and massive asset retention.
- Safe cleanup guarantees during screen disposal, navigation, backgrounding, session completion, and OS `onTrimMemory` events.

---

## 11. Thermal Awareness

The app listens to Android thermal state APIs.
If the device overheats:
`ULTRA` ↓ `HIGH` ↓ `BALANCED` ↓ `LOW` ↓ `MINIMAL`
Expensive 3D and high-particle effects are throttled or disabled first to cool the device, without disrupting core learning functionality.

---

## 12. Battery Awareness

When the battery drops to a critical low (e.g., < 15%):
- Reduce decorative animations, 3D processing, and particle effects.
- Reduce animation frequency and default to lightweight native effects.
- *Never disable essential learning functionality.*

---

## 13. Reduced Motion

Respect accessibility settings globally:
`FULL` → `REDUCED` → `MINIMAL` → `OFF`
*Accessibility policy mathematically overrides all performance/quality preferences.*

---

## 14. Animation Scheduling

An `AnimationScheduler` orchestrates the queue to prevent:
- Animation storms (too many triggering at once).
- Simultaneous expensive renders.
- Duplicate events and CPU spikes.
*Decorative effects are aggressively delayed, merged, or skipped to prioritize critical interactions.*

---

## 15. Performance Monitoring

A dev-only suite tracks FPS, frame time, Jank, memory bounds, asset load times, and fallback rates. Monitoring must operate seamlessly without creating its own noticeable overhead.

---

## 16. Adaptive Renderer Selection

The Orchestrator algorithm:
`Event + Device Profile + Performance State + Accessibility + Asset Cost = Renderer Selection`
- **High-end:** 3D + Rive + Lottie
- **Mid-range:** Rive + Lottie
- **Low-end:** Lottie + Native
- **Minimal:** Native / Static

---

## 17. Offline Performance

Animations remain strictly functional offline. No unnecessary network calls for assets. The UI is never blocked waiting for an optional remote asset payload.

---

## 18. Startup Performance

**Do NOT load every animation during app boot.**
Startup loads only critical UI resources, core typography, and lightweight feedback. Large `.riv` and `.glb` files load much later to protect TTI (Time to Interactive).

---

## 19. Scroll Performance

Animations must not cause scroll stutter, layout thrashing, or block the main thread.
Animations outside the visible scroll bounds must pause their render loops aggressively.

---

## 20. Voice + Animation Performance

Voice assistant and animation processes operate concurrently but independently.
- Animation never blocks TTS, Speech Recognition, or MCQ validation.
- Voice fetching never freezes the animation thread.
- Asynchronous coordination ensures neither system bottlenecks the other.

---

## 21. Performance Fallback Chain

If performance crashes, degrade gracefully:
- **LEVEL 1:** Reduce decorative effects.
- **LEVEL 2:** Reduce animation quality.
- **LEVEL 3:** Disable expensive 3D.
- **LEVEL 4:** Force Rive/Lottie minimal modes.
- **LEVEL 5:** Force native/static feedback.
*(The user maintains a fully functional learning experience at all levels).*

---

## 22. Debugging Dashboard

A dev-only Performance Dashboard overlays FPS, memory, active renderers, fallback counts, and device tier. **This must never be exposed to normal end-users.**

---

## 23. Testing Matrix

Performance must be validated against:
- [ ] Low / Mid / High-end Android devices
- [ ] 60Hz / 90Hz / 120Hz refresh rates
- [ ] Low battery mode / Thermal throttling
- [ ] Memory pressure (running heavy apps in background)
- [ ] Offline mode
- [ ] Long study sessions (Memory leak testing)
- [ ] Rapid MCQ answering
- [ ] Voice assistant + 3D active simultaneously
- [ ] Dark mode & Tablet layouts

---

## 24. Long Session Stability

The app protects against gradual memory growth, cache bloat, and animation accumulation over 2+ hour study sessions. Frame drop rates must remain stable from minute 1 to minute 120.

---

## 25. Future AI Performance Optimizer

An optional `PerformanceOptimizationEngine` interface is prepared.
In the future, an intelligent system could evaluate thermal state, battery, FPS history, and memory pressure to dynamically recommend renderer quality and preloading paths. 
*Constraint: AI MUST NEVER override user accessibility preferences or core application safety.*

---

## 26. Golden Rules

1. Performance is more important than decorative animation.
2. Never block the main learning flow.
3. Prefer the lightest renderer that achieves the desired effect.
4. Avoid loading unnecessary assets.
5. Avoid unnecessary simultaneous animations.
6. Release resources aggressively but safely.
7. Adapt quality to device conditions.
8. Protect low-end devices.
9. Support long study sessions (zero memory leaks).
10. Animation failure must never crash the app.
