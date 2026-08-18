# 3D Animation Integration Specification

This document is the official technical skill specification for integrating 3D animations into the Android learning/MCQ application. It ensures that any existing or new 3D systems are used exclusively for high-impact premium experiences without jeopardizing the stability, performance, or existing architecture of the core application.

---

## 1. Purpose

Advanced 3D animation must coexist harmoniously with Rive, Lottie, Native Android animations, and the existing application UI. 

3D is strictly reserved for **high-impact, immersive experiences** rather than simple UI feedback. It must never interfere with the MCQ engine, practice engine, voice assistant, XP/streak system, analytics, or cloud synchronization.

---

## 2. Recommended 3D Use Cases

**Prefer 3D for:**
- Premium learning scenes
- Main learning character
- Major achievements
- Level-up experiences
- Course completion
- Exam completion
- Special rewards
- Interactive educational objects
- Major milestone celebrations
- Immersive learning modules

**Do NOT use 3D for simple:**
- Checkmarks
- Button feedback
- Small XP effects
- Simple loading
- Basic correct/wrong indicators

*(Use Lottie, Rive, or native animation for simple feedback).*

---

## 3. Architecture

The 3D system must remain isolated from MCQ/business logic via an Adapter pattern. The MCQ engine remains the absolute source of truth. The 3D system only *reacts* to application events.

**Data Flow:**
```text
Application Event (e.g., User levels up)
       ↓
Animation Event Controller
       ↓
Animation Manager
       ↓
3D Adapter
       ↓
Existing 3D System
       ↓
3D Character / Scene
```

---

## 4. Event Mapping

Do NOT trigger expensive 3D scenes for every normal MCQ answer. Normal answer feedback should use Rive + Lottie.

Appropriate 3D reactions are mapped to:
- `LEVEL_UP`
- `MAJOR_ACHIEVEMENT`
- `COURSE_COMPLETED`
- `MOCK_EXAM_COMPLETED`
- `DAILY_GOAL_COMPLETED`
- `STREAK_MILESTONE`
- `SPECIAL_REWARD`

---

## 5. 3D State Architecture

Recommended states for 3D characters/scenes:

| State | Entry Condition | Exit Condition | Priority | Interruptible | Transition Rules | Fallback |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `IDLE` | Default / No action | Any trigger | Lowest | Yes | Crossfade to new state | Static Model |
| `ATTENTION`| User interacts / hovers | User idles | Low | Yes | Smooth look-at blend | Rive/Lottie |
| `THINKING` | Waiting for network/eval | Eval finishes | Medium | Yes | Crossfade | Lottie |
| `CELEBRATION`| Minor milestone (Streak) | Anim ends | High | No | Crossfade to IDLE | Lottie |
| `SUCCESS` | High score / Good streak | Anim ends | High | Yes | Crossfade to IDLE | Rive |
| `FAILURE` | Exam failed / Bad streak | Anim ends | High | Yes | Crossfade to IDLE | Rive |
| `REWARD` | Unlocking premium item | Anim ends | Critical | No | Direct cut to UI | Modal |
| `LEVEL_UP` | Level threshold crossed | Anim ends | Critical | No | Direct cut to UI | Modal |
| `SPECIAL_EVENT`| Seasonal/Promotional | Event ends | Medium | Yes | Crossfade to IDLE | Static UI |

---

## 6. Device Performance Tiers

The app must automatically detect hardware and degrade visual quality when required.

| Tier | Polygon Complexity | Texture Resolution | Shadow Quality | Lighting | Particles | Max Simultaneous Effects | Frame-rate Target |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **LOW** | < 10k | 512x512 | Off/Blob | Unlit/Baked | < 50 | 1 | 30fps (or fallback to Lottie) |
| **MEDIUM**| < 30k | 1024x1024 | Low/Hard | Vertex/Simple | < 200 | 2 | 60fps |
| **HIGH** | < 100k | 2048x2048 | Soft/PCF | PBR/Dynamic | < 1000 | 3+ | 60/120fps |

---

## 7. Performance Protection

The 3D system must never noticeably interfere with MCQ answering, scrolling, timers, voice assistant, navigation, analytics, or data synchronization.

- **Lazy Loading:** Never load 3D assets on app boot unless they appear on the immediate home screen.
- **Asset Caching:** Cache models and textures locally.
- **Resource Disposal / Scene Unloading:** Explicitly unload geometry, materials, and textures from GPU memory when the scene closes.
- **Memory Management:** Strictly monitor VRAM usage.
- **Background Lifecycle:** Halt the 3D render loop completely when the app goes to the background.
- **Frame-rate Monitoring:** If FPS drops below 30 for >3 seconds, gracefully kill the 3D context and fall back to 2D animations.

---

## 8. Lifecycle Management

3D resources must be tightly bound to the Android/App lifecycle to prevent memory leaks, duplicate renderers, orphaned scenes, duplicate characters, or unreleased textures/GPU resources.

- **Screen enter:** Initialize renderer, load assets asynchronously.
- **Screen exit:** Unload assets, destroy WebGL/OpenGL context, nullify references.
- **App background:** Pause render loop and physics.
- **App foreground:** Resume render loop.
- **Configuration change / Navigation:** Handle resizing gracefully without dumping and reloading the entire scene if possible.
- **Memory pressure:** Intercept OS memory warnings and destroy the 3D context immediately, replacing it with a static placeholder.

---

## 9. Offline Support

Core 3D experiences should work offline when assets are bundled. Do not make basic learning functionality dependent on network access.

**Fallback Chain (If a 3D asset is unavailable, corrupted, or offline):**
`3D` ↓ `Rive` ↓ `Lottie` ↓ `Native UI` ↓ `Static feedback`

The user must still be able to use the application normally if 3D fails.

---

## 10. Existing 3D System Protection

Before proposing or implementing any future 3D system, developers MUST:
1. Inspect the existing 3D architecture in the project.
2. Identify the engine/library already used (e.g., Three.js, Babylon, Unity export, Filament).
3. Identify existing models, animation controllers, and render lifecycles.
4. Identify existing performance optimizations.
5. **Reuse existing infrastructure whenever possible.**

*Never introduce another 3D engine simply because it is newer. Avoid duplicate rendering frameworks at all costs.*

---

## 11. Asset Management

Professional structure for 3D assets:

**Folders:**
- `3d/models/`
- `3d/textures/`
- `3d/materials/`
- `3d/animations/`
- `3d/scenes/`
- `3d/lighting/`
- `3d/audio/`
- `3d/particles/`

**Naming Conventions:**
Use semantic, descriptive, version-controlled names.
- ✅ *Good:* `learning_character_v1.glb`, `achievement_scene.gltf`, `level_up_character_diffuse.png`
- ❌ *Bad:* `model_final.obj`, `model_final2.fbx`, `test_model.glb`, `new_scene.gltf`

---

## 12. Accessibility

3D must never be the only method of communicating important information.
- **Reduced motion:** Disable camera panning, intense particle effects, and screen shakes.
- **Disable animation:** Replace the 3D canvas with a static render/image.
- **Screen readers:** Provide equivalent text descriptions (`contentDescription` / `aria-label`) for 3D scenes.
- **Motion-sensitive users:** Avoid strobing lights, rapidly spinning objects, or disorienting camera moves.

---

## 13. Voice Assistant Synchronization

If the voice assistant announces "Correct answer" or a milestone:
- The visual reaction must be synchronized **without blocking** the voice system.
- Use a non-blocking event synchronization strategy (e.g., emitting a detached `VoiceEventStarted` that the 3D adapter listens to).
- **Voice failure must not break 3D.**
- **3D failure must not break voice.**

---

## 14. Rive / Lottie / 3D Selection Rules

Use the lightest technology capable of producing the desired effect.

| Requirement | Preferred Technology | Example |
| :--- | :--- | :--- |
| Simple UI effect | **Native Android / CSS** | Button ripple, expanding card, toast slide-in |
| Small visual effect | **Lottie** | Checkmark, confetti, simple loading spinner |
| Interactive character | **Rive** | Mascot whose eyes follow cursor, responsive idle states |
| High-impact immersive experience | **3D** | Interactive 3D globe, premium trophy reveal, level-up stage |

*Do not use 3D for simple effects that Lottie or Rive can handle efficiently.*

---

## 15. Testing

Test cases required for 3D integration:
- [ ] Low-end device (Verify fallback or degraded quality)
- [ ] Mid-range device
- [ ] High-end device (Verify 60fps+)
- [ ] Offline mode (Verify bundled models load)
- [ ] App background/foreground (Verify render loop pauses/resumes)
- [ ] Navigation (Verify VRAM is cleared)
- [ ] Memory pressure (Verify graceful disposal)
- [ ] Missing model / Missing texture / Missing animation (Verify graceful fallback)
- [ ] Voice assistant enabled / disabled (Verify async sync)
- [ ] Reduced motion (Verify static rendering)
- [ ] Dark mode (Verify lighting adjusts appropriately)
- [ ] Tablet (Verify aspect ratio and scaling)
- [ ] Rapid user interaction (Verify queue logic, no stacking)

---

## 16. Stability

3D failures (WebGL context loss, out-of-memory errors, parse failures) must **NEVER crash the application**.
If the 3D system fails, the application must automatically catch the error, dispose of the 3D canvas, and fall back to a lighter animation layer (Rive/Lottie/CSS). The MCQ engine must continue functioning normally.

---

## 17. Future Compatibility

The 3D implementation relies entirely on the `3D Adapter`. 
The 3D engine itself must remain replaceable (e.g., swapping Three.js for PlayCanvas) by only modifying the adapter, without rewriting:
- MCQ engine
- Practice engine
- XP / Streak / Analytics
- Voice assistant
- Authentication
- Cloud synchronization
- Rive / Lottie systems
