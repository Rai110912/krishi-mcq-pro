# Add Lottie Animation Workflow

This workflow dictates the strict procedure for safely introducing Lottie vector animations into the existing Android application. Lottie is utilized for lightweight, high-performance visual effects (like particles, correct/wrong feedback, and micro-interactions) while ensuring it never interferes with business logic or app stability.

---

## 1. OBJECTIVE

Create a safe workflow for integrating Lottie animations. 
Lottie should primarily provide lightweight feedback, micro-interactions, particles, XP/streak effects, achievement celebrations, and loading/empty states.
**Lottie is a renderer, NOT a business-logic engine.**

---

## 2. ARCHITECTURE

Use one-way event flow:
`Application State` ↓ `Semantic Event` ↓ `Animation Orchestrator` ↓ `Lottie Adapter` ↓ `Lottie Composition`
*Business logic must remain completely independent.*

---

## 3. PRE-INTEGRATION AUDIT

Before adding any Lottie dependency or asset, inspect the project:
- Existing Lottie dependencies, assets, and wrappers.
- Gradle configuration, Kotlin version, AGP.
- Existing animation architecture, Rive integration, 3D system, and native animations.
*If Lottie already exists: Reuse the existing architecture where safe. Do NOT create duplicate Lottie systems.*

---

## 4. ASSET VALIDATION

Before implementing a Lottie JSON asset, verify:
- JSON is valid and parses correctly.
- Composition exists and animation is compatible.
- Any required embedded image assets are available (though purely vector Lotties are preferred).
- File size, layer count, and performance cost are reasonable.
- Loop behavior is intentional.
*Do not blindly import arbitrary animation JSON files.*

---

## 5. SEMANTIC ASSET IDs

Do not scatter file paths throughout the application.
Use semantic IDs. The `AnimationAssetRegistry` resolves the actual asset.
**Examples:** `lottie.feedback.correct`, `lottie.feedback.wrong`, `lottie.reward.xp`, `lottie.reward.streak`, `lottie.loading.standard`.

---

## 6. EVENT-DRIVEN INTEGRATION

Animation execution remains strictly one-way:
`ANSWER_CORRECT` ↓ `AnimationOrchestrator` ↓ `Lottie Adapter` ↓ `Correct Feedback`
*The Lottie animation must NEVER decide correctness, score, XP, streak, or navigation. The application remains the source of truth.*

---

## 7. USE CASE PRIORITY

Preferred Lottie use cases:
- **HIGH VALUE:** Correct/wrong feedback, XP gain, Streak, Achievement, Progress completion.
- **MEDIUM:** Loading, Empty state, Small UI celebrations.
- **LOW:** Pure decoration.
*Do not add animation simply because it looks impressive.*

---

## 8. LOOP POLICY

Explicitly define loop behavior: `ONE_SHOT`, `LOOP`, `PING_PONG`, `CONTROLLED`.
**Defaults:** Feedback → `ONE_SHOT`, Loading → `LOOP`, Decorative background → `CONTROLLED`.
*Avoid infinite animations unless structurally necessary.*

---

## 9. PERFORMANCE

Optimize for mobile rendering:
- Small JSON size, limited layers, and limited keyframes.
- Limited masks, mattes, and heavy mathematical effects.
- Minimal or zero raster image assets.
*Avoid expensive compositions for frequently triggered events.*

---

## 10. RAPID EVENT PROTECTION

If the user performs actions rapidly, do not spawn unlimited Lottie instances.
Support: Debounce, Queue, Merge, Cancel, Restart, or Skip decorative effects.
*Example: Multiple rapid `XP +5` events may merge into one combined `XP +15` visual effect where appropriate.*

---

## 11. PRIORITY

Support strict event priority:
`CRITICAL` → `HIGH` (Achievement Unlocked) → `NORMAL` (Answer Correct) → `LOW` (Decorative Particle) → `BACKGROUND`.
*Higher priority events instantly interrupt and override lower-priority Lottie states.*

---

## 12. RENDERER ARBITRATION

Lottie must coexist safely with Rive, 3D, and Native animations.
Do not allow unnecessary simultaneous heavy renderers.
*Example: If a heavy 3D celebration is active, a requested Lottie decorative particle may be safely skipped to protect the performance budget.*

---

## 13. FALLBACK

Every Lottie animation must define a fallback chain:
`Primary Lottie` ↓ `Native animation` ↓ `Final Static UI`
*(If a Rive alternative exists: Lottie → Rive → Native → Static).*
*The final static fallback must always exist.*

---

## 14. ACCESSIBILITY

Lottie implementations must respect the global accessibility policy:
- **FULL:** All animations allowed.
- **REDUCED:** Use subtle/short Lottie variants.
- **MINIMAL:** Use native CSS/Android transitions.
- **OFF:** Use static UI.
*Never bypass accessibility preferences.*

---

## 15. OFFLINE

Core Lottie animations must be bundled locally.
Network access must never be required for: Correct, Wrong, XP, Streak, Progress, or Achievement Lotties.

---

## 16. AUDIO / VOICE / HAPTIC

Lottie may be synchronized with Sound, Voice, and Haptics, but all layers remain completely independent.
- If Lottie fails → Audio/voice/haptic continues.
- If audio fails → Lottie continues.

---

## 17. LIFECYCLE

Explicitly handle Android/Compose lifecycles:
Screen creation, Visibility, Pause, Resume, Navigation, Background, Foreground, Disposal.
*Do not continue rendering invisible or off-screen animations unnecessarily.*

---

## 18. MEMORY SAFETY

Prevent Memory Leaks/OOM:
- No duplicate compositions or repeated unnecessary parsing.
- No unreleased animation views/controllers.
- Limit cache growth and purge hidden animation rendering loops.
*Reuse compositions when appropriate.*

---

## 19. RESPONSIVE UI

Lottie must adapt dynamically to:
Different screen sizes, Tablets, Small devices, Large text accessibility scaling, Portrait/Landscape, and Dark/Light themes.
*Avoid fixed, hard-coded, device-specific pixel positioning.*

---

## 20. DEBUG MODE

Development-only debug information should overlay the Lottie canvas showing:
Asset ID, Composition info, Loop mode, Event trigger, Duration, Fallback state, Load time, and Performance cost.
*Do not expose this in production.*

---

## 21. TESTING

Every Lottie implementation must pass:
- [ ] Correct/Wrong/XP/Streak triggers.
- [ ] Rapid overlapping events.
- [ ] Navigation & Background/Foreground lifecycle testing.
- [ ] Offline mode validation.
- [ ] Missing JSON / Corrupted JSON safe failure.
- [ ] Unsupported composition fallback checking.
- [ ] Low-end device & Memory pressure tests.
- [ ] Accessibility: Reduced motion & Animation OFF.
- [ ] Multimodal checks: Voice/Haptic/Audio active.

---

## 22. FAILURE POLICY

If Lottie cannot load (e.g., corrupted JSON):
**DO NOT:** Crash, block MCQ, block navigation, block voice, or retry indefinitely.
**INSTEAD:** Detect failure, log the technical reason, instantly select the fallback renderer, and continue application flow naturally.

---

## 23. IMPLEMENTATION ORDER

When this workflow is executed by a developer/agent:
1. Inspect existing project.
2. Read animation skills.
3. Check existing Lottie integration.
4. Verify dependency compatibility.
5. Verify asset.
6. Register semantic asset ID.
7. Connect event to orchestrator.
8. Configure lifecycle hooks.
9. Configure fallback mechanism.
10. Build.
11. Test.
12. Run regression checks.
13. Report.

---

## 24. CHANGE REPORT

Always report:
`Files created`, `Files modified`, `Files deleted`, `Dependencies added/changed`, `Lottie assets added`, `Events connected`, `Fallbacks configured`, `Tests performed`, `Build status`, `Performance impact`, `Accessibility status`, `Offline status`.
*If nothing was deleted, explicitly state: **"No existing files were deleted."***

---

## 25. STOP CONDITIONS

**Stop immediately if:**
- Build fails.
- Existing Rive system, 3D system, or Voice Assistant breaks.
- MCQ behavior changes.
- Authentication or Cloud sync breaks.
- Major performance regression appears.
- Existing Lottie implementation conflicts with proposed changes.
*Do not automatically rewrite unrelated code to fix integration issues.*

---

## 26. FUTURE AI COMPATIBILITY

Prepare the Lottie adapter for:
`AnimationAssetSelector` + `AnimationPolicyEngine` + `PerformanceProfile` + `AccessibilityPolicy`.
Future intelligent selection may determine the Lottie animation, intensity, duration, quality, or whether to skip the animation entirely. It must **never** override Business logic, Accessibility, User settings, or Performance safety.

---

## GOLDEN RULE

Use Lottie where it provides maximum visual value with minimum performance cost.
**Prefer:** `SMALL`, `FAST`, `REUSABLE`, `OFFLINE`, `ACCESSIBLE`, `FALLBACK-SAFE` over unnecessarily complex animations.

---

## FINAL EXECUTION POLICY

When invoked:
`INSPECT → PLAN → VALIDATE → IMPLEMENT → BUILD → TEST → VERIFY → REPORT`

**Never perform a full-project rewrite. Never silently remove existing functionality. Never modify unrelated systems.**
