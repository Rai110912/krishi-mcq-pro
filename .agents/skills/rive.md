# Rive Integration Specification

This document serves as the official technical skill specification for integrating Rive interactive animations into the existing Android learning/MCQ application. This specification strictly protects existing application code and enforces a decoupled, highly performant architecture.

---

## 1. Purpose

Rive is designated exclusively for **interactive, state-based character animations and dynamic reactions**. It must complement the existing application systems without replacing them. 

Authorized Rive use cases include:
- **Interactive learning character** (e.g., an avatar that reacts to user progress).
- **Correct-answer reaction** (e.g., cheering, jumping).
- **Wrong-answer reaction** (e.g., shaking head, looking confused).
- **Thinking state** (while waiting for network or user input).
- **Idle state** (subtle breathing/blinking during inactivity).
- **Celebration** (completing a daily target or mock exam).
- **XP gain & Streak celebration** (dynamic counters or particle bursts).
- **Level-up** (character transformation or high-energy reaction).
- **Loading state** (engaging looping animations).
- **Empty/error states** (character looking through a magnifying glass, or crying).
- **Interactive buttons** (micro-interactions for primary CTAs where appropriate).

---

## 2. Rive Architecture

Rive implementations must be strictly isolated behind an adapter pattern. The core business logic (MCQ Engine, Auth, Sync) must never depend directly on Rive APIs.

**Data Flow:**
```text
UI / User Action (e.g., clicks "Submit Answer")
       ↓
Application Event (e.g., evaluates MCQ, updates localData)
       ↓
Animation Event Controller (intercepts global events)
       ↓
Animation Manager (determines priority and queues the event)
       ↓
Rive Adapter (translates abstract events to Rive inputs)
       ↓
Rive State Machine (evaluates inputs and triggers transitions)
       ↓
Rive Character / Animation (renders to Canvas/Surface)
```

---

## 3. State Machine Design

Rive assets must be built using State Machines, avoiding static, linear timelines where possible.

**Recommended States:**
- `IDLE`: Default looping state (entry condition: none; exit condition: any trigger; priority: lowest; interruptible).
- `THINKING`: Looping state (entry: waiting for processing; exit: processing complete; priority: low; interruptible).
- `CORRECT`: One-shot reaction (entry: `ANSWER_CORRECT` trigger; exit: animation ends → `IDLE`; priority: high; interruptible by another `CORRECT`/`WRONG`).
- `WRONG`: One-shot reaction (entry: `ANSWER_WRONG` trigger; exit: animation ends → `IDLE`; priority: high; interruptible by another `CORRECT`/`WRONG`).
- `CELEBRATE`: High-energy reaction (entry: milestones; priority: high; non-interruptible).
- `XP_GAIN`: One-shot overlay (priority: medium; interruptible).
- `STREAK`: Celebration overlay (priority: high; non-interruptible).
- `LEVEL_UP`: Major transition (priority: critical; non-interruptible).
- `LOADING`: Looping state (priority: medium; interruptible by success/error).
- `ERROR`: Looping or one-shot state (priority: high; interruptible by user dismissal).

**Transition Rules:** Always provide smooth interpolation or explicit transition states (e.g., `IdleToCorrect`) to avoid snapping.
**Fallback Behavior:** If a state fails to trigger, the machine must safely return to `IDLE`.

---

## 4. MCQ Integration

Rive **reacts**; it does not **decide**. The MCQ engine remains the absolute single source of truth.

- `ANSWER_CORRECT`: Sent by the MCQ engine *after* updating `localData.stats` and evaluating the rule. Rive Adapter flips the `isCorrect` boolean or fires the `CorrectTrigger` input.
- `ANSWER_WRONG`: Rive Adapter fires the `WrongTrigger` input.
- `QUESTION_COMPLETED`: Rive Adapter returns character to `IDLE` or `THINKING`.
- `XP_GAINED` / `STREAK_INCREASED` / `LEVEL_UP`: Fired by the centralized `finishSession` or `updateStatsRibbon` logic. Rive Adapter translates these to numerical inputs (e.g., `xpAmount`) or boolean toggles.

---

## 5. Rapid Interaction Protection

Users may spam answers rapidly. The Animation Manager and Rive Adapter must enforce strict protections:
- **Debouncing / Animation Stacking:** Throttle incoming animation triggers. If 5 `ANSWER_CORRECT` events fire in 1 second, only process the last one or drop subsequent triggers if one is playing.
- **State-Machine Conflicts:** Ensure Rive State Machines are configured with "Any State" transitions that allow interrupting an ongoing reaction safely.
- **Priority Queue Strategy:** 
  - *Low/Medium Priority* (e.g., `THINKING`, `XP_GAINED`): Overwritten instantly by new events.
  - *High Priority* (e.g., `CORRECT`, `WRONG`): Can only be overwritten by other High/Critical events.
  - *Critical Priority* (e.g., `LEVEL_UP`): Locks the queue. Subsequent events are ignored or queued until completion.
- **Instance Limits:** Strictly instantiate only **one** Rive Character instance per screen.

---

## 6. Lifecycle Management

To prevent memory leaks and orphaned instances (crucial for WebViews/Android Canvas):
- **App Background:** Pause Rive rendering immediately (`riveInstance.pause()`).
- **App Foreground:** Resume rendering if an animation was active.
- **Screen Navigation / Exit:** Explicitly call `.cleanup()`, `.destroy()`, or equivalent teardown methods. Unmount the canvas.
- **Configuration Change / Rotation:** Recalculate layout bounds but maintain the state machine's current state.
- **Memory Pressure:** Pause hidden Rive instances. If critical memory pressure occurs, unload the Rive instance and fallback to CSS/Static UI.

---

## 7. Performance

Rive animations must never noticeably reduce MCQ interaction performance.
- **Asset Size:** `.riv` files must be rigorously compressed. Target `< 100KB` per character/scene.
- **Lazy Loading:** Do not instantiate Rive until the component is visible in the viewport.
- **Device Scaling:**
  - *Low-end Devices:* Disable Rive entirely or drop framerate to 30fps. Fallback to Native CSS.
  - *Mid-range Devices:* Run at 60fps.
  - *High-end Devices:* Run at 60/120fps.
- **CPU/GPU:** Avoid excessive clipping masks, complex mesh deformations, or overlapping transparent layers within the `.riv` file, as these bottleneck mobile GPUs.

---

## 8. Offline Support

The application is offline-first. Rive must comply:
- **Bundled Assets:** Core `.riv` files (character, core UI reactions) must be bundled within the app package (`assets/` or local public directory).
- **No Network Dependency:** Core animations must never block rendering waiting for a network fetch.
- **Missing/Corrupted Asset Fallback:** If a `.riv` file fails to load or parse, catch the exception silently and fallback to static SVGs or Native CSS animations.

---

## 9. Accessibility

The application must remain fully usable when animations are disabled:
- **Reduced Motion:** Hook into system-level accessibility settings (`prefers-reduced-motion`). If enabled, bypass Rive instantiation entirely and use non-animation fallback feedback (e.g., static color changes, standard Toasts).
- **Screen Readers:** Ensure the Rive canvas is accompanied by `aria-labels` or Android `contentDescription` text that describes the character's reaction.
- **Motion Sensitivity:** Avoid rapid flashing, strobe effects, or excessive screen shaking inside Rive assets.

---

## 10. Asset Management

Strict naming conventions prevent collisions and make dynamic loading predictable.

**Folder Structure:**
```text
assets/rive/
├── characters/
├── reactions/
├── learning/
├── rewards/
└── states/
```

**Naming Rules:**
- **Files:** `[category]_[name]_[version].riv` (e.g., `character_owl_v1.riv`, `reward_streak_v2.riv`).
- **State Machines:** `sm_[context]` (e.g., `sm_avatar_reactions`).
- **Inputs:** `input_[type]_[name]` (e.g., `input_bool_isCorrect`, `input_trigger_celebrate`, `input_num_xp`).
- **Artboards:** `artboard_[name]` (e.g., `artboard_main_character`).

*Vague names like `animation1.riv`, `test.riv`, or `final2.riv` are strictly prohibited.*

---

## 11. Error Handling

Animation failures must NEVER crash the application.
- **Missing/Failed Asset:** Catch load errors. Render a fallback UI (Lottie → Native CSS → Static UI).
- **State Machine Unavailable:** If an expected input trigger does not exist in the `.riv` file, log a soft warning to console and abort the animation call. Do not throw fatal exceptions.
- **Render Crash:** If the WebGL context is lost or the Rive renderer crashes, destroy the canvas element and proceed with the app's business logic smoothly.

---

## 12. Rive + Lottie + 3D Priority

Do not overlap responsibilities. Use the correct tool for the job:
- **Rive:** Use for **interactive characters**, state-based logic, and things that must dynamically react to user input in real-time (e.g., a character whose eyes follow the cursor, or seamlessly transitions from thinking to celebrating).
- **Lottie:** Use for **lightweight, linear visual effects** (e.g., an isolated confetti pop, a loading spinner, a complex icon animation).
- **3D:** Use for **premium/high-impact experiences** ONLY (e.g., a rotating 3D trophy for reaching a 30-day streak).
- **Native Android/CSS:** Use for **simple UI transitions** (e.g., expanding cards, button presses, sliding panels). Avoid Rive/3D for basic UI.

---

## 13. Testing

Before merging any Rive implementation, it must pass this test matrix:
- [ ] **Correct/Wrong Answer:** Verify triggers map to correct states.
- [ ] **Rapid Answers:** Spam clicks. Ensure no memory leaks or visual glitches.
- [ ] **Repeated Answers:** Trigger the same state 5 times in a row. Ensure it restarts or loops correctly.
- [ ] **Screen Navigation:** Navigate away while animating. Verify successful garbage collection.
- [ ] **App Background/Foreground:** Minimize app mid-animation, reopen. Verify it resumes or resets safely.
- [ ] **Offline Mode:** Disconnect internet, clear cache, reboot app. Verify bundled Rive files load.
- [ ] **Missing Asset:** Rename a `.riv` file to simulate a 404. Verify graceful fallback to CSS.
- [ ] **Reduced Motion:** Enable OS reduced motion. Verify Rive does not play.
- [ ] **Low-End Device:** Throttle CPU. Verify graceful degradation.
- [ ] **Voice Assistant Enabled/Disabled:** Verify audio sync and screen reader labels.

---

## 14. Security & Stability

- **Version Control:** All `.riv` files must be committed to version control or securely hosted.
- **No Arbitrary Assets:** Do not download or execute `.riv` files provided by user input or untrusted remote sources.
- **Data Privacy:** Rive inputs must only receive generic state flags (e.g., `isCorrect = true`). Never pass sensitive user data, auth tokens, or PII into Rive text runs or inputs.

---

## 15. Future Compatibility

The architecture relies heavily on the **Rive Adapter** pattern.
Because the MCQ engine calls generic methods like `AnimationManager.playReaction('correct')`, the underlying technology can be swapped completely in the future. If Rive is deprecated, the adapter can be rewritten to route `playReaction('correct')` to a new 2D engine or Lottie without modifying a single line of the MCQ Engine, XP system, Streak system, Analytics, or Authentication modules.
