# Add Rive Animation Workflow

This workflow dictates the strict procedure for safely introducing Rive interactive animations into the existing Android application. It ensures that Rive functions exclusively as an isolated rendering layer and never interferes with business logic or app stability.

---

## 1. OBJECTIVE

Create a safe, repeatable workflow for adding Rive animations.
Rive must function strictly as an animation renderer, not as a replacement for application/business logic.

**Target Architecture:**
`Application State` ↓ `Semantic Event` ↓ `Animation Orchestrator` ↓ `Rive Adapter` ↓ `Rive Asset / State Machine`

---

## 2. PRE-INTEGRATION AUDIT

Before adding any Rive dependency or asset, inspect the project:
- Existing Rive dependencies, assets, and integration wrappers.
- Existing animation controllers.
- Gradle configuration, Kotlin version, AGP, Min/Compile SDK.
- Existing rendering architecture.

*Rule: If Rive is already integrated, DO NOT create a second competing Rive architecture. Reuse the existing implementation where safe.*

---

## 3. ASSET VALIDATION

Before implementing a `.riv` asset, developers must manually verify:
- File exists and parses correctly.
- Expected artboard exists.
- Expected state machine exists.
- Expected animation exists.
- Expected inputs (booleans, numbers, triggers) exist.
- Asset size and device performance cost are acceptable.
*Never assume asset names or inputs. Inspect the actual asset via the Rive Editor before implementation.*

---

## 4. STABLE ANIMATION ID

Do not reference Rive files directly throughout the application's business logic.
Use a semantic ID. The internal registry will resolve the actual file path.
**Examples:** `rive.feedback.correct`, `rive.feedback.wrong`, `rive.character.idle`, `rive.character.levelUp`.

---

## 5. STATE MACHINE SAFETY

If the Rive asset uses a State Machine, strictly verify:
- State machine name (e.g., `sm_avatar_reactions`).
- Input types (`Boolean`, `Number`, `Trigger`).
*Do not hard-code assumed input names. Bind exactly to the actual asset specification to prevent runtime crashes.*

---

## 6. EVENT-DRIVEN CONTROL

Animation execution must remain strictly one-way:
`ANSWER_CORRECT` ↓ `AnimationOrchestrator` ↓ `Rive Adapter` ↓ `Trigger correct reaction`
*The Rive animation must NEVER determine answer correctness, XP, streak, score, or navigation timing.*

---

## 7. LIFECYCLE MANAGEMENT

Rive instances must explicitly handle Android/Compose lifecycles:
- **Screen creation / disposal:** Explicitly create and destroy instances.
- **Background / foreground:** Pause and resume render loops.
- **Configuration changes:** Handle resizing and redraws safely.
*Rule: No orphaned Rive controllers. No leaked resources.*

---

## 8. PERFORMANCE

Strict performance limits apply to Rive instances:
- Avoid creating unnecessary Rive instances (reuse singletons).
- Do not reload the same asset repeatedly from disk.
- Never run hidden animations or off-screen state machines.
- **Prefer:** Reuse where safe, lazy loading, asset caching, and proper disposal.

---

## 9. DEVICE ADAPTATION

Rive implementations must hook into the `DevicePerformanceProfile`:
`ULTRA` → `HIGH` → `BALANCED` → `LOW` → `MINIMAL`
*Example:* A High-End device receives the full complex Rive experience. A Low-End device receives a simplified Rive file or falls back to Lottie/Native CSS.

---

## 10. ACCESSIBILITY

Rive implementations must respect the global accessibility policy:
`FULL` → `REDUCED` → `MINIMAL` → `OFF`
*If animation is OFF, the system must use static UI feedback. Never bypass the global accessibility policy.*

---

## 11. FALLBACK

Every Rive animation must have a guaranteed fallback chain in case of failure:
`Rive` ↓ `Lottie` ↓ `Native` ↓ `Static`
*Rive asset parse failure, missing files, or renderer crashes must NEVER crash the application.*

---

## 12. OFFLINE

Core Rive assets must work fully offline.
Do not require a network connection for correct/wrong feedback, XP/Streak visualizations, or basic character reactions. Core `.riv` files must be bundled.

---

## 13. AUDIO / VOICE / HAPTIC

Rive may be synchronized with Sound, Voice, and Haptics, but all layers remain completely independent.
- If voice fails → Rive continues.
- If Rive fails → Voice continues.
- If haptic fails → Rive continues.

---

## 14. RAPID EVENTS

Protect against repeated overlapping triggers. If a user answers 10 questions rapidly, do NOT spawn 10 simultaneous Rive instances.
Use Queue, Debounce, Merge, Cancel, and Restart strategies according to the Orchestrator's animation priority rules.

---

## 15. PRIORITY

Support strict event priority:
`CRITICAL` (Level up) → `HIGH` → `NORMAL` (Answer correct) → `LOW` → `BACKGROUND` (Character idle).
*Higher priority events instantly interrupt and override lower-priority Rive states.*

---

## 16. UI INTEGRATION

When integrating Rive into the UI layout, ensure:
- Responsive sizing and correct aspect ratios without distortion.
- No layout overflow or clipping bugs.
- No unnecessary full-screen rendering for a small icon.
- Correct dark/light theme behavior.
- Tablet and portrait/landscape compatibility.
*Do not hard-code device-specific pixel dimensions.*

---

## 17. DEBUG MODE

Development-only debug information should overlay the Rive canvas showing:
Asset ID, Artboard, State machine, Current Inputs, Event trigger, Fallback reason, and Performance metrics.
*Do not expose debug information to normal users.*

---

## 18. TESTING

Every Rive implementation must pass:
- [ ] Correct/Wrong answer tracking.
- [ ] Rapid answers (spam click debouncing).
- [ ] Navigation & Background/Foreground lifecycle testing.
- [ ] Offline mode validation.
- [ ] Missing Rive asset / Invalid Rive asset fallback checking.
- [ ] State machine / Input missing safe failure.
- [ ] Low-end device & Memory pressure tests.
- [ ] Accessibility: Reduced motion & Animation OFF.
- [ ] Multimodal checks: Voice/Haptic/Audio active.

---

## 19. FAILURE POLICY

If Rive cannot load (e.g., corrupted file, Out-of-Memory):
**DO NOT:** Crash, block UI, block MCQ, block navigation, or retry indefinitely.
**INSTEAD:** Log the technical failure, instantly select the fallback renderer, and continue application flow naturally.

---

## 20. IMPLEMENTATION ORDER

When this workflow is executed by a developer/agent:
1. Inspect project.
2. Read animation architecture rules.
3. Verify Rive dependency.
4. Verify asset (file existence and integrity).
5. Verify asset metadata.
6. Verify event payload.
7. Implement adapter if necessary.
8. Connect event to the orchestrator.
9. Add fallback mechanism.
10. Test.
11. Build.
12. Regression test.
13. Report changes.

---

## 21. CHANGE CONTROL

After implementation, a report MUST be generated detailing:
`Files created`, `Files modified`, `Files deleted`, `Dependencies changed`, `Rive assets added`, `Events connected`, `Fallback configured`, `Tests performed`, `Build status`, `Performance impact`, `Accessibility status`, `Offline status`.
*If no files were deleted, explicitly state: **"No existing files were deleted."***

---

## 22. STOP CONDITIONS

**Stop immediately if:**
- Build breaks.
- Existing animation, voice assistant, or 3D system breaks.
- MCQ behavior changes.
- Authentication or Cloud sync breaks.
- Major performance regression occurs.
- Existing Rive integration conflicts with the new implementation.
*Do not automatically rewrite unrelated systems to "fix" an integration error.*

---

## 23. FUTURE AI COMPATIBILITY

The Rive adapter should eventually support:
`AnimationAssetSelector` + `AnimationPolicyEngine` + `PerformanceProfile` + `AccessibilityPolicy`.
Future intelligent selection may dynamically choose the Rive asset, intensity, and quality, but it must **never** override Business Logic, Accessibility, Performance Safety, or User Settings.

---

## GOLDEN RULE

**Rive should make the application feel alive. Rive must NEVER become responsible for keeping the application alive.**
Protect the existing application first. Add animation incrementally. Keep every change reversible, testable, and isolated.

---

## FINAL EXECUTION POLICY

When invoked:
`INSPECT → PLAN → VALIDATE → IMPLEMENT → BUILD → TEST → VERIFY → REPORT`
**Never:**
`INSPECT → REWRITE EVERYTHING.`
