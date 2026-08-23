# P-Hybrid: In-App Google Login Restoration Plan

> **Status:** PREPARED — awaiting execution day (after v164 test passes + fixes committed)
> **Goal:** Restore native in-app Google sign-in (no browser shift), regain offline-first APK behavior.
> **Root cause:** Commit `8580d09` (2026-05-31, "apk updates") added `server.url` to `capacitor.config.json`; the GoogleAuth npm plugin was never tracked/installed since.

---

## Why this works

| Layer | Now | After |
|---|---|---|
| Code source | Live website (`server.url`) | Bundled `www/` inside APK |
| Google login | Web OAuth → browser shift | Native GoogleAuth dialog |
| Offline first launch | ❌ needs net | ✅ works |
| Updates | Hosting push only | OTA engine (already built) fetches newer hosting files via SW |

`app.js` already contains complete native code expecting exactly
`@codetrix-studio/capacitor-google-auth` API (`initialize()`, `signIn()` → `result.idToken`)
— no JS changes required.

---

## Execution Steps

### Step 0 — Preconditions (blocking)
- [ ] v164 data-safety test PASSED on phone
- [ ] All work committed & pushed

### Step 1 — Install plugin (assistant)
```bash
npm install @codetrix-studio/capacitor-google-auth
npx cap sync android
```

### Step 2 — Remove remote-server mode (assistant)
In `capacitor.config.json`, delete the entire block:
```json
"server": {
    "androidScheme": "https",
    "url": "https://krishi-mcq-pro.web.app",
    "cleartext": true
},
```
Keep everything else (splash, plugins config incl. GoogleAuth clientId).

### Step 3 — Extract SHA-1 (user, in Android Studio)
Gradle panel → `android` → Tasks → android → **signingReport** → copy SHA-1 of debug variant.
(Alternative once JDK configured: `keytool -list -v -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android`)

### Step 4 — Register SHA-1 (user, Firebase Console)
Firebase Console → Authentication → Sign-in method → Google:
- Add package name: `com.krishimcqpro.app`
- Paste SHA-1 → Save
- Confirm Web client ID matches `serverClientId` in capacitor.config.json
  (`39741021868-ig8gckot7movhre5pqr5j15jnc2mis8t.apps.googleusercontent.com`)

### Step 5 — Build & install (user)
Android Studio → Build APK(s) → install `android\app\build\outputs\apk\debug\app-debug.apk`

---

## Verification Checklist

- [ ] App opens WITHOUT network (airplane mode) → loads fine (bundled)
- [ ] Google Login → **native dialog inside app**, no browser shift
- [ ] Login completes → progress preserved toast / stats intact
- [ ] Re-enable network → OTA engine detects hosting version → updates
- [ ] Second device / web PWA still logs in normally
- [ ] Account-switch guard still fires between two real accounts

## Rollback (if anything breaks)

```bash
git checkout 51bd882 -- capacitor.config.json   # restores server.url block
npx cap sync android                             # rebuild in Studio
```
Plugin package can stay installed harmlessly while server.url mode is active.

## Known Risks

| Risk | Mitigation |
|---|---|
| Plugin unmaintained upstream | Pin exact version; code isolated behind `isNative` branch |
| SHA-1 mismatch → `DEVELOPER_ERROR` | Re-check step 4 values; error appears only at login attempt |
| Old cached SW conflicts with bundled assets | Bump version before rebuild (`node bump_version.js`) |
