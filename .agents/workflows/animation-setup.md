# Animation Setup Workflow

This workflow is a strictly safe, repeatable procedure for introducing the new animation ecosystem into the existing Android application. 
*The existing app is a valuable production component that has been in development for months. It must be protected.*

---

## 1. PRIMARY OBJECTIVE

Create a safe, repeatable workflow for introducing the target animation ecosystem:
`Stitch` + `Rive` + `Lottie` + `Existing 3D system` + `Native Android animation` + `Voice/audio/haptic synchronization`.
- **Stitch:** UI/UX design and prototyping source.
- **Rive, Lottie, 3D, Native:** Runtime technologies.

---

## 2. ABSOLUTE SAFETY RULE

**NEVER start by rewriting the application.**
Before changing anything:
`INSPECT` ↓ `UNDERSTAND` ↓ `PLAN` ↓ `CHECK DEPENDENCIES` ↓ `CHECK REFERENCES` ↓ `CREATE SAFE CHECKPOINT` ↓ `IMPLEMENT MINIMAL CHANGE` ↓ `BUILD` ↓ `TEST` ↓ `VERIFY` ↓ `REPORT`

---

## 3. PRE-FLIGHT PROJECT AUDIT

Before implementation, inspect:
- Project structure, Android & Gradle configuration.
- Existing dependencies, UI framework, Navigation, State management.
- Existing animation libraries, Rive/Lottie integration, 3D system.
- Voice assistant, Audio system, Haptic system.
- MCQ engine, Practice engine, XP, Streak, Analytics, Auth, Cloud sync, Offline system.
*Do not assume a technology is absent simply because it is not immediately visible.*

---

## 4. EXISTING CODE PROTECTION

Before modifying any file, determine:
- Why the file exists and what features depend on it.
- What imports depend on it, what screens use it, what state it manages.
- What external references exist.
*Never modify a file merely because it appears convenient. Prefer creating isolated animation modules.*

---

## 5. DEPENDENCY AUDIT

Before adding Rive/Lottie dependencies, check:
- Existing dependency versions, AGP, Kotlin, Compile SDK, Min SDK.
- Existing rendering/animation libraries.
- Duplicate libraries, version conflicts, transitive dependency conflicts.
*Do not blindly add the newest version. Choose versions strictly compatible with the existing project.*

---

## 6. ARCHITECTURE CHECK

Ensure the following conceptual layers exist or can be introduced safely:
`Animation Event` ↓ `Animation Controller` ↓ `Animation Orchestrator` ↓ `Renderer Adapter (Rive/Lottie/3D/Native)`
*Business logic must remain entirely independent.*

---

## 7. SAFE INCREMENTAL IMPLEMENTATION

Never implement the entire animation system in one change.
**Recommended Order:**
- **Phase 1:** Animation architecture
- **Phase 2:** Event system
- **Phase 3:** Rive adapter
- **Phase 4:** Lottie adapter
- **Phase 5:** 3D adapter
- **Phase 6:** Audio/voice synchronization
- **Phase 7:** Performance optimization
- **Phase 8:** Accessibility
- **Phase 9:** Final testing
*Each phase must be independently testable.*

---

## 8. FIRST ANIMATION

The first runtime animation should be extremely low-risk.
**Recommended:** `ANSWER_CORRECT` → small Lottie or Rive feedback.
**Do NOT begin with:** Complex 3D scenes, global navigation rewrites, full-screen animations, major UI redesigns, or replacing the voice assistant.

---

## 9. ANIMATION EVENT SAFETY

When connecting animation to MCQ:
- **MCQ engine:** determines correctness.
- **Animation system:** reacts to correctness.
*Never reverse this relationship.*

---

## 10. STITCH WORKFLOW

If Stitch designs are provided, use Stitch as a visual/UX reference.
Before implementing, compare the Stitch design vs the existing application.
Identify: UI changes, layout changes, new components, animation requirements, responsive requirements.
*Do not blindly replace the existing UI with generated output. Preserve existing functionality.*

---

## 11. ASSET SAFETY

Before adding an animation asset, check:
File format, Size, Renderer, Version, References, Device cost, Accessibility fallback, Offline availability.
*Do not add large assets unnecessarily.*

---

## 12. CHECKPOINT STRATEGY

Before each significant implementation phase, create a safe development checkpoint using version control.
If version control is unavailable:
- Do NOT invent a destructive backup mechanism.
- Document the exact files that will change.
- Modify only the smallest required set of files.

---

## 13. IMPLEMENTATION RULE

Every implementation must answer:
1. **WHY** is this file changing?
2. **WHAT** functionality does it add?
3. **WHAT** existing behavior could it affect?
4. **HOW** will it be tested?
*If these cannot be answered, stop before editing.*

---

## 14. BUILD VERIFICATION

After every implementation phase, run the project validation/build process.
Check: Compilation, dependency resolution, lint/static analysis, resource validation, existing feature integrity.
*Do not continue if the project no longer builds.*

---

## 15. REGRESSION TESTING

Verify at minimum:
Home, Practice, Questions, Planner, Analytics, Auth, Cloud Sync, Offline mode, Voice assistant, Existing 3D, Navigation, Theme, Responsive layouts.
*Animation changes must not break unrelated features.*

---

## 16. PERFORMANCE CHECK

Check:
Frame drops, Memory, CPU, GPU, Startup impact, Scroll performance, Animation load time, Long-session stability.
*If performance worsens significantly: Stop. Optimize before adding more animations.*

---

## 17. ACCESSIBILITY CHECK

Verify:
Reduced motion, Animation OFF, Large text, Screen reader compatibility, Sound/Haptic disabled, Static fallback.

---

## 18. OFFLINE CHECK

Verify:
Core animations work offline, no animation blocks MCQ, no animation depends on cloud sync, local assets load correctly, missing remote assets have fallbacks.

---

## 19. FAILURE POLICY

- **Rive failure** → Lottie/native fallback
- **Lottie failure** → Native/static fallback
- **3D failure** → Rive/Lottie/native fallback
- **Audio failure** → visual feedback continues
- **Voice failure** → visual feedback continues
*Animation failure must NEVER crash the application.*

---

## 20. STOP CONDITIONS

**Immediately stop implementation if:**
- Existing unrelated feature breaks.
- Build fails.
- Authentication or Cloud sync breaks.
- MCQ correctness changes unexpectedly.
- Voice assistant or existing 3D system breaks.
- Significant performance regression appears.
- Unexpected dependency conflict appears.
- Large-scale refactoring becomes necessary.
*Do not "fix" unrelated problems automatically. Report them separately.*

---

## 21. CHANGE REPORT

After each workflow execution, report:
`FILES CREATED`, `FILES MODIFIED`, `FILES DELETED`, `DEPENDENCIES ADDED`, `DEPENDENCIES CHANGED`, `FEATURES AFFECTED`, `TESTS RUN`, `BUILD STATUS`, `PERFORMANCE IMPACT`, `ACCESSIBILITY STATUS`, `OFFLINE STATUS`, `KNOWN RISKS`.
*If nothing was deleted, explicitly state: "No existing files were deleted."*

---

## 22. FUTURE-READY RULE

The architecture must allow future integration of:
AI-assisted animation selection, adaptive intensity, device-aware rendering, personalized policies, dynamic asset selection, advanced 3D scenes, intelligent multimodal experiences.
*These must be introduced incrementally. Never introduce AI simply for decoration.*

---

## 23. GOLDEN RULE

The application must remain:
**FUNCTIONAL + STABLE + FAST + OFFLINE-CAPABLE + ACCESSIBLE**
before it becomes **MORE ANIMATED**.
*Animation is an enhancement, not a dependency.*

---

## FINAL EXECUTION POLICY

When this workflow is invoked:
1. Inspect the current project.
2. Read relevant `.agents/skills/*.md` rules.
3. Identify the smallest safe change.
4. Explain the planned change.
5. Verify dependencies.
6. Create a safe checkpoint when possible.
7. Implement only the requested animation phase.
8. Build/test.
9. Perform regression checks.
10. Report all changes.
11. Stop before unrelated modifications.

**NEVER** perform a full-project rewrite.
**NEVER** modify unrelated features.
**NEVER** silently remove existing functionality.
**NEVER** assume existing code is disposable.

*This workflow protects months of development while gradually introducing a professional, futuristic animation ecosystem.*
