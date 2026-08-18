# Accessibility & Inclusive Animation Specification

This document is the official technical skill specification for Accessibility within the Android learning/MCQ application. It guarantees a futuristic, inclusive animation experience where learning remains paramount, regardless of a user's sensory, physical, or device limitations.

---

## 1. Vision

Animation must **enhance learning**, never become a requirement for understanding. Every user must be able to comfortably use the application regardless of motion preferences, vision limitations, hearing limitations, device capability, or interaction method.

---

## 2. Accessibility Priority

Accessibility settings operate at the absolute highest level of the architecture.

**Priority Hierarchy:**
`USER ACCESSIBILITY`
↓
`CORE LEARNING FUNCTIONALITY`
↓
`PERFORMANCE`
↓
`ANIMATION`
↓
`DECORATIVE EFFECTS`

*Rule: Explicit accessibility settings mathematically override animation intensity, performance defaults, and multimodal policies.*

---

## 3. Animation Modes

The system responds to four global animation modes driven by user preference or OS-level settings:

- **FULL:** Allows everything. Rive, Lottie, 3D, sound, haptic, character reactions, and particle effects.
- **REDUCED:** Uses short Rive/Lottie animations, minimal movement, limited particles, and reduced/static 3D elements.
- **MINIMAL:** Uses simple native CSS/Android transitions and static visual feedback.
- **OFF:** Uses static UI, text, icons, and color-independent feedback. No animation is rendered.

---

## 4. Reduced Motion

When "Reduced Motion" is enabled via system settings:
- **AVOID:** Large zooms, rapid camera movement, excessive particles, continuous motion, strong screen transitions, rapid flashing, and large parallax effects.
- **PREFER:** Opacity changes, small scale changes, static state changes, and subtle crossfades.

---

## 5. Color Independence

**Never communicate meaning using color alone.**
A correct answer must not depend only on *Green*. A wrong answer must not depend only on *Red*.
Always use combinations: `Icon` + `Text` + `Optional Color` + `Optional Animation`.
*Example:* ✓ Correct / ✕ Incorrect.

---

## 6. Audio Independence

Important information must never depend only on sound.
If the device is muted or the voice assistant is disabled, the user must still be fully able to understand Correct/Wrong states, XP, Streaks, Progress, Level-ups, and Errors through distinct visual feedback.

---

## 7. Visual Independence

Important information must not depend only on animation.
If an animation fails to load, or if the user sets animations to `OFF`, the UI must provide equivalent semantic data via:
- Text
- Distinct Icons
- Static State Changes
- Progress Indicators

---

## 8. Haptic Independence

Haptic feedback is strictly optional.
If unavailable on the hardware, or explicitly disabled by the user, visual and audio feedback continues unaffected. The app must never require vibration to understand a learning interaction.

---

## 9. Screen Reader Compatibility

Animation must never interfere with TalkBack or other screen readers.
- Do not repeatedly announce looping decorative changes.
- Ensure that the final static state (or the container of the animation) has meaningful `contentDescription` / `aria-label` tags.
- Character reactions (e.g., a cheering Rive mascot) should have a single, non-intrusive accessibility label like "Character celebrates".

---

## 10. Focus Management

Animation must **never** unexpectedly steal accessibility focus.
When a question changes, an answer is selected, or a dialog appears, standard Android/DOM focus navigation must remain intact. An executing background Lottie file must not intercept tab/swipe navigation.

---

## 11. Dynamic Text Scaling

Animations must remain functional when system font sizes are increased.
- Animations must adapt to larger text, larger buttons, and tablet edge-to-edge layouts.
- *Rule: Never position critical learning information solely based on fixed pixel coordinates inside a canvas.*

---

## 12. Touch Accessibility

Interactive animation elements must never become the *only* way to interact.
A Rive character may react to a button press, but the accessible Android/HTML Button element itself remains the actual interactive control.
**Support:** Large touch targets, predictable interactions, keyboard/alternative input, and absolutely **no gesture-only critical actions**.

---

## 13. Motion Safety

Strictly avoid effects that can trigger discomfort or seizures:
- No flashing or rapid strobing.
- No aggressive screen shaking.
- No excessive camera movement or continuous high-frequency background movement.

---

## 14. 3D Accessibility

For 3D scenes (e.g., Level-Up environments):
- Support reduced camera panning, reduced particles, and reduced lighting strobes.
- If 3D or motion is disabled, a Rive/Lottie or Native static fallback must provide the exact equivalent information.

---

## 15. Voice + Accessibility

The Voice Assistant works entirely independently from visual animation.
*Example for a Correct Answer:*
- Voice announces: "Correct."
- Animation plays optionally.
- If Animation is `OFF`, Voice still works.
- If Voice is `OFF`, Visual feedback still works.

---

## 16. Localization Readiness

Do not place critical text inside binary animation assets (`.riv`, `.json`) where it cannot be intercepted by translation strings or screen readers. Animation assets must remain language-independent.

---

## 17. Cognitive Accessibility

Avoid excessive simultaneous feedback that overwhelms the learner.
For important learning events, prefer:
`One clear message` + `One meaningful animation` + `Optional sound/haptic`.
Avoid firing 3D + particles + sound + voice + multiple popups simultaneously unless it is a genuinely rare, major achievement.

---

## 18. User Preferences

Settings for Animation Intensity, Reduced Motion, Sound Effects, Voice Assistant, and Haptic Feedback must be centralized. They must be respected globally by the `AnimationOrchestrator`. No individual animation is allowed to bypass these settings.

---

## 19. Device Adaptation

Accessibility profiles work harmoniously alongside Performance Tiers (`LOW`, `MEDIUM`, `HIGH`, `ULTRA`).
*Example:* `LOW DEVICE` + `REDUCED MOTION` → Instantly falls back to Native/static feedback.
*Example:* `HIGH DEVICE` + `FULL MOTION` → Rive/Lottie/3D plays at 60fps.

---

## 20. Error & Failure Behavior

If an animation fails to load or the engine crashes:
The user must never lose information. The system must instantly provide static, accessible feedback.
*Example:* Animation crash → "Correct answer" text appears → Accessible state announcement fires.

---

## 21. Testing Matrix

Accessibility tests must validate:
- [ ] Reduced motion enabled OS-wide.
- [ ] Animation disabled in-app.
- [ ] TalkBack / Screen Readers active.
- [ ] Large font / Maximum display scaling.
- [ ] High contrast mode.
- [ ] Sound disabled / Voice disabled / Haptic disabled.
- [ ] Low-end device performance.
- [ ] Tablet landscape/portrait reflowing.
- [ ] Offline mode.
- [ ] 3D disabled / Rive unavailable / Lottie unavailable (Fallback checks).

---

## 22. Future Intelligent Accessibility

The architecture prepares an `AccessibilityExperiencePolicy`.
In the future, an AI could evaluate user performance and screen context to recommend less distracting presentation styles (e.g., lowering animation intensity if the user is struggling with a topic).
**Absolute Constraint:** AI must NEVER override explicit user accessibility settings or core learning logic.

---

## 23. Golden Rules

1. Animation is optional.
2. Learning information is never optional.
3. Accessibility settings always win.
4. Never rely on color alone.
5. Never rely on animation alone.
6. Never rely on sound alone.
7. Never rely on haptic alone.
8. Avoid excessive motion.
9. Protect screen-reader focus.
10. Keep critical interactions simple.
11. Preserve usability with large text.
12. Provide static fallbacks.
13. Never allow animation failure to reduce functionality.
