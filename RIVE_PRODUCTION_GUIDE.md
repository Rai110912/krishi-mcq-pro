# 🎬 RIVE_PRODUCTION_GUIDE — तपाईंको Character लाई Real Animation

> **Goal:** तपाईंकै character (उही अनुहार, लुगा) लाई Rive मा rig गरेर
> Duolingo-class smooth animation — 60fps, offline, 90KB runtime।
> **आफ्नै खाका बनाउनु पर्दैन!** तपाईंको PNG लाई टुक्र्याएर image-layers को रूपमा प्रयोग हुन्छ।

---

## 🧭 PHASES OVERVIEW

| Phase | के | को | समय |
|-------|----|----|------|
| 0 | App skeleton + fallback | ✅ म (गरिसकें) | — |
| 1 | Layer cutting | तपाईं (Photopea, free) | 30-60 min |
| 2 | Rive rigging + animations | तपाईं (rive.app, free) | 4-8 hrs पहिलो पटक |
| 3 | Wire + polish | ✅ म | ~1 hr |

---

## 📐 PHASE 1 — Layer Cutting (Photopea.com)

### तयारी
1. खोल्नुहोस्: **photopea.com** (खाता चाहिँदैन)
2. File → Open → `scratch\buddy-front.png`

### कुन-कुन टुक्रा छुट्याउने (6 layers)

| Layer | कसरी | नाम |
|-------|------|-----|
| ① **HEAD** | Lasso (L) ले घाँटीमाथि सम्पूर्ण टाउको+कपाल घेर्नुहोस् → Ctrl+J (duplicate layer) | `head.png` |
| ② **TORSO/BODY** | टाउका मुनि देखि कम्मासम्म (दुवै हात बाहेक) → Ctrl+J | `body.png` |
| ③ **ARM RIGHT** (उसको दायाँ = हाम्रो बायाँ) | दायाँ हात काँधदेखि हातसम्म → Ctrl+J | `armR.png` |
| ④ **ARM LEFT** | बायाँ हात → Ctrl+J | `armL.png` |
| ⑤ **LEGS** | कम्मादेखि जुत्तासम्म | `legs.png` |
| ⑥ **BACK HAIR** (optional, depth को लागि) | टाउकोको पछाडिको कपाल | `hairB.png` |

### ⚠️ Cutting Tips:
- हरेक piece को **काँध/घाँटीमा अलि-अलि OVERLAP** राख्नुहोस् (जोड्दा खाली नदेखिने)
- हरेक layer export: layer मा right-click → **Export as PNG** (transparent आउँछ)
- नाम मिलाएर `scratch\rive-layers\` folder मा राख्नुहोस्:
  `head.png, body.png, armR.png, armL.png, legs.png, hairB.png`

---

## 🎨 PHASE 2 — Rive Editor (rive.app)

### Setup
1. **rive.app** → Sign up (free) → New File → नाम: `krishi_buddy`

### Step 1 — Images Import
- Left panel → **Images** → `+` → सबै 6 PNG import गर्नुहोस्

### Step 2 — Hierarchy (Artboard मा जोड्ने)
Artboard (आकार: 500×700) मा यो क्रममा राख्नुहोस् (तलको = पछाडि):
```
legs.png (तल)
body.png
armL.png
armR.png
head.png (माथि — सबैभन्दा अगाडि)
```
हरेकलाई तपाईंको original जस्तै position मा मिलाउनुहोस् (overlap हुनुपर्छ!)

### Step 3 — Groups (महत्त्वपूर्ण!)
हरेक image लाई **Group** बनाउनुहोस् (right-click → Group) — pivot point राम्रोसँग राख्न:
- `armR` group को **pivot काँधमा** (rotation को धुरी)
- `head` group को **pivot घाँटीमा**
- `legs` pivot खुट्टामा

### Step 4 — Animations (Animate mode, हरेक 1-2 sec loop)

| Animation | के गर्ने | समय |
|-----------|---------|------|
| **idle** | body scale 100→102→100%, head 0→2°→0° rotate (सास फेर्ने) | 3s loop |
| **wave** | armR rotate 0→-120°→-100°→-120° (2 पटक हल्लाउने) + head tilt 5° | 1.5s |
| **celebrate** | दुवै हात माथि (rotate ±150°), body translateY -20px jump ×2 | 1.2s |
| **sad** | head rotate 8° झुक्ने, body translateY +6px, हल्का | 1.5s |
| **think** | head tilt -6° + अलि translate, hold | 2s |
| **talk** | head 0→3°→0° + body 1px bob, loop (मुख image मा छैन — bubble ले cover गर्छ) | 0.4s loop |

### Step 5 — State Machine (बायाँ panel → State Machines)
```
Entry → idle
idle ──[wave_trigger]──▶ wave ──▶ idle
idle ──[celebrate_trigger]──▶ celebrate ──▶ idle
idle ──[sad_trigger]──▶ sad ──▶ idle
idle ──[talk_bool ON]──▶ talk ──[talk_bool OFF]──▶ idle
idle ──[mood == 3]──▶ sad (optional advanced)
```
**Inputs बनाउनुहोस् (नाम EXACT यही हुनुपर्छ — code ले यही खोज्छ):**
- Trigger: `wave_trigger`, `celebrate_trigger`, `sad_trigger`
- Boolean: `talking`

### Step 6 — Export
- दायाँ-माथि **Export → Runtime** → `.riv` file download
- राख्नुहोस्: `scratch\buddy.riv`

---

## 🤝 PHASE 3 — म गर्छु (तपाईंले buddy.riv राखेपछि)
- Runtime auto-detect → character canvas मा live animation
- हरेक MCQ event le सही trigger fire गर्छ
- Fallback: .riv नभए image-system (कहिल्यै खल्बिँदैन)

---

## 🆘 Common Problems

| समस्या | समाधान |
|--------|---------|
| जोड्दा खाली-खाली देखियो | Layers मा overlap बढाउनुहोस् |
| हात घुम्दा काँधबाट नभई बीचमा घुम्छ | Group pivot काँधमा सार्नुहोस् |
| .riv export भएन | Export menu मा "Runtime" छुटाउनुभएको हुनसक्छ |
| Animation जाम भयो | State machine मा exit transition हरू जाँच्नुहोस् |
