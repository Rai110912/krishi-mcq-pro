# Animation System Master Specification

This document serves as the master technical specification for the animation ecosystem of the Krishi MCQ application. All future animation-related workflows, implementations, and skills MUST comply with the rules, architectures, and conventions defined here.

## 1. Core Support Requirements
The animation architecture must robustly support:
- **Rive interactive animations** (state-machine driven).
- **Lottie animations** (JSON/DotLottie).
- **Existing 3D animation system** (e.g., Three.js/Spline integration).
- **Native UI transitions** (CSS/DOM based).
- **Animation events** (hooks into play, pause, loop, end).
- **Sound/voice synchronization** (haptics and audio bytes synced to frames).
- **Offline operation** (bundled assets playable without network).
- **Performance optimization** (60/120fps, strict memory overhead limits).
- **Accessibility** (respecting system "reduce motion" settings).
- **Device-size adaptation** (responsive scaling).
- **Dark/light theme compatibility** (dynamic color palettes).

---

## 2. Architecture Flow

Animations must be decoupled from business logic. The strict data flow is:

```text
User Action (e.g., clicks "Submit Answer")
       ↓
Application State/Event (e.g., evaluates correctness, updates score)
       ↓
Animation Event Controller (intercepts global state changes)
       ↓
Animation Manager (determines payload, priority, and interrupts)
       ↓
Animation Renderer (routes to specific engine)
  ├── Rive
  ├── Lottie
  ├── 3D
  └── Native UI Animation
```

---

## 3. Standard Animation Events

| Event Name | Trigger | Priority | Anim Type | Interruptible? | Fallback | Sync (Sound/Voice) | Offline Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ANSWER_CORRECT` | User selects correct MCQ option | High | Rive/Lottie | Yes | CSS glow/pulse | Success chime | Bundled asset |
| `ANSWER_WRONG` | User selects incorrect option | High | Rive/Lottie | Yes | CSS shake | Error buzzer | Bundled asset |
| `QUESTION_COMPLETED`| Moving to next question | Low | Native UI | Yes | Instant switch | None | Native |
| `XP_GAINED` | Score/XP increments | Medium | Lottie | Yes | Text scale-up | Coin/XP sound | Bundled asset |
| `STREAK_INCREASED` | Daily target hits streak milestone | High | Rive/3D | No | CSS flame icon | Fire ignite sound | Bundled asset |
| `LEVEL_UP` | User crosses XP threshold | Critical| 3D/Rive | No | CSS modal | Fanfare | Bundled asset |
| `DAILY_GOAL_COMPLETED`| Daily question target reached | Critical| 3D/Lottie | No | CSS modal | Fanfare | Bundled asset |
| `MOCK_EXAM_COMPLETED`| Final question of mock exam done | High | Lottie/Rive | No | CSS results card | Bell/Chime | Bundled asset |
| `BUTTON_PRESS` | Any generic UI button tap | Low | Native UI | Yes | CSS transform | Soft click / Haptic | Native |
| `SCREEN_ENTER` | Navigation routes to new screen | Low | Native UI | Yes | Instant show | None | Native |
| `SCREEN_EXIT` | Navigation routes away from screen| Low | Native UI | Yes | Instant hide | None | Native |
| `LOADING` | Network or heavy async operation | Low | Lottie/Native| Yes | CSS spinner | None | Bundled asset |
| `ERROR` | Network or logic failure | High | Lottie/Native| Yes | Static Red Toast | Error sound | Bundled asset |
| `SUCCESS` | Generic action (e.g., profile saved)| Medium | Native UI | Yes | Static Green Toast | Success pop | Native |

---

## 4. Architecture Rules

1. **Decoupling:** Never place animation logic directly inside MCQ, database, or business logic functions.
2. **Centralization:** Use a centralized `AnimationManager` or `AnimationEventController` to orchestrate playback.
3. **Fault Tolerance:** Animation failures (e.g., missing assets, WebGL crash) MUST NEVER crash the application.
4. **Modularity:** Rive, Lottie, and 3D renderers must be independently replaceable without rewriting the `AnimationManager`.
5. **Singleton Instances:** Avoid duplicate animation instances in the DOM/Canvas. Reuse and reposition singletons where possible.
6. **Memory Safety:** Prevent memory leaks by explicitly destroying WebGL contexts, Rive instances, and Lottie workers when screens unmount.
7. **Debouncing/Throttling:** Prevent animation stacking when users answer rapidly (e.g., clicking Next 5 times quickly).
8. **Interruption:** The system must support cancellation and interruption for low/medium priority events.
9. **Accessibility:** Strictly respect reduced-motion/accessibility settings (fallback to Native UI or static states).
10. **Low-End Support:** Gracefully degrade to lightweight alternatives on low-end Android devices (detect via hardware concurrency or framerate drops).
11. **Efficiency:** Prefer lightweight native CSS or simple Lotties for frequent events (like clicks).
12. **Premium Impact:** Reserve heavy 3D animations exclusively for premium/high-impact events (Level Up, Daily Goal).
13. **Asset Versioning:** Animation assets must be versionable and replaceable remotely without requiring changes to business logic.
14. **Offline First:** Offline mode must continue to work seamlessly for bundled, critical animations.
15. **Data Integrity:** Animation state (e.g., a Rive state machine variable) must NEVER become the source of truth for MCQ data.

---

## 5. Folder Responsibilities

### `.agents/workflows/`
**Purpose:** Executable, step-by-step development procedures.
**Usage:** When a developer needs to *do* something (e.g., adding a new Lottie file, profiling performance, debugging a glitch). Workflows contain action items, shell commands, and checklists.

### `.agents/skills/`
**Purpose:** Reusable technical knowledge, rules, and architectural constraints.
**Usage:** When a developer needs to *know* how something works (e.g., how the AnimationManager handles offline assets, what naming convention to use, or Android specific WebGL constraints). Skills contain specifications, diagrams, and constraints.

---

## 6. Naming Conventions

Strict naming conventions ensure predictability and easier dynamic loading:

- **Animation IDs:** `anim_[feature]_[action]` (e.g., `anim_mcq_correct`, `anim_streak_flame`)
- **Event IDs:** `EVT_[CATEGORY]_[ACTION]` (e.g., `EVT_MCQ_ANSWER_CORRECT`)
- **Rive State Machines:** `sm_[feature]_[state]` (e.g., `sm_character_celebrate`)
- **Lottie Assets:** `lottie_[feature]_[name].json` (e.g., `lottie_ui_loading.json`)
- **3D Animation States:** `state_3d_[name]` (e.g., `state_3d_trophy_spin`)
- **Sound Effects:** `sfx_[feature]_[action].mp3` (e.g., `sfx_mcq_correct.mp3`)
- **Animation Configuration:** `config_anim_[type]` (e.g., `config_anim_durations`)

---

## 7. Performance Rules

- **Memory:** Strict cap on animation memory footprint (e.g., maximum 50MB for WebGL context, strict garbage collection).
- **CPU/GPU Usage:** Hardware acceleration is required. Avoid complex vector paths in Lottie that cause CPU rasterization bottlenecks.
- **Frame Rate:** Target 60fps minimum. If frame rate drops below 30fps for >2 seconds, gracefully degrade to fallback animations.
- **Asset Size:**
  - Rive `.riv`: < 100KB per asset.
  - Lottie `.json`: < 200KB per asset.
  - 3D `.glb` / `.gltf`: < 2MB per asset (compressed).
- **Lazy Loading:** Never load animation assets on app boot unless they appear on the immediate home screen. Defer loading until idle or right before the feature is accessed.
- **Caching:** Cache downloaded remote animations in IndexedDB or the Cache API for offline persistence.
- **Disposal:** Explicitly call `.destroy()`, `.dispose()`, or clear canvases immediately when the animation is no longer needed.
- **Lifecycle Handling:** Pause all active Canvas/WebGL animations when the app goes into the background (`visibilitychange`) to save battery.

---

## 8. Testing Requirements

Every animation implementation must pass the following testing matrix:
1. **Correct Answer:** Verify Rive/Lottie triggers, sound syncs, and CSS glow fires.
2. **Wrong Answer:** Verify haptics, error sound, and UI shake.
3. **Rapid Repeated Answers:** Spam clicks must not stack animations, leak memory, or crash the app. The system must throttle or interrupt safely.
4. **Screen Rotation/Configuration Change:** Canvas must resize and re-render correctly without stretching.
5. **App Background/Foreground:** Animations must pause on background and resume (or reset) on foreground without freezing.
6. **Offline Mode:** Disconnect internet; verify bundled assets still play correctly.
7. **Low-End Device Emulation:** Throttle CPU in DevTools; verify fallbacks trigger if FPS drops heavily.
8. **Asset Missing/Corrupted:** Point to a broken URL; ensure the app catches the error, plays a CSS fallback, and does not crash.
9. **Voice Assistant / Accessibility Enabled:** Turn on screen reader or "Reduce Motion"; verify complex animations are replaced by static UI or simple fades.
10. **3D Unavailable:** Disable WebGL; ensure 3D premium events fallback gracefully to Lottie or CSS modals.
