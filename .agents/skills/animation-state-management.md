# Animation State Management Specification

This document is the official technical skill specification for Animation State Management in the Android learning/MCQ application. It defines a deterministic, event-driven architecture that safely coordinates Rive, Lottie, 3D, Native UI, Audio, and Haptics without conflicting with core business logic.

---

## 1. Vision

The Animation State Management architecture is deterministic and event-driven. It ensures that complex, multi-layered visual and sensory feedback (Rive, Lottie, 3D, sound, voice, haptics) is coordinated flawlessly. 
The animation system remains **completely separate** from the application's business logic, acting as an isolated, reactive visual layer.

---

## 2. Core Principle

**Animation state must NEVER determine application state.**

```text
Application State (MCQ evaluated as correct)
       ↓
Semantic Event (ANSWER_CORRECT emitted)
       ↓
Animation State Manager (Registers the event)
       ↓
Animation Orchestrator (Evaluates budget and priority)
       ↓
Renderer (Rive/Lottie/3D/Native executes)
```

*Example:* A Rive `CORRECT` animation must NOT dictate whether an MCQ answer is correct or when the user proceeds. The MCQ engine is the sole source of truth.

---

## 3. Animation State Model

Every animation event moves through a strict lifecycle.

**Standard States:**
- `IDLE`: Default rest state.
- `PREPARING`: Resolving assets and configuring renderer.
- `LOADING`: Fetching assets from cache/disk/network.
- `PLAYING`: Actively rendering frames.
- `PAUSED`: Temporarily halted (e.g., app backgrounded).
- `INTERRUPTED`: Overridden by a higher-priority event.
- `QUEUED`: Waiting for a higher-priority event to finish.
- `COMPLETED`: Finished natural playback.
- `CANCELLED`: Dropped before or during playback.
- `FAILED`: Crashed or missing asset.
- `FALLBACK`: Downgraded to a lighter renderer due to failure.

---

## 4. State Machine

The state machine is highly deterministic. No undefined states may exist.

**Normal Path:**
`IDLE` → `PREPARING` → `PLAYING` → `COMPLETED` → `IDLE`

**Failure Path:**
`PLAYING` → `FAILED` → `FALLBACK` → `COMPLETED` → `IDLE`

**Interruption Path:**
`PLAYING` → `INTERRUPTED` → `CANCELLED / RESUME / FALLBACK` → `IDLE`

---

## 5. Animation Ownership

State and execution ownership is strictly separated to prevent uncontrolled feedback loops.

- **AnimationStateManager:** Owns the state (Playing, Queued, Failed).
- **AnimationOrchestrator:** Decides *what* should play and manages priority.
- **RiveAdapter / LottieAdapter / ThreeDAdapter:** Controls specific renderers.
- **AudioAdapter / HapticAdapter:** Controls sound and vibration.
- **Business Logic (MCQ Engine):** Owns learning and application state. *Business logic never controls renderer state directly.*

---

## 6. Priority System

In the event of competing animations, priority dictates the outcome.

| Level | Example | Conflict Resolution |
| :--- | :--- | :--- |
| **CRITICAL** | `LEVEL_UP` | Interrupts all current animations. Locks queue. |
| **HIGH** | `ACHIEVEMENT` | Interrupts Normal/Low. Queues behind Critical. |
| **NORMAL** | `ANSWER_CORRECT`| Safely interrupts previous Normal. Yields to High. |
| **LOW** | `BUTTON_PRESS` | Dropped if system is busy. |
| **BACKGROUND**| Ambient FX | Lowest priority, pauses easily. |

*Never allow uncontrolled simultaneous animations. If `LEVEL_UP` occurs during `ANSWER_CORRECT`, `ANSWER_CORRECT` is safely cancelled or finalized, and `LEVEL_UP` begins.*

---

## 7. Queue Management

The `AnimationQueue` is responsible for handling rapid state changes.

**Responsibilities:**
- **Queue/Prioritize:** Sequence events safely.
- **Deduplicate/Merge:** E.g., Five rapid `XP_GAINED` events merge into a single `XP_GAINED(totalXP)` instead of playing five overlapping animations.
- **Cancel/Replace:** Evict low-priority events when the queue is full.
- **Drop:** Ignore low-priority events if the performance budget is exceeded.

---

## 8. Debouncing & Throttling

Strict protections exist against spam and race conditions:
- **Double taps / Rapid answers:** Input throttling debounces triggers within a short window (e.g., 200ms).
- **Animation Spam:** Animations must never stack visually.
- **Non-blocking:** Animations must **never** block the user from answering the next question.

---

## 9. Renderer Arbitration

The `RendererSelector` dynamically determines the best engine for an event:

`Event` + `Device` + `Performance` + `Accessibility` + `Asset Availability` = **Best Renderer** (Rive / Lottie / 3D / Native / Static)

Only **one** primary renderer should own a visual event unless explicitly designed as a synchronized multi-layer animation.

---

## 10. Multi-Layer Animation

Intentional combinations (Visual + Sound + Haptic) are permitted but must share one parent event.

*Example for `ANSWER_CORRECT`:*
- **Rive:** Character reaction
- **Lottie:** Small celebration particles
- **Audio:** Success sound
- **Haptic:** Short feedback

*Rule:* All components share the exact same `eventId` and lifecycle. If the event is cancelled, all layers stop simultaneously.

---

## 11. Synchronization

Synchronization between animation, sound, voice, and haptics is completely **non-blocking**.
- Use event markers/timestamps to align visuals with audio.
- Voice must never wait indefinitely for animation to finish.
- Animation must never wait indefinitely for voice fetching.
- All layers must be individually cancelable and recoverable.

---

## 12. Lifecycle Awareness

Animation state reacts strictly to Android/Compose lifecycles.
- **App background:** Pause active animations.
- **Screen navigation / Disposal:** Non-critical animations are cancelled immediately. Critical animations (e.g., Level Up) safely finalize or cancel based on defined policy.
- **Memory pressure / Recreation:** Safely purge the queue and fallback to static UI.
*No animation should continue rendering after its owner (Fragment/Activity/View) is destroyed.*

---

## 13. Memory Safety

Strict bounds prevent resource exhaustion:
- No duplicate controllers or renderers.
- No orphaned animations.
- Explicit cleanup to prevent memory/GPU leaks.
- Rive instances, Lottie compositions, and 3D resources must be `.destroy()`'d.
- Every animation has a clear lifecycle owner.

---

## 14. Timeout Protection

Every animation is given a maximum expected duration limit.
If an animation becomes stuck (e.g., endless loading loop, WebGL freeze):
`PLAYING` → `TIMEOUT` → `CANCEL` → `FALLBACK` → `IDLE`
*A stuck animation must NEVER permanently block the application.*

---

## 15. Error Recovery

The fallback chain prevents crashes:
- `Rive` fails → `Lottie` fallback
- `Lottie` fails → `Native` fallback
- `3D` fails → `Rive/Lottie` fallback
- `Audio` fails → Continue visual animation
- `Haptic` fails → Continue visual/audio feedback

Animation failure must **never** crash or block learning functionality.

---

## 16. Offline State

Animation state operates entirely independently of network connectivity. Core learning feedback must remain available offline. No remote animation request may block local state transitions.

---

## 17. Accessibility State

A global animation policy dictates rendering capabilities:
- **FULL:** Rive + Lottie + 3D + Sound + Haptic
- **REDUCED:** Rive/Lottie only (no 3D, limited motion)
- **MINIMAL:** Native/Static feedback only
- **OFF:** Static UI feedback

*Accessibility settings always override visual complexity.*

---

## 18. Future Adaptive Animation

The architecture prepares an `AdaptiveAnimationPolicy`.
In the future, an AI could evaluate inputs (Learning context, achievement level, device tier, accessibility) to recommend animation intensity. 
**Constraint:** Future AI must **never** control MCQ correctness, security, navigation, or core business logic.

---

## 19. Debug State

A development-only state inspector overlays the screen, exposing:
- Current Event & Renderer
- Current State & Priority
- Active Queue & Elapsed Time
- Fallback Reason & Performance Cost
*Sensitive user data is strictly prohibited from debug logs.*

---

## 20. Testing Matrix

Tests must cover:
- [ ] Correct/Wrong answer parsing.
- [ ] Rapid answers & duplicate event debouncing.
- [ ] Multiple simultaneous events (Queue overflow & Priority conflicts).
- [ ] Animation timeout & Renderer failures.
- [ ] Screen navigation & Background/Foregrounding.
- [ ] Memory pressure disposal.
- [ ] Offline mode & Missing assets.
- [ ] Accessibility: Reduced motion & Animation OFF.
- [ ] Sensory failure: Voice, Haptic, or 3D unavailable.

---

## 21. Golden Rules

1. Business state is the source of truth.
2. Animation state is disposable.
3. Animation failure must never crash the app.
4. Accessibility overrides animation intensity.
5. Performance overrides visual complexity.
6. Critical learning interactions override decorative animation.
7. Every animation must have a fallback.
8. Every animation must have an owner.
9. Every animation must be cancellable.
10. No uncontrolled animation stacking.
