# Existing Animation Audit & Safe Migration Workflow

This workflow is the mandatory **FIRST STEP** before introducing new animations into the application. It dictates how to safely inspect, audit, and classify the existing animation implementation without breaking the application's current production stability.

---

## 1. PRIMARY OBJECTIVE

Audit every existing animation in the application and classify it strictly using one of the following decisions:
`KEEP`, `ADAPT`, `IMPROVE`, `REPLACE`, `REMOVE`.
*The decision must be evidence-based. Do not preserve bad animation merely because it exists. Do not remove working animation merely because a newer technology (like Rive) is available.*

---

## 2. PROJECT INSPECTION

Inspect the entire project for animation-related implementations:
- Kotlin files, Compose animations, XML animations.
- Rive, Lottie, 3D systems, OpenGL/graphics code, Canvas animations.
- Motion/transition systems, Animated images (GIF/WebP).
- Character animations, particle effects, loading, rewards, screen transitions, audio-syncs.
**Also inspect:** Animation assets, resource directories, configuration files, dependencies, animation controllers, state machines, and utilities.

---

## 3. DO NOT ASSUME

**Do not assume:**
- An animation is unused or obsolete.
- A dependency is unnecessary.
- An asset is a duplicate or a file can be safely deleted.
- A renderer can be trivially replaced.
*Always search for actual references before making decisions.*

---

## 4. BUILD AN ANIMATION INVENTORY

Create an internal audit table tracking every animation:
`Animation ID` | `Technology` | `File/Location` | `Screen` | `Purpose` | `Trigger/Event` | `Current State` | `Performance Risk` | `UX Quality` | `Accessibility` | `Offline Support` | `Dependencies` | `Used By` | `Conflicts` | `Recommendation`
*Do not modify application code merely to create this inventory.*

---

## 5. CLASSIFICATION RULES

### KEEP
- **When:** Works correctly, UX is good, performance is acceptable, safe architecture, no conflicts.
- **Action:** Keep it unchanged initially. Do not unnecessarily rewrite it.

### ADAPT
- **When:** Animation is good and works, but should be connected to the new Animation Event System.
- **Action:** Build an Adapter/Orchestrator hook around it. Do not rewrite the underlying animation unless necessary.

### IMPROVE
- **When:** Animation works but looks outdated, timing is poor, or accessibility/responsive behavior is weak.
- **Action:** Improve incrementally without redesigning unrelated UI.

### REPLACE
- **When:** Superior replacement exists, current tech limits the app, performance is poor, or architecture actively conflicts with the new system.
- **Action:** Identify references, define replacement/fallback, test replacement, and confirm old behavior is preserved.

### REMOVE
- **When:** Harmful, broken, persistent bug, duplicate functionality, causes crashes/memory leaks, or creates unacceptable UX.
- **Action:** Removal must NEVER happen simply because "Rive/Lottie is newer."

---

## 6. REMOVAL SAFETY

Before removing anything, **SEARCH ALL REFERENCES.**
Check: Code, Resources, Navigation, Events, State management, Assets, Dependencies, Configuration, and Tests.
*If references remain: DO NOT DELETE. First determine a safe migration path.*

---

## 7. REASON REQUIRED

Every `REPLACE` or `REMOVE` decision must include a concrete reason.
**Bad:** "Old animation."
**Good:** "Removed because the animation creates duplicate rendering with the new Rive state machine and causes visible frame drops during rapid MCQ interaction."
*Required properties:* Reason, Impact, Replacement, Fallback, Risk, Validation method.

---

## 8. CONFLICT DETECTION

Detect architectural conflicts:
- Two animations responding to the exact same event.
- Duplicate Rive controllers or Lottie instances.
- Multiple 3D renderers fighting for context.
- Animation loops never stopping (memory leaks).
- Animation blocking the UI or triggering core business logic.

---

## 9. PERFORMANCE AUDIT

Evaluate and classify risks (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`):
FPS/jank risk, CPU/GPU overhead, Memory footprint, Asset size, Rendering frequency, Startup impact, and Long-session impact.
*Do not optimize blindly.*

---

## 10. ACCESSIBILITY AUDIT

Check every existing animation against:
Reduced motion handling, Animation OFF toggles, Screen reader compatibility, and Static fallbacks.
*Any animation that communicates essential information MUST have a non-animation fallback.*

---

## 11. OFFLINE AUDIT

Determine whether each important animation works offline.
Core learning feedback must not depend on network availability or cloud synchronization to render.

---

## 12. FUTURE SYSTEM MAPPING

For each existing animation, map where it ultimately belongs in the new architecture:
*Event System, Asset Registry, State Manager, Orchestrator, Adapters (Rive/Lottie/3D/Native), Audio Sync.*
*Note: Do not implement these integrations during the audit unless explicitly requested. This step is purely AUDIT + PLAN.*

---

## 13. OUTPUT REPORT

After inspection, produce a structured report containing:
- **TOTAL ANIMATIONS FOUND**
- **KEEP / ADAPT / IMPROVE:** [Animation] + [Reason]
- **REPLACE:** [Animation] + [Reason] + [Replacement strategy]
- **REMOVE:** [Animation] + [Exact Reason] + [Affected Files] + [Fallback]
- **CONFLICTS FOUND:** [Conflict] + [Severity] + [Component]
- **RISKS:** Performance, Accessibility, Offline vulnerabilities + [Severity]

---

## 14. CRITICAL SAFETY

During this audit phase, **DO NOT:**
- Delete files or replace animations.
- Rewrite architecture or install dependencies.
- Modify MCQ logic, voice assistant, authentication, cloud sync, planner, or analytics.
*This step must only produce an audit and migration plan.*

---

## 15. APPROVAL GATE

At the end of the audit:
**DO NOT automatically execute REPLACE or REMOVE actions.**
Present the proposed actions clearly to the user.
For every destructive action show: `FILE` | `ACTION` | `REASON` | `DEPENDENCIES` | `REPLACEMENT` | `FALLBACK` | `RISK`
**Then STOP.** Wait for explicit implementation instruction.

---

## GOLDEN RULE

**KEEP** if good. **ADAPT** if compatible but needs integration. **IMPROVE** if valuable but imperfect. **REPLACE** if a demonstrably better solution exists. **REMOVE** if it is harmful, redundant, broken, conflicting, or unnecessary.

*Never delete first and investigate later. Protect the existing application while progressively transforming it into a futuristic animation ecosystem.*
