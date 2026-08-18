# Lottie Integration Specification

This document is the official technical skill specification for integrating Lottie animations into the Android learning/MCQ application. It ensures Lottie is used appropriately for lightweight visual effects without jeopardizing the stability, performance, or architecture of the core application.

---

## 1. Purpose

Lottie is designated strictly for **lightweight, high-performance visual effects**. It should NOT be used as the primary system for complex interactive characters (which are handled by Rive).

**Approved Lottie Use Cases:**
- Correct answer celebration
- Wrong answer feedback
- XP gain
- Coin/reward animation
- Streak animation
- Confetti
- Checkmark animation
- Error animation
- Success animation
- Loading animation
- Empty-state animation
- Small UI micro-interactions
- Achievement animations
- Daily goal completion
- Mock exam completion

---

## 2. Animation Architecture

Lottie implementations must be isolated behind the centralized animation architecture defined in `animation-system.md`. Business logic must never directly control Lottie.

**Data Flow:**
```text
Application Event (e.g., MCQ answered)
       ↓
Animation Event Controller
       ↓
Animation Manager
       ↓
Lottie Adapter
       ↓
Lottie Renderer
       ↓
Lottie Asset (.json / .lottie)
```

---

## 3. Event Mapping

| Event Name | Animation Type | Duration | Priority | Interruptible | Repeat | Queued | Fallback |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ANSWER_CORRECT` | Checkmark/Glow | 0.5s - 1.2s | HIGH | Yes | No | No | CSS Glow |
| `ANSWER_WRONG` | Cross/Shake | 0.5s - 1.0s | HIGH | Yes | No | No | CSS Shake |
| `XP_GAINED` | Text Pop/Stars | 1.0s - 1.5s | NORMAL | Yes | No | Yes | Text Scale |
| `STREAK_INCREASED`| Fire/Spark | 1.5s - 2.5s | HIGH | No | No | Yes | CSS Flame |
| `LEVEL_UP` | Confetti/Badge | 2.5s - 4.0s | CRITICAL | No | No | Yes | Modal |
| `DAILY_GOAL_COMPLETED`| Fireworks | 2.5s - 4.0s | CRITICAL | No | No | Yes | Modal |
| `MOCK_EXAM_COMPLETED`| Trophy/Badge | 2.0s - 3.5s | HIGH | No | No | Yes | Modal |
| `SUCCESS` | Subtle Check | 0.5s - 1.5s | LOW | Yes | No | No | Native Pop |
| `ERROR` | Warning Icon | 1.0s - 2.0s | HIGH | Yes | No | No | Native Toast |
| `LOADING` | Spinner/Dots | Infinite | NORMAL | Yes | Yes | No | CSS Spinner |
| `BUTTON_PRESS` | Ripple/Scale | 0.2s - 0.4s | LOW | Yes | No | No | CSS Transform|

---

## 4. Performance Rules

Lottie animations must remain lightweight and never reduce the performance of MCQ scrolling, answer selection, timers, voice assistant, navigation, analytics, or data synchronization.

- **JSON Asset Size:** strictly `< 200KB` per file (preferably `< 50KB`). Use `.lottie` format if beneficial.
- **Image Assets:** Avoid embedded raster images (PNG/JPG) inside Lottie files. Use 100% vector paths.
- **Vector Complexity:** Avoid complex clipping masks, excessive matte layers, and high-node-count paths.
- **Simultaneous Animations:** Maximum of 3 concurrent Lottie animations rendering on screen at any time.
- **Frame Rate:** Animations must render smoothly at 60fps.
- **Memory & CPU/GPU:** Must use hardware acceleration but keep rasterization overhead minimal. 
- **Asset Caching:** Pre-cache frequently used assets (like correct/wrong icons) in memory.
- **Lazy Loading:** Do not load complex rewards animations until the exact moment they are needed.
- **Disposal:** Explicitly destroy or nullify Lottie instances when the animation completes or the screen closes to free memory.

---

## 5. Animation Priority

When multiple events trigger simultaneously, the Animation Manager uses this hierarchy:

1. **CRITICAL** (e.g., `LEVEL_UP`, `DAILY_GOAL_COMPLETED`): Locks the queue. Cannot be interrupted. Lower-priority animations are skipped or queued behind it.
2. **HIGH** (e.g., `ANSWER_CORRECT`, `ANSWER_WRONG`): Interrupts NORMAL/LOW. Overwrites existing HIGH animations of the same type.
3. **NORMAL** (e.g., `XP_GAINED`, `LOADING`): Will yield to HIGH/CRITICAL.
4. **LOW** (e.g., `BUTTON_PRESS`, `SUCCESS`): Safely ignored if system is busy or overlapping with a higher priority event.

---

## 6. Rapid Event Protection

Users may answer multiple questions rapidly. The system must prevent:
- **Animation Stacking:** 5 rapid correct answers should not spawn 5 overlapping checkmarks.
- **Duplicate Playback:** Debounce identical triggers within a 500ms window.
- **Memory Spikes:** Limit total DOM nodes / Canvas contexts.
- **UI Freezing:** Ensure parsing large JSONs happens off the main thread where possible.
- **Queue Overload:** Clear the low-priority event queue if it exceeds 3 pending items.

---

## 7. Offline Support

Core Lottie animations must work completely offline without network access.
- **Bundled Assets:** Essential feedback (correct, wrong, loading, error, simple rewards) must be bundled within the app.
- **Fallback Chain:** If a remote or bundled asset fails, degrades safely:
  `Lottie` → `Native Android/CSS Animation` → `Static UI Feedback`
- **Zero Crashes:** Animation failure, missing JSON, corrupted files, or WebGL context loss must NEVER crash the application.

---

## 8. Asset Organization

**Folder Structure:**
```text
assets/
└── animations/
    └── lottie/
        ├── feedback/
        ├── rewards/
        ├── streak/
        ├── progress/
        ├── loading/
        ├── errors/
        └── achievements/
```

**Naming Conventions:**
Use descriptive, lower_snake_case names.
- ✅ *Good:* `answer_correct.json`, `answer_wrong.json`, `xp_gain.json`, `streak_fire.json`, `level_up.json`
- ❌ *Bad:* `animation1.json`, `final.json`, `test2.json`, `new_final.json`

---

## 9. Theme & UI Compatibility

- **Dark/Light Theme:** Lottie files must use color parameters that can be overridden dynamically by the app's theme, or be designed to look good on both dark and light backgrounds.
- **Screen Adaptation:** Animations must scale responsively via CSS constraints to support phones, tablets, and edge-to-edge layouts.
- **No Overlap:** Z-index and absolute positioning must be carefully managed so animations never obscure important UI controls (e.g., the 'Next' button).

---

## 10. Accessibility

- **Reduced Motion:** If the OS accessibility setting "Reduce Motion" is enabled, disable all scaling/bouncing Lottie files. Fall back to simple opacities or static UI changes.
- **Disable Animations Toggle:** Respect any in-app toggle that lets users completely disable animations.
- **Information Redundancy:** Never make an animation the *only* way to communicate state (Correct, Wrong, Error, Success, Progress). Always pair animations with accessible text, color changes, and screen reader labels.

---

## 11. Lifecycle Management

To prevent memory leaks:
- **Screen Opens:** Instantiate Lottie only when elements enter the viewport.
- **User Navigates Away / Screen Closes:** Call `.destroy()` immediately.
- **App Enters Background:** Pause all active Lottie instances.
- **App Returns Foreground:** Resume paused Lottie instances.
- **Memory Pressure:** Stop and destroy non-critical Lottie animations.

---

## 12. Lottie + Rive + 3D Rules

- **Rive:** Reserved for interactive characters and complex state machines.
- **Lottie:** Reserved for lightweight visual effects, icons, micro-interactions, and simple feedback.
- **3D:** Reserved for premium, high-impact scenes only.
- **Native Android/CSS:** Reserved for simple UI transitions (cards, drawers, modals).

*Rule: Do not use Lottie where Rive (interaction) or 3D (volume) is technically more appropriate. Do not use 3D for simple effects that Lottie handles more efficiently.*

---

## 13. Testing

Test cases required for Lottie integration:
- [ ] Correct answer
- [ ] Wrong answer
- [ ] Rapid answers
- [ ] XP gain & Streak
- [ ] Level up / Daily goal / Mock exam completion
- [ ] Offline mode (airplane mode)
- [ ] Missing asset (force 404)
- [ ] Corrupted asset (invalid JSON)
- [ ] Low-end Android device (CPU throttling)
- [ ] Tablet layout
- [ ] Dark mode / Light mode toggling
- [ ] Reduced motion enabled
- [ ] Voice assistant enabled/disabled
- [ ] Screen navigation mid-animation
- [ ] App background/foreground transitions

---

## 14. Stability Rules

Animation errors must remain isolated from the core application.
If the Lottie engine completely fails, the MCQ system must continue working normally. The user must seamlessly be able to:
- Answer questions
- Navigate
- View results
- Track progress
- Use voice assistant
- Sync data

---

## 15. Future Compatibility

The Lottie implementation relies entirely on the `Lottie Adapter`. 
It must be possible to completely rip out the Lottie library and replace it with a different 2D engine (like SVG animations or Canvas API) by only modifying the adapter, without requiring a single rewrite to the:
- MCQ engine
- Practice engine
- XP system
- Streak system
- Analytics
- Voice assistant
- Authentication
- Cloud synchronization
- Rive system
- 3D system
