
async function loadStaticQuestions() {
    try {
        // Safe await SQLite database initialization on native Capacitor platform to eliminate race condition
        if (window.KrishiSQLite) {
            await window.KrishiSQLite.init();
            if (window.KrishiSQLite.isAvailable()) {
                let sqliteQ = await window.KrishiSQLite.getQuestions();
                if (sqliteQ && sqliteQ.length > 0) {
                    defaultQuestions = sqliteQ;
                    console.log('[SQLite] Loaded questions from SQLite database successfully.');
                    return;
                }
            }
        }

        // Standard fallback load
        const res = await fetch('./questions.json');
        defaultQuestions = await res.json();
        console.log('[App] Static defaultQuestions array successfully loaded from questions.json.');
        
        // Save static questions to SQLite for future offline starts
        if (window.KrishiSQLite && window.KrishiSQLite.isAvailable()) {
            await window.KrishiSQLite.saveQuestions(defaultQuestions);
        }

        // Trigger Incremental Delta Question Sync
        if (typeof window.checkAndSyncDeltaQuestions === 'function') {
            setTimeout(() => {
                window.checkAndSyncDeltaQuestions();
            }, 1000);
        }
    } catch(e) {
        console.error('[App] Failed to load static questions:', e);
        defaultQuestions = [];
        if (window.showToast) {
            window.showToast('⚠️ Database load failed. Connect to internet to sync questions.', true);
        }
    }
}



    // Performance note:
    // Heavy libraries (PDF.js / Tesseract / Quill) are loaded lazily when their features are used.
    
    // Top-Level Static Configuration
    const DEFAULT_EXAM_PROFILE = {
        id: 'profile_default',
        name: 'Agriculture 5th Level',
        level: '5th Level',
        province: 'Bagmati Province',
        targetDate: '2026-07-03',
        dailyTarget: 50,
        weeklyTarget: 250,
        syllabusTarget: 80,
        preferredSubjects: ['Agronomy (कृषि विकास)', 'Soil Science (माटो विज्ञान)'],
        active: true
    };

    // State, questions definitions
    let defaultQuestions = [];

    const KrishiDB = (() => {
        const DB_NAME = 'KrishiCustomQuestionsDB';
        const STORE_NAME = 'custom_questions';
        
        function getDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    }
                };
                request.onsuccess = e => resolve(e.target.result);
                request.onerror = e => reject(e.target.error);
            });
        }
        
        // Returns the current row count, or null if it cannot be determined.
        function countRows(db) {
            return new Promise(resolve => {
                try {
                    const tx = db.transaction(STORE_NAME, 'readonly');
                    const req = tx.objectStore(STORE_NAME).count();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                } catch(e) { resolve(null); }
            });
        }

        return {
            // Resolves to an array on success, or null when the store could not be
            // read. null means "unknown" and MUST NOT be treated as "empty" — a read
            // failure that is laundered into [] becomes a destructive write later.
            getAll: async () => {
                try {
                    const db = await getDB();
                    return await new Promise(resolve => {
                        const tx = db.transaction(STORE_NAME, 'readonly');
                        const store = tx.objectStore(STORE_NAME);
                        const req = store.getAll();
                        req.onsuccess = () => resolve(req.result || []);
                        req.onerror = () => {
                            console.error('[IndexedDB] Get all read failed:', req.error);
                            resolve(null);
                        };
                    });
                } catch(e) {
                    console.error('[IndexedDB] Get all failed:', e);
                    return null;
                }
            },
            // Destructive: clears the store and rewrites it. Refuses to clear a
            // non-empty store when handed an empty array unless allowEmpty is set
            // (only the deliberate logout wipe passes it).
            saveAll: async (questions, opts) => {
                const allowEmpty = !!(opts && opts.allowEmpty);
                if (!Array.isArray(questions)) {
                    throw new Error('[IndexedDB] saveAll refused: not an array');
                }
                const db = await getDB();
                if (questions.length === 0 && !allowEmpty) {
                    const existing = await countRows(db);
                    if (existing === null || existing > 0) {
                        throw new Error('[IndexedDB] saveAll refused: empty array would wipe ' +
                            (existing === null ? 'an unknown number of' : existing) + ' stored questions');
                    }
                    return; // store is already empty — nothing to do
                }
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, 'readwrite');
                    const store = tx.objectStore(STORE_NAME);
                    let aborted = false;
                    // Resolve/reject off the transaction, so a rolled-back clear() is
                    // never reported as a success.
                    tx.oncomplete = () => resolve();
                    tx.onabort = () => reject(tx.error || new Error('[IndexedDB] saveAll transaction aborted'));
                    tx.onerror = () => reject(tx.error || new Error('[IndexedDB] saveAll transaction failed'));
                    const clearReq = store.clear();
                    clearReq.onsuccess = () => {
                        questions.forEach(q => {
                            if (aborted) return;
                            const addReq = store.put(q);
                            addReq.onerror = () => {
                                if (aborted) return;
                                aborted = true;
                                console.error('[IndexedDB] put failed, rolling back clear():', addReq.error);
                                try { tx.abort(); } catch(e) {}
                            };
                        });
                    };
                });
            }
        };
    })();


    let localData={
        bookmarked:[], wrong:[], bookmarkedLog:{}, wrongLog:{}, customQuestions:[], streak:{},
        stats:{totalSolved:0,totalCorrect:0,subjectStats:{}}, achievements:[], progression:{xp:0}
    };
    // True only once localData.customQuestions has been proven to reflect IndexedDB.
    // Until then localData.customQuestions is the empty literal above, which must never
    // be persisted locally or uploaded — an unhydrated [] is indistinguishable from a
    // genuinely empty bank and would destroy the user's questions.
    let customQuestionsHydrated = false;
    // Removed legacy sm2Data variable
    let tempBatch=[];
    let tempBulkParsed=[];
    let selectedManageQIds=[];
    let importPreviewQuestions=[];
    let importSelectedIds=[];
    let importDuplicates=[];
    let currentCreatorTab='add';

    let state={
        currentIndex:0, selectedOption:null, answered:false, score:0, questions:[],
        sessionResults:[], isMock:false, timerSec:0, timerInterval:null, totalQuestions:0, tempGeneratedQuestions:[]
    };
  



    // ==================== PERFORMANCE SETTINGS & HELPERS ====================
    const PERF_DEFAULTS = {
        animIntensity: 'medium', // off | low | medium | high
        perfMode: 'balanced',    // battery | balanced | smooth120
        soundEffects: true,
        reduceMotion: false
    };

    function safeJsonParse(str, fallback) {
        try { return JSON.parse(str); } catch (_) { return fallback; }
    }

    // localStorage wrapper: caches reads + batches writes (prevents jank with big question banks)
    const Storage = (() => {
        const cache = new Map();
        const pending = new Map();
        let flushTimer = null;
        let flushRequested = false;

        function getRaw(key) {
            if (cache.has(key)) return cache.get(key);
            const v = KrishiStorage.getItem(key);
            cache.set(key, v);
            return v;
        }

        function setRaw(key, value, { immediate = false } = {}) {
            cache.set(key, value);
            pending.set(key, value);
            if (immediate) return flush();
            scheduleFlush();
        }

        function scheduleFlush() {
            if (flushRequested) return;
            flushRequested = true;
            const flushFn = () => {
                flushRequested = false;
                flush();
            };
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(flushFn, { timeout: 800 });
            } else {
                flushTimer = setTimeout(flushFn, 200);
            }
        }

        function flush() {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            for (const [k, v] of pending.entries()) {
                try { 
                    KrishiStorage.setItem(k, v); 
                } catch (e) { 
                    if (e.name === 'QuotaExceededError' || e.message.includes('quota')) {
                        console.error('[Storage] Quota exceeded. Data loss occurred for key:', k);
                        if (window.showToast) window.showToast('⚠️ Storage Full! Your progress could not be saved.', true);
                        else alert('⚠️ Storage Full! Your progress could not be saved.');
                    }
                }
            }
            pending.clear();
        }

        function getJSON(key, fallback) {
            const raw = getRaw(key);
            if (!raw) return fallback;
            return safeJsonParse(raw, fallback);
        }

        function setJSON(key, obj, opts) {
            // stringify once; helps when the same object is re-saved frequently
            let str;
            try { str = JSON.stringify(obj); } catch (_) { str = 'null'; }
            setRaw(key, str, opts);
        }

        return { getRaw, setRaw, getJSON, setJSON, flush };
    })();

    function getPerfSettings() {
        const saved = Storage.getJSON('krishi_perf_settings', null);
        return { ...PERF_DEFAULTS, ...(saved || {}) };
    }

    function savePerfSettings(patch) {
        const next = { ...getPerfSettings(), ...patch };
        Storage.setJSON('krishi_perf_settings', next);
        applyPerfSettings(next);
        return next;
    }

    function applyPerfSettings(settings = getPerfSettings()) {
        // dataset flags allow cheap CSS branching without reflow-heavy class toggles
        const root = document.documentElement;
        root.dataset.perfMode = settings.perfMode;
        root.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false';

        // Animation intensity -> adjust only the app-owned animation timings (not all Tailwind transitions)
        let pageAnim = 350;
        if (settings.reduceMotion || settings.animIntensity === 'off') pageAnim = 0;
        else if (settings.animIntensity === 'low') pageAnim = 220;
        else if (settings.animIntensity === 'high') pageAnim = 420;

        if (settings.perfMode === 'battery') pageAnim = 0;

        root.style.setProperty('--page-anim', pageAnim + 'ms');
    }

    function debounce(fn, wait = 150) {
        let t = null;
        return function(...args) {
            if (t) clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function rafThrottle(fn) {
        let raf = 0;
        let lastArgs = null;
        return function(...args) {
            lastArgs = args;
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                fn.apply(this, lastArgs);
            });
        };
    }

    // Lazy-load heavy CDNs only when needed
    const LazyLibs = (() => {
        const inFlight = new Map();

        function loadScript(src) {
            if (inFlight.has(src)) return inFlight.get(src);
            const p = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = src;
                s.async = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Failed loading: ' + src));
                document.head.appendChild(s);
            });
            inFlight.set(src, p);
            return p;
        }

        async function ensureQuill() {
            if (window.Quill) return;
            if (!navigator.onLine) {
                throw new Error("offline");
            }
            try {
                await loadScript('https://cdn.quilljs.com/1.3.7/quill.min.js');
            } catch(e) {
                if (!navigator.onLine) throw new Error("offline");
                throw e;
            }
        }

        async function ensurePdfjs() {
            if (window.pdfjsLib) return;
            if (!navigator.onLine) {
                throw new Error("offline");
            }
            try {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
                try {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                } catch (_) {}
            } catch(e) {
                if (!navigator.onLine) throw new Error("offline");
                throw e;
            }
        }

        async function ensureTesseract() {
            if (window.Tesseract) return;
            if (!navigator.onLine) {
                throw new Error("offline");
            }
            try {
                await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
            } catch(e) {
                if (!navigator.onLine) throw new Error("offline");
                throw e;
            }
        }

        return { ensureQuill, ensurePdfjs, ensureTesseract };
    })();

    // ==================== INITIALIZATION ====================
    // Advanced PWA Loading Screen Supervisor
    (function() {
        const messages = [
            "Preparing your exam dashboard...",
            "Loading MCQ practice tools...",
            "Warming up revision engine...",
            "Syncing your study progress...",
            "Ready for today's Krishi mission... 🌾"
        ];

        let progress = 0;
        let messageIndex = 0;
        let loaded = false;

        const pBar = document.getElementById('splash-progress');
        const pPercent = document.getElementById('splash-percent');
        const pMessage = document.getElementById('splash-message');
        const pSplash = document.getElementById('splash-screen');
        const pParticles = document.getElementById('splash-particles');

        // Create background floating sparks dynamically for low overhead
        if (pParticles && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            for (let i = 0; i < 12; i++) {
                const particle = document.createElement('div');
                particle.className = 'splash-particle';
                particle.style.width = (Math.random() * 5 + 3) + 'px';
                particle.style.height = particle.style.width;
                particle.style.left = (Math.random() * 100) + 'vw';
                particle.style.animationDelay = (Math.random() * 4) + 's';
                particle.style.animationDuration = (Math.random() * 3 + 4) + 's';
                pParticles.appendChild(particle);
            }
        }

        // Shifting loading messages
        const msgInterval = setInterval(() => {
            if (loaded) return;
            messageIndex = (messageIndex + 1) % (messages.length - 1);
            if (pMessage) pMessage.innerText = messages[messageIndex];
        }, 900);

        // Smooth progress crawler to 95% (eased deceleration)
        const progInterval = setInterval(() => {
            if (loaded) return;
            const remaining = 95 - progress;
            progress += remaining * 0.08;
            updateUI(Math.round(progress));
        }, 120);

        function updateUI(percent) {
            if (pBar) pBar.style.width = percent + '%';
            if (pPercent) pPercent.innerText = percent + '%';
        }

        function dismissSplash() {
            if (loaded) return;
            loaded = true;
            clearInterval(msgInterval);
            clearInterval(progInterval);

            updateUI(100);
            if (pMessage) pMessage.innerText = messages[messages.length - 1];

            setTimeout(() => {
                if (pSplash) {
                    pSplash.classList.add('hidden');
                    // Completely flush particle DOM after fadeout to zero rendering overhead
                    setTimeout(() => {
                        if (pParticles) pParticles.innerHTML = '';
                    }, 500);
                }
            }, 350);
        }

        // 1. Dismiss on page load ready
        window.addEventListener("load", dismissSplash);

        // 2. Safe Stall Fallback (4.5s) to guarantee PWA never locks up
        setTimeout(dismissSplash, 4500);
    })();

    document.addEventListener("DOMContentLoaded", async function() {
        if (typeof KrishiStorage !== 'undefined') await KrishiStorage.init();
        await loadStaticQuestions();

        if(KrishiStorage.getItem('krishi_dark')==='true') document.documentElement.classList.add('dark');
        applyPerfSettings();
        loadData();
        
        // Listen for incoming deep links (e.g. from secure login-helper.html)
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.addListener('appUrlOpen', async function(data) {
                console.log("[DeepLink] App opened with URL:", data.url);
                try {
                    let urlStr = data.url;
                    if (urlStr.includes('auth?token=')) {
                        let tokenIndex = urlStr.indexOf('token=');
                        if (tokenIndex !== -1) {
                            let token = urlStr.substring(tokenIndex + 6);
                            let ampersandIndex = token.indexOf('&');
                            if (ampersandIndex !== -1) {
                                token = token.substring(0, ampersandIndex);
                            }
                            token = decodeURIComponent(token);
                            if (token) {
                                showToast('⏳ Completing secure Google Sign-in...');
                                const auth = getSafeFirebaseApp().auth();
                                const credential = firebase.auth.GoogleAuthProvider.credential(token);
                                await auth.signInWithCredential(credential);
                                showToast('✅ Logged in successfully with Google!');
                                if (typeof triggerBackgroundSync === 'function') triggerBackgroundSync();
                                
                                // Close the external browser tab securely after a short delay
                                try {
                                    if (window.Capacitor.Plugins.Browser) {
                                        await window.Capacitor.Plugins.Browser.close();
                                    }
                                } catch(e){}
                            }
                        }
                    }
                } catch (err) {
                    console.error("[DeepLink] Failed to process incoming token:", err);
                }
            });
        }
        
        // Smart Scroll Auto-Hide for Mobile Nav and Header
        let lastScrollY = window.scrollY;
        const mobileHeader = document.getElementById('mobile-header');
        const mobileBottomNav = document.getElementById('mobile-bottom-nav');
        
        window.addEventListener('scroll', () => {
            if(window.innerWidth >= 1024) return; // Only apply on mobile/tablet screens
            const currentScrollY = window.scrollY;
            
            // Allow 50px threshold before hiding to prevent jitter
            if (currentScrollY > lastScrollY && currentScrollY > 60) {
                if(mobileHeader) mobileHeader.classList.add('header-hide');
            } else {
                if(mobileHeader) mobileHeader.classList.remove('header-hide');
            }
            lastScrollY = currentScrollY;
        }, { passive: true });
        
        // macOS-style Dock Fluid Zoom Magnification Engine
        window.initMacOSDockZoom = function() {
            const dock = document.getElementById('mobile-bottom-nav');
            if (!dock) return;

            const items = dock.querySelectorAll('.dock-item');
            let itemUnderTouch = null;
            let lastClosestItem = null;
            
            function handleZoom(clientX) {
                if (window.innerWidth >= 1024) return;
                
                let closestItem = null;
                let minDistance = 99999;
                
                // Add lift and glow styling to dock container during interaction
                dock.classList.add('dock-zooming');
                
                items.forEach(item => {
                    const rect = item.getBoundingClientRect();
                    const itemCenterX = rect.left + rect.width / 2;
                    const dist = Math.abs(clientX - itemCenterX);
                    
                    let scale = 1.0;
                    if (dist < 90) {
                        scale = 1.0 + (1.0 - dist / 90) * 0.32;
                    }
                    
                    item.style.transform = `scale(${scale})`;
                    const icon = item.querySelector('.text-base');
                    if (icon) {
                        icon.style.transform = `scale(${1 + (scale - 1) * 0.25})`;
                    }

                    if (scale > 1.18) {
                        item.classList.add('dock-touch-active');
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestItem = item;
                        }
                    } else {
                        item.classList.remove('dock-touch-active');
                    }
                });
                
                // Trigger physical tactile haptic tick feedback if active item changes
                if (closestItem && closestItem !== lastClosestItem) {
                    if (typeof window.triggerHaptic === 'function') {
                        window.triggerHaptic('click');
                    }
                    lastClosestItem = closestItem;
                }
                
                itemUnderTouch = closestItem;
            }

            function resetZoom() {
                dock.classList.remove('dock-zooming');
                items.forEach(item => {
                    item.style.transform = 'scale(1)';
                    const icon = item.querySelector('.text-base');
                    if (icon) {
                        icon.style.transform = 'scale(1)';
                    }
                    item.classList.remove('dock-touch-active');
                });
                lastClosestItem = null;
            }

            dock.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches[0]) {
                    handleZoom(e.touches[0].clientX);
                }
            }, { passive: true });

            dock.addEventListener('touchmove', (e) => {
                if (e.touches && e.touches[0]) {
                    handleZoom(e.touches[0].clientX);
                }
            }, { passive: true });

            dock.addEventListener('touchend', (e) => {
                if (itemUnderTouch) {
                    // Prevent default synthesized click to completely stop ghost click bleed-through
                    e.preventDefault();
                    e.stopPropagation();
                    // Instantly trigger target's navigation logic!
                    itemUnderTouch.click();
                    // Apply visual active dot
                    items.forEach(i => i.classList.remove('dock-active'));
                    itemUnderTouch.classList.add('dock-active');
                }
                resetZoom();
                itemUnderTouch = null;
            });

            dock.addEventListener('touchcancel', () => {
                resetZoom();
                itemUnderTouch = null;
            });

            dock.addEventListener('mousemove', (e) => {
                handleZoom(e.clientX);
            });

            dock.addEventListener('mouseleave', resetZoom);
        };
        
        window.initMacOSDockZoom();
        
        // WebView Keyboard Overlap Guard: Hide bottom navigation when input fields are focused
        document.body.addEventListener('focusin', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                if (mobileBottomNav) mobileBottomNav.classList.add('bottom-nav-hide');
            }
        });
        
        document.body.addEventListener('focusout', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                if (mobileBottomNav) mobileBottomNav.classList.remove('bottom-nav-hide');
            }
        });
        
        // Legacy: ?sync_key= URL parameter is no longer used.
        // Users sync via Firebase Authentication (account-based) instead.
        // Old QR codes with sync_key are gracefully ignored.
        
        // Asynchronously load custom questions from IndexedDB (Zero-Risk Legacy Migrator)
        try {
            let legacyQuestions = Storage.getJSON('krishi_customQuestions', null);
            // length > 0 is essential: a legacy "[]" would otherwise clear the store.
            if (legacyQuestions && Array.isArray(legacyQuestions) && legacyQuestions.length > 0) {
                console.log('[IndexedDB Migration] Migrating legacy custom questions to IndexedDB...');
                await KrishiDB.saveAll(legacyQuestions);
                KrishiStorage.removeItem('krishi_customQuestions'); // Clean up old LocalStorage
                console.log('[IndexedDB Migration] Legacy custom questions successfully migrated!');
            } else if (legacyQuestions && Array.isArray(legacyQuestions)) {
                KrishiStorage.removeItem('krishi_customQuestions'); // empty legacy key, nothing to migrate
            }
            const idbQuestions = await KrishiDB.getAll();
            if (Array.isArray(idbQuestions)) {
                localData.customQuestions = idbQuestions.map(q => normalizeQuestion(q));
                registerCustomSubjectsFromQuestions(localData.customQuestions);
                customQuestionsHydrated = true;
                console.log('[IndexedDB] Custom questions loaded:', localData.customQuestions.length);
            } else {
                // getAll() returned null => the store could not be read. Stay unhydrated so
                // no save or sync path can mistake this for an empty question bank.
                console.error('[IndexedDB] Custom questions unreadable — question bank locked read-only for this session.');
                if (typeof showToast === 'function') {
                    showToast('⚠️ Custom questions could not be loaded. Restart the app before adding or syncing questions.', 'error');
                }
            }
        } catch(e) {
            console.error('[IndexedDB] Failed to load custom questions:', e);
        }
        loadTimingData();
        applyAppearanceSettings();
        if (typeof applyCustomAppearanceAndLanguageSettings === 'function') {
            applyCustomAppearanceAndLanguageSettings();
        }
        updateHomePage();
        updatePracticePage();
        // Unified Shell: populate stats ribbon on startup
        if (typeof updateStatsRibbon === 'function') setTimeout(updateStatsRibbon, 200);
        checkAutoBackupReminder();

        initPracticeSoundSettings();
        initHapticUI();
        initPerfSettingsUI();
        if (typeof initEliteAnimationsUI === 'function') initEliteAnimationsUI();
        restoreUIStateIfCached();
    window.showConfirmDialog = function(message, onConfirm, onCancel) {
        let existing = document.getElementById('custom-confirm-modal-overlay');
        if (existing) existing.remove();

        let overlay = document.createElement('div');
        overlay.id = 'custom-confirm-modal-overlay';
        overlay.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-opacity duration-300';
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.35s cubic-bezier(0.25, 0.8, 0.25, 1)';

        overlay.innerHTML = `
            <div class="confirm-glass-card rounded-3xl p-6 max-w-[320px] w-full text-center space-y-5 transform scale-[0.88] translateY(25px) transition-all duration-300" style="transition: transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);">
                <div class="w-12 h-12 rounded-2xl study-target-glow flex items-center justify-center text-xl mx-auto">🎯</div>
                <div class="space-y-1.5">
                    <h4 class="font-black text-sm text-slate-800 dark:text-slate-100">अधुरो अभ्यास (Saved Progress)</h4>
                    <div class="text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400 font-medium">${message}</div>
                </div>
                <div class="flex gap-2.5">
                    <button id="custom-confirm-cancel-btn" class="flex-1 py-2.5 rounded-xl font-bold text-[10.5px] cursor-pointer">तुरुन्त रद्द</button>
                    <button id="custom-confirm-ok-btn" class="flex-1 py-2.5 rounded-xl font-black text-[10.5px] cursor-pointer">सुरु गर्नुहोस्</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Soft sound play when dialog appears
        if (typeof playSound === 'function') {
            try { playSound('click'); } catch(e) {}
        }

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            overlay.querySelector('div').style.transform = 'scale(1) translateY(0)';
        });

        function closeConfirm(callback) {
            overlay.style.opacity = '0';
            overlay.querySelector('div').style.transform = 'scale(0.88) translateY(25px)';
            setTimeout(() => {
                overlay.remove();
                if (typeof callback === 'function') callback();
            }, 300);
        }

        document.getElementById('custom-confirm-cancel-btn').addEventListener('click', () => {
            if (typeof window.triggerHaptic === 'function') window.triggerHaptic('click');
            closeConfirm(onCancel);
        });

        document.getElementById('custom-confirm-ok-btn').addEventListener('click', () => {
            if (typeof window.triggerHaptic === 'function') window.triggerHaptic('success');
            closeConfirm(onConfirm);
        });
    };

    // Resume session logic
    // Single source of truth for "can this saved session still be continued?". Both the
    // save path and every restore path go through this, so a session that has run to the
    // end can never be persisted, uploaded, or offered for resume on another device.
    // Before this existed, a completed session was offered on the peer device and tapping
    // the offer replayed it — which re-saved it and bounced the offer back, forever.
    window.isResumableSession = function(session) {
        if (!session || session.isCleared) return false;
        if (!Array.isArray(session.questions) || session.questions.length === 0) return false;
        return (session.currentIndex || 0) < session.questions.length;
    };

    window.lastPromptedSessionKey = window.lastPromptedSessionKey || null;
    window.checkAndPromptResumeSession = function() {
        let activePage = document.querySelector('.page.active');
        if (!activePage || activePage.id !== 'page-practice') {
            return;
        }
        let snapshotSessionId = state ? state.sessionId : undefined;
        let localSaved = KrishiStorage.getItem('krishi_saved_practice');
        const uid = (typeof getCloudUID === 'function') ? getCloudUID() : null;
        const key = uid; // alias for condition check below

        function triggerPrompt(session, isCloud = false) {
            if (!session) return;
            // A finished session must never be advertised. It used to reach here, and
            // because questions[currentIndex] is undefined once the index has run past the
            // end, the fallback below presented it as a fresh Q1.
            if (!window.isResumableSession(session)) {
                console.log('[Resumption] Ignoring a session that is already complete.');
                return;
            }
            
            // Generate a unique key for this session state
            let sessionKey = session.updatedAt || session.score || 0;
            
            if (window.lastPromptedSessionKey === sessionKey) return;
            
            if (state && state.sessionId !== snapshotSessionId) {
                console.log('[Resumption] Prompt aborted because user started a new session while cloud fetch was pending.');
                return;
            }
            
            // Async safety check: Ensure user is still on the practice page after network fetch
            let currentActive = document.querySelector('.page.active');
            if (!currentActive || currentActive.id !== 'page-practice') {
                return;
            }
            
            window.lastPromptedSessionKey = sessionKey;

            let total = session.questions ? session.questions.length : 0;
            let current = session.currentIndex || 0;
            let remaining = total - current;
            let currentQ = session.questions ? (session.questions[current] || session.questions[0]) : null;
            let subject = currentQ ? (currentQ.sub || 'कृषि') : 'कृषि';
            let deviceTag = session.device ? ` (${session.device})` : '';

            let pct = total > 0 ? Math.round((current / total) * 100) : 0;
            let correct = session.sessionResults ? session.sessionResults.filter(r => r.correct).length : 0;
            let attempted = session.sessionResults ? session.sessionResults.length : 0;
            let accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 100;
            
            let totalSpeed = session.sessionResults ? session.sessionResults.reduce((acc, r) => acc + (r.seconds || 0), 0) : 0;
            let avgSpeed = attempted > 0 ? Math.round(totalSpeed / attempted) : 0;

            let sourceText = isCloud ? `<span class="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">Cloud Resumption${deviceTag}</span>` : `<span class="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">Local Resumption</span>`;

            let messageHtml = `
                <div class="space-y-3 text-left">
                    <div class="flex justify-between items-center">${sourceText}</div>
                    <p class="text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-400">
                        तपाईंको <b>${subject}</b> विषयको <b>${remaining}</b> वटा प्रश्नहरू समाधान गर्न बाँकी रहेको सत्र फेला परेको छ। के तपाईं सोही स्थानबाट जारी राख्न चाहनुहुन्छ?
                    </p>
                    
                    <div class="modal-stats-dashboard space-y-2">
                        <div class="flex justify-between items-center text-[10px] font-black text-slate-500 dark:text-slate-400">
                            <span>PROGRESS</span>
                            <span class="text-emerald-600 dark:text-emerald-400 font-extrabold">${pct}% completed</span>
                        </div>
                        <div class="modal-progress-bar-container">
                            <div class="modal-progress-bar-fill" style="width: ${pct}%;"></div>
                        </div>
                        
                        <div class="grid grid-cols-3 gap-1.5 text-center pt-1 text-[10px]">
                            <div class="p-1.5 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span class="text-slate-400 block text-[8px] uppercase font-bold">REMAINING</span>
                                <b class="text-slate-750 dark:text-slate-350 text-xs">🎯 ${remaining}</b>
                            </div>
                            <div class="p-1.5 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span class="text-slate-400 block text-[8px] uppercase font-bold">ACCURACY</span>
                                <b class="text-emerald-600 dark:text-emerald-400 text-xs">📈 ${accuracy}%</b>
                            </div>
                            <div class="p-1.5 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
                                <span class="text-slate-400 block text-[8px] uppercase font-bold">AVG SPEED</span>
                                <b class="text-blue-500 dark:text-blue-400 text-xs">⏱️ ${avgSpeed}s</b>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            window.showConfirmDialog(
                messageHtml,
                function() {
                    setupMCQSession(session.questions, session.isMock, session.timerSec);
                    state.currentIndex = session.currentIndex;
                    state.score = session.score;
                    state.sessionResults = session.sessionResults;
                    if (session.timeSpentArray) state.timeSpentArray = session.timeSpentArray;
                    if (session.totalTimeSpent) state.totalTimeSpent = session.totalTimeSpent;
                    renderMCQ();
                    // The session key prevents duplicate prompts; no boolean reset needed.
                },
                function() {
                    clearPracticeProgress();
                    // On cancel, the session is cleared, so it won't prompt anyway.
                }
            );
        }

        if (key && navigator.onLine && window.firebase && firebase.apps && firebase.apps.length) {
            let existingApp = firebase.apps.find(app => app.name === "KrishiApp");
            let firebaseApp = existingApp || firebase.app("KrishiApp");
            function safeParseSession(str) {
                if (!str) return null;
                try {
                    return JSON.parse(str);
                } catch(e) {
                    console.warn('[Resumption] Corrupted active session backup found and removed:', e);
                    try { KrishiStorage.removeItem('krishi_active_session_backup'); } catch(err){}
                    return null;
                }
            }

            if (firebaseApp) {
                const firestore = firebase.firestore(firebaseApp);
                firestore.collection('users').doc(uid).collection('active_session').doc('progress').get()
                    .then(doc => {
                        if (doc.exists) {
                            let cloudSession = doc.data();
                            let localSessionObj = safeParseSession(localSaved);
                            let localTime = localSessionObj ? (localSessionObj.updatedAt || 0) : 0;
                            let localTombstone = parseInt(KrishiStorage.getItem('krishi_local_session_tombstone') || '0');

                            if (cloudSession.isCleared) {
                                // Tombstone found. If it was cleared AFTER our local save, we must wipe local data!
                                let clearedTime = cloudSession.clearedAt || 0;
                                if (clearedTime > localTime) {
                                    console.log('[Resumption] Cloud session was cleared on another device. Wiping outdated local session.');
                                    try { KrishiStorage.removeItem('krishi_saved_practice'); } catch(e){}
                                    return; // Abort prompt
                                } else if (localSessionObj && localSessionObj.questions && localSessionObj.questions.length > 0) {
                                    // Extremely rare: user played offline AFTER another device cleared it.
                                    triggerPrompt(localSessionObj, false);
                                }
                                return;
                            }

                            let cloudTime = cloudSession.updatedAt || 0;
                            
                            // Check for stale cloud session (finished offline, cloud never got the tombstone)
                            if (localTombstone > cloudTime) {
                                console.log('[Resumption] Stale cloud session detected. Ignoring cloud data.');
                                cloudTime = 0; // Invalidate cloud session
                                cloudSession = {}; 
                                
                                // Only sync the tombstone if we haven't started a NEW local session since then
                                if (!localSessionObj || !localSessionObj.questions || localSessionObj.questions.length === 0) {
                                    clearPracticeProgress(); 
                                    return;
                                }
                            }

                            // Test resumability, not merely "has questions". A completed
                            // cloud session with a newer timestamp used to win here and
                            // shadow a local session that really could be continued.
                            if (cloudTime > localTime && window.isResumableSession(cloudSession)) {
                                console.log('[Resumption] Resolving to cloud active session progress.');
                                triggerPrompt(cloudSession, true);
                            } else if (window.isResumableSession(localSessionObj)) {
                                console.log('[Resumption] Resolving to local active session progress (newer).');
                                triggerPrompt(localSessionObj, false);
                            }
                        } else if (localSaved) {
                            let localSessionObj = safeParseSession(localSaved);
                            if (localSessionObj && localSessionObj.questions && localSessionObj.questions.length > 0) {
                                triggerPrompt(localSessionObj, false);
                            }
                        }
                    })
                    .catch(err => {
                        console.warn('[Resumption] Cloud fetch failed, falling back to local:', err);
                        if (localSaved) {
                            let localSessionObj = safeParseSession(localSaved);
                            if (localSessionObj && localSessionObj.questions && localSessionObj.questions.length > 0) {
                                triggerPrompt(localSessionObj, false);
                            }
                        }
                    });
                return;
            }
        }

        if (localSaved) {
            let session = safeParseSession(localSaved);
            if (session && session.questions && session.questions.length > 0) {
                triggerPrompt(session, false);
            }
        }
    };

    // Resume session logic - only trigger on startup if we are actively on the practice page
    setTimeout(() => {
        // Check updates on load
        window.addEventListener('load', () => {
            if (typeof checkForUpdates === 'function') {
                checkForUpdates(false);
            }
        });

        // Anti-Cheat & Save Data Mechanism
        function saveSpacedRepetitionProgress() {
            if (window.KrishiSM2Engine && state && state.activeConfig && state.activeConfig.isSpacedReview && state.sessionResults) {
                // Assuming session answers are already saved individually by checkAnswer
                // But we can trigger a bulk save or sync here if necessary
                console.log("Anti-cheat: App backgrounded, progress preserved.");
            }
        }

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === 'hidden') {
                saveSpacedRepetitionProgress();
            }
        });
        window.addEventListener("pagehide", () => {
            saveSpacedRepetitionProgress();
        });

        let activePage = document.querySelector('.page.active');
        if (activePage && activePage.id === 'page-practice') {
            window.checkAndPromptResumeSession();
        }
    }, 1000);

        // Register Service Worker for PWA (Progressive Web App) offline support
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => {
                        console.log('Service Worker registered successfully!', reg.scope);
                        
                        // Force check for updates immediately on load
                        try {
                            reg.update();
                        } catch(e) {
                            console.warn('[PWA Update] Forced update check failed:', e);
                        }
                        
                        // Register Periodic Sync if supported
                        try {
                            registerPeriodicSync(reg);
                        } catch(e) {
                            console.error('[PeriodicSync] Failed initiation:', e);
                        }
                        
                        // Check for updates and automatically skip waiting when not practicing
                        function checkAndSkipWaiting(worker) {
                            if (typeof showUpdatePrompt === 'function') {
                                showUpdatePrompt(worker);
                            } else {
                                setTimeout(() => {
                                    if (typeof showUpdatePrompt === 'function') {
                                        showUpdatePrompt(worker);
                                    }
                                }, 500);
                            }
                        }

                        if (reg.waiting) {
                            checkAndSkipWaiting(reg.waiting);
                        }
                        reg.addEventListener('updatefound', () => {
                            const installingWorker = reg.installing;
                            if (installingWorker) {
                                installingWorker.addEventListener('statechange', () => {
                                    if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                        checkAndSkipWaiting(installingWorker);
                                    }
                                });
                            }
                        });
                    })
                    .catch(err => console.warn('Service Worker registration failed:', err));
            });

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
                console.log('[PWA Update] Controller changed. Reloading app safely...');
                saveUIStateForRestore(); // Save state before reloading!
                setTimeout(() => {
                    window.location.reload();
                }, 250);
            });

            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data && event.data.type === 'BACKGROUND_SYNC_TRIGGER') {
                    console.log('[PWA Sync] Background sync event triggered by Service Worker');
                    performCloudSync();
                }
            });
        }

        // ==================== PWA ADVANCED AUTO-UPDATE SYSTEM ====================
        let newWorker;
        let updateToastVisible = false;

        function showUpdatePrompt(worker) {
            newWorker = worker;
            if (updateToastVisible) return;

            // Suppress updates only when actively inside gameplay or result view cards
            const activePage = document.querySelector('.page.active');
            const mcqActive = document.getElementById('page-mcq') && !document.getElementById('page-mcq').classList.contains('hidden');
            const resActive = document.getElementById('practice-result-panel') && !document.getElementById('practice-result-panel').classList.contains('hidden');
            const isMockActive = activePage && activePage.id === 'page-mock';
            
            const isPracticing = isMockActive || (activePage && activePage.id === 'page-practice' && (mcqActive || resActive));

            if (isPracticing) {
                console.log('[PWA Update] Update is waiting, but user is practicing. Will prompt later.');
                // Hook navigation router dynamically to show update prompt when user exits practice page
                const originalNavigate = window.navigate;
                window.navigate = function(pageId) {
                    originalNavigate.apply(this, arguments);
                    if (pageId !== 'page-practice' && pageId !== 'page-mock') {
                        // Restore original navigate and show the prompt
                        window.navigate = originalNavigate;
                        showUpdatePrompt(worker);
                    }
                };
                return;
            }

            updateToastVisible = true;

            // Create glassmorphic dynamic update toast element
            const toast = document.createElement('div');
            toast.id = 'pwa-update-toast';

            const style = document.createElement('style');
            style.textContent = `
                #pwa-update-toast {
                    position: fixed;
                    bottom: 24px;
                    left: 24px;
                    background: rgba(255, 255, 255, 0.85);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid rgba(226, 232, 240, 0.8);
                    padding: 12px 16px;
                    border-radius: 12px;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
                    z-index: 99999;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    transform: translateY(150%);
                    opacity: 0;
                    font-family: inherit;
                    color: #1e293b;
                }
                .dark #pwa-update-toast {
                    background: rgba(30, 41, 59, 0.85);
                    border-color: rgba(51, 65, 85, 0.8);
                    color: #f1f5f9;
                }
                #pwa-update-toast.show {
                    transform: translateY(0);
                    opacity: 1;
                }
                @media (max-width: 767px) {
                    #pwa-update-toast {
                        left: 50% !important;
                        bottom: calc(85px + env(safe-area-inset-bottom, 12px)) !important;
                        transform: translate3d(-50%, 150%, 0) !important;
                        width: calc(100% - 32px) !important;
                        box-sizing: border-box !important;
                        justify-content: space-between !important;
                    }
                    #pwa-update-toast.show {
                        transform: translate3d(-50%, 0, 0) !important;
                        opacity: 1 !important;
                    }
                }
                #pwa-update-btn {
                    background: #059669;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: bold;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                #pwa-update-btn:hover {
                    background: #047857;
                }
            `;
            document.head.appendChild(style);

            toast.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <span style="font-size:9px; font-weight:900; text-transform:uppercase; color:#94a3b8; letter-spacing:0.05em;">Krishi MCQ Update 🌾</span>
                    <span style="font-size:11px; font-weight:bold;">New version ready</span>
                </div>
                <button id="pwa-update-btn">Refresh 🔄</button>
            `;

            document.body.appendChild(toast);
            
            // Trigger transition
            setTimeout(() => toast.classList.add('show'), 50);

            document.getElementById('pwa-update-btn').onclick = () => {
                if (typeof playSound === 'function') {
                    try { playSound('success'); } catch(e) {}
                }
                if (newWorker) {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                }
            };
        }
// Initialize Automatic Cloud Sync & Firebase Authentication safely
        initFirebaseAuth()
            .catch(err => console.warn('[Firebase Auth] Offline or CDN load failure:', err));
            
        initSelectiveSyncCheckboxes();

        initCloudSync()
            .catch(err => console.warn('[Cloud Sync] Initialization failure safely bypassed:', err));
            
        // Initialize Automatic Real-Time PC Update Checker & Silent OTA Live Engine
        try {
            initAutoUpdateChecker();
            if (typeof initLiveOTAUpdateEngine === 'function') {
                initLiveOTAUpdateEngine();
            }
        } catch(e) {
            console.error('Failed to initialize Auto Update Checker:', e);
        }

        // Initialize Mobile QR Code Overlay (COMPLETELY REMOVED per user approval)
        /*
        try {
            initMobileQROverlay();
        } catch(e) {
            console.error('Failed to initialize Mobile QR Overlay:', e);
        }
        */

        // Initialize PWA App Install Flow Banner (COMPLETELY REMOVED per user approval)
        /*
        try {
            initPWAInstallFlow();
        } catch(e) {
            console.error('Failed to initialize PWA Install Flow:', e);
        }
        */
    });

    
// Function initAutoUpdateChecker moved to external module


    
// Function initMobileQROverlay moved to external module


    
// Function initPWAInstallFlow moved to external module


    async function registerPeriodicSync(registration) {
        if (!('periodicSync' in registration)) {
            console.log('[PeriodicSync] Periodic Background Sync is not supported by this browser/device.');
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
            if (isStandalone) {
                showToast('Periodic Background Sync is not supported in this browser. Updates will check on manual reload.');
            }
            return;
        }

        try {
            const status = await navigator.permissions.query({
                name: 'periodic-background-sync',
            });

            if (status.state === 'granted') {
                await registration.periodicSync.register('krishi-daily-update', {
                    minInterval: 24 * 60 * 60 * 1000
                });
                console.log('[PeriodicSync] Successfully registered krishi-daily-update event tag.');
            } else {
                console.log('[PeriodicSync] Periodic background sync permission is not granted yet.');
            }
        } catch (err) {
            console.warn('[PeriodicSync] Failed to register periodic sync:', err);
        }
    }

    document.addEventListener('visibilitychange', () => {
        // Used by animation loops to pause when tab is hidden (battery + smoothness)
        window.__KRISHI_VISIBLE__ = !document.hidden;
        // थपिएको: मोबाइलमा एप मिनिमाइज हुने बित्तिकै सबै पेन्डिङ डाटाहरू तत्कालै सुरक्षित गर्ने
        if (document.hidden) {
            try { Storage.flush(); } catch(e) {}
        }
    }, { passive: true });

    window.addEventListener('beforeunload', () => {
        try { Storage.flush(); } catch(e) {}
    }, { capture: true });

    // ==================== BASIC HELPER FUNCTIONS ====================
 // ==================== NEW FEAT: IN-APP TOAST SYSTEM ====================
    
// Function newfeat_showNotification moved to external module
   
function loadData(){
        syncCredentialsAuthorized = KrishiStorage.getItem('krishi_sync_credentials_authorized') === 'true';
        syncSelectiveBookmarks = KrishiStorage.getItem('krishi_sync_sel_bookmarks') !== 'false';
        syncSelectiveErrors = KrishiStorage.getItem('krishi_sync_sel_errors') !== 'false';
        syncSelectiveCustom = KrishiStorage.getItem('krishi_sync_sel_custom') !== 'false';
        syncSelectiveLogs = KrishiStorage.getItem('krishi_sync_sel_logs') !== 'false';
        activePlanMode = KrishiStorage.getItem('krishi_active_plan_mode') || 'normal';
        ['bookmarked','wrong','streak','stats','achievements','progression'].forEach(k=>{
            const v = Storage.getJSON('krishi_'+k, null);
            if (v !== null && v !== undefined) localData[k] = v;
        });

        // Legacy loadSM2() removed
    }

    function saveData(){
        // Auto-synchronize CRDT logs for bookmarked items
        const currentBms = localData.bookmarked || [];
        const bmLog = localData.bookmarkedLog || {};
        const now = Date.now();
        currentBms.forEach(qid => {
            if (!bmLog[qid] || bmLog[qid].action !== 'add') {
                bmLog[qid] = { action: 'add', timestamp: now };
            }
        });
        Object.entries(bmLog).forEach(([qid, info]) => {
            if (info.action === 'add' && !currentBms.includes(qid) && !currentBms.includes(Number(qid))) {
                bmLog[qid] = { action: 'remove', timestamp: now };
            }
        });
        localData.bookmarkedLog = bmLog;

        // Auto-synchronize CRDT logs for wrong items
        const currentWrongs = localData.wrong || [];
        const wrLog = localData.wrongLog || {};
        currentWrongs.forEach(qid => {
            if (!wrLog[qid] || wrLog[qid].action !== 'add') {
                wrLog[qid] = { action: 'add', timestamp: now };
            }
        });
        Object.entries(wrLog).forEach(([qid, info]) => {
            if (info.action === 'add' && !currentWrongs.includes(qid) && !currentWrongs.includes(Number(qid))) {
                wrLog[qid] = { action: 'remove', timestamp: now };
            }
        });
        localData.wrongLog = wrLog;

        if (localData.customQuestions && Array.isArray(localData.customQuestions)) {
            // First normalize all customQuestions
            localData.customQuestions = localData.customQuestions.map(q => normalizeQuestion(q));
            // Then validate and filter out invalid ones
           // डाटा सुरक्षित राख्न गलत प्रश्नहरूलाई डिलिट गर्नुको सट्टा 'revision' (सच्याउनुपर्ने) मा राख्ने
            localData.customQuestions = localData.customQuestions.map(q => {
                let errors = validateImportQuestion(q);
                if (errors.length > 0) {
                    q.status = 'revision'; // डिलिट नगर्ने, सच्याउने मोडमा लैजाने
                }
                return q;
            });
            // Register custom subjects automatically on the fly to prevent desync
            registerCustomSubjectsFromQuestions(localData.customQuestions);
        }
        // Batch writes to avoid jank (excluding customQuestions to prevent LocalStorage quota overflow!)
        Object.entries(localData).forEach(([k,v]) => {
            if (k !== 'customQuestions') {
                Storage.setJSON('krishi_'+k, v);
            }
        });
        
        // Write custom questions to IndexedDB asynchronously.
        // Gated on hydration: before the initial IndexedDB read resolves (or after it
        // failed) localData.customQuestions is not authoritative, and saveAll() is a
        // clear-then-rewrite — writing it would delete the real bank.
        if (customQuestionsHydrated && Array.isArray(localData.customQuestions)) {
            KrishiDB.saveAll(localData.customQuestions)
                .then(() => console.log('[IndexedDB] Custom questions saved successfully.'))
                .catch(err => console.error('[IndexedDB] Custom questions save failed:', err));
        } else if (!customQuestionsHydrated) {
            console.warn('[IndexedDB] Skipped custom-question write: bank not hydrated yet.');
        }
        
        try { Storage.flush(); } catch(e) {}
        triggerBackgroundSync();
        KrishiStorage.setItem('krishi_last_updated_at', Date.now());
        scheduleCloudSync('Data saved');
        savePracticeProgress();

    }


    // ==================== CLOUD SYNCHRONIZATION ENGINE ====================
    let firebaseApp = null;
    let firebaseDb = null;

    // ── Dirty Module Tracker ─────────────────────────────────────────────────
    // Set by applyAllAppData() when sync data changes a module.
    // Consumed by krishiScheduleSyncRender() which renders only active+dirty pages.
    // navigate() always renders the target page fresh, so stale risk is zero.
    const _krishiDirty = {
        home:      false,
        practice:  false,
        profiles:  false,
        planner:   false,
        questions: false,
        appearance: false
    };
    // RAF handle — prevents scheduling two frames in the same sync cycle
    let _krishiSyncRafHandle = null;

    /**
     * krishiScheduleSyncRender — called once per onSnapshot cycle.
     * Schedules a single requestAnimationFrame that renders ONLY the
     * currently visible page, leaving all other dirty modules for the
     * next navigate() call (which always re-renders anyway).
     */
    function krishiScheduleSyncRender() {
        if (_krishiSyncRafHandle) return; // already scheduled this frame
        _krishiSyncRafHandle = requestAnimationFrame(function () {
            _krishiSyncRafHandle = null;
            try {
                // Apply appearance (CSS vars / body class) only when it changed.
                // This can trigger a layout, so we isolate it to the RAF frame.
                if (_krishiDirty.appearance) {
                    _krishiDirty.appearance = false;
                    if (typeof applyAppearanceSettings === 'function') applyAppearanceSettings();
                    if (typeof applyCustomAppearanceAndLanguageSettings === 'function') {
                        applyCustomAppearanceAndLanguageSettings();
                    }
                }

                // Lightweight ribbon — always safe, uses targeted textContent patches
                if (typeof updateStatsRibbon === 'function') updateStatsRibbon();

                // Active page detection
                const activePanels = document.getElementById('practice-active-state-panels');
                const isUserInActiveQuiz = activePanels && !activePanels.classList.contains('hidden');
                const activePage = document.querySelector('.page.active');
                const activeId = activePage ? activePage.id : '';

                // User is mid-quiz — do NOT rebuild any page DOM
                if (isUserInActiveQuiz) {
                    console.log('[SyncRender] Skipped full render: user in active quiz.');
                    return;
                }

                // Render only the currently visible page if it is dirty
                if (activeId === 'page-home' && _krishiDirty.home) {
                    _krishiDirty.home = false;
                    // Suppress .slide-up-card entrance animation during sync renders
                    // to prevent the opacity:0 → 1 flash on full innerHTML rebuild.
                    const _hwc = document.getElementById('home-widgets-container');
                    if (_hwc) _hwc.classList.add('krishi-sync-update');
                    if (typeof updateHomePage === 'function') updateHomePage();
                } else if (activeId === 'page-practice' && _krishiDirty.practice) {
                    _krishiDirty.practice = false;
                    if (typeof updatePracticePage === 'function') updatePracticePage();
                } else if (activeId === 'page-study-planner' && _krishiDirty.planner) {
                    _krishiDirty.planner = false;
                    if (typeof refreshPlannerPage === 'function') refreshPlannerPage();
                } else if (activeId === 'page-settings' && _krishiDirty.profiles) {
                    _krishiDirty.profiles = false;
                    if (typeof renderProfilesInventory === 'function') renderProfilesInventory();
                } else if ((activeId === 'page-mcq-creator') && _krishiDirty.questions) {
                    _krishiDirty.questions = false;
                    if (typeof scheduleRenderQuestionList === 'function') scheduleRenderQuestionList();
                }
                // All other dirty modules remain dirty; navigate() clears them on visit.
            } catch (e) {
                console.warn('[SyncRender] Non-fatal render error during sync RAF:', e);
            }
        });
    }
    let syncListenerRef = null;
    let syncInProgress = false;
    let cachedCloudData = null;
    // The uid cachedCloudData was populated for. Without this, one account's cached
    // cloud state can drive writes into another account's document after a switch.
    let cachedCloudUid = null;

    let currentSessionId = Math.random().toString(36).substring(2, 10);
    let sessionTouchInterval = null;
    let pendingConflictResolution = null;
    let enteredPIN = "";
    let syncCredentialsAuthorized = false;

    // Selective Sync & Offline Pending State Variables
    let syncSelectiveBookmarks = true;
    let syncSelectiveErrors = true;
    let syncSelectiveCustom = true;
    let syncSelectiveLogs = true;

    let deviceIpAddress = '';
    let deviceLocationCity = '';
    let deviceLocationCountry = '';

    function initSelectiveSyncCheckboxes() {
        const selBookmarks = document.getElementById('sync-sel-bookmarks');
        const selErrors = document.getElementById('sync-sel-errors');
        const selCustom = document.getElementById('sync-sel-custom');
        const selLogs = document.getElementById('sync-sel-logs');

        if (selBookmarks) selBookmarks.checked = syncSelectiveBookmarks;
        if (selErrors) selErrors.checked = syncSelectiveErrors;
        if (selCustom) selCustom.checked = syncSelectiveCustom;
        if (selLogs) selLogs.checked = syncSelectiveLogs;
    }

    function updateOfflineQueueBadge() {
        const btn = document.getElementById('btn-sync-now');
        if (!btn) return;
        
        let oldBadge = document.getElementById('sync-pending-badge');
        if (oldBadge) {
            oldBadge.remove();
        }
        
        const count = parseInt(KrishiStorage.getItem('krishi_sync_pending_count') || '0');
        if (count > 0) {
            const badge = document.createElement('span');
            badge.id = 'sync-pending-badge';
            badge.className = 'ml-1 px-1.5 py-0.5 text-[8px] font-black rounded bg-amber-500 text-white animate-pulse';
            badge.innerText = `(${count})`;
            btn.appendChild(badge);
        }
    }

    function toggleSelectiveSyncSetting(type) {
        if (type === 'bookmarks') {
            syncSelectiveBookmarks = !syncSelectiveBookmarks;
            KrishiStorage.setItem('krishi_sync_sel_bookmarks', syncSelectiveBookmarks);
        } else if (type === 'errors') {
            syncSelectiveErrors = !syncSelectiveErrors;
            KrishiStorage.setItem('krishi_sync_sel_errors', syncSelectiveErrors);
        } else if (type === 'custom') {
            syncSelectiveCustom = !syncSelectiveCustom;
            KrishiStorage.setItem('krishi_sync_sel_custom', syncSelectiveCustom);
        } else if (type === 'logs') {
            syncSelectiveLogs = !syncSelectiveLogs;
            KrishiStorage.setItem('krishi_sync_sel_logs', syncSelectiveLogs);
        }
        showToast('⚙️ Selective sync preferences updated!');
    }
    window.toggleSelectiveSyncSetting = toggleSelectiveSyncSetting;

    async function fetchDeviceLocationMetadata() {
        try {
            // Using a standard, fast geolocation API (ip-api.com)
            const res = await fetch('https://ip-api.com/json/');
            if (res.ok) {
                const data = await res.json();
                if (data && data.status === 'success') {
                    deviceIpAddress = data.query || '';
                    deviceLocationCity = data.city || '';
                    deviceLocationCountry = data.countryCode || '';
                    console.log(`[GeoIP] Location resolved: ${deviceLocationCity}, ${deviceLocationCountry} (IP: ${deviceIpAddress})`);
                    return;
                }
            }
        } catch(e) {
            console.warn('[GeoIP] Primary resolver failed, attempting fallback...', e);
        }

        try {
            // Fallback keyless resolver
            const res = await fetch('https://ipapi.co/json/');
            if (res.ok) {
                const data = await res.json();
                deviceIpAddress = data.ip || '';
                deviceLocationCity = data.city || '';
                deviceLocationCountry = data.country_code || '';
                console.log(`[GeoIP] Fallback resolved: ${deviceLocationCity}, ${deviceLocationCountry}`);
            }
        } catch(e) {
            console.warn('[GeoIP] Fallback resolver failed:', e);
        }
    }

    // PIN Verification Handlers
    function authenticateForSyncCredentials() {
        enteredPIN = "";
        updateSyncPinDots();
        const feedback = document.getElementById('sync-pin-feedback');
        if (feedback) feedback.innerText = '';
        
        const modal = document.getElementById('sync-auth-modal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeSyncAuthModal() {
        const modal = document.getElementById('sync-auth-modal');
        if (modal) modal.classList.add('hidden');
    }

    function pressSyncPIN(num) {
        const feedback = document.getElementById('sync-pin-feedback');
        if (feedback) feedback.innerText = '';

        if (num === 'cancel') {
            closeSyncAuthModal();
            return;
        }
        if (num === 'backspace') {
            if (enteredPIN.length > 0) {
                enteredPIN = enteredPIN.slice(0, -1);
            }
            updateSyncPinDots();
            return;
        }

        if (enteredPIN.length < 4) {
            enteredPIN += num;
            updateSyncPinDots();
        }

        if (enteredPIN.length === 4) {
            if (enteredPIN === '1109' || enteredPIN === '1234') {
                syncCredentialsAuthorized = true;
                KrishiStorage.setItem('krishi_sync_credentials_authorized', 'true');
                showToast('🔓 Access Granted!');
                closeSyncAuthModal();
                updateSyncUI();
            } else {
                enteredPIN = "";
                updateSyncPinDots();
                if (feedback) feedback.innerText = '❌ Incorrect PIN. Try 1109.';
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
                    try { window.Capacitor.Plugins.Haptics.vibrate({ duration: 300 }); } catch(e){}
                }
            }
        }
    }

    window.pressSyncPIN = pressSyncPIN;
    window.authenticateForSyncCredentials = authenticateForSyncCredentials;
    window.closeSyncAuthModal = closeSyncAuthModal;
    window.updateSyncPinDots = updateSyncPinDots;

    function updateSyncPinDots() {
        const dotsContainer = document.getElementById('sync-pin-dots');
        if (!dotsContainer) return;
        const dots = dotsContainer.children;
        for (let i = 0; i < 4; i++) {
            if (dots[i]) {
                if (i < enteredPIN.length) {
                    dots[i].style.background = '#047857'; // Filled green-emerald
                    dots[i].style.borderColor = '#047857';
                } else {
                    dots[i].style.background = 'transparent';
                    dots[i].style.borderColor = '';
                }
            }
        }
    }

    // Conflict Resolution Strategy Helpers
    function calculateStreakFromStreakObject(streakObj) {
        if (!streakObj || typeof streakObj !== 'object') return 0;
        let settings = getPlannerSettings();
        let restDays = settings.restDays || [6];
        let target = settings.dailyTarget || 30;
        let todayStr = getLocalDateString(new Date());
        
        let s = 0;
        let checkDate = new Date();
        
        for (let i = 0; i < 365; i++) {
            let stamp = getLocalDateString(checkDate);
            let dayData = streakObj[stamp];
            let solved = dayData ? (dayData.solved || 0) : 0;
            
            if (stamp === todayStr) {
                if (solved >= target) {
                    s++;
                }
            } else {
                if (solved >= target) {
                    s++;
                } else if (restDays.includes(checkDate.getDay())) {
                    // Rest day configured!
                } else {
                    break;
                }
            }
            checkDate.setDate(checkDate.getDate() - 1);
        }
        return s;
    }

    function checkForSyncConflicts(local, cloud) {
        const localB = (local.bookmarked || []).length;
        const cloudB = (cloud.bookmarked || []).length;
        const localW = (local.wrong || []).length;
        const cloudW = (cloud.wrong || []).length;
        const localS = calculateStreakFromStreakObject(local.streak);
        const cloudS = calculateStreakFromStreakObject(cloud.streak);
        const localL = (local.timingLog || []).length;
        const cloudL = (cloud.timingLog || []).length;
        const localC = (local.customQuestions || []).length;
        // Was never declared. Referencing it below threw a ReferenceError that aborted
        // this function and silently killed the entire manual "Sync Now" path.
        const cloudC = (cloud.customQuestions || []).length;

        // Auto-Pull Protection: If local device is fresh/empty (0 data), bypass conflict modal and auto-pull cloud data!
        if (localB === 0 && localW === 0 && localS === 0 && localL === 0 && localC === 0) {
            return null;
        }

        if (localB !== cloudB || localW !== cloudW || localS !== cloudS || localL !== cloudL || localC !== cloudC) {
            return {
                local: { bookmarks: localB, mistakes: localW, streak: localS, logs: localL, customQuestions: localC },
                cloud: { bookmarks: cloudB, mistakes: cloudW, streak: cloudS, logs: cloudL, customQuestions: cloudC }
            };
        }
        return null;
    }

    function promptConflictModal(localStats, cloudStats, onResolve) {
        const lb = document.getElementById('conflict-local-bookmarks');
        if (lb) lb.innerText = localStats.bookmarks;
        const cb = document.getElementById('conflict-cloud-bookmarks');
        if (cb) cb.innerText = cloudStats.bookmarks;
        
        const lm = document.getElementById('conflict-local-mistakes');
        if (lm) lm.innerText = localStats.mistakes;
        const cm = document.getElementById('conflict-cloud-mistakes');
        if (cm) cm.innerText = cloudStats.mistakes;
        
        const ls = document.getElementById('conflict-local-streak');
        if (ls) ls.innerText = `${localStats.streak} days`;
        const cs = document.getElementById('conflict-cloud-streak');
        if (cs) cs.innerText = `${cloudStats.streak} days`;
        
        const ll = document.getElementById('conflict-local-logs');
        if (ll) ll.innerText = localStats.logs;
        const cl = document.getElementById('conflict-cloud-logs');
        if (cl) cl.innerText = cloudStats.logs;

        const modal = document.getElementById('sync-conflict-modal');
        if (modal) modal.classList.remove('hidden');

        pendingConflictResolution = onResolve;
    }

    function closeSyncConflictModal() {
        const modal = document.getElementById('sync-conflict-modal');
        if (modal) modal.classList.add('hidden');
        pendingConflictResolution = null;
    }

    async function resolveConflict(strategy) {
        if (!pendingConflictResolution) return;
        closeSyncConflictModal();
        await pendingConflictResolution(strategy);
    }

    window.closeSyncConflictModal = closeSyncConflictModal;
    window.resolveConflict = resolveConflict;

    // ─── Cloud Identity: Canonical Firebase UID ───────────────────────────────
    // getCloudUID() is the single source of truth for cloud identity.
    // Unauthenticated users return null → cloud sync disabled safely.
    function getCloudUID() {
        if (currentAuthUser && currentAuthUser.uid) return currentAuthUser.uid;
        if (window.firebase && firebase.auth) {
            try {
                const authInst = firebase.auth(getSafeFirebaseApp());
                if (authInst && authInst.currentUser) return authInst.currentUser.uid;
            } catch(e) {}
        }
        return null;
    }

    // getSyncKey() — Legacy bridge. Returns UID-prefixed key when logged in,
    // empty string otherwise (safely disables sync without crashing old callers).
    function getSyncKey() {
        const uid = getCloudUID();
        return uid ? ('KRISHI-UID-' + uid) : '';
    }

    // getCloudDocRef() — Returns the canonical Firestore document reference
    // for the current authenticated user. Returns null if not authenticated.
    function getCloudDocRef(firestore) {
        const uid = getCloudUID();
        if (!uid || !firestore) return null;
        return firestore.collection('users').doc(uid);
    }

    function generateNewAutoSyncKey() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let key = 'KRISHI-SYNC';
        for (let i = 0; i < 4; i++) {
            let segment = '';
            for (let j = 0; j < 4; j++) {
                segment += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            key += '-' + segment;
        }
        return key;
    }

    function generateNewSyncKey() {
        const key = generateNewAutoSyncKey();
        const input = document.getElementById('cloud-sync-key-input');
        if (input) input.value = key;
        showToast('🔑 Generated new Sync Key! Make sure to click Enable.');
    }

    function copyActiveSyncKey() {
        const key = getSyncKey();
        if (key) {
            navigator.clipboard.writeText(key).then(() => {
                showToast('📋 Sync Key copied to clipboard!');
            }).catch(() => {
                showToast('❌ Copy to clipboard failed!');
            });
        }
    }

    let html5QrScanner = null;

    function openQRScanner() {
        if (typeof Html5Qrcode === 'undefined') {
            showToast('⏳ Loading camera scanner library...');
            setTimeout(openQRScanner, 500);
            return;
        }

        // Native Capacitor Camera Runtime Permission Hook
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
            console.log('[Camera Permission] Requesting native camera permission via Capacitor...');
            window.Capacitor.Plugins.Camera.requestPermissions({ permissions: ['camera'] }).then(res => {
                console.log('[Camera Permission] Native permissions status:', res);
                if (res && res.camera === 'granted') {
                    startScanningSequence();
                } else {
                    showToast('⚠️ Camera permission is required to scan!');
                }
            }).catch(err => {
                console.warn('[Camera Permission] Native request failed, falling back to standard prompt:', err);
                startScanningSequence();
            });
        } else {
            startScanningSequence();
        }

        function startScanningSequence() {
            const modal = document.getElementById('qr-scanner-modal');
            if (modal) modal.classList.remove('hidden');
            
            if (typeof playSound === 'function') {
                try { playSound('click'); } catch(e) {}
            }

            // Initialize HTML5 QR Reader
            html5QrScanner = new Html5Qrcode("qr-reader-container");
            const config = { fps: 15, qrbox: { width: 220, height: 220 } };

            html5QrScanner.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    if (decodedText && decodedText.startsWith('KRISHI-SYNC-')) {
                        const input = document.getElementById('cloud-sync-key-input');
                        if (input) input.value = decodedText;
                        
                        // Native haptic double-pulse vibration on success
                        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
                            try {
                                window.Capacitor.Plugins.Haptics.vibrate({ duration: 150 });
                                setTimeout(() => {
                                    try {
                                        window.Capacitor.Plugins.Haptics.vibrate({ duration: 150 });
                                    } catch (e) {}
                                }, 250);
                            } catch(e) {
                                console.warn('[Haptics] Haptic vibration failed:', e);
                            }
                        }
                        
                        if (typeof playSound === 'function') {
                            try { playSound('success'); } catch(e) {}
                        }
                        showToast('✓ Sync Key scanned successfully!');
                        closeQRScanner();
                        enableCloudSync();
                    } else {
                        showToast('⚠️ Invalid Sync Key format scanned!');
                    }
                },
                (errorMessage) => {
                    // Verbose barcode failures skipped to maintain high FPS performance
                }
            ).catch(err => {
                console.error('[QR Scanner] Camera start failed:', err);
                showToast('❌ Camera access failed or denied!');
                const container = document.getElementById('qr-reader-container');
                if (container) {
                    container.style.height = 'auto';
                    container.style.background = 'var(--card)';
                    container.style.padding = '16px';
                    container.innerHTML = `
                        <div class="flex flex-col items-center justify-center text-center space-y-3.5">
                            <span class="text-3xl">⚠️</span>
                            <p class="text-[10px] font-black text-rose-500 uppercase tracking-wider">Camera Blocked or Unavailable</p>
                            <p class="text-[8.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                                WebRTC camera permission was denied or is blocked by your browser/OS security policy.<br>
                                <strong class="text-[9px] block mt-2 text-slate-700 dark:text-slate-200">Alternative Pairing Option:</strong>
                                Enter your pairing Sync Key manually in the settings box underneath.
                            </p>
                            <button onclick="closeQRScanner(); playSound('click');" class="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-[9px] font-bold border-none cursor-pointer  transition" style="color:var(--text);">Cancel & Enter Manually</button>
                        </div>
                    `;
                }
            });
        }
    }

    function closeQRScanner() {
        const modal = document.getElementById('qr-scanner-modal');
        if (modal) modal.classList.add('hidden');
        
        if (html5QrScanner) {
            html5QrScanner.stop().then(() => {
                html5QrScanner = null;
            }).catch(err => {
                console.warn('[QR Scanner] Stop failed safely:', err);
                html5QrScanner = null;
            });
        }
    }

    function updateSyncUI() {
        const key = getSyncKey();
        const setupPanel = document.getElementById('sync-setup-panel');
        const activePanel = document.getElementById('sync-active-panel');
        const badge = document.getElementById('sync-status-badge');
        const display = document.getElementById('active-sync-key-display');
        const timeTxt = document.getElementById('sync-time-txt');

        if (key) {
            if (setupPanel) setupPanel.classList.add('hidden');
            if (activePanel) activePanel.classList.remove('hidden');
            if (display) display.innerText = key;

            // Credentials authorization visibility handling
            const lockOverlay = document.getElementById('sync-key-lock-overlay');
            const credCard = document.getElementById('sync-key-credentials-card');
            if (syncCredentialsAuthorized) {
                if (lockOverlay) lockOverlay.classList.add('hidden');
                if (credCard) credCard.classList.remove('hidden');
            } else {
                if (lockOverlay) lockOverlay.classList.remove('hidden');
                if (credCard) credCard.classList.add('hidden');
            }

            // Guard: If QRCode library is not loaded yet, retry in 300ms
            if (typeof QRCode === 'undefined') {
                console.warn('[QR Generator] QRCode library not loaded yet. Retrying...');
                setTimeout(updateSyncUI, 300);
                return;
            }

            // Generate and update QR code dynamically client-side (offline safe) - deferred to let layout pass complete
            setTimeout(() => {
                const qrContainer = document.getElementById('sync-qrcode-container');
                if (qrContainer) {
                    if (!qrContainer.hasChildNodes() || qrContainer.getAttribute('data-key') !== key) {
                        qrContainer.innerHTML = '';
                        qrContainer.setAttribute('data-key', key);
                        try {
                            new QRCode(qrContainer, {
                                text: key,
                                width: 120,
                                height: 120,
                                colorDark: "#047857",
                                colorLight: "#ffffff"
                            });
                        } catch(e) {
                            console.error('[QR Generator] Offline draw failed:', e);
                            qrContainer.innerHTML = `<span class="text-[8px] text-rose-500 font-mono break-all">Error: ${e.message}</span>`;
                        }
                    }
                }
            }, 60);

            // Populate Statistics Dashboard
            const statBookmarks = document.getElementById('sync-stat-bookmarks');
            const statMistakes = document.getElementById('sync-stat-mistakes');
            const statStreak = document.getElementById('sync-stat-streak');
            const statLogs = document.getElementById('sync-stat-logs');

            if (statBookmarks) statBookmarks.innerText = localData.bookmarked ? localData.bookmarked.length : 0;
            if (statMistakes) statMistakes.innerText = getValidWrongCount();
            if (statStreak) {
                const computedStreak = typeof getStreakCount === 'function' ? getStreakCount() : 0;
                statStreak.innerText = `${computedStreak} days`;
            }
            if (statLogs) {
                const logs = safeJsonParse(KrishiStorage.getItem('krishi_timingLog'), []);
                statLogs.innerText = `${logs.length} entries`;
            }
            const statCustom = document.getElementById('sync-stat-custom');
            if (statCustom) {
                statCustom.innerText = `${getCustomQuestions().length} questions`;
            }
            
            let status = KrishiStorage.getItem('krishi_sync_status') || 'Synced';
            if (!navigator.onLine) status = 'Offline';
            
            // Sync status badges
            const syncBadgeStatus = document.getElementById('sync-badge-status');
            if (syncBadgeStatus) {
                syncBadgeStatus.innerText = status;
                if (status === 'Syncing...') {
                    syncBadgeStatus.className = 'px-2 py-0.5 rounded text-[8px] font-black uppercase bg-amber-500/10 text-amber-500 animate-pulse';
                } else if (status === 'Offline') {
                    syncBadgeStatus.className = 'px-2 py-0.5 rounded text-[8px] font-black uppercase bg-slate-500/10 text-slate-500';
                } else if (status === 'Sync failed') {
                    syncBadgeStatus.className = 'px-2 py-0.5 rounded text-[8px] font-black uppercase bg-rose-500/10 text-rose-500';
                } else {
                    syncBadgeStatus.className = 'px-2 py-0.5 rounded text-[8px] font-black uppercase bg-emerald-500/10 text-emerald-500';
                }
            }

            if (badge) {
                if (status === 'Syncing...') {
                    badge.innerText = 'Syncing... 🟡';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 animate-pulse';
                } else if (status === 'Offline') {
                    badge.innerText = 'Offline 🟡';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-150 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
                } else if (status === 'Sync failed') {
                    badge.innerText = 'Sync failed 🔴';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400';
                } else {
                    badge.innerText = 'Synced 🟢';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400';
                }
            }
            
            const lastSync = KrishiStorage.getItem('krishi_last_sync_time');
            if (timeTxt) timeTxt.innerText = lastSync ? 'Last Synced: ' + lastSync : 'Last Synced: Never';
        } else {
            if (setupPanel) setupPanel.classList.remove('hidden');
            if (activePanel) activePanel.classList.add('hidden');
            if (badge) {
                badge.innerText = 'Disabled 🔴';
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
            }
        }
        updateProfileSyncUI();
        updateOfflineQueueBadge();
    }


    let firebaseAuth = null;
    let currentAuthUser = null;
    let firebaseAuthInitialized = false;

    let firebaseLoadPromise = null;
    let firebaseSDKLoaded = false;

    async function loadFirebaseSDKs() {
        if (window.firebase && window.firebase.auth && window.firebase.firestore && window.firebase.database) {
            firebaseSDKLoaded = true;
            return Promise.resolve();
        }
        if (firebaseLoadPromise) return firebaseLoadPromise;

        firebaseLoadPromise = new Promise(async (resolve, reject) => {
            const loadScript = (url) => {
                return new Promise((res, rej) => {
                    let script = document.createElement('script');
                    script.src = url;
                    script.onload = () => res();
                    script.onerror = (err) => rej(err);
                    document.head.appendChild(script);
                });
            };

            try {
                // Attempt to load from high-speed local assets first (Village Mode)
                await loadScript('./js/firebase-app-compat.js');
                try {
                    await loadScript('./js/firebase-firestore-compat.js');
                } catch(fsLocalErr) {
                    // Fallback to CDN for firestore compat if local is missing
                    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js');
                }
                try {
                    await loadScript('./js/firebase-database-compat.js');
                } catch(dbLocalErr) {
                    // Fallback to CDN for database compat if local is missing
                    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js');
                }
                await loadScript('./js/firebase-auth-compat.js');
                
                console.log("[Firebase Loader] Firebase SDKs loaded successfully with local assets!");
                firebaseSDKLoaded = true;
                resolve();
            } catch (localErr) {
                console.warn("[Firebase Loader] Local files failed/missing, falling back to CDN:", localErr);
                try {
                    // Direct CDN links fallback
                    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
                    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js');
                    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js');
                    await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js');
                    
                    console.log("[Firebase Loader] All Firebase SDKs loaded successfully via Google CDN!");
                    firebaseSDKLoaded = true;
                    resolve();
                } catch (cdnErr) {
                    console.error("[Firebase Loader] Global load failed:", cdnErr);
                    reject(cdnErr);
                    firebaseLoadPromise = null;
                }
            }
        });

        return firebaseLoadPromise;
    }

    function getSafeFirebaseApp() {
        if (firebaseApp) return firebaseApp;
        
        let customConfig = null;
        try { customConfig = JSON.parse(KrishiStorage.getItem('krishi_firebase_config')); } catch(e){}
        
        const config = customConfig || {
            apiKey: "AIzaSyBOyKUK4nIUCp4gF3aiJyOt6OyHhYz10bA",
            authDomain: "krishi-mcq-pro.firebaseapp.com",
            projectId: "krishi-mcq-pro",
            storageBucket: "krishi-mcq-pro.firebasestorage.app",
            messagingSenderId: "39741021868",
            appId: "1:39741021868:web:c838ca32f5aaeb41720909",
            measurementId: "G-MHX05SE7WB",
            databaseURL: "https://krishi-mcq-pro-default-rtdb.asia-southeast1.firebasedatabase.app"
        };
        
        try {
            if (window.firebase && firebase.apps) {
                let existingApp = firebase.apps.find(app => app.name === "KrishiApp");
                if (existingApp) {
                    firebaseApp = existingApp;
                } else {
                    firebaseApp = firebase.initializeApp(config, "KrishiApp");
                }
            }
        } catch(e) {
            console.warn('[Firebase App Init] Exception caught, falling back to registered app:', e);
            if (window.firebase && firebase.apps && firebase.apps.length > 0) {
                firebaseApp = firebase.apps[0];
            }
        }
        return firebaseApp;
    }

   // Concurrency guard: `firebaseAuthInitialized` is only set after two awaits, so two callers
   // racing into init (boot + syncCloudNow + retry paths) could each register their own
   // onAuthStateChanged observer. Caching the in-flight promise makes init genuinely once-only;
   // it is cleared on failure so an offline boot can still retry later.
   let firebaseAuthInitPromise = null;
   function initFirebaseAuth() {
        if (firebaseAuthInitialized) return Promise.resolve();
        if (firebaseAuthInitPromise) return firebaseAuthInitPromise;
        firebaseAuthInitPromise = _initFirebaseAuthOnce().catch(err => {
            firebaseAuthInitPromise = null;
            throw err;
        });
        return firebaseAuthInitPromise;
   }

   async function _initFirebaseAuthOnce() {
        if (firebaseAuthInitialized) return;
        try {
            await loadFirebaseSDKs();
            firebaseApp = getSafeFirebaseApp();
            
            if (firebaseApp && !window.__krishiFirestorePersistenceEnabled__) {
                window.__krishiFirestorePersistenceEnabled__ = true;
                try {
                    if (firebase.firestore) {
                        const firestoreInstance = firebase.firestore(firebaseApp);
                        await firestoreInstance.enablePersistence({ synchronizeTabs: true });
                        console.log('[Offline] Firestore offline persistence enabled ✅');
                    }
                } catch(persistErr) {
                    if (persistErr.code === 'failed-precondition') {
                        console.warn('[Offline] Persistence failed: multiple tabs open. Only one tab can have persistence enabled at a time.');
                    } else if (persistErr.code === 'unimplemented') {
                        console.warn('[Offline] Persistence not supported in this browser/environment.');
                    } else {
                        console.warn('[Offline] Persistence error (non-critical):', persistErr);
                    }
                }
            }
            
            if (!firebaseApp) throw new Error("Firebase app could not be initialized");
            
            firebaseAuth = firebase.auth(firebaseApp);
            firebaseAuthInitialized = true;
            
            // Handle Google redirect results
            if (typeof firebaseAuth.getRedirectResult === 'function') {
                firebaseAuth.getRedirectResult()
                    .then(async (result) => {
                        if (result && result.user) {
                            showToast('✅ Logged in successfully with Google!');
                            try {
                                if (typeof triggerBackgroundSync === 'function') triggerBackgroundSync();
                            } catch(e) {}
                        }
                    })
                    .catch(error => {
                        console.error("[Auth] Redirect result error:", error);
                        if (error.code && error.code !== 'auth/web-storage-unsupported') {
                            showToast('❌ Google Auth failed: ' + error.message, 5000);
                        }
                    });
            }
            
            // Explicitly lock Auth persistence to LOCAL storage (survives WebView cache sweeps)
            if (typeof firebaseAuth.setPersistence === 'function') {
                firebaseAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                    .then(() => {
                        console.log('[Auth] Explicit local persistence lock configured successfully.');
                    })
                    .catch(err => {
                        console.warn('[Auth] Explicit persistence setting failed:', err);
                    });
            }
            
            firebaseAuth.onAuthStateChanged(async (user) => {
                currentAuthUser = user;
                window.currentAuthUser = user;
                
                if (user) {
                    syncCredentialsAuthorized = true;
                    KrishiStorage.setItem('krishi_sync_credentials_authorized', 'true');
                }
                updateAuthUI();
                
                if (user && navigator.onLine && firebaseApp) {
                    // A restored session fires this observer on every reload. Only a genuinely new
                    // link (different uid than the one already recorded) should announce itself,
                    // otherwise the user sees the same popup on every app start.
                    const isNewLink = KrishiStorage.getItem('krishi_linked_uid') !== user.uid;
                    try {
                        const firestore = firebase.firestore(firebaseApp);
                        // UID is now the canonical cloud identity — no synthetic sync key needed
                        const userDocRef = firestore.collection('users').doc(user.uid);
                        await userDocRef.set({
                            email: user.email || user.displayName || 'Authorized User',
                            uid: user.uid,
                            updatedAt: Date.now()
                        }, { merge: true });

                        KrishiStorage.setItem('krishi_linked_uid', user.uid);
                        if (isNewLink) showToast('✅ Account Linked: Cloud Sync initialized successfully!');
                        await initCloudSync();
                        if (typeof syncCloudNow === 'function') await syncCloudNow(true);
                    } catch (err) {
                        console.error('[Auth Sync Map] Failed to map account profile:', err);
                        await initCloudSync();
                        if (typeof syncCloudNow === 'function') await syncCloudNow(true);
                    }
                } else {
                    // Fallback to local sync state if offline or logged out
                    await initCloudSync();
                    
                    // Trigger Google One Tap Sign-In for Web PWA if logged out and online
                    if (!user && navigator.onLine) {
                        try {
                            if (typeof initGoogleOneTap === 'function') initGoogleOneTap();
                        } catch(e){}
                    }
                }
            }, (error) => {
                console.error("Auth state observer error:", error);
                showAuthStatus('Auth failed 🔴');
            });
        } catch(e) {
            console.error("Firebase Auth loading failed:", e);
            // Allow a later retry (e.g. once the device is back online) to re-run init
            firebaseAuthInitPromise = null;
            showAuthStatus('Firebase Unavailable 🌐');
            updateAuthUI();
        }
    }


    async function handleFirebaseSignup() {
        const emailEl = document.getElementById('firebase-auth-email');
        const passEl = document.getElementById('firebase-auth-password');
        const email = emailEl ? emailEl.value.trim() : '';
        const password = passEl ? passEl.value : '';

        if (!email || !password) {
            showToast('⚠️ Please enter both Email and Password!');
            return;
        }

        try {
            showToast('⏳ Registering account...');
            await initFirebaseAuth();
            if (!firebaseAuth) throw new Error("Firebase SDK load failed");
            await firebaseAuth.createUserWithEmailAndPassword(email, password);
            showToast('✅ Account registered successfully!');
            if (emailEl) emailEl.value = '';
            if (passEl) passEl.value = '';
        } catch (error) {
            console.error("Signup error:", error);
            showToast('❌ Signup failed: ' + translateAuthError(error.code, error.message));
            showAuthStatus('Auth failed 🔴');
        }
    }

    async function handleFirebaseLogin() {
        const emailEl = document.getElementById('firebase-auth-email');
        const passEl = document.getElementById('firebase-auth-password');
        const email = emailEl ? emailEl.value.trim() : '';
        const password = passEl ? passEl.value : '';

        if (!email || !password) {
            showToast('⚠️ Please enter both Email and Password!');
            return;
        }

        try {
            showToast('⏳ Logging in...');
            await initFirebaseAuth();
            if (!firebaseAuth) throw new Error("Firebase SDK load failed");
            await firebaseAuth.signInWithEmailAndPassword(email, password);
            showToast('✅ Logged in successfully!');
            if (emailEl) emailEl.value = '';
            if (passEl) passEl.value = '';
        } catch (error) {
            console.error("Login error:", error);
            showToast('❌ Login failed: ' + translateAuthError(error.code, error.message));
            showAuthStatus('Auth failed 🔴');
        }
    }

    async function handleGoogleLogin() {
        try {
            showToast('⏳ Opening Google Sign-in...');
            
            // Initialize auth synchronously to preserve browser user gesture context (PC Fallback)
            const auth = getSafeFirebaseApp().auth();
            const provider = new firebase.auth.GoogleAuthProvider();
            
            // Check if running in a native Capacitor shell
            const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
            
            if (isNative) {
                const GoogleAuthPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth;
                let nativeSuccess = false;
                if (GoogleAuthPlugin) {
                    showToast('🔄 Opening Native Google Sign-In...');
                    try {
                        await GoogleAuthPlugin.initialize();
                    } catch (initErr) {
                        console.warn("GoogleAuthPlugin initialization notice:", initErr);
                    }
                    try {
                        const result = await GoogleAuthPlugin.signIn();
                        if (result && result.idToken) {
                            showToast('🔐 Exchanging tokens with server...');
                            const credential = firebase.auth.GoogleAuthProvider.credential(result.idToken);
                            await auth.signInWithCredential(credential);
                            showToast('✅ Logged in successfully with Google!');
                            nativeSuccess = true;
                            try {
                                if (typeof triggerBackgroundSync === 'function') triggerBackgroundSync();
                            } catch(e) {}
                        }
                    } catch (nativeErr) {
                        console.warn("[Google Auth Native] Native Google Sign-In failed or unconfigured, attempting Web OAuth fallback:", nativeErr);
                    }
                }
                if (!nativeSuccess) {
                    showToast('🔄 Opening Web Google Sign-In...');
                    try {
                        await auth.signInWithPopup(provider);
                    } catch(popupErr) {
                        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/popup-closed-by-user') {
                            await auth.signInWithRedirect(provider);
                            return;
                        }
                        throw popupErr;
                    }
                    showToast('✅ Logged in successfully with Google!');
                    try {
                        if (typeof triggerBackgroundSync === 'function') triggerBackgroundSync();
                    } catch(e) {}
                }
            } else {
                // Clear One Tap suppression flag on manual login attempt!
                KrishiStorage.removeItem('krishi_one_tap_disabled');
                // Trigger popup instantly on Web / PWA
                await auth.signInWithPopup(provider);
                showToast('✅ Logged in successfully with Google!');
                try {
                    if (typeof triggerBackgroundSync === 'function') triggerBackgroundSync();
                } catch(e) {}
            }
        } catch (error) {
            console.error("Google login error:", error);
            showToast('❌ Google Sign-in failed: ' + (error.message || error));
        }
    }

    function initGoogleOneTap() {
        const isCapacitorNative = window.Capacitor &&
                                  window.Capacitor.isNativePlatform &&
                                  window.Capacitor.isNativePlatform();
        if (isCapacitorNative) return; // Native Capacitor uses GoogleAuth.signIn() native dialog

        if (KrishiStorage.getItem('krishi_one_tap_disabled') === 'true') {
            console.log('[OneTap] Suppressed: User previously signed out.');
            return;
        }

        if (window.__googleOneTapInitialized__) return;
        window.__googleOneTapInitialized__ = true;

        if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
            console.log('[OneTap] Loading Google Identity Services script...');
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => setupOneTapPrompt();
            script.onerror = () => {
                console.warn('[OneTap] Google Identity client failed to load.');
                window.__googleOneTapInitialized__ = false;
            };
            document.head.appendChild(script);
        } else {
            setupOneTapPrompt();
        }
    }

    function setupOneTapPrompt() {
        try {
            const clientId = '39741021868-ig8gckot7movhre5pqr5j15jnc2mis8t.apps.googleusercontent.com';
            google.accounts.id.initialize({
                client_id: clientId,
                callback: handleOneTapResponse,
                auto_select: false,
                cancel_on_tap_outside: true
            });
            google.accounts.id.prompt((notification) => {
                if (notification.isNotDisplayed()) {
                    console.log('[OneTap] Prompt not displayed:', notification.getNotDisplayedReason());
                    window.__googleOneTapInitialized__ = false;
                } else if (notification.isSkippedMoment()) {
                    console.log('[OneTap] Prompt skipped:', notification.getSkippedReason());
                }
            });
        } catch(err) {
            console.warn('[OneTap] Initialization failed:', err);
            window.__googleOneTapInitialized__ = false;
        }
    }

    async function handleOneTapResponse(response) {
        if (!response || !response.credential) return;
        
        showToast('⏳ Authenticating with Google One Tap...');
        try {
            await initFirebaseAuth();
            if (!firebaseAuth) throw new Error("Firebase SDK load failed");
            const credential = firebase.auth.GoogleAuthProvider.credential(response.credential);
            const userCredential = await firebaseAuth.signInWithCredential(credential);
            if (userCredential && userCredential.user) {
                showToast('✅ Logged in successfully with Google One Tap!');
            }
        } catch(err) {
            console.error('[OneTap] Firebase Auth failed:', err);
            showToast('❌ One Tap Auth failed: ' + err.message, 5000);
            window.__googleOneTapInitialized__ = false;
        }
    }

    async function handleFirebaseLogout() {
        try {
            if (!confirm('Logging out will clear your local offline study data from this device to protect your privacy. Are you sure you want to log out?')) return;
            
            showToast('⏳ Logging out & clearing local data...');
            KrishiStorage.removeItem('krishi_sync_credentials_authorized');
            
            // Wipe user-specific study data to prevent Data Bleed for the next user (V2 Complete Wipe)
            const keysToWipe = [
                'krishi_bookmarked',
                'krishi_bookmarkedLog',
                'krishi_wrong',
                'krishi_wrongLog',
                'krishi_stats',
                'krishi_streak',
                'krishi_achievements',
                'krishi_timingLog',
                'krishi_sm2',
                'krishi_sm2_v2',
                'krishi_sm2_heatmap',
                'krishi_mockScores',
                'krishi_practice_recent',
                'krishi_exam_profiles',
                'krishi_home_settings',
                'krishi_planner_settings',
                'krishi_syllabus_custom',
                'krishi_custom_subjects',
                'krishi_last_sync_time',
                'krishi_appearance_settings',
                'krishi_custom_appearance_settings',
                'krishi_sound_enabled',
                'krishi_sound_muted',
                'krishi_sound_volume',
                'krishi_dark',
                'krishi_battery_saver',
                'krishi_elite_animations',
                'krishi_haptic_enabled',
                'krishi_username',
                'krishi_profile_photo',
                'krishi_profile_updated_at',
                'krishi_linked_uid',
                'krishi_custom_device_name',
                'krishi_layout_backups',
                'krishi_stats_baseline',
                'krishi_last_updated_at',
                'krishi_goal_settings',
                'krishi_last_practice_config',
                'krishi_saved_practice',
                'krishi_intensity_mode',
                'krishi_difficulty_bias',
                'krishi_retry_delay',
                'krishi_active_plan_mode',
                'krishi_sync_pending',
                'krishi_sync_pending_count',
                'krishi_sync_status',
                'krishi_gemini_key',
                'krishi_gemini_model',
                'krishi_gemini_temp'
            ];
            // Tear the sync engine down BEFORE wiping anything. While the users/{uid}
            // listener is still attached and the uid still valid, an inbound snapshot
            // would merge the half-emptied local state and push it back to the cloud.
            try { disableCloudSyncSilently(); } catch(e) { console.warn('[Logout] sync teardown failed:', e); }
            if (typeof syncDebounceTimer !== 'undefined' && syncDebounceTimer) {
                clearTimeout(syncDebounceTimer);
                syncDebounceTimer = null;
            }

            keysToWipe.forEach(k => KrishiStorage.removeItem(k));

            // Clear IndexedDB Custom Questions (the one deliberate empty wipe)
            if (typeof KrishiDB !== 'undefined' && KrishiDB.saveAll) {
                try { await KrishiDB.saveAll([], { allowEmpty: true }); } catch(e) { console.warn('Failed to wipe custom questions IDB on logout'); }
            }
            customQuestionsHydrated = false;
            localData.customQuestions = [];
            
            if (firebaseAuth) {
                await firebaseAuth.signOut();
            }
            
            showToast('✅ Logged out successfully. Reloading...');
            
            // Wait slightly for IDB flushes, then force reload to wipe RAM state
            setTimeout(() => {
                window.location.reload(true);
            }, 800);
        } catch (error) {
            console.error("Logout error:", error);
            showToast('❌ Logout failed: ' + error.message);
        }
    }

    function translateAuthError(code, defaultMsg) {
        if (!navigator.onLine) {
            return "No internet connection. Please go online to authenticate.";
        }
        if (defaultMsg && (defaultMsg.includes("Firebase SDK load failed") || defaultMsg.includes("Failed to load"))) {
            return "Firebase services are temporarily unavailable. Please check your internet connection or try again later.";
        }
        switch(code) {
            case 'auth/invalid-email':
                return 'Invalid email address format.';
            case 'auth/weak-password':
                return 'Password should be at least 6 characters.';
            case 'auth/user-not-found':
                return 'No user found with this email.';
            case 'auth/wrong-password':
                return 'Incorrect password.';
            case 'auth/email-already-in-use':
                return 'This email is already registered.';
            case 'auth/operation-not-allowed':
                return 'Email/Password auth is not enabled in Firebase Console.';
            case 'auth/network-request-failed':
                return 'Network connection failed. Please check your internet connection.';
            default:
                return defaultMsg || 'Authentication error.';
        }
    }

    function showAuthStatus(statusText) {
        const badge = document.getElementById('sync-status-badge');
        if (badge) {
            badge.innerText = statusText;
            if (statusText.includes('Logged in')) {
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400';
            } else if (statusText.includes('Auth failed') || statusText.includes('failed')) {
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400';
            } else if (statusText.includes('Offline')) {
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
            } else {
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
            }
        }
    }

    function updateAuthUI() {
        const userDisplayEl = document.getElementById('auth-user-email-display');
        const loginFormEl = document.getElementById('auth-login-form');
        const loggedInControlsEl = document.getElementById('auth-loggedin-controls');
        
        if (!navigator.onLine) {
            showAuthStatus('Offline 🟡');
            if (userDisplayEl) {
                const userEmail = currentAuthUser ? (currentAuthUser.email || currentAuthUser.displayName || (currentAuthUser.uid ? `User (${currentAuthUser.uid.substring(0, 8)})` : 'User')) : '';
                userDisplayEl.innerText = currentAuthUser ? `Offline Mode (${userEmail})` : 'Offline Mode';
                userDisplayEl.className = 'p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border text-[10px] font-bold text-center text-amber-800 dark:text-amber-400 border-amber-100/30';
            }
            updateProfileSyncUI();
            return;
        }

        if (currentAuthUser) {
            showAuthStatus('Logged in 🟢');
            if (userDisplayEl) {
                const userIdent = currentAuthUser.email || currentAuthUser.displayName || (currentAuthUser.uid ? `User (${currentAuthUser.uid.substring(0, 8)})` : 'Authorized User');
                userDisplayEl.innerText = `Logged in as: ${userIdent}`;
                userDisplayEl.className = 'p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border text-[10px] font-bold text-center text-emerald-800 dark:text-emerald-400 border-emerald-100/30';
            }
            if (loginFormEl) loginFormEl.classList.add('hidden');
            if (loggedInControlsEl) loggedInControlsEl.classList.remove('hidden');
        } else {
            showAuthStatus('Not logged in ⚪');
            if (userDisplayEl) {
                userDisplayEl.innerText = 'No active cloud session';
                userDisplayEl.className = 'p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border text-[10px] font-bold text-center border-slate-150 dark:border-slate-750 text-slate-500';
            }
            if (loginFormEl) loginFormEl.classList.remove('hidden');
            if (loggedInControlsEl) loggedInControlsEl.classList.add('hidden');
        }
        updateProfileSyncUI();
    }

    // ==================== STUDENT PROFILE (identity + account hub) ====================
    // Identity reuses the existing `krishi_username` key — no second user/account model.
    // This module only RENDERS state that updateAuthUI() / updateSyncUI() already own and
    // is invoked from them, so it registers no auth listener, sync manager or timer of its own.
    const PROFILE_NAME_KEY = 'krishi_username';
    const PROFILE_PHOTO_KEY = 'krishi_profile_photo';
    const PROFILE_STAMP_KEY = 'krishi_profile_updated_at';
    const PROFILE_PHOTO_PX = 128;

    function getProfileName() {
        const stored = (KrishiStorage.getItem(PROFILE_NAME_KEY) || '').trim();
        return stored || 'विद्यार्थी';
    }

    function getProfilePhoto() {
        return KrishiStorage.getItem(PROFILE_PHOTO_KEY) || '';
    }

    // Single greeting builder shared by Home, the sidebar and Profile (no duplicated logic)
    function getGreetingText(username) {
        /* Language lives in ONE place now (see getCanonicalLanguageValue): the
           customizer's languageMode drives the UI labels and this greeting
           together. 'custom' has no greeting of its own, so it keeps using the
           older Appearance-tab dialect — as does any install that has never saved
           the customizer, which is why existing users see no change. */
        let lang = getCanonicalLanguageValue();
        if (lang === 'custom') lang = getAppearanceSettings().greetingLanguage || 'nepali';
        if (lang === 'nepali') return `नमस्ते, ${username}`;
        if (lang === 'sanskrit') return `शुभमस्तु, ${username}`;
        if (lang === 'mixed') return `नमस्ते (Welcome), ${username}`;
        return `Welcome back, ${username}`;
    }

    function stampProfileUpdated() {
        KrishiStorage.setItem(PROFILE_STAMP_KEY, Date.now());
    }

    function paintAvatarEl(el, src, initial) {
        if (!el) return;
        if (src) {
            // Repaint only when the source actually changed — prevents avatar flicker on re-render
            if (el.getAttribute('data-avatar-src') === src) return;
            el.setAttribute('data-avatar-src', src);
            el.innerHTML = '';
            const img = document.createElement('img');
            img.className = 'w-full h-full object-cover';
            img.alt = '';
            img.draggable = false;
            img.onerror = () => {
                el.removeAttribute('data-avatar-src');
                el.textContent = initial;
            };
            img.src = src;
            el.appendChild(img);
        } else {
            if (el.hasAttribute('data-avatar-src')) el.removeAttribute('data-avatar-src');
            if (el.textContent !== initial) el.textContent = initial;
        }
    }

    function renderProfileAvatars() {
        const name = getProfileName();
        const initial = Array.from(name)[0] || '🌾';
        // Priority: user photo → Google account photo → first letter of the display name
        const googlePhoto = (currentAuthUser && currentAuthUser.photoURL) ? currentAuthUser.photoURL : '';
        const src = getProfilePhoto() || googlePhoto;
        paintAvatarEl(document.getElementById('home-avatar-circle'), src, initial);
        paintAvatarEl(document.getElementById('profile-avatar-large'), src, initial);
    }

    function refreshHomeGreeting() {
        const greetText = `${getGreetingText(getProfileName())} 👋`;
        const greetingEl = document.getElementById('home-greeting');
        const sidebarGreeting = document.getElementById('sidebar-greeting');
        if (greetingEl && greetingEl.innerHTML !== greetText) greetingEl.innerHTML = greetText;
        if (sidebarGreeting && sidebarGreeting.innerHTML !== greetText) sidebarGreeting.innerHTML = greetText;
    }

    function renderProfileIdentity() {
        const name = getProfileName();
        const greetEl = document.getElementById('profile-greeting');
        if (greetEl) {
            const txt = `${getGreetingText(name)} 👋`;
            if (greetEl.innerHTML !== txt) greetEl.innerHTML = txt;
        }
        const nameEl = document.getElementById('profile-name-display');
        if (nameEl && nameEl.innerText !== name) nameEl.innerText = name;
        const actions = document.getElementById('profile-photo-actions');
        if (actions) actions.classList.toggle('hidden', !getProfilePhoto());
        renderProfileAvatars();
    }

    // Read-only mirror of the existing statistics + daily target — no new calculation, no second goal system
    function renderProfileSnapshot() {
        const stats = localData.stats || {};
        const solved = stats.totalSolved || 0;
        const correct = stats.totalCorrect || 0;

        const attemptedEl = document.getElementById('profile-stat-attempted');
        if (attemptedEl) attemptedEl.innerText = solved;
        const accuracyEl = document.getElementById('profile-stat-accuracy');
        if (accuracyEl) accuracyEl.innerText = solved > 0 ? Math.round((correct / solved) * 100) + '%' : '--%';
        const streakEl = document.getElementById('profile-stat-streak');
        if (streakEl) streakEl.innerText = typeof getStreakCount === 'function' ? getStreakCount() : 0;

        const target = getPlannerSettings().dailyTarget || 30;
        const todayData = (localData.streak && localData.streak[getLocalDateString()]) || {};
        const done = todayData.solved || 0;
        const goalTxt = document.getElementById('profile-goal-text');
        if (goalTxt) goalTxt.innerText = `${done} / ${target}`;
        const goalBar = document.getElementById('profile-goal-bar');
        if (goalBar) goalBar.style.width = Math.min(100, target > 0 ? Math.round((done / target) * 100) : 0) + '%';
    }

    // Mirrors auth + sync state into the Profile account card. Called from updateAuthUI()
    // and updateSyncUI() only — it never queries Firebase itself.
    function updateProfileSyncUI() {
        if (!document.getElementById('page-profile')) return;
        const online = navigator.onLine;
        const signedIn = !!currentAuthUser;
        const key = typeof getSyncKey === 'function' ? getSyncKey() : '';

        const offlineChip = document.getElementById('profile-offline-chip');
        if (offlineChip) offlineChip.classList.toggle('hidden', online);

        const loggedInEl = document.getElementById('profile-loggedin-controls');
        if (loggedInEl) loggedInEl.classList.toggle('hidden', !signedIn);
        const whyEl = document.getElementById('profile-connect-why');
        if (whyEl) whyEl.classList.toggle('hidden', signedIn);
        const syncActions = document.getElementById('profile-sync-actions');
        if (syncActions) syncActions.classList.toggle('hidden', !(signedIn && key));
        const inactiveHint = document.getElementById('profile-sync-inactive-hint');
        if (inactiveHint) inactiveHint.classList.toggle('hidden', !(signedIn && !key));

        const timeTxt = document.getElementById('sync-time-txt');
        if (timeTxt) {
            const lastSync = KrishiStorage.getItem('krishi_last_sync_time');
            const txt = lastSync ? 'Last Synced: ' + lastSync : 'Last Synced: Never';
            if (timeTxt.innerText !== txt) timeTxt.innerText = txt;
        }

        const badge = document.getElementById('profile-sync-badge');
        if (badge) {
            let label = 'Not connected ⚪';
            let tone = 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
            if (signedIn && !online) {
                label = 'Offline 🟡';
            } else if (signedIn && !key) {
                label = 'Not syncing ⚪';
            } else if (signedIn) {
                const status = KrishiStorage.getItem('krishi_sync_status') || 'Synced';
                if (status === 'Syncing...') {
                    label = 'Syncing... 🟡';
                    tone = 'bg-amber-500/10 text-amber-500 animate-pulse';
                } else if (status === 'Sync failed') {
                    label = 'Sync failed 🔴';
                    tone = 'bg-rose-500/10 text-rose-500';
                } else {
                    label = 'Synced 🟢';
                    tone = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
                }
            }
            const cls = 'text-[8px] font-extrabold px-2 py-0.5 rounded-full ' + tone;
            if (badge.innerText !== label) badge.innerText = label;
            if (badge.className !== cls) badge.className = cls;
        }
    }

    function refreshProfilePage() {
        renderProfileIdentity();
        renderProfileSnapshot();
        updateProfileSyncUI();
    }

    function flashProfileSaved(el) {
        if (!el) return;
        const ps = typeof getPerfSettings === 'function' ? getPerfSettings() : {};
        if (ps.reduceMotion || ps.perfMode === 'battery') return;
        el.classList.remove('profile-saved-flash');
        void el.offsetWidth; // restart the animation cleanly
        el.classList.add('profile-saved-flash');
        setTimeout(() => el.classList.remove('profile-saved-flash'), 800);
    }

    function openProfilePage() {
        if (typeof playSound === 'function') { try { playSound('click'); } catch(e) {} }
        if (typeof window.navigate === 'function') window.navigate('page-profile');
    }

    // The pairing console (sync key / QR / devices / selective sync) intentionally stays in Settings
    function openAdvancedSyncSettings() {
        if (typeof window.navigate === 'function') window.navigate('page-settings');
        if (typeof switchSettingsTab === 'function') switchSettingsTab('general');
        const ps = typeof getPerfSettings === 'function' ? getPerfSettings() : {};
        const behavior = (ps.reduceMotion || ps.perfMode === 'battery') ? 'auto' : 'smooth';
        setTimeout(() => {
            const body = document.getElementById('accordion-body-sync');
            if (body && body.classList.contains('hidden') && typeof window.toggleSettingsAccordion === 'function') {
                window.toggleSettingsAccordion('sync');
            }
            const anchor = document.getElementById('accordion-body-sync');
            if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: behavior, block: 'center' });
        }, 240);
    }

    // ---------- display name editing ----------
    function startProfileNameEdit() {
        const row = document.getElementById('profile-name-row');
        const edit = document.getElementById('profile-name-edit');
        const input = document.getElementById('profile-name-input');
        if (!row || !edit || !input) return;
        input.value = (KrishiStorage.getItem(PROFILE_NAME_KEY) || '').trim();
        row.classList.add('hidden');
        edit.classList.remove('hidden');
        input.focus();
        input.select();
    }

    function cancelProfileNameEdit() {
        const row = document.getElementById('profile-name-row');
        const edit = document.getElementById('profile-name-edit');
        if (row) row.classList.remove('hidden');
        if (edit) edit.classList.add('hidden');
    }

    function saveProfileName() {
        const input = document.getElementById('profile-name-input');
        if (!input) return;
        const clean = (input.value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        KrishiStorage.setItem(PROFILE_NAME_KEY, clean);
        stampProfileUpdated();
        cancelProfileNameEdit();
        renderProfileIdentity();
        refreshHomeGreeting();
        flashProfileSaved(document.getElementById('profile-name-display'));
        showToast(clean ? '✅ नाम सुरक्षित भयो!' : '✅ नाम रिसेट भयो!');
        // Reuses the existing debounced cloud push — queues safely while offline
        syncSettingsToCloud('Profile name updated');
    }

    // ---------- profile photo ----------
    function triggerProfilePhotoPicker() {
        const input = document.getElementById('profile-photo-input');
        if (!input) return;
        input.value = '';
        input.click();
    }

    // Downscale + center-crop to a small square JPEG so the avatar rides along inside the
    // existing sync payload (no Firebase Storage, no second upload path)
    function compressImageToDataURL(file, size) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                try {
                    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
                    if (!side) throw new Error('Empty image');
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(
                        img,
                        ((img.naturalWidth || img.width) - side) / 2,
                        ((img.naturalHeight || img.height) - side) / 2,
                        side, side, 0, 0, size, size
                    );
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                } catch (err) {
                    reject(err);
                } finally {
                    URL.revokeObjectURL(url);
                }
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Image could not be decoded'));
            };
            img.src = url;
        });
    }

    async function handleProfilePhotoPick(event) {
        const file = event && event.target && event.target.files ? event.target.files[0] : null;
        if (!file) return;
        if (file.type && file.type.indexOf('image/') !== 0) {
            showToast('⚠️ कृपया फोटो (image) फाइल छान्नुहोस्।');
            return;
        }
        try {
            const dataUrl = await compressImageToDataURL(file, PROFILE_PHOTO_PX);
            KrishiStorage.setItem(PROFILE_PHOTO_KEY, dataUrl);
            stampProfileUpdated();
            renderProfileIdentity();
            flashProfileSaved(document.getElementById('profile-avatar-large'));
            showToast('✅ प्रोफाइल फोटो अपडेट भयो!');
            syncSettingsToCloud('Profile photo updated');
        } catch (err) {
            console.error('[Profile] Photo processing failed:', err);
            showToast('❌ फोटो प्रोसेस गर्न सकिएन।');
        }
    }

    function removeProfilePhoto() {
        if (!getProfilePhoto()) return;
        KrishiStorage.removeItem(PROFILE_PHOTO_KEY);
        stampProfileUpdated();
        renderProfileIdentity();
        showToast('🗑️ प्रोफाइल फोटो हटाइयो।');
        syncSettingsToCloud('Profile photo removed');
    }

    window.openProfilePage = openProfilePage;
    window.openAdvancedSyncSettings = openAdvancedSyncSettings;
    window.startProfileNameEdit = startProfileNameEdit;
    window.saveProfileName = saveProfileName;
    window.cancelProfileNameEdit = cancelProfileNameEdit;
    window.triggerProfilePhotoPicker = triggerProfilePhotoPicker;
    window.handleProfilePhotoPick = handleProfilePhotoPick;
    window.removeProfilePhoto = removeProfilePhoto;
    window.refreshProfilePage = refreshProfilePage;

    async function manualCheckForUpdates() {
        if ('serviceWorker' in navigator) {
            showToast('⏳ Checking for updates...');
            try {
                const reg = await navigator.serviceWorker.ready;
                await reg.update();
                // Wait 1.5s to see if SW found anything
                setTimeout(() => {
                    if (reg.waiting) {
                        showToast('💡 New update available! Prompt displayed below.');
                    } else if (reg.installing) {
                        showToast('⏳ Installing new update...');
                    } else {
                        showToast('✓ You are already running the latest version!');
                    }
                }, 1500);
            } catch (err) {
                console.error('[Manual Update] Check failed:', err);
                showToast('❌ Update check failed. Please check your network.');
            }
        } else {
            showToast('⚠️ PWA features are not supported in this browser.');
        }
    }

    async function clearAppCacheAndReload() {
        if (confirm('Are you sure you want to clear all application caches and force reload? This is useful for clearing old configurations.')) {
            showToast('⚡ Clearing cache & reloading...');
            try {
                // 1. Unregister all service workers
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (let registration of registrations) {
                        await registration.unregister();
                    }
                }
                
                // 2. Delete all caches
                if ('caches' in window) {
                    const keys = await caches.keys();
                    for (let key of keys) {
                        await caches.delete(key);
                    }
                }
                
                // 3. Clear localStorage cache parameters
                KrishiStorage.removeItem('krishi_last_sync_time');
                
                showToast('✅ Caches cleared. Reloading...');
                setTimeout(() => {
                    window.location.reload(true);
                }, 1000);
            } catch (err) {
                console.error('[Cache Reset] Reset failed:', err);
                showToast('❌ Reset failed: ' + err.message);
            }
        }
    }

    async function initCloudSync() {
        // Use canonical UID-based identity; getSyncKey() returns '' when logged out
        const uid = getCloudUID();
        updateSyncUI();
        if (!uid) return;

        try {
            setSyncStatus('Syncing...');
            await loadFirebaseSDKs();
            
            firebaseApp = getSafeFirebaseApp();
            if (!firebaseApp) throw new Error("Firebase app could not be initialized");

            const firebaseAuthObj = firebase.auth(firebaseApp);
            if (!firebaseAuthObj.currentUser) {
                try {
                    await firebaseAuthObj.signInAnonymously();
                    console.log('[Cloud Sync] Anonymous auth fallback successful.');
                } catch(e) {
                    console.warn('[Cloud Sync] Anonymous auth fallback failed:', e);
                }
            }

            const firestore = firebase.firestore(firebaseApp);
            
            // Live Session Presence Registration
            const sessionId = currentSessionId;
            const platform = (window.Capacitor && window.Capacitor.getPlatform) ? (window.Capacitor.getPlatform() === 'android' ? 'Android App' : (window.Capacitor.getPlatform() === 'ios' ? 'iOS App' : 'Web PWA')) : 'Web PWA';
            const deviceName = /Android/i.test(navigator.userAgent) ? 'Android Device' : (/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'iOS Device' : 'Desktop Browser');
            
            const sessionRef = firestore.collection('users').doc(uid).collection('sessions').doc(sessionId);
            const updateSessionDoc = () => {
                const customName = KrishiStorage.getItem('krishi_custom_device_name');
                const sessionPayload = {
                    deviceName: customName || deviceName,
                    platform: platform,
                    lastActive: firebase.firestore.FieldValue.serverTimestamp()
                };
                if (deviceIpAddress) sessionPayload.ip = deviceIpAddress;
                if (deviceLocationCity) {
                    sessionPayload.location = `${deviceLocationCity} (${deviceLocationCountry})`;
                }
                const fcmToken = KrishiStorage.getItem('krishi_fcm_token');
                if (fcmToken) sessionPayload.fcmToken = fcmToken;
                
                sessionRef.set(sessionPayload, { merge: true }).catch(err => console.warn('[Presence] Touch failed:', err));
            };

            // Define global rename function bound to this session
            window.promptRenameDevice = () => {
                const currentCustom = KrishiStorage.getItem('krishi_custom_device_name') || '';
                const existingName = currentCustom || deviceName;
                const newName = prompt("Enter a custom name for this device:", existingName);
                if (newName !== null) {
                    const trimmed = newName.trim();
                    if (trimmed) {
                        KrishiStorage.setItem('krishi_custom_device_name', trimmed);
                        showToast('✅ Device renamed to: ' + trimmed);
                    } else {
                        KrishiStorage.removeItem('krishi_custom_device_name');
                        showToast('✅ Reset device name to default.');
                    }
                    updateSessionDoc();
                }
            };
            
            fetchDeviceLocationMetadata().finally(() => {
                updateSessionDoc();
                if (sessionTouchInterval) clearInterval(sessionTouchInterval);
                sessionTouchInterval = setInterval(updateSessionDoc, 30000);
            });

            // Listen for remote disconnect events on this device's session
            if (window.deviceDisconnectListenerUnsubscribe) {
                window.deviceDisconnectListenerUnsubscribe();
            }
            window.deviceDisconnectListenerUnsubscribe = sessionRef.onSnapshot(doc => {
                if (doc.exists) {
                    const data = doc.data();
                    if (data && data.disconnect === true) {
                        console.log('[Remote Disconnect] Received logout signal from server.');
                        showToast('⚠️ This session has been disconnected remotely.', 10000);
                        disableCloudSyncSilently();
                        if (firebaseAuth) {
                            firebaseAuth.signOut().catch(e => console.warn('[Remote Disconnect] SignOut failed:', e));
                        }
                    }
                }
            }, err => {
                console.warn('[Remote Disconnect] Listener failed:', err);
            });

            // Define global disconnect callback for the UI button
            window.remotelyDisconnectDevice = function(targetSessionId) {
                if (confirm('Are you sure you want to disconnect this device remotely?')) {
                    firestore.collection('users').doc(uid).collection('sessions').doc(targetSessionId).set({
                        disconnect: true
                    }, { merge: true }).then(() => {
                        showToast('✉️ Sent disconnect request to device...');
                    }).catch(err => {
                        console.error('[Disconnect] Request failed:', err);
                        showToast('❌ Failed to send disconnect request.');
                    });
                }
            };

            // iOS Safari Foreground Synchronization Fallback
            if (window.safariPeriodicSyncInterval) clearInterval(window.safariPeriodicSyncInterval);
            window.safariPeriodicSyncInterval = setInterval(() => {
                if (navigator.onLine && !syncInProgress && getCloudUID()) {
                    console.log('[iOS Sync Fallback] Executing periodic study progress foreground synchronization...');
                    performCloudSync();
                }
            }, 180000);

            // Presence Listener
            if (window.presenceListenerUnsubscribe) {
                window.presenceListenerUnsubscribe();
            }
            window.presenceListenerUnsubscribe = firestore.collection('users').doc(uid).collection('sessions')
                .onSnapshot(snapshot => {
                    const listContainer = document.getElementById('sync-connected-devices-list');
                    if (!listContainer) return;
                    
                    listContainer.innerHTML = '';
                    const nowMs = Date.now();
                    let count = 0;
                    
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        if (!data) return;
                        
                        let lastActiveMs = nowMs;
                        if (data.lastActive && typeof data.lastActive.toMillis === 'function') {
                            lastActiveMs = data.lastActive.toMillis();
                        } else if (data.lastActive instanceof Date) {
                            lastActiveMs = data.lastActive.getTime();
                        }
                        
                        if (nowMs - lastActiveMs > 90000) return;
                        
                        count++;
                        const isCurrent = doc.id === currentSessionId;
                        const item = document.createElement('div');
                        item.className = 'flex justify-between items-center p-1.5 rounded-lg border bg-white dark:bg-slate-800 text-[9px] transition-all duration-150 hover:bg-slate-100 dark:hover:bg-slate-700';
                        item.style.borderColor = 'var(--border)';
                        
                        const disconnectButton = isCurrent ? `
                            <span class="px-1.5 py-0.5 rounded-full font-bold uppercase bg-emerald-500/10 text-emerald-500 flex items-center gap-1 text-[7px]">
                                <span class="h-1 w-1 rounded-full bg-emerald-500"></span> Online
                            </span>
                        ` : `
                            <button class="text-rose-500 hover:text-white px-1.5 py-0.5 rounded border border-rose-500/20 hover:bg-rose-500 font-bold transition-all text-[7px]" onclick="window.remotelyDisconnectDevice('${doc.id}')">
                                Disconnect
                            </button>
                        `;

                        const geoText = data.location ? `<span class="text-[8px] text-emerald-600 dark:text-emerald-400 font-bold block mt-0.5">📍 ${data.location} ${data.ip ? `(${data.ip})` : ''}</span>` : '';
                        item.innerHTML = `
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs">${(data.platform === 'Android App' || data.platform === 'iOS App') ? '📱' : '💻'}</span>
                                <div class="flex flex-col">
                                    <span class="font-bold text-slate-800 dark:text-slate-200">${data.deviceName}${isCurrent ? ' <span class="text-indigo-500 font-extrabold text-[8px]">(This)</span> <button class="inline-flex items-center bg-transparent border-0 cursor-pointer text-slate-400 hover:text-indigo-500 ml-1 p-0 transition-colors text-[8px]" onclick="window.promptRenameDevice()" title="Rename Device">✏️</button>' : ''}</span>
                                    <span class="text-[8px] text-slate-400">${data.platform}</span>
                                    ${geoText}
                                </div>
                            </div>
                            ${disconnectButton}
                        `;
                        listContainer.appendChild(item);
                    });
                    
                    if (count === 0) {
                        listContainer.innerHTML = '<div class="text-center py-2 text-slate-400">No active sync peers online.</div>';
                    }
                }, err => {
                    console.warn('[Presence] Listener failed:', err);
                    const listContainer = document.getElementById('sync-connected-devices-list');
                    if (listContainer) {
                        listContainer.innerHTML = '<div class="text-center py-2 text-rose-500/80 dark:text-rose-400/80">⚠️ Presence listener paused. Authenticating...</div>';
                    }
                });

            if (window.syncListenerUnsubscribe) {
                window.syncListenerUnsubscribe();
            }

            function detectPeerChangesAndNotify(cloudData) {
                if (!cloudData) return;
                
                try {
                    const localBms = (localData.bookmarked || []).length;
                    const cloudBms = (cloudData.bookmarked || []).length;
                    const localWrongs = getValidWrongCount();
                    const cloudWrongs = (cloudData.wrong || []).length;
                    
                    const localLogs = safeJsonParse(KrishiStorage.getItem('krishi_timingLog'), []).length;
                    const cloudLogs = (cloudData.timingLog || []).length;

                    const localCust = (localData.customQuestions || []).length;
                    const cloudCust = (cloudData.customQuestions || []).length;
                    
                    let messages = [];
                    
                    if (cloudBms > localBms && syncSelectiveBookmarks) {
                        messages.push(`🔖 ${cloudBms - localBms} Bookmarks`);
                    }
                    if (cloudWrongs > localWrongs && syncSelectiveErrors) {
                        messages.push(`🔴 ${cloudWrongs - localWrongs} Errors`);
                    }
                    if (cloudLogs > localLogs && syncSelectiveLogs) {
                        messages.push(`📅 ${cloudLogs - localLogs} Logs`);
                    }
                    if (cloudCust > localCust && syncSelectiveCustom) {
                        messages.push(`📝 ${cloudCust - localCust} MCQs`);
                    }
                    
                    if (messages.length > 0) {
                        const text = `🔄 Synced: ${messages.join(', ')}`;
                        showToast(text);
                        if (typeof playSound === 'function') {
                            try { playSound('success'); } catch(e){}
                        }
                    }
                } catch(e) {
                    console.warn('[Peer Notifications] Failed to calculate diff:', e);
                }
            }

            // Listen for cross-device quiz handoff events
            listenForRemoteHandoff(uid, firestore);

            // Real-time snapshot listener
            window.syncListenerUnsubscribe = firestore.collection('users').doc(uid)
                .onSnapshot(async doc => {
                    // Tracks whether THIS invocation took the syncInProgress lock, so the
                    // finally block never releases a lock owned by another run.
                    let ownsSyncLock = false;
                    try {
                    const fromCache = !!(doc.metadata && doc.metadata.fromCache);

                    if (doc.exists) {
                        const rawData = doc.data();
                        if (rawData && rawData.__e2ee__) {
                            // An encrypted envelope carries none of the real fields. Treating
                            // it as the payload would blank everything it lacks, so refuse to
                            // sync rather than decrypt with key material the app never sets.
                            console.error('[Cloud Sync] Cloud document is encrypted and unreadable — sync halted to protect data.');
                            setSyncStatus('Sync failed');
                            return;
                        }
                        cachedCloudData = rawData;
                        cachedCloudUid = uid;
                        window.__krishiSyncListenerInitialized__ = true;
                    } else {
                        // A "document does not exist" answer served from the local Firestore
                        // cache is NOT proof of absence: on a fresh install, after cleared
                        // storage, or in a new browser profile the cache is empty and reports
                        // every document as missing. Trusting it here is what allowed the app
                        // to replace a populated cloud document with an empty one.
                        if (fromCache) {
                            console.warn('[Cloud Sync] Ignoring cache-only "document missing" snapshot; waiting for the server copy.');
                            return;
                        }
                        cachedCloudData = null;
                        cachedCloudUid = uid;
                        window.__krishiSyncListenerInitialized__ = true;
                    }

                    if (syncInProgress) return;

                    if (doc.metadata && doc.metadata.hasPendingWrites) {
                        return;
                    }

                    if (doc.exists) {
                        const cloudData = cachedCloudData;
                        syncInProgress = true;
                        ownsSyncLock = true;
                        console.log('[Cloud Sync] Snappy silent real-time CRDT merge executing...');
                        const mergedPayload = mergeCloudAndLocalData(cloudData);
                        detectPeerChangesAndNotify(cloudData);
                        applyAllAppData(mergedPayload);

                        const delta = getDifferentialSyncDelta(mergedPayload, cloudData);
                        if (delta && Object.keys(delta).length > 0) {
                            const now = firebase.firestore.FieldValue.serverTimestamp();
                            mergedPayload.updatedAt = Date.now();
                            KrishiStorage.setItem('krishi_last_updated_at', mergedPayload.updatedAt);
                            firestore.collection('users').doc(uid).set({ ...delta, updatedAt: now }, { merge: true })
                                .then(() => console.log('[Cloud Sync] Real-time merged local changes pushed back to cloud'))
                                .catch(err => console.error('[Cloud Sync] Real-time push back failed:', err));
                        } else {
                            KrishiStorage.setItem('krishi_last_updated_at', cloudData.updatedAt || Date.now());
                        }

                        KrishiStorage.removeItem('krishi_sync_pending');
                        KrishiStorage.setItem('krishi_sync_pending_count', '0');
                        setSyncStatus('Synced');
                        updateOfflineQueueBadge();
                        scheduleMidnightCloudVault();
                        if (typeof updateSyncUI === 'function') updateSyncUI();

                        // Single batched RAF render — replaces the previous multi-render storm.
                        // applyAllAppData() above has already set dirty flags.
                        // krishiScheduleSyncRender() will render only the active+dirty page
                        // in the next animation frame, keeping the main thread free for
                        // the toast animation and any ongoing user interaction.
                        if (typeof krishiScheduleSyncRender === 'function') krishiScheduleSyncRender();

                        window.dispatchEvent(new Event('appDataSynced'));
                    } else {
                        scheduleCloudSync('Initial sync configuration setup');
                    }
                    } catch (e) {
                        // Without this, any throw in the merge left syncInProgress latched
                        // true for the rest of the session, silently killing all sync.
                        console.error('[Cloud Sync] Snapshot handler failed:', e);
                        setSyncStatus('Sync failed');
                    } finally {
                        if (ownsSyncLock) syncInProgress = false;
                    }
                }, err => {
                    console.error('[Cloud Sync] Listener failed:', err);
                    setSyncStatus('Sync failed');
                    setTimeout(() => {
                        if (navigator.onLine && KrishiStorage.getItem('krishi_sync_status') === 'Sync failed') {
                            console.log('[Cloud Sync] Auto-retrying cloud sync after failure...');
                            initCloudSync();
                        }
                    }, 5000);
                });

        } catch (err) {
            console.error('Failed to initialize Cloud Sync:', err);
            setSyncStatus('Sync failed');
        }
    }

    async function generatePairingPin() {
        const key = getSyncKey();
        if (!key) {
            showToast('⚠️ Please login or enable Cloud Sync first!');
            return;
        }
        try {
            await loadFirebaseSDKs();
            const firestore = firebase.firestore(firebaseApp);
            
            const pin = String(Math.floor(100000 + Math.random() * 900000));
            const now = Date.now();
            const expiresAt = now + (15 * 60 * 1000);
            
            await firestore.collection('sync_pins').doc(pin).set({
                syncKey: key,
                createdAt: now,
                expiresAt: expiresAt,
                ownerUid: (currentAuthUser ? currentAuthUser.uid : null)
            });
            
            const pinModal = document.getElementById('modal-pairing-pin');
            const pinDisplay = document.getElementById('cloud-pairing-pin-display');
            if (pinDisplay) pinDisplay.textContent = pin;
            if (pinModal) pinModal.classList.remove('hidden');
            
            showToast(`🔑 Pairing PIN: ${pin}`);
        } catch(err) {
            console.error('[Pairing PIN] Failed to generate PIN:', err);
            showToast('❌ PIN generation failed: ' + err.message);
        }
    }
    window.generatePairingPin = generatePairingPin;

    async function pairWithPin(pinInput) {
        const pin = String(pinInput || '').trim().replace(/\s+/g, '');
        if (!pin || pin.length !== 6) {
            showToast('⚠️ Please enter a valid 6-digit PIN code!');
            return;
        }
        try {
            showToast('🔄 Verifying pairing PIN...');
            await loadFirebaseSDKs();
            const firestore = firebase.firestore(firebaseApp);
            
            const doc = await firestore.collection('sync_pins').doc(pin).get();
            if (!doc.exists) {
                showToast('❌ Invalid or expired PIN code!');
                return;
            }
            
            const pinData = doc.data();
            if (pinData.expiresAt && Date.now() > pinData.expiresAt) {
                showToast('❌ This PIN code has expired! Please generate a new one.');
                return;
            }
            
            const targetKey = pinData.syncKey;
            if (!targetKey) {
                showToast('❌ Invalid sync key attached to PIN!');
                return;
            }
            
            // PIN pairing resolved: trigger full Firebase login sync.
            // The user should now be authenticated via Firebase Auth;
            // getCloudUID() will return their UID automatically.
            syncCredentialsAuthorized = true;
            KrishiStorage.setItem('krishi_sync_credentials_authorized', 'true');

            showToast('✅ Device Linked with PIN! Merging account data...');
            await initCloudSync();
            if (typeof syncCloudNow === 'function') await syncCloudNow(false);
            
            const pinModal = document.getElementById('modal-pairing-pin');
            if (pinModal) pinModal.classList.add('hidden');
        } catch(err) {
            console.error('[Pairing PIN] Failed to link with PIN:', err);
            showToast('❌ Linking failed: ' + err.message);
        }
    }
    window.pairWithPin = pairWithPin;

    // A session id is regenerated on every app launch, so it cannot identify a *device*:
    // after finishing a quiz and reopening the app, the phone saw its own leftover handoff
    // doc as a "peer" and offered to resume the quiz it had just completed. This id is
    // persistent, so a device can always recognise its own broadcast and ignore it.
    function getStableDeviceId() {
        let id = KrishiStorage.getItem('krishi_device_id');
        if (!id) {
            id = 'dev-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
            KrishiStorage.setItem('krishi_device_id', id);
        }
        return id;
    }

    function listenForRemoteHandoff(uid, firestore) {
        if (window.handoffListenerUnsubscribe) {
            window.handoffListenerUnsubscribe();
        }
        const myDeviceId = getStableDeviceId();
        window.handoffListenerUnsubscribe = firestore.collection('users').doc(uid).collection('handoff').doc('current')
            .onSnapshot(doc => {
                if (!doc || !doc.exists) return;
                const data = doc.data();
                if (!data) return;
                // The broadcasting device retired the session (finishSession -> clearQuizHandoff
                // writes active:false). Tear down any banner still on screen instead of just
                // ignoring the update, otherwise a banner rendered while the quiz was live
                // lingers after it finished and its Resume button replays the done session.
                if (!data.active || data.sessionId === currentSessionId) {
                    if (typeof window.dismissHandoffBanner === 'function') window.dismissHandoffBanner();
                    return;
                }
                // Ignore this device's own broadcast, whatever session it came from.
                if (data.deviceId && data.deviceId === myDeviceId) {
                    if (typeof window.dismissHandoffBanner === 'function') window.dismissHandoffBanner();
                    return;
                }
                if (Date.now() - (data.updatedAt || 0) < 600000) {
                    renderHandoffBanner(data);
                } else if (typeof window.dismissHandoffBanner === 'function') {
                    // Stale broadcast (older than 10 min) — make sure no old banner survives.
                    window.dismissHandoffBanner();
                }
            }, err => console.warn('[Handoff] Listener error:', err));
    }

    function renderHandoffBanner(data) {
        let banner = document.getElementById('krishi-handoff-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'krishi-handoff-banner';
            document.body.appendChild(banner);
        }
        banner.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[99999] bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2.5 rounded-2xl shadow-xl border border-indigo-400/30 flex items-center gap-3 animate-bounce text-xs cursor-pointer';
        banner.innerHTML = `
            <span>📱 Active Session on <strong>${data.deviceName || 'Peer'}</strong> (${data.subject || 'Quiz'} - Q #${(data.questionIdx || 0) + 1})</span>
            <button onclick="if(typeof window.navigateTab==='function') window.navigateTab('page-practice'); window.dismissHandoffBanner();" class="bg-white text-indigo-700 font-extrabold px-2.5 py-1 rounded-xl text-[10px] shadow hover:bg-indigo-50 cursor-pointer">Resume Here 🚀</button>
            <button onclick="window.dismissHandoffBanner()" class="text-white/80 hover:text-white text-xs cursor-pointer">✕</button>
        `;
    }

    window.dismissHandoffBanner = function() {
        const banner = document.getElementById('krishi-handoff-banner');
        if (banner) banner.remove();
    };

    function broadcastQuizHandoff(quizState) {
        quizState = quizState || {};
        const uid = getCloudUID();
        if (!uid || !firebaseApp) return;
        try {
            const firestore = firebase.firestore(firebaseApp);
            const payload = {
                sessionId: currentSessionId,
                deviceId: getStableDeviceId(),
                deviceName: KrishiStorage.getItem('krishi_custom_device_name') || 'Peer Device',
                subject: quizState.subject || (state ? state.selectedSubject : 'All Subjects') || 'Quiz',
                questionIdx: typeof quizState.questionIdx !== 'undefined' ? quizState.questionIdx : (state ? state.currentIndex : 0),
                totalScore: typeof quizState.score !== 'undefined' ? quizState.score : (state ? state.score : 0),
                updatedAt: Date.now(),
                active: true
            };
            firestore.collection('users').doc(uid).collection('handoff').doc('current').set(payload, { merge: true })
                .catch(e => console.warn('[Handoff] Broadcast failed:', e));
        } catch(e){}
    }
    window.broadcastQuizHandoff = broadcastQuizHandoff;

    // renderMCQ() broadcasts `active: true` on every question, but nothing ever wrote the
    // closing record, so the handoff doc stayed "active" forever. Every peer therefore kept
    // offering to resume a quiz that had already been completed, and because the banner's
    // Resume button just navigates to the practice page, tapping it replayed the finished
    // session — the loop reported on the tablet.
    function clearQuizHandoff() {
        const uid = getCloudUID();
        if (!uid || !firebaseApp) return;
        try {
            const firestore = firebase.firestore(firebaseApp);
            firestore.collection('users').doc(uid).collection('handoff').doc('current').set({
                sessionId: currentSessionId,
                deviceId: getStableDeviceId(),
                active: false,
                updatedAt: Date.now()
            }, { merge: true }).catch(e => console.warn('[Handoff] Clear failed:', e));
        } catch (e) { /* clearing is best-effort; never block finishing a quiz */ }
        // Also drop any banner already on screen for the session that just ended.
        if (typeof window.dismissHandoffBanner === 'function') window.dismissHandoffBanner();
    }
    window.clearQuizHandoff = clearQuizHandoff;

    function scheduleMidnightCloudVault() {
        const today = new Date().toISOString().split('T')[0];
        const lastVaultDate = KrishiStorage.getItem('krishi_last_vault_date');
        if (lastVaultDate !== today) {
            performMidnightVaultBackup(today);
        }
    }

    async function performMidnightVaultBackup(dateStr) {
        const uid = getCloudUID();
        if (!uid || !firebaseApp) return;
        try {
            const firestore = firebase.firestore(firebaseApp);
            const snapshot = collectAllAppData();
            snapshot.vaultDate = dateStr;
            snapshot.vaultTimestamp = Date.now();
            await firestore.collection('users').doc(uid).collection('backups').doc(dateStr).set(snapshot, { merge: true });
            KrishiStorage.setItem('krishi_last_vault_date', dateStr);
            console.log('[Midnight Vault] Cloud backup snapshot created for:', dateStr);
        } catch(e) {
            console.warn('[Midnight Vault] Failed:', e);
        }
    }
    window.performMidnightVaultBackup = performMidnightVaultBackup;

    function updateOfflineQueueBadge() {
        const badge = document.getElementById('krishi-offline-queue-badge');
        if (badge) {
            badge.classList.add('hidden');
            badge.style.display = 'none';
        }
    }
    window.updateOfflineQueueBadge = updateOfflineQueueBadge;
    window.addEventListener('online', updateOfflineQueueBadge);
    window.addEventListener('offline', updateOfflineQueueBadge);

    async function enableCloudSync() {
        const inputKey = document.getElementById('cloud-sync-key-input').value.trim().toUpperCase();
        // Legacy manual key input: this function is replaced by Firebase Authentication.
        // Users should log in via Google/Email to get automatic sync.
        showToast('⚠️ Manual Sync Key is no longer supported. Please login with your account for automatic sync!');
        return;
    }

    function disableCloudSync() {
        if (confirm('Are you sure you want to disable Cloud Sync? Your progress will remain saved locally.')) {
            disableCloudSyncSilently();
            showToast('🔴 Cloud Sync disabled successfully.');
        }
    }

    function disableCloudSyncSilently() {
        // Delete presence registration before clean up
        try {
            const uid = getCloudUID();
            if (uid && firebaseApp) {
                const firestore = firebase.firestore(firebaseApp);
                firestore.collection('users').doc(uid).collection('sessions').doc(currentSessionId).delete()
                    .catch(e => console.warn('[Presence] Cleanup failed:', e));
            }
        } catch(e) {
            console.warn('[Presence] Session cleanup err:', e);
        }
        if (sessionTouchInterval) {
            clearInterval(sessionTouchInterval);
            sessionTouchInterval = null;
        }
        if (window.presenceListenerUnsubscribe) {
            window.presenceListenerUnsubscribe();
            window.presenceListenerUnsubscribe = null;
        }
        if (window.syncListenerUnsubscribe) {
            try {
                window.syncListenerUnsubscribe();
            } catch(e) {
                console.error('Failed to unsubscribe sync listener:', e);
            }
            window.syncListenerUnsubscribe = null;
        }
        if (window.deviceDisconnectListenerUnsubscribe) {
            try {
                window.deviceDisconnectListenerUnsubscribe();
            } catch(e) {}
            window.deviceDisconnectListenerUnsubscribe = null;
        }
        if (syncListenerRef) {
            try { syncListenerRef.off(); } catch(e){}
            syncListenerRef = null;
        }
        KrishiStorage.removeItem('krishi_last_sync_time');
        KrishiStorage.removeItem('krishi_sync_credentials_authorized');
        syncCredentialsAuthorized = false;
        // Drop the cloud snapshot cache with the listener that fed it. Leaving it behind
        // let a stale (or another account's) snapshot decide document existence and write
        // paths after re-enabling sync.
        cachedCloudData = null;
        cachedCloudUid = null;
        window.__krishiSyncListenerInitialized__ = false;
        syncInProgress = false;
        updateSyncUI();
    }

    function performSmartMerge(cloudData, shouldPushAfter = true) {
        if (!cloudData) return;
        syncInProgress = true;

        try {
            console.log('[SmartMerge] Executing full CRDT payload merge & UI refresh...');
            const mergedPayload = mergeCloudAndLocalData(cloudData);
            applyAllAppData(mergedPayload);

            KrishiStorage.setItem('krishi_last_updated_at', mergedPayload.updatedAt || Date.now());
            KrishiStorage.setItem('krishi_last_sync_time', new Date().toLocaleTimeString());

            updateSyncUI();

            if (typeof updateHomePage === 'function') updateHomePage();
            if (typeof updatePracticePage === 'function') updatePracticePage();
            if (typeof updateStatsRibbon === 'function') updateStatsRibbon();
            if (typeof scheduleRenderQuestionList === 'function') scheduleRenderQuestionList(true);

            if (shouldPushAfter) {
                pushLocalToCloud();
            }
        } catch (err) {
            console.error('Error during smart merge:', err);
        } finally {
            syncInProgress = false;
        }
    }

    async function pushLocalToCloud() {
        console.log('[Sync] Delegating local push to snappy Firestore debouncer.');
        scheduleCloudSync('Pushing to cloud');
    }

    async function syncCloudNow(silent = false) {
    const uid = getCloudUID();
    if (!uid) return;

    const spinner = document.getElementById('sync-spinner');
    const btn = document.getElementById('btn-sync-now');
    
    if (!silent && spinner) {
        spinner.classList.remove('hidden');
        if (btn) btn.disabled = true;
    }

    try {
        await loadFirebaseSDKs();
        if (!firebaseApp) {
            await initFirebaseAuth();
        }
        if (firebaseApp) {
            const firestore = firebase.firestore(firebaseApp);
            const docRef = firestore.collection('users').doc(uid);
            const doc = await docRef.get();
            
            if (doc.exists) {
                const cloudData = doc.data();
                const conflict = checkForSyncConflicts(collectAllAppData(), cloudData);
                if (conflict && !silent) {
                    promptConflictModal(conflict.local, conflict.cloud, async (strategy) => {
                        try {
                            if (strategy === 'merge') {
                                performSmartMerge(cloudData, true);
                                if (!silent) showToast('✅ Intelligent Merge successful!');
                            } else if (strategy === 'local') {
                                const now = Date.now();
                                const localDataPayload = collectAllAppData();
                                localDataPayload.updatedAt = now;
                                // merge:true — "keep local" means the user's local copy of the
                                // conflicting collections wins, not that every cloud field the
                                // payload happens to omit (a disabled sync toggle, a newer
                                // schema key) gets deleted.
                                await docRef.set(localDataPayload, { merge: true });
                                KrishiStorage.setItem('krishi_last_updated_at', now);
                                KrishiStorage.removeItem('krishi_sync_pending');
                                KrishiStorage.setItem('krishi_sync_pending_count', '0');
                                setSyncStatus('Synced');
                                updateOfflineQueueBadge();
                                if (!silent) showToast('✅ Cloud overwritten with Local version!');
                            } else if (strategy === 'cloud') {
                                applyAllAppData(cloudData);
                                KrishiStorage.setItem('krishi_last_updated_at', cloudData.updatedAt || Date.now());
                                KrishiStorage.removeItem('krishi_sync_pending');
                                KrishiStorage.setItem('krishi_sync_pending_count', '0');
                                setSyncStatus('Synced');
                                updateOfflineQueueBadge();
                                if (!silent) showToast('✅ Local overwritten with Cloud version!');
                            }
                        } catch(err) {
                            console.error('[Conflict Resolution] Resolution failed:', err);
                            showToast('❌ Resolution failed: ' + err.message);
                        }
                    });
                } else {
                    performSmartMerge(cloudData, true);
                    if (!silent) showToast('✅ Cloud Sync successful!');
                }
            } else {
                await pushLocalToCloud();
                KrishiStorage.setItem('krishi_last_sync_time', new Date().toLocaleTimeString());
                updateSyncUI();
                if (!silent) showToast('✅ Cloud Sync successful!');
            }
        }
    } catch(e) {
        console.error('Manual sync failed:', e);
        if (!silent) showToast('❌ Cloud connection error!');
    } finally {
        if (!silent && spinner) {
            spinner.classList.add('hidden');
            if (btn) btn.disabled = false;
        }
    }
}

    // Offline sync is managed entirely and robustly by the official Firebase SDK's native persistence.

    function writeFCMTokenToFirebaseSession(token) {
        if (!token) return;
        const uid = getCloudUID();
        if (!uid || !firebaseApp) return;

        try {
            const firestore = firebase.firestore(firebaseApp);
            const sessionRef = firestore.collection('users').doc(uid)
                .collection('sessions').doc(currentSessionId);
            
            sessionRef.set({
                fcmToken: token,
                updatedAt: Date.now()
            }, { merge: true }).catch(e => {
                console.warn('[Push] Failed to write FCM token to session:', e);
            });
        } catch(e) {
            console.warn('[Push] Firestore FCM registration error:', e);
        }
    }
    window.writeFCMTokenToFirebaseSession = writeFCMTokenToFirebaseSession;

    function triggerBackgroundSync() {
        // Redundant background sync disabled in favor of real-time Firebase SDK Sync
        console.log('[BackgroundSync] Bypassed old sync flow in favor of real-time Firestore sync.');
    }

    window.addEventListener('online', () => {
        if (getCloudUID()) {
            initCloudSync();
        }
    });

    function getAllQuestions(){ return [...defaultQuestions, ...(localData.customQuestions || []).filter(q => !q.deleted)]; }
    function getCustomQuestions(){ return (localData.customQuestions || []).filter(q => !q.deleted); }
    function getValidWrongCount() {
        if (!localData || !localData.wrong) return 0;
        const allQ = getAllQuestions();
        const validIds = new Set(allQ.map(q => q.id));
        return localData.wrong.filter(id => validIds.has(id)).length;
    }
    function getValidBookmarkedCount() {
        if (!localData || !localData.bookmarked) return 0;
        const allQ = getAllQuestions();
        const validIds = new Set(allQ.map(q => q.id));
        return localData.bookmarked.filter(id => validIds.has(id)).length;
    }
    function getPromoDueCount() {
        return window.KrishiSM2Engine ? window.KrishiSM2Engine.getStats().dueCount : 0;
    }

    function getLocalDateString(date = new Date()) {
        let year = date.getFullYear();
        let month = String(date.getMonth() + 1).padStart(2, '0');
        let day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function shuffle(arr) {
        let copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    function getStreakCount(){
        let settings = getPlannerSettings();
        let restDays = settings.restDays || [6];
        let target = settings.dailyTarget || 30;
        let todayStr = getLocalDateString(new Date());
        
        let s = 0;
        let checkDate = new Date();
        
        // Loop backward up to 365 days
        for (let i = 0; i < 365; i++) {
            let stamp = getLocalDateString(checkDate);
            let dayData = localData.streak[stamp];
            let solved = dayData ? (dayData.solved || 0) : 0;
            
            if (stamp === todayStr) {
                if (solved >= target) {
                    s++;
                } else {
                    // Today's target is not complete yet, but do not break the streak.
                }
            } else {
                if (solved >= target) {
                    s++;
                } else if (restDays.includes(checkDate.getDay())) {
                    // Rest day configured! It is streak-safe. Keep checking earlier days.
                } else {
                    // Missed regular study day, streak breaks!
                    break;
                }
            }
            checkDate.setDate(checkDate.getDate() - 1);
        }
        return s;
    }

    // ==================== TOAST & THEME ====================
    function showToast(msg, dur=2000){
        let t=document.getElementById('toast'); if(!t) return;
        t.textContent=msg; t.style.opacity='1'; t.style.pointerEvents='auto';
        setTimeout(()=>{ t.style.opacity='0'; t.style.pointerEvents='none'; }, dur);
    }

    function syncSettingsToCloud(reason = 'Settings changed') {
        KrishiStorage.setItem('krishi_last_updated_at', Date.now());
        if (typeof scheduleCloudSync === 'function') {
            scheduleCloudSync(reason);
        }
    }
    window.syncSettingsToCloud = syncSettingsToCloud;

    // Per-setting write clocks.
    //
    // The document-level `updatedAt` cannot order an individual toggle: collectAllAppData()
    // re-stamps it with Date.now() on every single read, so `useCloud` in
    // mergeCloudAndLocalData() is effectively always false and the cloud could never win a
    // scalar. That is why turning dark mode ON propagated (the peer held no value, so
    // `local ?? cloud` had to fall through to the cloud) but turning it back OFF never did
    // (the peer now held 'true', so local always won and re-pushed its own stale value).
    // Each toggle therefore carries its own timestamp and merges on that clock alone.
    const SETTING_STAMPS_KEY = 'krishi_setting_stamps';
    function getSettingStamps() {
        const s = safeJsonParse(KrishiStorage.getItem(SETTING_STAMPS_KEY), {});
        return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
    }
    function stampSetting(field) {
        try {
            const stamps = getSettingStamps();
            stamps[field] = Date.now();
            KrishiStorage.setItem(SETTING_STAMPS_KEY, JSON.stringify(stamps));
        } catch (e) { /* a failed stamp must never block the setting itself */ }
    }
    window.stampSetting = stampSetting;

    function toggleDarkMode(){
        document.documentElement.classList.toggle('dark');
        KrishiStorage.setItem('krishi_dark', document.documentElement.classList.contains('dark'));
        stampSetting('dark');
        syncSettingsToCloud('Dark mode toggled');
        if (typeof applyCustomAppearanceAndLanguageSettings === 'function') {
            applyCustomAppearanceAndLanguageSettings();
        }
        showToast(document.documentElement.classList.contains('dark')?'🌙 Dark mode on':'☀️ Light mode on');
    }

    // ==================== NAVIGATION ====================
    function navigate(pageId){
        if (pageId !== 'page-practice') {
            stopTimer();
            if (state.perQuestionTimerInterval) {
                clearInterval(state.perQuestionTimerInterval);
                state.perQuestionTimerInterval = null;
            }
            let mcqPage = document.getElementById('page-mcq');
            if (mcqPage) mcqPage.classList.add('hidden');
            let resPanel = document.getElementById('practice-result-panel');
            if (resPanel) resPanel.classList.add('hidden');
            let activePanels = document.getElementById('practice-active-state-panels');
            if (activePanels) activePanels.classList.remove('hidden');

            // Defensively remove any stuck transition overlays
            let overlay1 = document.getElementById('shared-transition-overlay');
            if (overlay1) overlay1.remove();
            let overlay2 = document.getElementById('shared-transition-overlay-reverse');
            if (overlay2) overlay2.remove();
        }

        // Navigation weight map to determine left/right sliding directions
        const navIndexMap = {
            'page-home': 0,
            'page-profile': 0.5, // detail view opened from the Home header: forward from Home, back to Home
            'page-practice': 1, 'page-mock': 1, 'page-mock-config': 1, 'page-wrong-questions': 1, 'page-smart-scan': 1, 'page-file-scan': 1, 'page-edit-mcq': 1,
            'page-mcq-creator': 2,
            'page-analytics': 3,
            'page-study-planner': 4,
            'page-settings': 5, 'page-subject-manager': 5, 'page-admin': 5, 'page-tinder-swiper': 5
        };

        let activePage = document.querySelector('.page.active');
        let oldIdx = activePage ? (navIndexMap[activePage.id] !== undefined ? navIndexMap[activePage.id] : 0) : 0;
        let newIdx = navIndexMap[pageId] !== undefined ? navIndexMap[pageId] : 0;

        // Reset ALL pages: force hide all inactive pages and clear animation transitions
        // to prevent bleed-through and ensure absolute layout isolation.
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active', 'slide-in-right', 'slide-in-left', 'fade-in-transition', 'zoom-in-transition', 'no-transition');
            p.style.display = 'none'; // Force hide
            p.style.opacity = '';
            p.style.transition = '';
        });

        let target = document.getElementById(pageId);
        if(target) {
            target.classList.add('active');
            target.style.display = 'block'; // Force show

            // Trigger premium bi-directional transitions based on user customization
            if (activePage && activePage.id !== pageId) {
                let style = (window.EliteAnimsConfig && window.EliteAnimsConfig.pageTransitionStyle) || 'slide';
                const ps = typeof window.getPerfSettings === 'function' ? window.getPerfSettings() : {};
                if (ps.reduceMotion || ps.perfMode === 'battery') style = 'none';

                if (style === 'slide') {
                    let slideClass = newIdx > oldIdx ? 'slide-in-right' : 'slide-in-left';
                    target.classList.add(slideClass);
                    setTimeout(() => {
                        target.classList.remove(slideClass);
                    }, 360);
                } else if (style === 'fade') {
                    target.classList.add('fade-in-transition');
                    setTimeout(() => {
                        target.classList.remove('fade-in-transition');
                    }, 360);
                } else if (style === 'zoom') {
                    target.classList.add('zoom-in-transition');
                    setTimeout(() => {
                        target.classList.remove('zoom-in-transition');
                    }, 360);
                } else {
                    target.classList.add('no-transition');
                }
            } else {
                target.classList.add('no-transition');
            }
        }

        document.querySelectorAll('.nav-item').forEach(n => {
            n.style.color='var(--text-secondary)';
            n.classList.remove('dock-active');
        });
        // Reset More button highlight
        let moreBtn = document.getElementById('nav-btn-more');
        if (moreBtn) moreBtn.classList.remove('more-btn-highlight');

        // Reset Header Settings Highlight
        let headerSettingsBtn = document.getElementById('header-settings-btn');
        if (headerSettingsBtn) {
            headerSettingsBtn.style.transform = 'none';
            headerSettingsBtn.style.opacity = '0.75';
            headerSettingsBtn.style.filter = 'none';
        }

        // Reset sheet item active states
        document.querySelectorAll('.sheet-nav-item').forEach(el => el.classList.remove('sheet-item-active'));

        let map={
            'page-home': 0, 'page-practice': 1, 'page-mock': 1, 'page-mock-config': 1,
            'page-wrong-questions': 1, 'page-smart-scan': 1, 'page-file-scan': 1, 'page-edit-mcq': 1,
            'page-mcq-creator': 2, 'page-analytics': 3, 'page-study-planner': 'planner',
            // Sheet pages — highlight the More (⋯) button
            'page-settings': 'more',
            'page-subject-manager': 'more', 'page-admin': 'more',
            'page-tinder-swiper': 'more'
        };
        let index = map[pageId];
        if(index !== undefined){
            if (index === 'more') {
                // Highlight More button for sheet-level pages
                if (moreBtn) moreBtn.classList.add('more-btn-highlight');
                if (headerSettingsBtn) {
                    headerSettingsBtn.style.transform = 'scale(1.18) rotate(35deg)';
                    headerSettingsBtn.style.opacity = '1';
                    headerSettingsBtn.style.filter = 'drop-shadow(0 0 10px var(--primary))';
                }
                // Highlight the matching sheet nav item
                let sheetMap = {
                    'page-settings': 'sheet-nav-settings',
                    'page-subject-manager': 'sheet-nav-settings',
                    'page-admin': 'sheet-nav-admin',
                    'page-tinder-swiper': 'sheet-nav-tinder'
                };
                let sheetItemId = sheetMap[pageId];
                if (sheetItemId) {
                    let sheetItem = document.getElementById(sheetItemId);
                    if (sheetItem) sheetItem.classList.add('sheet-item-active');
                }
            } else if (index === 'planner') {
                let activeNavBtn = document.getElementById('nav-btn-planner');
                if(activeNavBtn) {
                    activeNavBtn.style.color='var(--primary)';
                    activeNavBtn.classList.add('dock-active');
                }
            } else {
                let activeNavBtn = document.getElementById('nav-btn-'+index);
                if(activeNavBtn) {
                    activeNavBtn.style.color='var(--primary)';
                    activeNavBtn.classList.add('dock-active');
                }
            }

            // Also dynamically update active visual style on desktop sidebar links
            document.querySelectorAll('.sidebar-nav-item').forEach(el => {
                el.style.color = 'var(--text-secondary)';
                el.classList.remove('bg-emerald-50', 'dark:bg-emerald-950/20');
            });
            // Map sheet pages back to sidebar-nav-btn index
            let sidebarIndex = (index === 'more') ? ({'page-settings':5,'page-subject-manager':5,'page-admin':5,'page-tinder-swiper':5}[pageId]) : (index === 'planner' ? 4 : index);
            let activeSidebarBtn = document.getElementById('sidebar-nav-btn-'+sidebarIndex);
            if(activeSidebarBtn) {
                activeSidebarBtn.style.color = 'var(--primary)';
                activeSidebarBtn.classList.add('bg-emerald-50', 'dark:bg-emerald-950/20');
            }
        }

        if(pageId==='page-home') {
            // Remove sync-render animation suppression so entrance animations play on navigation
            const _hwc = document.getElementById('home-widgets-container');
            if (_hwc) _hwc.classList.remove('krishi-sync-update');
            updateHomePage();
        }
        if(pageId==='page-practice') updatePracticePage();
        if(pageId==='page-profile') refreshProfilePage();
        if(pageId==='page-analytics') updateEnhancedAnalyticsPage();
        if(pageId==='page-wrong-questions') renderWrongPage();
        if(pageId==='page-settings') loadApiKeyInput();
        if(pageId==='page-file-scan') { toggleAIButtonVisibility(); loadApiKeyInput(); }
        if(pageId==='page-subject-manager') renderSubjectList();
        if(pageId==='page-admin') populateAdminSubjects();
        if(pageId==='page-mock-config') populateMockSubjectFilter();
        if(pageId==='page-study-planner') refreshPlannerPage();
        if(pageId==='page-mcq-creator') {
            Promise.resolve(initCreatorPage()).then(() => switchCreatorTab(currentCreatorTab));
        }

        // Always update the stats ribbon on every navigate
        if (typeof updateStatsRibbon === 'function') updateStatsRibbon();

        const ps = getPerfSettings();
        const scrollBehavior = (ps.reduceMotion || ps.perfMode === 'battery') ? 'auto' : 'smooth';
        window.scrollTo({top:0, behavior: scrollBehavior});
    }

    // ==================== UNIFIED SHELL: BOTTOM SHEET ====================
    window.toggleNavSheet = function() {};
    window.closeNavSheet = function() {};

    // ==================== UNIFIED SHELL: STATS RIBBON ====================
    window.updateStatsRibbon = function() {
        if (typeof window.updateProgressionUI === 'function') window.updateProgressionUI();
        try {
            const today = getLocalDateString();
            const todayData = (localData.streak && localData.streak[today]) || {};

            // 1. Streak count
            const streakCount = typeof getStreakCount === 'function' ? getStreakCount() : 0;

            // 2. Today's accuracy
            const solved = todayData.solved || 0;
            const correct = todayData.correct || 0;
            const accuracy = solved > 0 ? Math.round((correct / solved) * 100) : null;

            // 3. Update ribbon (mobile)
            const ribbonStreak = document.getElementById('ribbon-streak');
            const ribbonAccuracy = document.getElementById('ribbon-accuracy');
            const ribbonToday = document.getElementById('ribbon-today');
            if (ribbonStreak) ribbonStreak.textContent = streakCount;
            if (ribbonAccuracy) ribbonAccuracy.textContent = accuracy !== null ? accuracy + '%' : '--%';
            if (ribbonToday) ribbonToday.textContent = solved;

            // Toggle active streak combustion class on fire indicators
            let isAnims = KrishiStorage.getItem('krishi_elite_animations') !== 'false';
            let fireBadges = [
                document.getElementById('ribbon-streak'),
                document.getElementById('sidebar-streak-badge'),
                document.getElementById('sidebar-stat-streak'),
                document.getElementById('hybrid-streak-badge'),
                document.getElementById('planner-streak-count')
            ];
            
            fireBadges.forEach(el => {
                if (el) {
                    if (isAnims && streakCount > 0) {
                        el.classList.add('streak-on-fire');
                    } else {
                        el.classList.remove('streak-on-fire');
                    }
                }
            });

            // 4. Update desktop sidebar stats
            const sidebarStreak = document.getElementById('sidebar-stat-streak');
            const sidebarAccuracy = document.getElementById('sidebar-stat-accuracy');
            const sidebarToday = document.getElementById('sidebar-stat-today');
            if (sidebarStreak) sidebarStreak.textContent = streakCount + ' days';
            if (sidebarAccuracy) sidebarAccuracy.textContent = accuracy !== null ? accuracy + '%' : '--%';
            if (sidebarToday) sidebarToday.textContent = solved + ' Qs';

            // 5. Update sheet user sub-text with today's progress
            const sheetSub = document.getElementById('sheet-user-sub');
            if (sheetSub) {
                sheetSub.textContent = solved > 0
                    ? `🔥 ${streakCount} day streak • ${solved} Qs today`
                    : 'आजको तयारी जारी राखौँ';
            }
        } catch(e) {
            // Silent fail — ribbon is non-critical UI
        }
    };


    // ==================== FLUID TRANSITIONS GENERATOR ====================
    function animateQuestionTransition(actionCallback) {
        let card = document.getElementById('mcq-card-container');
        if (!card) {
            actionCallback();
            return;
        }
        let origTransition = card.style.transition;
        const ps = getPerfSettings();
        if (ps.reduceMotion || ps.animIntensity === 'off' || ps.perfMode === 'battery') {
            actionCallback();
            return;
        }
        // Transform+opacity only (avoid layout-heavy "all"), and avoid forced reflow.
        card.style.transition = 'transform 150ms ease-in, opacity 150ms ease-in';
        card.style.transform = 'translateY(6px) scale(0.98)';
        card.style.opacity = '0';

        requestAnimationFrame(() => {
            setTimeout(() => {
                actionCallback();
                // Prime next state
                card.style.transition = 'none';
                card.style.transform = 'translateY(-6px) scale(1.02)';
                card.style.opacity = '0';

                requestAnimationFrame(() => {
                    card.style.transition = 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms cubic-bezier(0.16, 1, 0.3, 1)';
                    card.style.transform = 'translateY(0) scale(1)';
                    card.style.opacity = '1';
                    setTimeout(() => { card.style.transition = origTransition; }, 280);
                });
            }, 150);
        });
    }

    function transitionMcqToResult() {
        let source = document.getElementById('mcq-card-container');
        let targetPage = document.getElementById('page-practice');
        let sourcePage = document.getElementById('page-mcq');
        
        if (!source || !targetPage || !sourcePage) {
            let resPanel = document.getElementById('practice-result-panel');
            if (resPanel) resPanel.classList.remove('hidden');
            let activePanels = document.getElementById('practice-active-state-panels');
            if (activePanels) activePanels.classList.add('hidden');
            navigate('page-practice');
            return;
        }

        let sourceRect = source.getBoundingClientRect();
        
        // Setup transition overlay
        let overlay = document.createElement('div');
        overlay.id = 'shared-transition-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'none';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
        overlay.style.transition = 'background-color 0.4s ease-out';
        document.body.appendChild(overlay);

        // Create morphological transition card
        let morphCard = document.createElement('div');
        morphCard.id = 'shared-morph-card';
        morphCard.style.position = 'fixed';
        morphCard.style.left = sourceRect.left + 'px';
        morphCard.style.top = sourceRect.top + 'px';
        morphCard.style.width = sourceRect.width + 'px';
        morphCard.style.height = sourceRect.height + 'px';
        morphCard.style.margin = '0';
        morphCard.style.boxSizing = 'border-box';
        morphCard.style.zIndex = '10000';
        morphCard.style.transition = 'all 0.55s cubic-bezier(0.34, 1.3, 0.64, 1)';
        
        let isDark = document.documentElement.classList.contains('dark');
        morphCard.style.background = isDark ? '#1e293b' : '#ffffff';
        morphCard.style.border = '1px solid ' + (isDark ? '#334155' : '#e2e8f0');
        morphCard.style.borderRadius = '1.5rem';
        morphCard.style.boxShadow = '0 12px 30px -10px rgba(0, 0, 0, 0.15)';
        morphCard.style.overflow = 'hidden';
        morphCard.style.opacity = '1';
        
        morphCard.innerHTML = `
            <div class="p-5 flex flex-col justify-center items-center h-full text-center space-y-4 transition-opacity duration-200" id="morph-content-source">
                <span class="text-3xl animate-bounce">📊</span>
                <p class="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Generating Your Report Card...</p>
            </div>
        `;
        overlay.appendChild(morphCard);

        sourcePage.style.transition = 'opacity 0.2s ease';
        sourcePage.style.opacity = '0';

        // Set up accuracy chart empty start state
        let circle = document.getElementById('result-circle-fill');
        if (circle) {
            circle.style.strokeDashoffset = '290';
        }

        // Toggle sub-panels within the Practice page
        let resPanel = document.getElementById('practice-result-panel');
        if (resPanel) resPanel.classList.remove('hidden');
        let activePanels = document.getElementById('practice-active-state-panels');
        if (activePanels) activePanels.classList.add('hidden');
        let emptyState = document.getElementById('practice-empty-state');
        if (emptyState) emptyState.classList.add('hidden');

        // Activate the Practice page via the router
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none'; // Force hide
            p.style.opacity = '';
            p.style.transition = '';
        });
        targetPage.classList.add('active');
        targetPage.style.display = 'block'; // Force show

        document.querySelectorAll('.nav-item').forEach(n=>n.style.color='var(--text-secondary)');
        let activeNavBtn = document.getElementById('nav-btn-1'); 
        if(activeNavBtn) activeNavBtn.style.color='var(--primary)';

        window.scrollTo({top:0, behavior:'auto'});

        requestAnimationFrame(() => {
            let targetCard = document.getElementById('result-card-container');
            if (!targetCard) {
                overlay.remove();
                sourcePage.style.opacity = '1';
                sourcePage.classList.add('hidden');
                return;
            }

            let targetRect = targetCard.getBoundingClientRect();
            targetCard.style.opacity = '0';

            requestAnimationFrame(() => {
                overlay.style.backgroundColor = isDark ? 'rgba(15, 23, 42, 0.3)' : 'rgba(240, 253, 244, 0.3)';
                morphCard.style.left = targetRect.left + 'px';
                morphCard.style.top = targetRect.top + 'px';
                morphCard.style.width = targetRect.width + 'px';
                morphCard.style.height = targetRect.height + 'px';

                setTimeout(() => {
                    let morphContent = document.getElementById('morph-content-source');
                    if (morphContent) {
                        morphContent.style.opacity = '0';
                        setTimeout(() => {
                            let finalAccuracy = document.getElementById('res-accuracy') ? document.getElementById('res-accuracy').textContent : '0%';
                            morphContent.innerHTML = `
                                <div class="flex flex-col items-center justify-center h-full text-center">
                                    <span class="text-3xl font-black text-emerald-500 transition duration-300 scale-110">${finalAccuracy}</span>
                                    <span class="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Compiling Achievements...</span>
                                </div>
                            `;
                            morphContent.style.opacity = '1';
                        }, 120);
                    }
                }, 180);

                setTimeout(() => {
                    targetCard.style.transition = 'opacity 0.25s ease';
                    targetCard.style.opacity = '1';

                    let accText = document.getElementById('res-accuracy') ? document.getElementById('res-accuracy').textContent : '0%';
                    let accVal = parseInt(accText) || 0;
                    let fillCircle = document.getElementById('result-circle-fill');
                    if (fillCircle) {
                        let offsetVal = 290 - (290 * accVal) / 100;
                        fillCircle.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)';
                        fillCircle.style.strokeDashoffset = offsetVal;
                    }

                    morphCard.style.opacity = '0';
                    overlay.style.backgroundColor = 'rgba(0,0,0,0)';

                    setTimeout(() => {
                        overlay.remove();
                        // Clear all inline styles from transition so CSS controls display
                        sourcePage.style.opacity = '';
                        sourcePage.style.transition = '';
                        sourcePage.classList.add('hidden');
                        targetCard.style.transition = '';
                        targetCard.style.opacity = '';
                    }, 250);

                }, 550);
            });
        });
    }

    function transitionResultToMcq(pool, isMock, timerSec) {
        let source = document.getElementById('result-card-container');
        let targetPage = document.getElementById('page-mcq');
        let sourcePage = document.getElementById('practice-result-panel');

        if (!source || !targetPage || !sourcePage) {
            let resPanel = document.getElementById('practice-result-panel');
            if (resPanel) resPanel.classList.add('hidden');
            let activePanels = document.getElementById('practice-active-state-panels');
            if (activePanels) activePanels.classList.remove('hidden');
            setupMCQSession(pool, isMock, timerSec);
            return;
        }

        let sourceRect = source.getBoundingClientRect();

        let overlay = document.createElement('div');
        overlay.id = 'shared-transition-overlay-reverse';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'none';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
        overlay.style.transition = 'background-color 0.4s ease-out';
        document.body.appendChild(overlay);

        let morphCard = document.createElement('div');
        morphCard.id = 'shared-morph-card-reverse';
        morphCard.style.position = 'fixed';
        morphCard.style.left = sourceRect.left + 'px';
        morphCard.style.top = sourceRect.top + 'px';
        morphCard.style.width = sourceRect.width + 'px';
        morphCard.style.height = sourceRect.height + 'px';
        morphCard.style.margin = '0';
        morphCard.style.boxSizing = 'border-box';
        morphCard.style.zIndex = '10000';
        morphCard.style.transition = 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
        
        let isDark = document.documentElement.classList.contains('dark');
        morphCard.style.background = isDark ? '#1e293b' : '#ffffff';
        morphCard.style.border = '1px solid ' + (isDark ? '#334155' : '#e2e8f0');
        morphCard.style.borderRadius = '1.5rem';
        morphCard.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.1)';
        morphCard.style.overflow = 'hidden';
        morphCard.style.opacity = '1';

        morphCard.innerHTML = `
            <div class="p-5 flex flex-col justify-center items-center h-full text-center space-y-4 transition-opacity duration-200" id="morph-content-reverse">
                <span class="text-3xl animate-spin">🔄</span>
                <p class="text-xs font-black text-slate-500 uppercase tracking-widest">Rebuilding Practice Arena...</p>
            </div>
        `;
        overlay.appendChild(morphCard);

        sourcePage.style.transition = 'opacity 0.2s ease';
        sourcePage.style.opacity = '0';

        // Hide result sub-panel and hide selectors as we are starting gameplay
        let resPanel = document.getElementById('practice-result-panel');
        if (resPanel) resPanel.classList.add('hidden');
        let activePanels = document.getElementById('practice-active-state-panels');
        if (activePanels) activePanels.classList.add('hidden');

        // Setup the MCQ gameplay config without triggering normal navigate
        setupMCQSession(pool, isMock, timerSec, true);

        targetPage.classList.remove('hidden');

        // Keep page-practice active globally — clear any inline styles left by prior transitions
        let practicePage = document.getElementById('page-practice');
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none'; // Force hide
            p.style.opacity = '';
            p.style.transition = '';
        });
        if (practicePage) {
            practicePage.classList.add('active');
            practicePage.style.display = 'block'; // Force show
        }

        document.querySelectorAll('.nav-item').forEach(n => n.style.color = 'var(--text-secondary)');
        let activeNavBtn = document.getElementById('nav-btn-1');
        if (activeNavBtn) activeNavBtn.style.color = 'var(--primary)';

        window.scrollTo({top: 0, behavior: 'auto'});

        requestAnimationFrame(() => {
            let destCard = document.getElementById('mcq-card-container');
            if (!destCard) {
                overlay.remove();
                sourcePage.style.opacity = '';
                sourcePage.style.transition = '';
                sourcePage.classList.add('hidden');
                return;
            }

            let destRect = destCard.getBoundingClientRect();
            destCard.style.opacity = '0';

            requestAnimationFrame(() => {
                overlay.style.backgroundColor = isDark ? 'rgba(15, 23, 42, 0.03)' : 'rgba(240, 253, 244, 0.03)';
                morphCard.style.left = destRect.left + 'px';
                morphCard.style.top = destRect.top + 'px';
                morphCard.style.width = destRect.width + 'px';
                morphCard.style.height = destRect.height + 'px';

                setTimeout(() => {
                    let textContent = document.getElementById('morph-content-reverse');
                    if (textContent) {
                        textContent.style.opacity = '0';
                        setTimeout(() => {
                            textContent.innerHTML = `
                                <div class="flex flex-col items-center justify-center h-full text-center">
                                    <span class="text-3xl text-emerald-500 font-bold">🎯 Question 1</span>
                                    <span class="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Ready to begin</span>
                                </div>
                            `;
                            textContent.style.opacity = '1';
                        }, 120);
                    }
                }, 180);

                setTimeout(() => {
                    destCard.style.transition = 'opacity 0.25s ease';
                    destCard.style.opacity = '1';

                    morphCard.style.opacity = '0';
                    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';

                    setTimeout(() => {
                        overlay.remove();
                        // Clear all inline styles so CSS fully controls display
                        sourcePage.style.opacity = '';
                        sourcePage.style.transition = '';
                        sourcePage.classList.add('hidden');
                        destCard.style.transition = '';
                        destCard.style.opacity = '';
                    }, 250);

                }, 500);
            });
        });
    }

    // ==================== WEB AUDIO API SYNTHESIZER ====================
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playSound(type) {
        let soundEnabled = KrishiStorage.getItem('krishi_sound_enabled') !== 'false';
        let soundMuted = KrishiStorage.getItem('krishi_sound_muted') === 'true';
        let rawVol = KrishiStorage.getItem('krishi_sound_volume');
        let volume = rawVol !== null ? parseFloat(rawVol) : 0.5;

        if (!soundEnabled || soundMuted || volume <= 0) return;

        try {
            let ctx = getAudioContext();
            let osc = ctx.createOscillator();
            let gainNode = ctx.createGain();
            osc.connect(gainNode);
            gainNode.connect(ctx.destination);
            let now = ctx.currentTime;

            if (type === 'click') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
                gainNode.gain.setValueAtTime(0.12 * volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                osc.start(now);
                osc.stop(now + 0.08);
            } else if (type === 'correct') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.setValueAtTime(659.25, now + 0.12); // E5
                osc.frequency.setValueAtTime(783.99, now + 0.24); // G5
                gainNode.gain.setValueAtTime(0.2 * volume, now);
                gainNode.gain.setValueAtTime(0.2 * volume, now + 0.24);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
                osc.start(now);
                osc.stop(now + 0.45);
            } else if (type === 'wrong') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180, now);
                osc.frequency.linearRampToValueAtTime(110, now + 0.35);
                gainNode.gain.setValueAtTime(0.18 * volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.35);
            } else if (type === 'countdown') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                gainNode.gain.setValueAtTime(0.08 * volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                osc.start(now);
                osc.stop(now + 0.05);
            } else if (type === 'celebrate') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
                osc.frequency.exponentialRampToValueAtTime(1760, now + 0.3);
                gainNode.gain.setValueAtTime(0.25 * volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
                osc.start(now);
                osc.stop(now + 0.55);
            }
        } catch (e) {
            console.warn("Synth skipped in this context", e);
        }
    }

    // ==================== SOUNDS CONFIG HANDLERS ====================
    function initPracticeSoundSettings() {
        let enabled = KrishiStorage.getItem('krishi_sound_enabled') !== 'false';
        let muted = KrishiStorage.getItem('krishi_sound_muted') === 'true';
        let rawVol = KrishiStorage.getItem('krishi_sound_volume');
        let volume = rawVol !== null ? parseFloat(rawVol) : 0.5;

        let elEnabled = document.getElementById('sound-enabled');
        if (elEnabled) elEnabled.checked = enabled;

        let elMuted = document.getElementById('sound-mute');
        if (elMuted) elMuted.checked = muted;

        let elVol = document.getElementById('sound-volume');
        if (elVol) elVol.value = volume;

        let txt = document.getElementById('sound-vol-txt');
        if (txt) txt.textContent = Math.round(volume * 100) + '%';
        
        toggleSoundConfigDetailsBlock(enabled);
    }

    // ==================== PERFORMANCE SETTINGS UI ====================
    function initPerfSettingsUI() {
        const s = getPerfSettings();
        const animSel = document.getElementById('perf-anim-intensity');
        const modeSel = document.getElementById('perf-mode');
        const reduceChk = document.getElementById('perf-reduce-motion');
        const soundChk = document.getElementById('perf-sound-effects');

        if (animSel) {
            animSel.value = s.animIntensity;
            animSel.onchange = () => savePerfSettings({ animIntensity: animSel.value });
        }
        if (modeSel) {
            modeSel.value = s.perfMode;
            modeSel.onchange = () => savePerfSettings({ perfMode: modeSel.value });
        }
        if (reduceChk) {
            reduceChk.checked = !!s.reduceMotion;
            reduceChk.onchange = () => savePerfSettings({ reduceMotion: reduceChk.checked });
        }

        // Sound effects toggle mirrors the existing sound system (krishi_sound_enabled)
        const enabled = KrishiStorage.getItem('krishi_sound_enabled') !== 'false';
        if (soundChk) {
            soundChk.checked = enabled;
            soundChk.onchange = () => {
                setSoundEnabledSetting(soundChk.checked);
                savePerfSettings({ soundEffects: soundChk.checked });
            };
        }

        // Keep perf settings stored (even if user never opens Settings page)
        Storage.setJSON('krishi_perf_settings', s);

        // Premium Hybrid Layout toggle initialization
        const hybridChk = document.getElementById('perf-premium-hybrid');
        const hybridEnabled = KrishiStorage.getItem('krishi_premium_hybrid') !== 'false';
        if (hybridChk) {
            hybridChk.checked = hybridEnabled;
        }
        applyPremiumHybridStyles(hybridEnabled);
    }

    window.togglePremiumHybridLayout = function(isEnabled) {
        KrishiStorage.setItem('krishi_premium_hybrid', isEnabled ? 'true' : 'false');
        if (typeof showToast === 'function') {
            showToast(isEnabled ? '✨ Premium Hybrid Layout enabled!' : '⚙️ Classic Layout restored!');
        }
        applyPremiumHybridStyles(isEnabled);
        if (typeof triggerHaptic === 'function') {
            triggerHaptic('click');
        }
    };

    function applyPremiumHybridStyles(isEnabled) {
        if (isEnabled) {
            document.documentElement.classList.add('premium-hybrid-active');
        } else {
            document.documentElement.classList.remove('premium-hybrid-active');
        }
    }

    window.confirmExitExam = function() {
        if (confirm("के तपाईं यो अभ्यास सत्रबाट बाहिरिन चाहनुहुन्छ?")) {
            if (typeof stopTimer === 'function') stopTimer();
            if (state.perQuestionTimerInterval) {
                clearInterval(state.perQuestionTimerInterval);
                state.perQuestionTimerInterval = null;
            }
            navigate('page-practice');
        }
    };

    window.switchHybridDashboardTab = function(tabId) {
        let btnTasks = document.getElementById('hybrid-dash-tab-tasks');
        let btnExams = document.getElementById('hybrid-dash-tab-exams');
        
        if (tabId === 'tasks') {
            if (btnTasks) btnTasks.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400 cursor-pointer";
            if (btnExams) btnExams.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer";
            
            // Show daily active profile and normal widgets
            let targetCard = document.getElementById('home-active-profile-card');
            if (targetCard) targetCard.classList.remove('hidden');
            let widgetsContainer = document.getElementById('home-widgets-container');
            if (widgetsContainer) widgetsContainer.classList.remove('hidden');
            
            // Hide exams shortcut card
            let mockGroup = document.getElementById('hybrid-exams-shortcut-card');
            if (mockGroup) mockGroup.classList.add('hidden');
        } else {
            if (btnTasks) btnTasks.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer";
            if (btnExams) btnExams.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400 cursor-pointer";
            
            // Hide daily target cards and daily widgets
            let targetCard = document.getElementById('home-active-profile-card');
            if (targetCard) targetCard.classList.add('hidden');
            let widgetsContainer = document.getElementById('home-widgets-container');
            if (widgetsContainer) widgetsContainer.classList.add('hidden');
            
            // Show exams shortcut card
            let mockGroup = document.getElementById('hybrid-exams-shortcut-card');
            if (mockGroup) mockGroup.classList.remove('hidden');
        }
        
        if (typeof triggerHaptic === 'function') {
            triggerHaptic('click');
        }
    };

    function syncPerfSoundToggle() {
        const enabled = KrishiStorage.getItem('krishi_sound_enabled') !== 'false';
        const soundChk = document.getElementById('perf-sound-effects');
        if (soundChk) soundChk.checked = enabled;
    }

    function setSoundEnabledSetting(enabled) {
        KrishiStorage.setItem('krishi_sound_enabled', enabled ? 'true' : 'false');
        const elEnabled = document.getElementById('sound-enabled');
        if (elEnabled) elEnabled.checked = enabled;
        toggleSoundConfigDetailsBlock(enabled);
        syncSettingsToCloud('Sound preference updated');
    }

    function toggleSoundEnabledSetting() {
        let chk = document.getElementById('sound-enabled');
        if (!chk) return;
        KrishiStorage.setItem('krishi_sound_enabled', chk.checked ? 'true' : 'false');
        toggleSoundConfigDetailsBlock(chk.checked);
        syncPerfSoundToggle();
        playSound('click');
        syncSettingsToCloud('Sound toggled');
    }

    function toggleSoundConfigDetailsBlock(show) {
        let container = document.getElementById('sound-controls-details');
        if (container) {
            if (show) container.classList.remove('opacity-50', 'pointer-events-none');
            else container.classList.add('opacity-50', 'pointer-events-none');
        }
    }

    function changeSoundVolumeSetting(val) {
        KrishiStorage.setItem('krishi_sound_volume', val);
        let txt = document.getElementById('sound-vol-txt');
        if (txt) txt.textContent = Math.round(val * 100) + '%';
        syncSettingsToCloud('Sound volume adjusted');
    }

    function toggleSoundMutedSetting() {
        let chk = document.getElementById('sound-mute');
        if (!chk) return;
        KrishiStorage.setItem('krishi_sound_muted', chk.checked ? 'true' : 'false');
        playSound('click');
        syncSettingsToCloud('Sound mute state toggled');
    }

    function testAppSynthSound() {
        playSound('correct');
    }

    // ==================== PRACTICE / EXAMS SETUP ====================
    function startPractice(sub, cnt){
        if (isTransitioning) return;
        isTransitioning = true;
        setTimeout(() => isTransitioning = false, 1000);
        
        stopTimer();
        let pool = getAllQuestions();
        if(sub!=='all') pool = pool.filter(q=>(q.sub || "").trim().toLowerCase() === (sub || "").trim().toLowerCase());
        pool = shuffle(pool).slice(0, Math.min(cnt, pool.length));
        if(pool.length===0){ showToast('No questions available in this category!'); return; }
        
        setupMCQSession(pool, false, 0);
    }

    function startPracticeCustomOnly(){
        stopTimer();
        let pool=getCustomQuestions();
        if(pool.length===0){ showToast('No custom questions yet! Add some first.'); return; }
        pool=shuffle(pool).slice(0, Math.min(20, pool.length));
        setupMCQSession(pool, false, 0);
    }

    function startMockTest(cnt, mins){
        stopTimer();
        let pool = shuffle(getAllQuestions()).slice(0, cnt);
        state.activeConfig = { subject: 'all', topic: 'all', difficulty: 'all', count: cnt, timer: 'on', timerMin: mins, perQTimer: 'off', perQSec: 0, negativeMarking: 'on', feedback: 'end', shuffleQs: true, shuffleOpts: true, isMock: true };
        setupMCQSession(pool, true, mins * 60);
    }

    function startConfiguredMock(){
        let cnt = parseInt(document.getElementById('mock-q-count').value)||30;
        let mins = parseInt(document.getElementById('mock-time').value)||30;
        let sub = document.getElementById('mock-subject').value;
        let pool = getAllQuestions();
        if(sub!=='all') pool=pool.filter(q=>(q.sub || "").trim().toLowerCase() === (sub || "").trim().toLowerCase());
        pool = shuffle(pool).slice(0, Math.min(cnt, pool.length));
        if(pool.length===0){ showToast('No questions matched filters!'); return; }
        state.activeConfig = { subject: sub, topic: 'all', difficulty: 'all', count: cnt, timer: 'on', timerMin: mins, perQTimer: 'off', perQSec: 0, negativeMarking: 'on', feedback: 'end', shuffleQs: true, shuffleOpts: true, isMock: true };
        setupMCQSession(pool, true, mins * 60);
    }

    // ==================== ADVANCED CONFIG HANDLERS ====================
    function openPracticeSetupPage(preSelectedSubject = 'all', preSelectedTopic = 'all') {
        navigate('page-practice-config');
        
        // Populate subject options dropdown
        let subSel = document.getElementById('prac-cfg-subject');
        let previousVal = subSel.value;
        subSel.innerHTML = '<option value="all">All Subjects combined</option>';
        getAllSubjects().forEach(sub => {
            subSel.innerHTML += `<option value="${sub}">${sub}</option>`;
        });
        
        // Match selection
        if (preSelectedSubject !== 'all') {
            subSel.value = preSelectedSubject;
        } else {
            subSel.value = 'all';
        }
        
        onPracticeSubjectChanged(preSelectedTopic);
        
        // Load configurations
        // Load configurations
        let rawLast = KrishiStorage.getItem('krishi_last_practice_config');
        if (rawLast && preSelectedSubject === 'all') {
            try {
                let conf = JSON.parse(rawLast);
                subSel.value = conf.subject || 'all';
                onPracticeSubjectChanged(conf.topic || 'all');
                
                document.getElementById('prac-cfg-difficulty').value = conf.difficulty || 'all';
                document.getElementById('prac-cfg-count').value = conf.count || 20;
                document.getElementById('prac-cfg-count').dispatchEvent(new Event('input'));
                document.getElementById('prac-cfg-timer').value = conf.timer || 'off';
                document.getElementById('prac-cfg-timer-min').value = conf.timerMin || 20;
                document.getElementById('prac-cfg-per-q-timer').value = conf.perQTimer || 'off';
                document.getElementById('prac-cfg-per-q-sec').value = conf.perQSec || 30;
                document.getElementById('prac-cfg-neg-marking').value = conf.negativeMarking || 'off';
                document.getElementById('prac-cfg-feedback').value = conf.feedback || 'immediate';
                document.getElementById('prac-cfg-shuffle-qs').checked = conf.shuffleQs !== false;
                document.getElementById('prac-cfg-shuffle-opts').checked = conf.shuffleOpts !== false;
                
                document.getElementById('prac-cfg-inc-wrong').checked = conf.incWrong !== false;
                document.getElementById('prac-cfg-inc-bookmarks').checked = conf.incBookmarks !== false;
                document.getElementById('prac-cfg-inc-unattempted').checked = conf.incUnattempted !== false;
                document.getElementById('prac-cfg-inc-custom').checked = conf.incCustom !== false;
            } catch(ex) {
                console.warn("Failed restoring practice configurations", ex);
            }
        } else {
            // Explicitly reset filters so previous state does not leak into a new subject selection
            document.getElementById('prac-cfg-difficulty').value = 'all';
            document.getElementById('prac-cfg-count').value = 20;
            document.getElementById('prac-cfg-count').dispatchEvent(new Event('input'));
            document.getElementById('prac-cfg-timer').value = 'off';
            document.getElementById('prac-cfg-timer-min').value = 20;
            document.getElementById('prac-cfg-per-q-timer').value = 'off';
            document.getElementById('prac-cfg-per-q-sec').value = 30;
            document.getElementById('prac-cfg-neg-marking').value = 'off';
            document.getElementById('prac-cfg-feedback').value = 'immediate';
            document.getElementById('prac-cfg-shuffle-qs').checked = true;
            document.getElementById('prac-cfg-shuffle-opts').checked = true;
            document.getElementById('prac-cfg-inc-wrong').checked = true;
            document.getElementById('prac-cfg-inc-bookmarks').checked = true;
            document.getElementById('prac-cfg-inc-unattempted').checked = true;
            document.getElementById('prac-cfg-inc-custom').checked = true;
        }
        
        toggleConfigTimerFields();
        toggleConfigPerQTimerFields();
        updateSizingDiagnosticsInSetup();
    }

    function toggleConfigTimerFields() {
        let val = document.getElementById('prac-cfg-timer').value;
        document.getElementById('prac-cfg-timer-min-container').classList.toggle('hidden', val !== 'on');
    }

    function toggleConfigPerQTimerFields() {
        let val = document.getElementById('prac-cfg-per-q-timer').value;
        document.getElementById('prac-cfg-per-q-sec-container').classList.toggle('hidden', val !== 'on');
    }

    function onPracticeSubjectChanged(targetTopicToSet = 'all') {
        let sub = document.getElementById('prac-cfg-subject').value;
        let topicSel = document.getElementById('prac-cfg-topic');
        topicSel.innerHTML = '<option value="all">All Topics combined</option>';
        
        // Filter unique topics in this subject
        let allQ = getAllQuestions();
        let uniqueTopics = new Set();
        allQ.forEach(q => {
            if ((sub === 'all' || (q.sub || "").trim().toLowerCase() === (sub || "").trim().toLowerCase()) && q.topic) {
                uniqueTopics.add(q.topic.trim());
            }
        });
        
        [...uniqueTopics].sort().forEach(top => {
            topicSel.innerHTML += `<option value="${top}">${top}</option>`;
        });
        
        topicSel.value = targetTopicToSet;
        updateSizingDiagnosticsInSetup();
    }

    function updateSizingDiagnosticsInSetup() {
        // Load metrics counting
        document.getElementById('prac-cfg-cnt-wrong').textContent = getValidWrongCount();
        document.getElementById('prac-cfg-cnt-bookmarks').textContent = localData.bookmarked.length;
        document.getElementById('prac-cfg-cnt-custom').textContent = getCustomQuestions().length;
        
        // Count unattempted items
        let loggedIds = new Set(timingLog.map(l => l.qid));
        let unattemptedCount = getAllQuestions().filter(q => !loggedIds.has(q.id)).length;
        document.getElementById('prac-cfg-cnt-unattempt').textContent = unattemptedCount;
    }

    function startAdvancedConfiguredPractice() {
        let subject = document.getElementById('prac-cfg-subject').value;
        let topic = document.getElementById('prac-cfg-topic').value;
        let difficulty = document.getElementById('prac-cfg-difficulty').value;
        let count = parseInt(document.getElementById('prac-cfg-count').value) || 20;
        let timer = document.getElementById('prac-cfg-timer').value;
        let timerMin = parseInt(document.getElementById('prac-cfg-timer-min').value) || 20;
        let perQTimer = document.getElementById('prac-cfg-per-q-timer').value;
        let perQSec = parseInt(document.getElementById('prac-cfg-per-q-sec').value) || 30;
        let negativeMarking = document.getElementById('prac-cfg-neg-marking').value;
        let feedback = document.getElementById('prac-cfg-feedback').value;
        let shuffleQs = document.getElementById('prac-cfg-shuffle-qs').checked;
        let shuffleOpts = document.getElementById('prac-cfg-shuffle-opts').checked;
        
        let incWrong = document.getElementById('prac-cfg-inc-wrong').checked;
        let incBookmarks = document.getElementById('prac-cfg-inc-bookmarks').checked;
        let incUnattempted = document.getElementById('prac-cfg-inc-unattempted').checked;
        let incCustom = document.getElementById('prac-cfg-inc-custom').checked;
        
        // Save setup inside storage
        let configObj = {
            subject, topic, difficulty, count, timer, timerMin, perQTimer, perQSec,
            negativeMarking, feedback, shuffleQs, shuffleOpts,
            incWrong, incBookmarks, incUnattempted, incCustom
        };
        KrishiStorage.setItem('krishi_last_practice_config', JSON.stringify(configObj));

        // Gather matching items list
        let pool = [];
        let allQuestions = getAllQuestions();
        
        // Log attempt sets
        let loggedIds = new Set(timingLog.map(l => l.qid));
        let wrongSet = new Set(localData.wrong);
        let bkSet = new Set(localData.bookmarked);
        let customSet = new Set(getCustomQuestions().map(q => q.id));

        allQuestions.forEach(q => {
            // Apply category and difficulty gates
            if (subject !== 'all' && (q.sub || "").trim().toLowerCase() !== (subject || "").trim().toLowerCase()) return;
            if (topic !== 'all' && (q.topic || "").trim().toLowerCase() !== (topic || "").trim().toLowerCase()) return;
            if (difficulty !== 'all' && q.difficulty !== difficulty) return;
            
            // Check filters inclusions
            let isCustom = customSet.has(q.id);
            let isWrong = wrongSet.has(q.id);
            let isBookmarked = bkSet.has(q.id);
            let isUnattempted = !loggedIds.has(q.id);

            let matchesInclusion = false;
            if (incWrong && isWrong) matchesInclusion = true;
            if (incBookmarks && isBookmarked) matchesInclusion = true;
            if (incCustom && isCustom) matchesInclusion = true;
            if (incUnattempted && isUnattempted) matchesInclusion = true;
            
            // Default inclusion if filters are all off
            if (!incWrong && !incBookmarks && !incUnattempted && !incCustom) {
                matchesInclusion = true; 
            }

            if (matchesInclusion) {
                pool.push(q);
            }
        });

        if (pool.length === 0) {
            showToast('No questions match your filter metrics. Adjust settings!');
            return;
        }

        // Apply Shuffling
        if (shuffleQs) {
            pool = shuffle(pool);
        }
        pool = pool.slice(0, Math.min(count, pool.length));

        // Start session config
        state.activeConfig = configObj;
        setupMCQSession(pool, false, timer === 'on' ? timerMin * 60 : 0);
    }

    // ==================== SMART MODES ENGINE ====================
    function startSmartPracticeMode(mode) {
        let allQ = getAllQuestions();
        if (allQ.length === 0) {
            showToast("No questions found in application database.");
            return;
        }

        let pool = [];
        let config = {
            subject: 'all', topic: 'all', difficulty: 'all', count: 10,
            timer: 'off', timerMin: 0, perQTimer: 'off', perQSec: 0,
            negativeMarking: 'off', feedback: 'immediate', shuffleQs: true, shuffleOpts: true
        };

        if (mode === 'quick') {
            pool = shuffle(allQ).slice(0, 10);
            config.count = 10;
        } 
        else if (mode === 'weak') {
            let weakInfo = getWeakestSubject();
            if (weakInfo.hasData && weakInfo.subject && weakInfo.subject !== 'all') {
                pool = allQ.filter(q => (q.sub || "").trim().toLowerCase() === (weakInfo.subject || "").trim().toLowerCase());
                config.subject = weakInfo.subject;
                showToast(`Weak Topic Focus: targeting ${weakInfo.subject}!`);
            } else {
                pool = allQ;
                showToast("Not enough stats found yet. Practices launched!");
            }
            pool = shuffle(pool).slice(0, 15);
            config.count = 15;
        } 
        else if (mode === 'wrong') {
            let wrongs = new Set(localData.wrong);
            pool = allQ.filter(q => wrongs.has(q.id));
            if (pool.length === 0) {
                showToast("Perfect! You currently have zero mistakes.");
                return;
            }
            pool = shuffle(pool).slice(0, 15);
            config.count = pool.length;
        } 
        else if (mode === 'bookmark') {
            let bookmarks = new Set(localData.bookmarked);
            pool = allQ.filter(q => bookmarks.has(q.id));
            if (pool.length === 0) {
                showToast("No bookmarked questions saved yet.");
                return;
            }
            pool = shuffle(pool).slice(0, 15);
            config.count = pool.length;
        } 
        else if (mode === 'speed') {
            pool = shuffle(allQ).slice(0, 20);
            config.count = 20;
            config.perQTimer = 'on';
            config.perQSec = 30; // 30s quick sprint
            showToast("Speed Sprint! 30 seconds per question limit.");
        }
        else if (mode === 'sm2') {
            if (window.KrishiSM2Engine) {
                pool = window.KrishiSM2Engine.getDueQuestions(allQ);
            }
            if (pool.length === 0) {
                showToast("🎉 सबै प्रश्नहरू कण्ठ छन्! आजका लागि सम्झनुपर्ने प्रश्न छैन।");
                return;
            }
            pool = shuffle(pool).slice(0, 15);
            config.count = pool.length;
            config.isSpacedReview = true;
            showToast(`🧠 SM-2 Memory Refresh: ${pool.length} वटा प्रश्नहरू अभ्यासका लागि तयार भए!`);
        }
        else if (mode === 'daily') {
            let solvedToday = getSolvedTodayCount();
            let target = getDailyTarget();
            let needed = Math.max(5, target - solvedToday);
            pool = shuffle(allQ).slice(0, needed);
            config.count = needed;
            showToast(`Practice ${needed} more correct MCQs to smash today's goal!`);
        } 
        else if (mode === 'simulation') {
            pool = shuffle(allQ).slice(0, 50); // Loksewa simulations usually have 50 questions
            config.count = 50;
            config.timer = 'on';
            config.timerMin = 45; // 45 minute Loksewa standard exam timer
            config.negativeMarking = 'on'; // 20% negative score marker
            config.feedback = 'end'; // only display feedback at summary
            showToast("🏛 Simulation Loksewa launched! 45 mins limit, 20% penalty rules active.");
        }

        state.activeConfig = config;
        setupMCQSession(pool, mode === 'simulation', config.timer === 'on' ? config.timerMin * 60 : 0);
    }

    // Helper counts for Home statistics
    function getSolvedTodayCount() {
        let today = getLocalDateString();
        return (localData.streak[today] && localData.streak[today].solved) || 0;
    }

    function startRecommendedTopicPractice() {
        let analyzedSub = document.getElementById('recommended-text-insight').dataset.sub || 'all';
        if (analyzedSub !== 'all') {
            openPracticeSetupPage(analyzedSub, 'all');
        } else {
            openPracticeSetupPage('all', 'all');
        }
    }

    function setupMCQSession(questions, isMock, timerSec, skipNavigate = false){
        if (state.perQuestionTimerInterval) {
            clearInterval(state.perQuestionTimerInterval);
            state.perQuestionTimerInterval = null;
        }

        state.questions = questions;
        state.currentIndex = 0;
        state.score = 0;
        state.isFinishing = false;
        state.selectedOption = null;
        state.answered = false;
        state.sessionResults = [];
        state.isMock = isMock;
        state.totalQuestions = questions.length;
        state.sessionId = Date.now(); // Track active session to prevent race conditions
        state.timerSec = timerSec;
        state.hybridHearts = 5; // Default 5 hearts for hybrid attempts
        
        // Upgraded state item slots
        state.perQuestionTimerSec = 0;
        state.userConfidence = 'Medium'; // default confidence level
        state.totalTimeSpent = 0;
        state.timeSpentArray = [];

        if (!skipNavigate) {
            let activePanels = document.getElementById('practice-active-state-panels');
            if (activePanels) activePanels.classList.add('hidden');
            let resPanel = document.getElementById('practice-result-panel');
            if (resPanel) resPanel.classList.add('hidden');
            let emptyState = document.getElementById('practice-empty-state');
            if (emptyState) emptyState.classList.add('hidden');

            let mcqPage = document.getElementById('page-mcq');
            if (mcqPage) {
                mcqPage.classList.remove('hidden');
                mcqPage.style.opacity = '1';
                mcqPage.style.display = '';
            }
            navigate('page-practice');
        }
        renderMCQ();
        
        if (state.timerSec > 0) { 
            showTimer(); 
            startTimer(); 
        } else { 
            hideTimer(); 
        }
    }

    function hideTimer(){
        console.log('Hiding global timer');
        let el = document.getElementById('q-timer-display');
        if(el) {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
        let fb = document.getElementById('finish-btn');
        if(fb) fb.classList.add('hidden');
    }
    function showTimer(){
        console.log('Showing global timer');
        let el = document.getElementById('q-timer-display');
        if(el) {
            el.classList.remove('hidden');
            el.style.display = 'inline-block';
        }
    }



    // ==================== TIMER ====================
    function startTimer(){
        stopTimer();
        updateTimerDisplay();
        let expectedEndTime = Date.now() + (state.timerSec * 1000);
        state.timerInterval = setInterval(()=>{
            let remainingMs = expectedEndTime - Date.now();
            state.timerSec = Math.max(0, Math.ceil(remainingMs / 1000));
            updateTimerDisplay();
            if(state.timerSec <= 0){
                stopTimer();
                showToast('⏰ Time is Up!');
                finishSession();
            }
        }, 1000);
    }

    function stopTimer(){
        if(state.timerInterval){ clearInterval(state.timerInterval); state.timerInterval=null; }
    }

    function updateTimerDisplay(){
        let el = document.getElementById('q-timer-display'); if(!el) return;
        let m = Math.floor(state.timerSec/60);
        let s = state.timerSec%60;
        el.textContent = '⏱ ' + m + ':' + s.toString().padStart(2, '0');
        el.classList.toggle('text-red-600', state.timerSec < 60);
    }

    // ==================== MCQ GAMEPLAY ====================
    let questionStartTime = Date.now();
    function startQuestionTimer() { 
        questionStartTime = Date.now(); 
        
        // Setup per-question limit timer if configured
        if (state.perQuestionTimerInterval) {
            clearInterval(state.perQuestionTimerInterval);
            state.perQuestionTimerInterval = null;
        }

        let perQIndicator = document.getElementById('per-q-timer-display');
        if (state.activeConfig && state.activeConfig.perQTimer === 'on') {
            state.perQuestionTimerSec = state.activeConfig.perQSec || 30;
            let expectedEndTime = Date.now() + (state.perQuestionTimerSec * 1000);
            perQIndicator.classList.remove('hidden');
            perQIndicator.style.display = 'inline-block';
            perQIndicator.textContent = `⏱ Q: ${state.perQuestionTimerSec}s`;
            perQIndicator.classList.remove('timer-pulse');

            state.perQuestionTimerInterval = setInterval(() => {
                let remainingMs = expectedEndTime - Date.now();
                state.perQuestionTimerSec = Math.max(0, Math.ceil(remainingMs / 1000));
                perQIndicator.textContent = `⏱ Q: ${state.perQuestionTimerSec}s`;
                
                if (state.perQuestionTimerSec <= 5) {
                    perQIndicator.classList.add('timer-pulse');
                    playSound('countdown');
                }
                
                if (state.perQuestionTimerSec <= 0) {
                    clearInterval(state.perQuestionTimerInterval);
                    state.perQuestionTimerInterval = null;
                    showToast("⏰ Per-Question Time is Up!");
                    // Auto submit as wrong or empty
                    triggerPerQuestionTimeout();
                }
            }, 1000);
        } else {
            perQIndicator.classList.add('hidden');
        }
    }

    function triggerPerQuestionTimeout() {
        if (state.answered) return;
        // Submit empty or incorrect answers
        state.selectedOption = null;
        state.answered = true;
        
        let q = state.questions[state.currentIndex];
        let secondsSpent = state.activeConfig?.perQSec || 30;
        state.totalTimeSpent += secondsSpent;
        recordQuestionTime(q.id, q.sub, q.difficulty||'Easy', false);
        state.timeSpentArray.push({ id: q.id, sub: q.sub, seconds: secondsSpent, correct: false });
        
        let showAnswersEnd = state.activeConfig && state.activeConfig.feedback === 'end';
        
        // Highlight wrong and correct
        let btns = document.querySelectorAll('.option-btn');
        let correctBtnNode = null;
        btns.forEach(b => {
            b.classList.add('disabled');
            let oIdx = parseInt(b.dataset.originalIndex);
            if (oIdx === q.ans) correctBtnNode = b;
        });
        
        if (!showAnswersEnd && correctBtnNode) correctBtnNode.classList.add('glow-correct');
        
        // Isolation: Do not mix SM-2 Spaced Review mistakes with regular Mistakes Mode
        if (!state.activeConfig?.isSpacedReview) {
            if (!localData.wrong) localData.wrong = [];
            if (!localData.wrong.includes(q.id)) {
                localData.wrong.push(q.id);
                if (!localData.wrongLog) localData.wrongLog = {};
                let rev = localData.wrongLog[q.id] ? (localData.wrongLog[q.id]._rev || 0) : 0;
                localData.wrongLog[q.id] = { action: 'add', timestamp: Date.now(), _rev: rev + 1 };
            }
        }

        if (window.KrishiSM2Engine && !state.isMock) {
            window.KrishiSM2Engine.recordAnswer(q.id || q.q, false, secondsSpent);
        }

        // Standard statistics logger (Timeout counts as an attempted/solved question)
        localData.stats.totalSolved++;
        if(!localData.stats.subjectStats[q.sub]) localData.stats.subjectStats[q.sub]={solved:0, correct:0};
        localData.stats.subjectStats[q.sub].solved++;

        let today = getLocalDateString();
        if(!localData.streak[today]) localData.streak[today]={solved:0, correct:0};
        localData.streak[today].solved++;
        
        saveData();
        if (typeof updateStatsRibbon === 'function') updateStatsRibbon();
        
        // Decrement hearts in Premium Hybrid mode
        const hybridEnabled = KrishiStorage.getItem('krishi_premium_hybrid') !== 'false';
        if (hybridEnabled) {
            if (typeof state.hybridHearts === 'undefined') state.hybridHearts = 5;
            if (state.hybridHearts > 0) {
                state.hybridHearts--;
                let hybridHeartsCount = document.getElementById('hybrid-hearts-count');
                if (hybridHeartsCount) {
                    hybridHeartsCount.textContent = state.hybridHearts;
                    let heartsBadge = document.getElementById('hybrid-hearts-badge');
                    if (heartsBadge) {
                        heartsBadge.classList.add('scale-125');
                        heartsBadge.style.color = '#e11d48';
                        setTimeout(() => {
                            heartsBadge.classList.remove('scale-125');
                            heartsBadge.style.color = '';
                        }, 300);
                    }
                }
                if (state.hybridHearts === 0) {
                    showToast('💔 Hearts सकियो! तर चिन्ता नगर्नुहोस्, यो अभ्यास जारी राख्नुहोस्।');
                }
            }
        }
        
        state.sessionResults.push({ id: q.id, correct: false, userAns: -1, timeout: true, seconds: secondsSpent, confidence: 'Low' });

        // If not silent simulator
        if (!showAnswersEnd) {
            document.getElementById('q-explanation-container').classList.remove('hidden');
            document.getElementById('q-explanation').textContent = q.expl || 'Explanation not provided.';
        }
        document.getElementById('submit-btn').classList.add('hidden');

        if (state.currentIndex < state.totalQuestions - 1) {
            document.getElementById('next-btn').classList.remove('hidden');
        } else {
            document.getElementById('finish-btn').classList.remove('hidden');
            if (typeof stopTimer === 'function') stopTimer();
        }
    }

    function renderMCQ(){
        startQuestionTimer();
        if(state.currentIndex >= state.totalQuestions){ finishSession(); return; }
        
        if (typeof broadcastQuizHandoff === 'function') {
            try { broadcastQuizHandoff(); } catch(e){}
        }

        let q = state.questions[state.currentIndex];
        document.getElementById('q-progress').textContent = 'Question ' + (state.currentIndex+1) + '/' + state.totalQuestions;
        document.getElementById('progress-bar').style.width = ((state.currentIndex/state.totalQuestions)*100)+'%';

        // Update Premium Hybrid Duolingo Header
        let hybridProgress = document.getElementById('hybrid-progress-bar');
        if (hybridProgress) {
            hybridProgress.style.width = ((state.currentIndex/state.totalQuestions)*100)+'%';
        }
        let hybridStreak = document.getElementById('hybrid-streak-count');
        if (hybridStreak) {
            hybridStreak.textContent = typeof getStreakCount === 'function' ? getStreakCount() : 0;
        }
        let hybridHearts = document.getElementById('hybrid-hearts-count');
        if (hybridHearts) {
            if (typeof state.hybridHearts === 'undefined') state.hybridHearts = 5;
            hybridHearts.textContent = state.hybridHearts;
        }
        document.getElementById('q-text').textContent = q.q;
        
        // Setup details text
        document.getElementById('q-subject-badge').textContent = q.sub||'General';
        document.getElementById('q-topic-badge').textContent = q.topic||'General Topic';
        document.getElementById('q-difficulty-badge').textContent = q.difficulty||'Easy';
        
        // Hint btn setup
        let hintBtn = document.getElementById('q-hint-btn');
        if (q.expl && q.expl.trim().length > 0) {
            hintBtn.classList.remove('hidden');
        } else {
            hintBtn.classList.add('hidden');
        }

        document.getElementById('q-explanation-container').classList.add('hidden');
        document.getElementById('submit-btn').classList.remove('hidden');
        document.getElementById('next-btn').classList.add('hidden');
        document.getElementById('finish-btn').classList.add('hidden');
        
        // Render Bookmark icon
        let bBtn = document.getElementById('bookmark-btn');
        bBtn.textContent = localData.bookmarked.includes(q.id) ? '★' : '☆';
        bBtn.style.color = localData.bookmarked.includes(q.id) ? 'var(--warning)' : 'inherit';

        state.selectedOption = null;
        state.answered = false;
        
        // Reset confidence buttons
        setMCQConfidence('Medium');

        // Render Shuffled or Ordered options
        let container = document.getElementById('q-options'); 
        container.innerHTML = '';
        let opts = q.opts || [];
        
        let isShort = opts.every(opt => opt && opt.length < 8);
        if (isShort && window.innerWidth <= 768) {
            container.classList.add('options-container-grid');
            container.classList.remove('space-y-2.5');
        } else {
            container.classList.remove('options-container-grid');
            container.classList.add('space-y-2.5');
        }
        
        // Create an array list of index tracker
        let indexMap = opts.map((opt, idx) => ({ text: opt, originalIdx: idx }));
        if (state.activeConfig && state.activeConfig.shuffleOpts !== false) {
            indexMap = shuffle(indexMap);
        }

        indexMap.forEach((meta, i)=>{
            let btn = document.createElement('button');
            btn.className = 'option-btn transition-all duration-200 text-left option-entrance';
            btn.style.animationDelay = (i * 0.05) + 's';
            btn.textContent = String.fromCharCode(65+i) + '. ' + meta.text;
            btn.dataset.originalIndex = meta.originalIdx;

            btn.onclick = () => {
                if(!state.answered){
                    playSound('click');
                    state.selectedOption = meta.originalIdx;
                    window.dispatchEvent(new CustomEvent('krishi-option-selected'));
                    document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    
                    // Cognitive Hesitation Tracker: Auto-calculate confidence based on reaction speed
                    let reactionTimeMs = Date.now() - questionStartTime;
                    if (reactionTimeMs < 3000) {
                        state.userConfidence = 'High';
                    } else if (reactionTimeMs < 5000) {
                        state.userConfidence = 'Medium';
                    } else {
                        state.userConfidence = 'Low';
                    }
                    
                    // Immediately submit answer automatically
                    setTimeout(() => {
                        if (typeof submitMCQAnswer === 'function') {
                            submitMCQAnswer();
                        }
                    }, 50);
                }
            };
            container.appendChild(btn);
        });

        // Dispatch event for Voice Assistant modular hook with exact rendered DOM display order
        let renderedOpts = indexMap.map(m => m.text);
        window.krishiRenderedOpts = renderedOpts;
        window.dispatchEvent(new CustomEvent('krishi-question-rendered', { detail: { question: q, renderedOpts: renderedOpts } }));

        // Save practice session progress on every new unanswered question render
        if (typeof savePracticeProgress === 'function') {
            try { savePracticeProgress(); } catch(e) {}
        }
    }

    function showQuizHint() {
        let q = state.questions[state.currentIndex];
        if (q && q.expl) {
            // Cut or generate a subtle clue from the explanation
            let lines = q.expl.split('.');
            let clue = lines[0] || q.expl;
            showToast("💡 Hint clue: " + clue);
            playSound('click');
        }
    }

    function reportAnswerIssue() {
        let q = state.questions[state.currentIndex];
        let reportText = prompt("Tell us about the issue with Question ID " + (q?.id || "") + ":", "Incorrect option/typo in explanation");
        if (reportText) {
            showToast("⚠️ Report registered. Thank you for making Krishi better!");
            playSound('celebrate');
        }
    }

    function toggleBookmarkCurrent(){
        let q = state.questions[state.currentIndex]; if(!q) return;
        let idx = localData.bookmarked.indexOf(q.id);
        if (!localData.bookmarkedLog) localData.bookmarkedLog = {};
        let rev = localData.bookmarkedLog[q.id] ? (localData.bookmarkedLog[q.id]._rev || 0) : 0;
        const now = Date.now();
        if(idx === -1){
            localData.bookmarked.push(q.id);
            localData.bookmarkedLog[q.id] = { action: 'add', timestamp: now, _rev: rev + 1 };
            showToast('Bookmarks saved!');
            playSound('celebrate');
        } else {
            localData.bookmarked.splice(idx, 1);
            localData.bookmarkedLog[q.id] = { action: 'remove', timestamp: now, _rev: rev + 1 };
            showToast('Bookmarks removed!');
            playSound('click');
        }
        saveData();
        
        // Quick update icon content
        let bBtn = document.getElementById('bookmark-btn');
        bBtn.textContent = localData.bookmarked.includes(q.id) ? '★' : '☆';
        bBtn.style.color = localData.bookmarked.includes(q.id) ? 'var(--warning)' : 'inherit';
    }

    function setMCQConfidence(level) {
        state.userConfidence = level;
        ['High', 'Medium', 'Low'].forEach(l => {
            let el = document.getElementById(`conf-btn-${l}`);
            if (el) {
                if (l === level) {
                    el.className = "py-1 rounded-xl bg-indigo-600 text-white border border-indigo-600 text-[10px] font-black cursor-pointer transition-all";
                } else {
                    el.className = "py-1 rounded-xl bg-slate-50 dark:bg-slate-900 border text-[10px] font-black text-slate-605 dark:text-slate-400 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-850 transition-all border-slate-200 dark:border-slate-700";
                }
            }
        });
    }

    function reviewLaterQuestion() {
        if (state.answered) { nextMCQQuestion(); return; }
        if (state.isTransitioning) return;
        state.isTransitioning = true;
        state.answered = true; // Prevents timer race condition
        
        // Push currently skipped/later queue
        let q = state.questions[state.currentIndex];
        showToast("🕒 Review Later: skipped!");
        playSound('click');
        state.sessionResults.push({ id: q.id, correct: false, userAns: -1, skipped: true, later: true });
        
        // Proceed next
        animateQuestionTransition(() => {
            state.currentIndex++;
            state.selectedOption = null;
            state.answered = false;
            renderMCQ();
            state.isTransitioning = false;
        });
    }

    function submitMCQAnswer(){
        if(state.selectedOption === null) { showToast('Please select an option!'); return; }
        if(state.answered) return;
        state.answered = true;

        if (state.perQuestionTimerInterval) {
            clearInterval(state.perQuestionTimerInterval);
            state.perQuestionTimerInterval = null;
        }

        let q = state.questions[state.currentIndex];
        let isCorrect = state.selectedOption === q.ans;
        
        // Track absolute timings
        let secondsSpent = Math.max(1, Math.round((Date.now() - questionStartTime) / 1000));
        state.totalTimeSpent += secondsSpent;
        state.timeSpentArray.push({ id: q.id, sub: q.sub, seconds: secondsSpent, correct: isCorrect });

        recordQuestionTime(q.id, q.sub, q.difficulty||'Easy', isCorrect);
        
        let btns = document.querySelectorAll('.option-btn');
        let selectedBtnNode = null;
        let correctBtnNode = null;

        btns.forEach(b => {
            b.classList.add('disabled');
            let oIdx = parseInt(b.dataset.originalIndex);
            if (oIdx === state.selectedOption) selectedBtnNode = b;
            if (oIdx === q.ans) correctBtnNode = b;
        });

        // Config actions
        let isSimulation = state.activeConfig && state.activeConfig.negativeMarking === 'on';
        let showAnswersEnd = state.activeConfig && state.activeConfig.feedback === 'end';

        if(isCorrect){
            if (!showAnswersEnd) {
                playSound('correct');
                triggerHaptic('correct');
                showFeedbackSpeechTag("🎯 Correct answer!");
                if (window.AnimationOrchestrator) {
                    window.AnimationOrchestrator.dispatch('animation.correct', { targetEl: selectedBtnNode });
                } else if (window.LottieAdapter) {
                    window.LottieAdapter.play('lottie.feedback.correct').then(success => {
                        if (!success && selectedBtnNode) selectedBtnNode.classList.add('glow-correct');
                    });
                } else {
                    if (selectedBtnNode) selectedBtnNode.classList.add('glow-correct');
                }
            }
            state.score++;
            
            // Award XP (silently if it's a mock exam with showAnswersEnd)
            awardXP(XP_REWARDS.correctAnswer, 'correct_answer', selectedBtnNode, showAnswersEnd);
            
            // मिलाएको प्रश्नलाई गल्तीहरूको सूचीबाट स्वतः हटाउने
            if (localData.wrong && localData.wrong.includes(q.id)) {
                localData.wrong = localData.wrong.filter(id => id !== q.id);
                if (!localData.wrongLog) localData.wrongLog = {};
                let rev = localData.wrongLog[q.id] ? (localData.wrongLog[q.id]._rev || 0) : 0;
                localData.wrongLog[q.id] = { action: 'remove', timestamp: Date.now(), _rev: rev + 1 };
            }
        } else {
            if (!showAnswersEnd) {
                playSound('wrong');
                triggerHaptic('wrong');
                showFeedbackSpeechTag("❌ Incorrect!");
                if (correctBtnNode) correctBtnNode.classList.add('glow-correct'); // Always show the correct answer natively
                if (window.AnimationOrchestrator) {
                    window.AnimationOrchestrator.dispatch('animation.wrong', { targetEl: selectedBtnNode });
                } else if (window.LottieAdapter) {
                    window.LottieAdapter.play('lottie.feedback.wrong').then(success => {
                        if (!success && selectedBtnNode) selectedBtnNode.classList.add('shake-wrong');
                    });
                } else {
                    if (selectedBtnNode) selectedBtnNode.classList.add('shake-wrong');
                }
            }
            // Isolation: Do not mix SM-2 Spaced Review mistakes with regular Mistakes Mode
            if (!state.activeConfig?.isSpacedReview) {
                if (!localData.wrong) localData.wrong = [];
                if (!localData.wrong.includes(q.id)) {
                    localData.wrong.push(q.id);
                    if (!localData.wrongLog) localData.wrongLog = {};
                    let rev = localData.wrongLog[q.id] ? (localData.wrongLog[q.id]._rev || 0) : 0;
                    localData.wrongLog[q.id] = { action: 'add', timestamp: Date.now(), _rev: rev + 1 };
                    saveData();
                }
            }

            // Decrement hearts in Premium Hybrid mode
            const hybridEnabled = KrishiStorage.getItem('krishi_premium_hybrid') !== 'false';
            if (hybridEnabled) {
                if (typeof state.hybridHearts === 'undefined') state.hybridHearts = 5;
                if (state.hybridHearts > 0) {
                    state.hybridHearts--;
                    let hybridHeartsCount = document.getElementById('hybrid-hearts-count');
                    if (hybridHeartsCount) {
                        hybridHeartsCount.textContent = state.hybridHearts;
                        let heartsBadge = document.getElementById('hybrid-hearts-badge');
                        if (heartsBadge) {
                            heartsBadge.classList.add('scale-125');
                            heartsBadge.style.color = '#e11d48';
                            setTimeout(() => {
                                heartsBadge.classList.remove('scale-125');
                                heartsBadge.style.color = '';
                            }, 300);
                        }
                    }
                    if (state.hybridHearts === 0) {
                        showToast('💔 Hearts सकियो! तर चिन्ता नगर्नुहोस्, यो अभ्यास जारी राख्नुहोस्।');
                    }
                }
            }
        }

        state.sessionResults.push({
            id: q.id, 
            correct: isCorrect, 
            userAns: state.selectedOption,
            seconds: secondsSpent,
            confidence: state.userConfidence
        });

        // Voice Assistant & SM-2 Spaced Repetition Hook
        let correctOptionText = (q.opts && q.opts[q.ans]) ? q.opts[q.ans] : '';
        window.dispatchEvent(new CustomEvent('krishi-answer-checked', { 
            detail: { isCorrect: isCorrect, correctOptionText: correctOptionText } 
        }));

        if (window.KrishiSM2Engine && !state.isMock) {
            window.KrishiSM2Engine.recordAnswer(q.id || q.q, isCorrect, secondsSpent);
        }

        // Hide or show explanation container
        if (!showAnswersEnd) {
            document.getElementById('q-explanation-container').classList.remove('hidden');
            document.getElementById('q-explanation').textContent = q.expl || 'Explanation not provided.';
        }
        
        let sBtn = document.getElementById('submit-btn');
        if (sBtn) sBtn.classList.add('hidden');

        if(state.currentIndex < state.totalQuestions - 1){
            document.getElementById('next-btn').classList.remove('hidden');
        } else {
            document.getElementById('finish-btn').classList.remove('hidden');
            if (typeof stopTimer === 'function') stopTimer();
        }

        // Standard statistics logger
        localData.stats.totalSolved++;
        if(isCorrect) localData.stats.totalCorrect++;
        if(!localData.stats.subjectStats[q.sub]) localData.stats.subjectStats[q.sub]={solved:0, correct:0};
        localData.stats.subjectStats[q.sub].solved++;
        if(isCorrect) localData.stats.subjectStats[q.sub].correct++;

        let today = getLocalDateString();
        if(!localData.streak[today]) localData.streak[today]={solved:0, correct:0};
        localData.streak[today].solved++;
        if(isCorrect) localData.streak[today].correct++;

        // SM2 Repetition updates (Moved exclusively to KrishiSM2Engine)
        saveData();
        // Unified Shell: update ribbon live
        if (typeof updateStatsRibbon === 'function') updateStatsRibbon();

        // Auto-Advance Questions (1.5 seconds delay after submit)
        if (KrishiStorage.getItem('krishi_auto_advance') === 'true') {
            if (state.autoAdvanceTimer) clearTimeout(state.autoAdvanceTimer);
            state.autoAdvanceTimer = setTimeout(() => {
                let mcqPage = document.getElementById('page-mcq');
                if (mcqPage && !mcqPage.classList.contains('hidden') && state.answered) {
                    if (state.currentIndex < state.totalQuestions - 1) {
                        nextMCQQuestion();
                    } else {
                        finishSession();
                    }
                }
            }, 1500);
        }
    }

    function triggerSparkleBurst(sourceNode, isSuccess) {
        if (!sourceNode) return;
        let rect = sourceNode.getBoundingClientRect();
        let container = document.getElementById('float-feedback-container');
        if (!container) return;

        let numParticles = 6;
        for (let i = 0; i < numParticles; i++) {
            let el = document.createElement('span');
            el.className = 'float-feedback';
            el.textContent = isSuccess ? '✨' : '💥';
            
            // Random velocities
            let angle = (i / numParticles) * Math.PI * 2;
            let distance = 35 + Math.random() * 25;
            let x = Math.cos(angle) * distance;
            let y = Math.sin(angle) * distance;
            
            el.style.left = `50%`;
            el.style.top = `30%`;
            el.style.setProperty('--tx', `${x}px`);
            el.style.setProperty('--ty', `${y}px`);
            
            // Custom keyframe inline injection style for fluid movement
            el.style.animation = `floatExplode 0.7s cubic-bezier(0.12, 0.82, 0.15, 1) forwards`;
            container.appendChild(el);
            setTimeout(() => el.remove(), 700);
        }
    }

    // ==================== XP SYSTEM ARCHITECTURE ====================
    const XP_REWARDS = {
        correctAnswer: 10,
        streakBonus: 5,
        achievement: 50,
        dailyTarget: 20
    };

    function awardXP(amount, reason, targetElement, silent = false) {
        if (!amount || amount <= 0) return;
        
        // Update XP Source of Truth
        if (!localData.progression || typeof localData.progression !== 'object') {
            localData.progression = { xp: 0 };
        }
        if (typeof localData.progression.xp !== 'number' || isNaN(localData.progression.xp)) {
            localData.progression.xp = 0;
        }
        
        const previousLevel = getLevelFromXP(localData.progression.xp);
        
        localData.progression.xp += amount;
        saveData(); // Persist immediately
        
        const currentLevel = getLevelFromXP(localData.progression.xp);
        
        if (typeof window.updateProgressionUI === 'function') window.updateProgressionUI();
        
        if (previousLevel < currentLevel && !silent) {
            if (typeof window.triggerLevelUpCelebration === 'function') {
                window.triggerLevelUpCelebration(currentLevel);
            }
        }
        
        // Emit visual event (optional visual)
        if (!silent) {
            showXPMicroAnimation(amount, targetElement);
        }
    }

    function getLevelFromXP(xp) {
        // Simple predictable progression formula: Level = floor(sqrt(xp / 100)) + 1
        // Level 1: 0 XP
        // Level 2: 100 XP
        // Level 3: 400 XP
        return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
    }

    function getXPForNextLevel(currentLevel) {
        return Math.pow(currentLevel, 2) * 100;
    }

    function getLevelProgress(xp) {
        const currentLevel = getLevelFromXP(xp);
        const nextLevelXP = getXPForNextLevel(currentLevel);
        const prevLevelXP = currentLevel > 1 ? getXPForNextLevel(currentLevel - 1) : 0;
        
        const xpInCurrentLevel = xp - prevLevelXP;
        const xpNeededForLevel = nextLevelXP - prevLevelXP;
        
        const percentage = Math.min(100, Math.max(0, (xpInCurrentLevel / xpNeededForLevel) * 100));
        
        return {
            level: currentLevel,
            currentLevelXP: xpInCurrentLevel,
            nextLevelTotalXP: nextLevelXP,
            xpNeededForLevel: xpNeededForLevel,
            percentage: percentage
        };
    }
    
    window.updateProgressionUI = function() {
        if (!localData.progression) return;
        const xp = (typeof localData.progression.xp === 'number' && !isNaN(localData.progression.xp)) ? localData.progression.xp : 0;
        const progress = getLevelProgress(xp);
        
        const level = progress.level;
        const currentLevelXP = progress.currentLevelXP;
        const xpNeededForLevel = progress.xpNeededForLevel;
        const remainingXP = progress.xpNeededForLevel - progress.currentLevelXP;
        const percentage = progress.percentage;
        const nextLevel = level + 1;
        
        const a11yString = `Level ${level}, ${currentLevelXP} of ${xpNeededForLevel} XP, ${remainingXP} XP remaining to Level ${nextLevel}`;
        
        document.querySelectorAll('.prog-level-text').forEach(el => el.textContent = 'LEVEL ' + level);
        document.querySelectorAll('.prog-xp-text').forEach(el => el.textContent = `${currentLevelXP} / ${xpNeededForLevel} XP`);
        document.querySelectorAll('.prog-bar-fill').forEach(el => el.style.width = percentage + '%');
        document.querySelectorAll('.prog-remaining-text').forEach(el => el.textContent = `${remainingXP} XP to Level ${nextLevel}`);
        document.querySelectorAll('.prog-container-a11y').forEach(el => {
            el.setAttribute('aria-label', a11yString);
            el.setAttribute('aria-valuenow', currentLevelXP);
            el.setAttribute('aria-valuemax', xpNeededForLevel);
        });
    };

    window.triggerLevelUpCelebration = function(newLevel) {
        if (window.AnimationOrchestrator) {
            window.AnimationOrchestrator.dispatch('animation.levelUp', { level: newLevel });
            return;
        }
        // Original fallback when orchestrator is not loaded
        if (window._isLevelUpPlaying === newLevel) return;
        window._isLevelUpPlaying = newLevel;

        const ps = window.getPerfSettings ? window.getPerfSettings() : {};
        if (ps.perfMode === 'battery' || ps.animIntensity === 'off' || ps.reduceMotion) {
            if (typeof showToast === 'function') {
                showToast(`🎉 LEVEL ${newLevel} - Level Up!`);
            }
            setTimeout(() => { window._isLevelUpPlaying = false; }, 2000);
            return;
        }

        if (window.LottieAdapter && typeof window.LottieAdapter.play === 'function') {
            window.LottieAdapter.play('lottie.reward.levelUp').then(success => {
                if (success) {
                    if (typeof showToast === 'function') showToast(`✨ LEVEL ${newLevel} - Level Up!`);
                    setTimeout(() => { window._isLevelUpPlaying = false; }, 2000);
                } else {
                    playCSSLevelUp(newLevel);
                }
            });
        } else {
            playCSSLevelUp(newLevel);
        }
    };
    // Orchestrator hook: expose CSS Level-Up fallback for delegation
    window._orchestratorPlayCSSLevelUp = playCSSLevelUp;

    function playCSSLevelUp(newLevel) {
        const existing = document.getElementById('css-levelup-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'css-levelup-overlay';
        overlay.className = 'fixed inset-0 z-[999999] pointer-events-none flex items-center justify-center';
        
        overlay.innerHTML = `
            <div class="levelup-card relative flex flex-col items-center justify-center transform scale-50 opacity-0 transition-all duration-[600ms] ease-[cubic-bezier(0.175,0.885,0.32,1.275)]">
                <div class="absolute inset-0 bg-emerald-400/20 blur-3xl rounded-full pointer-events-none"></div>
                <div class="relative z-10 text-center">
                    <span class="block text-3xl drop-shadow-md" style="animation: oneShot-bounce 0.9s cubic-bezier(0.36,0.07,0.19,0.97) 1 forwards;">✨</span>
                    <h2 class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-br from-emerald-300 to-emerald-600 tracking-widest uppercase drop-shadow-[0_0_15px_rgba(52,211,153,0.8)] leading-tight">LEVEL UP</h2>
                    <div class="mt-2 text-[5rem] font-black text-white drop-shadow-[0_0_20px_rgba(52,211,153,0.9)] leading-none" style="-webkit-text-stroke: 2px #059669;">${newLevel}</div>
                </div>
                
                <div class="absolute inset-0 overflow-visible pointer-events-none">
                    ${Array.from({length: 14}).map((_, i) => {
                        const angle = (i * (360 / 14)) * (Math.PI / 180);
                        const distance = 100 + Math.random() * 60;
                        const tx = Math.cos(angle) * distance;
                        const ty = Math.sin(angle) * distance;
                        const delay = Math.random() * 0.15;
                        return `<div class="absolute top-1/2 left-1/2 w-2.5 h-2.5 bg-emerald-300 rounded-full shadow-[0_0_8px_#6ee7b7]" style="--tx: ${tx}px; --ty: ${ty}px; animation: levelupParticle 0.8s ease-out ${delay}s forwards;"></div>`;
                    }).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        if (!document.getElementById('levelup-styles')) {
            const style = document.createElement('style');
            style.id = 'levelup-styles';
            style.textContent = `
                @keyframes levelupParticle {
                    0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                    100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const card = overlay.querySelector('.levelup-card');
                if (card) {
                    card.style.transform = 'scale(1)';
                    card.style.opacity = '1';
                }
            });
        });

        setTimeout(() => {
            const card = overlay.querySelector('.levelup-card');
            if (card) {
                card.style.transition = 'all 0.4s ease-in';
                card.style.transform = 'scale(1.1)';
                card.style.opacity = '0';
            }
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                window._isLevelUpPlaying = false;
            }, 400);
        }, 1400);
    }

    function showXPMicroAnimation(amount, targetElement) {
        const ps = typeof getPerfSettings === 'function' ? getPerfSettings() : {};
        if (ps.perfMode === 'battery' || ps.animIntensity === 'off') return;

        const xpLabel = document.createElement('div');
        xpLabel.className = 'xp-micro-anim';
        xpLabel.textContent = '+' + amount + ' XP';
        
        if (targetElement) {
            const rect = targetElement.getBoundingClientRect();
            xpLabel.style.left = (rect.left + rect.width / 2) + 'px';
            xpLabel.style.top = rect.top + 'px';
        } else {
            xpLabel.style.left = '50%';
            xpLabel.style.top = '50%';
        }

        if (ps.reduceMotion) {
            xpLabel.style.animation = 'none';
            xpLabel.style.opacity = '1';
            xpLabel.style.transform = 'translate(-50%, -100%)';
            setTimeout(() => { xpLabel.style.opacity = '0'; }, 500);
        }

        document.body.appendChild(xpLabel);

        setTimeout(() => {
            if (xpLabel.parentNode) xpLabel.parentNode.removeChild(xpLabel);
        }, ps.reduceMotion ? 600 : 800);
    }
    // Orchestrator hook: expose XP micro-animation for delegation
    window._orchestratorShowXPMicro = showXPMicroAnimation;

    function showFeedbackSpeechTag(txt) {
        let container = document.getElementById('float-feedback-container');
        if (!container) return;
        let label = document.createElement('div');
        label.className = "absolute left-1/2 -translate-x-1/2 top-0 bg-slate-900 border text-white font-bold text-[10px] px-3 py-1 rounded-full shadow-lg z-50 pointer-events-none transition-all duration-500 transform translate-y-0 opacity-100";
        label.style.borderColor = "var(--border)";
        label.textContent = txt;
        container.appendChild(label);
        
        setTimeout(() => {
            label.style.transform = "translateY(-15px)";
            label.style.opacity = "0";
            setTimeout(() => label.remove(), 550);
        }, 800);
    }

    function nextMCQQuestion(){
        if (state.autoAdvanceTimer) {
            clearTimeout(state.autoAdvanceTimer);
            state.autoAdvanceTimer = null;
        }
        if (state.isTransitioning) return;
        state.isTransitioning = true;
        animateQuestionTransition(() => {
            state.currentIndex++;
            state.selectedOption = null;
            state.answered = false;
            renderMCQ();
            state.isTransitioning = false;
        });
    }

    function skipQuestion(){
        if (state.answered) { nextMCQQuestion(); return; }
        if (state.isTransitioning) return;
        state.isTransitioning = true;
        state.answered = true; // Prevents timer race condition
        
        animateQuestionTransition(() => {
            let q = state.questions[state.currentIndex];
            
            // Record skipped question timing array
            let secondsSpent = Math.max(1, Math.round((Date.now() - questionStartTime) / 1000));
            state.totalTimeSpent += secondsSpent;
            state.timeSpentArray.push({ id: q.id, sub: q.sub, seconds: secondsSpent, correct: false });

            state.sessionResults.push({ id : q.id, correct: false, userAns: -1, skipped: true, seconds: secondsSpent });
            
            // Isolation: Do not mix SM-2 Spaced Review mistakes with regular Mistakes Mode
            if (!state.activeConfig?.isSpacedReview) {
                if(!localData.wrong.includes(q.id)) { localData.wrong.push(q.id); saveData(); }
            }

            if (window.KrishiSM2Engine && !state.isMock) {
                window.KrishiSM2Engine.recordAnswer(q.id || q.q, false, secondsSpent);
            }
            
            state.currentIndex++;
            state.selectedOption = null;
            state.answered = false;
            
            let today = getLocalDateString();
            
            // Standard statistics logger (Skip counts as an attempted/solved question)
            localData.stats.totalSolved++;
            if(!localData.stats.subjectStats[q.sub]) localData.stats.subjectStats[q.sub]={solved:0, correct:0};
            localData.stats.subjectStats[q.sub].solved++;

            if(!localData.streak[today]) localData.streak[today]={solved:0, correct:0};
            localData.streak[today].solved++;
            
            saveData();
            if (typeof updateStatsRibbon === 'function') updateStatsRibbon();
            savePracticeProgress()

            renderMCQ();
            state.isTransitioning = false;
        });
    }

    function finishSession(){
       if (state.isFinishing) return;
       state.isFinishing = true;
       activePlanSequenceHTML = ''; // Clear stale recommendation plan
       clearPracticeProgress();
       // Retire the cross-device handoff record: this session is over, so no peer should
       // still be offering to resume it.
       if (typeof clearQuizHandoff === 'function') { try { clearQuizHandoff(); } catch(e){} }
        if (state.perQuestionTimerInterval) {
            clearInterval(state.perQuestionTimerInterval);
            state.perQuestionTimerInterval = null;
        }
        stopTimer();

        let total = state.questions.length;
        if (total === 0) return;

        let correct = state.sessionResults.filter(r=>r.correct).length;
        let acc = total > 0 ? Math.round((correct/total)*100) : 0;
        
        let explicitlySkipped = state.sessionResults.filter(r=>r.skipped).length;
        let unanswered = total - state.sessionResults.length;
        let skipped = explicitlySkipped + unanswered;
        let wrongsCount = total - correct - skipped;

        let totalSeconds = state.totalTimeSpent || 0;
        let avgSeconds = total > 0 ? Math.round(totalSeconds / total) : 0;

        // Custom weighted scores configuration
        let isNegativeConfig = state.activeConfig && state.activeConfig.negativeMarking === 'on';
        let weightPenalty = isNegativeConfig ? 0.2 : 0.0;
        let weightedScore = parseFloat((correct * 1.0) - (wrongsCount * weightPenalty)).toFixed(2);

        // Find fastest and slowest correct attempts
        let validAttempts = state.sessionResults.filter(r => r.seconds !== undefined && r.seconds > 0);
        let fastestCorrect = validAttempts.length > 0 ? Math.min(...validAttempts.map(v => v.seconds)) : 0;
        let slowestCorrect = validAttempts.length > 0 ? Math.max(...validAttempts.map(v => v.seconds)) : 0;

        // Populate Diagnostics fields
        document.getElementById('res-total-time').textContent = formatSecondsReadable(totalSeconds);
        document.getElementById('res-avg-time').textContent = formatSecondsReadable(avgSeconds);
        document.getElementById('res-fastest-q').textContent = fastestCorrect > 0 ? `${fastestCorrect}s` : '--';
        document.getElementById('res-slowest-q').textContent = slowestCorrect > 0 ? `${slowestCorrect}s` : '--';
        document.getElementById('res-skipped').textContent = skipped;
        document.getElementById('res-weighted-score').textContent = weightedScore;

        if (state.isMock) { 
            recordMockScore(acc); 
        }

        // Draw accuracy circle SVG animations
        let circle = document.getElementById('result-circle-fill');
        if (circle) {
            let offsetVal = 290 - (290 * acc) / 100;
            circle.style.strokeDashoffset = offsetVal;
            circle.style.stroke = acc >= 80 ? '#10b981' : (acc >= 50 ? '#f59e0b' : '#ef4444');
        }

        document.getElementById('res-accuracy').textContent = acc + '%';
        let feedbackVerdict = qAccuracyVerdict(acc);
        document.getElementById('res-detail').textContent = `${correct} correct, ${wrongsCount} wrong, ${skipped} skipped. ${feedbackVerdict}`;
        document.getElementById('res-correct').textContent = correct;
        document.getElementById('res-wrong').textContent = wrongsCount;

        // Dispatch Voice Assistant Quiz Finished Event
        window.dispatchEvent(new CustomEvent('krishi-quiz-finished', {
            detail: {
                total: total,
                correct: correct,
                accuracy: acc,
                wrongs: wrongsCount,
                skipped: skipped,
                timeSpentSeconds: totalSeconds
            }
        }));
        
        // Hide or show corrections loop btn
        document.getElementById('retry-wrong-btn').style.display = wrongsCount > 0 ? 'block' : 'none';

        // Load Matrix subjects progress
        let subStats = {};
        state.sessionResults.forEach(r => {
            let originalQ = getAllQuestions().find(q => q.id === r.id);
            if (originalQ) {
                let sName = originalQ.sub || 'General';
                if (!subStats[sName]) subStats[sName] = { counted: 0, checked: 0 };
                subStats[sName].counted++;
                if (r.correct) subStats[sName].checked++;
            }
        });

        let matrixList = document.getElementById('res-subject-matrix');
        matrixList.innerHTML = '';
        let lowestAccSub = null;
        let minRatio = 1.0;

        Object.keys(subStats).forEach(sb => {
            let rMeta = subStats[sb];
            let ratio = rMeta.checked / rMeta.counted;
            let ratioAcc = Math.round(ratio * 100);
            
            if (ratio < minRatio) {
                minRatio = ratio;
                lowestAccSub = sb;
            }

            matrixList.innerHTML += `
                <div class="space-y-0.5">
                    <div class="flex justify-between items-center text-[10px]">
                        <span class="font-extrabold text-slate-700 dark:text-slate-300">${sb}</span>
                        <span class="font-mono font-bold text-slate-500">${rMeta.checked}/${rMeta.counted} answered (${ratioAcc}%)</span>
                    </div>
                    <div class="w-full h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div class="h-full rounded-full ${ratioAcc >= 80 ? 'bg-emerald-500' : 'bg-amber-500'}" style="width: ${ratioAcc}%"></div>
                    </div>
                </div>
            `;
        });

        if (matrixList.innerHTML === '') {
            matrixList.innerHTML = '<p class="text-[9px] text-slate-400 italic">No subject data generated.</p>';
        }

        // Recommend actions
        document.getElementById('res-topic-weakness').textContent = lowestAccSub ? lowestAccSub : 'None. Perfect accuracy!';
        
        let patternText = "Steady performance. Solving speed and accuracy are balanced.";
        if (avgSeconds < 10 && acc < 60) {
            patternText = "⚠️ Solving speed is too high! Read options carefully before clicking.";
        } else if (avgSeconds > 40) {
            patternText = "⚠️ Timing spent per question is elevated. Suggesting Speed Mode practice.";
        }
        document.getElementById('res-mistake-pattern').textContent = patternText;

        let recommendationModeText = "Subject Practice Mode focus.";
        let dynamicWeakThreshold = getPlannerSettings().weakThreshold || 60;
        if (acc < dynamicWeakThreshold) {
            recommendationModeText = `Spaced review and Mistakes Review for ${lowestAccSub || 'entire modules'}`;
        } else if (avgSeconds > 35) {
            recommendationModeText = "Attempting Speed Practice sprint modes";
        } else {
            recommendationModeText = `Deep Practice session for ${lowestAccSub || 'any chapters'}`;
        }
        document.getElementById('res-recommended-mode').textContent = recommendationModeText;

        // Save session history
        let recentItem = {
            id: 'sess_' + Date.now(),
            date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now(),
            accuracy: acc,
            correct: correct,
            total: total,
            mode: state.activeConfig ? (state.activeConfig.subject !== 'all' ? state.activeConfig.subject : 'Custom filter') : 'Smart Mode'
        };
        saveRecentPracticeSessionLog(recentItem);

        // Check if daily target completed
        checkIfDailyTargetMetJustNow();

        // Celebration actions
        if (acc >= 80) {
            playSound('celebrate');
            if (window.AnimationOrchestrator) {
                window.AnimationOrchestrator.dispatch('animation.sessionComplete', { accuracy: acc });
            } else {
                showInteractiveCelebrationFireworks();
            }
        }

        // Setup practice weak subject button action binding
        let actBtn = document.getElementById('res-btn-practice-weak');
        if (lowestAccSub) {
            actBtn.dataset.weaksubject = lowestAccSub;
            actBtn.textContent = `🎯 Focus and Resolve ${lowestAccSub}`;
            actBtn.style.display = 'block';
        } else {
            actBtn.style.display = 'none';
        }

        transitionMcqToResult();
    }

    function formatSecondsReadable(sec) {
        if (sec < 60) return `${sec}s`;
        let min = Math.floor(sec / 60);
        let rem = sec % 60;
        return `${min}m ${rem}s`;
    }

    function qAccuracyVerdict(acc) {
        if (acc >= 90) return "👑 Exceptional Mastery! Outstanding results.";
        if (acc >= 75) return "🌟 Highly Proficient. You are close to perfection.";
        if (acc >= 50) return "👍 Adequate preparation. Build on weak concepts.";
        return "📉 Intensive training recommended. Re-try wrong answers.";
    }

    function saveRecentPracticeSessionLog(item) {
        let listRaw = KrishiStorage.getItem('krishi_practice_recent');
        let listArr = [];
        if (listRaw) {
            try { listArr = JSON.parse(listRaw); } catch(ex) {}
        }
        listArr.unshift(item);
        listArr = listArr.slice(0, 10); // store last 10
        KrishiStorage.setItem('krishi_practice_recent', JSON.stringify(listArr));
    }

    function practiceWeakestSubjectFromResult() {
        let el = document.getElementById('res-btn-practice-weak');
        let weakSub = el?.dataset?.weaksubject || 'all';
        openPracticeSetupPage(weakSub, 'all');
    }

    function closeSessionResults() {
        let resPanel = document.getElementById('practice-result-panel');
        if (resPanel) resPanel.classList.add('hidden');
        
        let activePanels = document.getElementById('practice-active-state-panels');
        if (activePanels) activePanels.classList.remove('hidden');
        
        updatePracticePage();
        navigate('page-practice');
    }

    function saveResultToAnalyticsDashboard() {
        showToast("💾 Practice sessions synced to analytics!");
        playSound('celebrate');
    }

    function showInteractiveCelebrationFireworks() {
        // Trigger high-performance canvas confetti engine for dynamic celebration
        if (typeof triggerConfetti === 'function') {
            triggerConfetti();
        }

        // Quick visual fireworks in DOM body background
        let fw = document.createElement('div');
        fw.className = "fixed inset-0 pointer-events-none z-[20000] flex justify-center items-center overflow-hidden";
        fw.innerHTML = `
            <div class="scale-150 transform opacity-100 transition-all duration-1000 flex flex-wrap gap-20 p-20 justify-center">
                <span class="text-4xl animate-bounce">🎉</span>
                <span class="text-4xl animate-pulse">🎓</span>
                <span class="text-4xl animate-bounce">🏆</span>
                <span class="text-4xl animate-pulse">🌟</span>
            </div>
        `;
        document.body.appendChild(fw);
        setTimeout(() => {
            fw.style.opacity = '0';
            setTimeout(() => fw.remove(), 1050);
        }, 1200);
    }
    // Orchestrator hook: expose session celebration for delegation
    window._orchestratorShowCelebration = showInteractiveCelebrationFireworks;

    function checkIfDailyTargetMetJustNow() {
        let target = getDailyTarget() || 50;
        let logsToday = getSolvedTodayCount();
        let todayStr = getLocalDateString();
        if (logsToday >= target && target > 0) {
            if (!KrishiStorage.getItem('target_sound_played_' + todayStr)) {
                KrishiStorage.setItem('target_sound_played_' + todayStr, 'true');
                if (typeof playSound === 'function') {
                    playSound('celebrate');
                }
                showToast("🎯 Bravo! Today's practice MCQ goals successfully crushed!");
            }
        }
    }

    function retryWrongSession(){
        let wrongIds = state.sessionResults.filter(r=>!r.correct && r.id).map(r=>r.id);
        let pool = getAllQuestions().filter(q => wrongIds.includes(q.id));
        if(pool.length===0){ showToast('No corrections needed!'); return; }
        
        // Prevent previous session config (e.g. Mock Exam 'end' feedback) from bleeding into retry loop
        state.activeConfig = { 
            subject: 'Retry', topic: 'all', difficulty: 'all', 
            count: pool.length, timer: 'off', timerMin: 0, 
            perQTimer: 'off', perQSec: 0, negativeMarking: 'off', 
            feedback: 'immediate', shuffleQs: false, shuffleOpts: true, 
            isMock: false, isSpacedReview: false 
        };
        
        transitionResultToMcq(pool, false, 0);
    }


    // ==================== WRONG QUESTIONS REVIEW ====================
    function renderWrongPage(){
        let wrongQs = getAllQuestions().filter(q => localData.wrong.includes(q.id));
        document.getElementById('no-wrong-msg').classList.toggle('hidden', wrongQs.length>0);
        document.getElementById('practice-wrong-btn').classList.toggle('hidden', wrongQs.length===0);
        
        let list = document.getElementById('wrong-questions-list');
        list.innerHTML = wrongQs.map(q => `
            <div class="p-3.5 rounded-lg border text-xs leading-relaxed prunable-row" style="background:var(--card);border-color:var(--border);">
                <p class="font-bold">${q.q}</p>
                <p class="text-emerald-600 mt-1">✅ ${q.opts[q.ans]}</p>
                <button onclick="removeWrongId('${q.id || q.q}')" class="text-[10px] text-red-500 mt-1 underline block">Remove from mistake list</button>
            </div>
        `).join('');

        if (window.KrishiDOMPruner) {
            list.querySelectorAll('.prunable-row').forEach(row => {
                window.KrishiDOMPruner.observe(row);
            });
        }
    }

    function removeWrongId(id){
        localData.wrong = localData.wrong.filter(i => i !== id);
        saveData();
        renderWrongPage();
        showToast('Item removed!');
    }

    function practiceWrongQuestions(){
        let pool = getAllQuestions().filter(q => localData.wrong.includes(q.id));
        if(pool.length===0){ showToast('No wrong items to resolve!'); return; }
        setupMCQSession(pool, false, 0);
    }

    // ==================== SUBJECT / TOPICS MANAGER ====================
    let defaultSubjects = ['Agronomy', 'Soil Science', 'Horticulture', 'Plant Pathology'];
    function getAllSubjects(){
        let custom = [];
        try {
            let raw = KrishiStorage.getItem('krishi_custom_subjects');
            if (raw) {
                custom = JSON.parse(raw);
                if (!Array.isArray(custom)) {
                    console.warn('[PWA Safety] Custom subjects was not an array, auto-removing corrupted cache.');
                    KrishiStorage.removeItem('krishi_custom_subjects');
                    custom = [];
                }
            }
        } catch(e) {
            console.warn('[PWA Safety] Failed to parse custom subjects, auto-removing corrupted cache:', e);
            KrishiStorage.removeItem('krishi_custom_subjects');
            custom = [];
        }
        
        let dynamicSubjects = [];
        if (typeof getAllQuestions === 'function') {
            dynamicSubjects = getAllQuestions().map(q => q.sub).filter(s => s && typeof s === 'string');
        }

        return [...new Set([...defaultSubjects, ...custom, ...dynamicSubjects])];
    }

    function renderSubjectList(){
        let container = document.getElementById('subject-list'); if(!container) return;
        let subjects = getAllSubjects(); container.innerHTML = '';
        subjects.forEach(sub => {
            let isDef = defaultSubjects.includes(sub);
            container.innerHTML += `
                <div class="flex justify-between items-center p-2.5 border rounded-lg text-xs" style="background:var(--card);border-color:var(--border);">
                    <span>${sub} ${isDef?'<span class="text-[10px] opacity-50">(Default)</span>':''}</span>
                    ${!isDef?`<button onclick="removeSubject('${sub}')" class="text-red-500 font-bold">Delete</button>`:''}
                </div>
            `;
        });
    }

    // Subject add/remove write clocks, in the same shape as bookmarkedLog/wrongLog so
    // mergeCRDTLogs() can order them. Without a 'remove' record the merge unions the two
    // devices' lists and a deletion can never propagate — the peer would simply hand the
    // subject straight back. Keyed by name because that is the subject's only identity.
    const SUBJECT_LOG_KEY = 'krishi_custom_subjects_log';
    function logSubjectChange(name, action) {
        try {
            const log = safeJsonParse(KrishiStorage.getItem(SUBJECT_LOG_KEY), {}) || {};
            const rev = (log[name] && log[name]._rev) || 0;
            log[name] = { action: action, timestamp: Date.now(), _rev: rev + 1 };
            KrishiStorage.setItem(SUBJECT_LOG_KEY, JSON.stringify(log));
        } catch (e) { /* never block the subject edit itself */ }
    }

    function addSubject(){
        let input = document.getElementById('new-subject-input'); let val = input.value.trim();
        if(!val) { showToast('Subject name empty!'); return; }
        let custom = [];
        try {
            let raw = KrishiStorage.getItem('krishi_custom_subjects');
            if (raw) {
                custom = JSON.parse(raw);
                if (!Array.isArray(custom)) custom = [];
            }
        } catch(e) {
            console.warn('[PWA Safety] Failed to parse custom subjects in addSubject, auto-removing corrupted cache:', e);
            KrishiStorage.removeItem('krishi_custom_subjects');
            custom = [];
        }
        if(getAllSubjects().includes(val)) { showToast('Duplicate names not allowed!'); return; }
        custom.push(val);
        KrishiStorage.setItem('krishi_custom_subjects', JSON.stringify(custom));
        logSubjectChange(val, 'add');
        input.value = '';
        renderSubjectList();
        // This write previously reached localStorage only. Nothing called saveData() or
        // scheduleCloudSync(), so the new subject sat locally until some unrelated save
        // happened to flush it — the "takes lots of time" symptom.
        KrishiStorage.setItem('krishi_last_updated_at', Date.now());
        if (typeof scheduleCloudSync === 'function') scheduleCloudSync('Subject added');
        showToast('Subject Added!');
    }

    function removeSubject(name){
        let custom = [];
        try {
            let raw = KrishiStorage.getItem('krishi_custom_subjects');
            if (raw) {
                custom = JSON.parse(raw);
                if (!Array.isArray(custom)) custom = [];
            }
        } catch(e) {
            console.warn('[PWA Safety] Failed to parse custom subjects in removeSubject, auto-removing corrupted cache:', e);
            KrishiStorage.removeItem('krishi_custom_subjects');
            custom = [];
        }
        custom = custom.filter(s=>s!==name);
        KrishiStorage.setItem('krishi_custom_subjects', JSON.stringify(custom));
        logSubjectChange(name, 'remove');
        renderSubjectList();
        KrishiStorage.setItem('krishi_last_updated_at', Date.now());
        if (typeof scheduleCloudSync === 'function') scheduleCloudSync('Subject removed');
        showToast('Subject removed!');
    }

    // ==================== SCANNER / FILE CONVERSION ====================
    function processScan(){
        let text = document.getElementById('scan-input').value.trim();
    if(!text) { showToast('Please insert text to scan!'); return; }
    let sentences = text.split(/[.!?।]+/).filter(s=>s.trim().length > 15);
        if(sentences.length === 0){ showToast('Notes sentences are too short to compile!'); return; }
        
        let parsed = [];
        sentences.slice(0, 5).forEach((s, i)=>{
            let firstWord = s.trim().split(' ')[0] || 'Term';
            parsed.push({
                id: Date.now() + i,
                q: `What is directly linked with "${firstWord}" in: "${s.trim().substring(0, 50)}..."?`,
                opts: [firstWord, "Alternative option B", "Alternative option C", "None of the above"],
                ans: 0,
                expl: `Sourced from scanned notes: ${s.trim()}`,
                sub: "General"
            });
        });
        state.tempGeneratedQuestions = parsed;
        showEditMCQPage(parsed);
        navigate('page-edit-mcq');
    }

    async function processFile(){
        let input = document.getElementById('file-input'); let file = input.files[0];
        if(!file) { showToast('Select backup or txt file!'); return; }
        let status = document.getElementById('file-status');
        let txt = document.getElementById('file-extracted-text');
        
        status.textContent = 'Processing...';
        let name = file.name.toLowerCase();
        
        if(name.endsWith('.txt')){
            let reader = new FileReader();
            reader.onload = (e) => {
                txt.value = e.target.result;
                status.textContent = '✅ Read complete!';
                document.getElementById('generate-simple-btn').classList.remove('hidden');
                toggleAIButtonVisibility();
            };
            reader.readAsText(file);
        } else if(name.endsWith('.pdf')){
            try {
                status.textContent = 'Loading PDF engine...';
                await LazyLibs.ensurePdfjs();
            } catch(e) {
                status.textContent = '⚠️ PDF engine load failed (offline?)';
                return;
            }
            let reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    let data = new Uint8Array(e.target.result);
                    const pdf = await pdfjsLib.getDocument({ data }).promise;
                    const pagesText = [];
                    for (let i = 1; i <= pdf.numPages; i++) {
                        status.textContent = `Extracting PDF text... (${i}/${pdf.numPages})`;
                        const page = await pdf.getPage(i);
                        const tc = await page.getTextContent();
                        pagesText.push(tc.items.map(it => it.str).join(' '));
                        // Yield occasionally to keep UI responsive on large PDFs
                        if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
                    }
                    txt.value = pagesText.join('\n');
                    status.textContent = '✅ PDF Extracted!';
                    document.getElementById('generate-simple-btn').classList.remove('hidden');
                    toggleAIButtonVisibility();
                } catch(err) {
                    status.textContent = '⚠️ PDF read error!';
                }
            };
            reader.readAsArrayBuffer(file);
        } else if(name.indexOf('.png') > 0 || name.indexOf('.jpg') > 0 || name.indexOf('.jpeg') > 0) {
       try {
           status.textContent = 'Loading OCR engine...';
           await LazyLibs.ensureTesseract();
       } catch(e) {
           if (e.message === "offline") {
               status.textContent = '⚠️ अफलाइन! पहिलो पटक स्क्यान गर्न इन्टरनेट चाहिन्छ।';
               showToast('📡 तपाईं अफलाइन हुनुहुन्छ! पहिलो पटक फोटो स्क्यान गर्न इन्टरनेट चाहिन्छ। कृपया नोट पेस्ट गर्ने फिचर प्रयोग गर्नुहोस्।');
           } else {
               status.textContent = '⚠️ OCR engine load failed (offline?)';
           }
           return;
       }
            status.textContent = 'Sharpening handwriting image...';
            preprocessImageForOCR(file).then(processedFile => {
                status.textContent = 'Running OCR scanning...';
                Tesseract.recognize(processedFile, 'nep+eng', { logger: m => status.textContent = 'OCR: ' + Math.round(m.progress * 100) + '%' })
                  .then(r => {
                      txt.value = r.data.text;
                      status.textContent = '✅ OCR Finished!';
                      document.getElementById('generate-simple-btn').classList.remove('hidden');
                      toggleAIButtonVisibility();
                  }).catch(ocrErr => {
                      console.warn('[OCR] Recognition error:', ocrErr);
                      if (!navigator.onLine) {
                          status.textContent = '⚠️ अफलाइन! फोटो स्क्यानका लागि इन्टरनेट चाहिन्छ।';
                          showToast('📡 अफलाइन हुनुहुन्छ! फोटो स्क्यान गर्न इन्टरनेट चाहिन्छ।');
                      } else {
                          status.textContent = '⚠️ OCR process failed!';
                      }
                  });
            }).catch(err => {
                console.warn('[OCR Preprocessing] Preprocessor failed, trying original:', err);
                status.textContent = 'Running OCR scanning...';
                Tesseract.recognize(file, 'nep+eng', { logger: m => status.textContent = 'OCR: ' + Math.round(m.progress * 100) + '%' })
                  .then(r => {
                      txt.value = r.data.text;
                      status.textContent = '✅ OCR Finished!';
                      document.getElementById('generate-simple-btn').classList.remove('hidden');
                      toggleAIButtonVisibility();
                  }).catch(ocrErr => {
                      console.warn('[OCR Fallback] Recognition error:', ocrErr);
                      if (!navigator.onLine) {
                          status.textContent = '⚠️ अफलाइन! फोटो स्क्यानका लागि इन्टरनेट चाहिन्छ।';
                          showToast('📡 अफलाइन हुनुहुन्छ! फोटो स्क्यान गर्न इन्टरनेट चाहिन्छ।');
                      } else {
                          status.textContent = '⚠️ OCR process failed!';
                      }
                  });
            });
        } else {
            status.textContent = 'Unsupported format!';
        }
    }

    function generateFromFileText(){
        let text = document.getElementById('file-extracted-text').value.trim();
        if(!text) { showToast('Extracted text is empty!'); return; }
        
        let parsed = parseTXTQuestions(text);
        if (parsed.length === 0) {
            showToast('⚠️ No structured MCQs detected! Generating questions from raw sentences...');
            let sentences = text.split(/[.!?\n]+/).filter(s=>s.trim().length > 15);
            sentences.slice(0, 5).forEach((sentence, i)=>{
                let wrd = sentence.trim().split(' ')[0] || 'Concept';
                parsed.push({
                    id: Date.now() + i,
                    q: `Who or what relates to "${wrd}" in: "${sentence.trim().substring(0, 55)}..."?`,
                    opts: [wrd, "Alternate statement B", "Alternate statement C", "No statement valid"],
                    ans: 0,
                    expl: `Based on text extract: ${sentence.trim()}`,
                    sub: "General"
                });
            });
        }
        
        let normalized = parsed.map(raw => normalizeQuestion(raw));
        importPreviewQuestions = detectDuplicatesAndErrors(normalized);
        
        importSelectedIds = [];
        importPreviewQuestions.forEach((q, i) => {
            if (q.isValid && !q.isDuplicate) {
                importSelectedIds.push(i);
            }
        });

        document.getElementById('import-preview-area').classList.remove('hidden');
        document.getElementById('import-status').textContent = `📋 Parsed ${importPreviewQuestions.length} items from file!`;
        
        renderImportPreview();
        
        navigate('page-mcq-creator');
        switchCreatorTab('io');
        
        setTimeout(() => {
            let el = document.getElementById('import-preview-area');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        }, 300);

        showToast(`Parsed ${importPreviewQuestions.length} questions! Review in Import/Export tab.`, 3000);
    }

    // ==================== EDIT AND REVIEW GENERATED LIST ====================
    function showEditMCQPage(questions){
        let container = document.getElementById('edit-mcq-list'); container.innerHTML = '';
        let listHtml = '';
        questions.forEach((q, i) => {
            listHtml += `
                <div class="p-3 border rounded-xl space-y-2 text-xs bg-white dark:bg-slate-800" data-idx="${i}">
                    <label class="font-bold">Question ${i+1}</label>
                    <input class="w-full p-2 border rounded" value="${q.q.replace(/"/g, '&quot;')}" id="ed-q-${i}">
                    <input class="w-full p-2 border rounded" value="${(q.opts[0]||'')}" id="ed-o1-${i}">
                    <input class="w-full p-2 border rounded" value="${(q.opts[1]||'')}" id="ed-o2-${i}">
                    <input class="w-full p-2 border rounded" value="${(q.opts[2]||'')}" id="ed-o3-${i}">
                    <input class="w-full p-2 border rounded" value="${(q.opts[3]||'')}" id="ed-o4-${i}">
                    <div class="flex gap-2">
                        <select class="p-2 border rounded" id="ed-sub-${i}">
                            ${getAllSubjects().map(s=>`<option value="${s}" ${s===q.sub?'selected':''}>${s}</option>`).join('')}
                        </select>
                        <select class="p-2 border rounded" id="ed-ans-${i}">
                            <option value="0" ${q.ans===0?'selected':''}>A</option>
                            <option value="1" ${q.ans===1?'selected':''}>B</option>
                            <option value="2" ${q.ans===2?'selected':''}>C</option>
                            <option value="3" ${q.ans===3?'selected':''}>D</option>
                        </select>
                        <button onclick="removeGeneratedQ(${i})" class="text-red-500 font-bold ml-auto px-2">Delete</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = listHtml;
    }

    function removeGeneratedQ(idx){
        state.tempGeneratedQuestions.splice(idx, 1);
        showEditMCQPage(state.tempGeneratedQuestions);
    }

    function saveEditedMCQs(){
        let list = state.tempGeneratedQuestions;
        list.forEach((q, i)=>{
            let qText = document.getElementById('ed-q-'+i);
            if(qText){
                q.q = qText.value;
                q.opts = [
                    document.getElementById('ed-o1-'+i).value,
                    document.getElementById('ed-o2-'+i).value,
                    document.getElementById('ed-o3-'+i).value,
                    document.getElementById('ed-o4-'+i).value
                ];
                q.sub = document.getElementById('ed-sub-'+i).value;
                q.ans = parseInt(document.getElementById('ed-ans-'+i).value);
            }
        });
        localData.customQuestions = localData.customQuestions.concat(list);
        saveData();
        showToast(`✅ Saved ${list.length} questions successfully!`);
        state.tempGeneratedQuestions = [];
        navigate('page-mcq-creator');
    }

    // ==================== MANUAL MCQ CREATOR ====================
    let quillQ; let quillExpl;
    async function initCreatorPage(){
        let subjects = getAllSubjects();
        let addSel = document.getElementById('cr-sub');
        if(addSel){
            addSel.innerHTML = '';
            subjects.forEach(s => addSel.innerHTML += `<option value="${s}">${s}</option>`);
        }
        let filterSel = document.getElementById('manage-filter-sub');
        if(filterSel){
            filterSel.innerHTML = '<option value="all">All subjects</option>';
            subjects.forEach(s => filterSel.innerHTML += `<option value="${s}">${s}</option>`);
        }
        // Admin categories select init
        populateAdminSubjects();

        if(!quillQ){
            try {
                await LazyLibs.ensureQuill();
            } catch(e) {
                showToast('⚠️ Editor load failed (offline?)');
                return;
            }
            quillQ = new Quill('#cr-q-editor', { theme: 'snow', modules: { toolbar: [['bold', 'italic', 'underline'], [{ 'list': 'bullet' }]] } });
            quillExpl = new Quill('#cr-expl-editor', { theme: 'snow', modules: { toolbar: [['bold', 'italic']] } });
            
            quillQ.on('text-change', () => {
                document.getElementById('cr-q').value = quillQ.root.innerHTML;
                updateCreatorPreview();
            });
            quillExpl.on('text-change', () => { document.getElementById('cr-expl').value = quillExpl.root.innerHTML; });
        }
        updateOptionCount();
    }

    function switchCreatorTab(tab){
        currentCreatorTab = tab;
        document.querySelectorAll('#creator-tabs button').forEach(b => b.classList.remove('active'));
        let activeBtn = document.getElementById('ctab-'+tab); if(activeBtn) activeBtn.classList.add('active');
        
        let panelIds = ['creator-panel-add', 'creator-panel-bulk', 'creator-panel-manage', 'creator-panel-io'];
        panelIds.forEach(id => {
            let el = document.getElementById(id);
            if(el) el.classList.add('hidden');
        });
        document.getElementById('creator-panel-'+tab).classList.remove('hidden');

        if(tab==='manage') scheduleRenderQuestionList(true);
    }

    function updateOptionCount(){
        let count = parseInt(document.getElementById('cr-opt-count').value)||4;
        for (let i = 0; i < 5; i++) {
            let el = document.getElementById('cr-o' + i);
            if (el) {
                let wrapper = el.parentElement;
                if (i < count) wrapper.classList.remove('hidden');
                else wrapper.classList.add('hidden');
            }
        }
        let ansSelect = document.getElementById('cr-ans');
        if(ansSelect){
            ansSelect.innerHTML = '';
            for(let i=0; i<count; i++){
                ansSelect.innerHTML += `<option value="${i}">${String.fromCharCode(65+i)}</option>`;
            }
        }
        updateCreatorPreview();
    }

    function updateCreatorPreview(){
        let qText = document.getElementById('cr-q').value.trim();
        let preview = document.getElementById('cr-preview'); if(!preview) return;
        if(!qText) { preview.classList.add('hidden'); return; }
        
        preview.classList.remove('hidden');
        document.getElementById('cr-preview-q').innerHTML = qText;
        
        let count = parseInt(document.getElementById('cr-opt-count').value)||4;
        let optsHtml = '';
        for(let i=0; i<count; i++){
            let val = document.getElementById('cr-o'+i).value.trim() || 'Empty';
            optsHtml += `<p>${String.fromCharCode(65+i)}. ${val}</p>`;
        }
        document.getElementById('cr-preview-opts').innerHTML = optsHtml;
        let ansIdx = parseInt(document.getElementById('cr-ans').value)||0;
        document.getElementById('cr-preview-ans').textContent = '✅ Correct Answer: ' + String.fromCharCode(65+ansIdx);
    }

    // Attach preview event listeners
    ['cr-o0', 'cr-o1', 'cr-o2', 'cr-o3', 'cr-o4', 'cr-ans', 'cr-opt-count'].forEach(id => {
        let el = document.getElementById(id); if(el) el.addEventListener('input', updateCreatorPreview);
    });

    function collectFormQuestion(){
        let count = parseInt(document.getElementById('cr-opt-count').value)||4;
        let opts = [];
        for(let i=0; i<count; i++){
            opts.push(document.getElementById('cr-o'+i).value.trim());
        }
        return {
            id: Date.now(),
            q: document.getElementById('cr-q').value,
            opts: opts,
            ans: parseInt(document.getElementById('cr-ans').value)||0,
            expl: document.getElementById('cr-expl').value,
            sub: document.getElementById('cr-sub').value,
            topic: document.getElementById('cr-topic').value,
            difficulty: document.getElementById('cr-difficulty').value,
            marks: parseInt(document.getElementById('cr-marks').value)||1,
            status: document.getElementById('cr-status').value
        };
    }

    function validateQuestion(q){
        if(!q.q || q.q.length < 5) return {valid:false, error:"Question details is too short!"};
        if(q.opts.some(o=>!o)) return {valid:false, error:"Please fill in all available options!"};
        return {valid:true};
    }

    function addSingleQuestion(){
        let q = collectFormQuestion();
        let val = validateQuestion(q);
        if(!val.valid) { showToast('⚠️ ' + val.error); return; }
        
        localData.customQuestions.push(q);
        saveData();
        showToast('✅ Saved successfully!');
        resetCreatorForm(!document.getElementById('cr-keep-subject').checked);
    }

    function addToTempBatch(){
        let q = collectFormQuestion();
        let val = validateQuestion(q);
        if(!val.valid) { showToast('⚠️ ' + val.error); return; }
        
        tempBatch.push(q);
        showToast(`📦 Question added to current batch list! (${tempBatch.length})`);
        resetCreatorForm(!document.getElementById('cr-keep-subject').checked);
        updateBatchUI();
    }

    function saveBatchQuestions(){
        localData.customQuestions = localData.customQuestions.concat(tempBatch);
        saveData();
        showToast(`Saved complete ${tempBatch.length} items to database!`);
        tempBatch = [];
        updateBatchUI();
    }

    function updateBatchUI(){
        document.getElementById('batch-count').textContent = tempBatch.length;
        document.getElementById('batch-count-btn').textContent = tempBatch.length;
        document.getElementById('save-batch-btn').classList.toggle('hidden', tempBatch.length===0);
    }

    function resetCreatorForm(clearTopic){
        document.getElementById('cr-q').value = '';
        quillQ.setText(''); quillExpl.setText('');
        for(let i=0;i<5;i++){
            let el = document.getElementById('cr-o'+i); if(el) el.value = '';
        }
        document.getElementById('cr-ans').selectedIndex = 0;
        if (clearTopic) {
            document.getElementById('cr-topic').value = '';
        }
        document.getElementById('cr-preview').classList.add('hidden');
    }

    // ==================== CREATOR FILE HANDLERS (IO) ====================
    function parseCSV(text) {
        let lines = [];
        let row = [""];
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            let c = text[i];
            let next = text[i + 1];
            if (c === '"') {
                if (inQuotes && next === '"') {
                    row[row.length - 1] += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c === ',' && !inQuotes) {
                row.push("");
            } else if ((c === '\r' || c === '\n') && !inQuotes) {
                if (c === '\r' && next === '\n') {
                    i++;
                }
                lines.push(row);
                row = [""];
            } else {
                row[row.length - 1] += c;
            }
        }
        if (row.length > 1 || row[0] !== "") {
            lines.push(row);
        }
        return lines.map(cols => cols.map(col => col.trim()));
    }

    function normalizeCorrectAnswer(rawAns, opts) {
        if (rawAns === undefined || rawAns === null) return -1;
        let str = String(rawAns).trim();
        if (str.length === 0) return -1;
        
        let cleanOpts = opts.map(o => String(o || "").trim().toLowerCase());
        
        // 1. Full option text match
        let optIdx = cleanOpts.indexOf(str.toLowerCase());
        if (optIdx !== -1) return optIdx;
        
        // 2. Letter match: A, B, C, D, E/1, 2, 3, 4, 5
        let letterMatch = str.match(/^[A-Ea-e](?:\.|\))?$/);
        if (letterMatch) {
            let letter = letterMatch[0][0].toUpperCase();
            return letter.charCodeAt(0) - 65;
        }

        // Nepali letter match: क, ख, ग, घ
        let nepMatch = str.match(/^[कखगघ](?:\.|\))?$/);
        if (nepMatch) {
            let ch = nepMatch[0][0];
            if (ch === 'क') return 0;
            if (ch === 'ख') return 1;
            if (ch === 'ग') return 2;
            if (ch === 'घ') return 3;
        }

        // English letter match anywhere in string fallback (e.g. "Answer is B")
        let engFallback = str.match(/\b([A-Ea-e])\b/);
        if (engFallback) {
            return engFallback[1].toUpperCase().charCodeAt(0) - 65;
        }

        // Nepali letter match anywhere in string fallback (e.g. "उत्तर ख हो")
        let nepFallback = str.match(/\b([कखगघ])\b|([कखगघ])/);
        if (nepFallback) {
            let ch = nepFallback[1] || nepFallback[2];
            if (ch === 'क') return 0;
            if (ch === 'ख') return 1;
            if (ch === 'ग') return 2;
            if (ch === 'घ') return 3;
        }
        
        // 3. Number index (0-based or 1-based)
        let num = parseInt(str);
        if (!isNaN(num)) {
            if (num >= 0 && num < opts.length) {
                return num; // assume 0-based
            } else if (num >= 1 && num <= opts.length) {
                return num - 1; // assume 1-based
            }
        }
        return -1;
    }

    function normalizeSubjectCasing(subjectStr) {
        if (subjectStr === undefined || subjectStr === null) return "General";
        let s = String(subjectStr).trim();
        if (!s) return "General";
        
        let trimmedLower = s.toLowerCase();
        // Case-insensitive match against default subjects
        for (let defSub of ['Agronomy', 'Soil Science', 'Horticulture', 'Plant Pathology']) {
            if (defSub.toLowerCase() === trimmedLower) {
                return defSub;
            }
        }
        
        // Title-case the custom subject words
        return s.split(/\s+/).map(word => {
            if (!word) return "";
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }).join(' ');
    }

    function registerCustomSubjectsFromQuestions(questions) {
        if (!questions || !Array.isArray(questions)) return;
        const activeQuestions = questions.filter(q => !q.deleted);
        let subjects = getAllSubjects();
        let subjectsLower = subjects.map(s => s.toLowerCase());
        
        let newCustom = [];
        try {
            let raw = KrishiStorage.getItem('krishi_custom_subjects');
            if (raw) {
                newCustom = JSON.parse(raw);
                if (!Array.isArray(newCustom)) newCustom = [];
            }
        } catch(e) {
            newCustom = [];
        }
        
        let addedAny = false;
        activeQuestions.forEach(q => {
            if (q.sub) {
                let normSub = q.sub; // q.sub is already normalized
                let subLower = normSub.toLowerCase();
                if (!subjectsLower.includes(subLower)) {
                    newCustom.push(normSub);
                    subjects.push(normSub);
                    subjectsLower.push(subLower);
                    addedAny = true;
                }
            }
        });
        
        if (addedAny) {
            // Exclude defaults and keep unique only
            newCustom = newCustom.filter(s => {
                let trimS = s.trim();
                if (!trimS) return false;
                let isDefault = ['Agronomy', 'Soil Science', 'Horticulture', 'Plant Pathology'].some(def => def.toLowerCase() === trimS.toLowerCase());
                return !isDefault;
            });
            newCustom = [...new Set(newCustom)];
            KrishiStorage.setItem('krishi_custom_subjects', JSON.stringify(newCustom));
            // Log these as adds too. A subject removed on another device carries a 'remove'
            // tombstone, and without a newer 'add' here the merge would keep deleting a
            // subject that this device's questions still reference.
            newCustom.forEach(s => logSubjectChange(s, 'add'));
            console.log('[PWA Safety] Auto-registered custom subjects:', newCustom);
            
            // Dynamic refresh of subjects UI lists
            let container = document.getElementById('subject-list');
            if (container) {
                try { renderSubjectList(); } catch(e) {}
            }
        }
    }

    function normalizeQuestion(raw) {
        let q = raw.q || raw.question || raw.Question || raw.question_text || raw.questionText || raw.text || raw.query || raw.prompt || "";
        q = String(q).trim();

        let opts = [];
        let optSource = null;
        if (raw.opts && Array.isArray(raw.opts)) optSource = raw.opts;
        else if (raw.options && Array.isArray(raw.options)) optSource = raw.options;
        else if (raw.choices && Array.isArray(raw.choices)) optSource = raw.choices;
        else if (raw.Opts && Array.isArray(raw.Opts)) optSource = raw.Opts;
        else if (raw.Options && Array.isArray(raw.Options)) optSource = raw.Options;
        else if (raw.Choices && Array.isArray(raw.Choices)) optSource = raw.Choices;
        else if (raw.opts && typeof raw.opts === 'object') optSource = raw.opts;
        else if (raw.options && typeof raw.options === 'object') optSource = raw.options;
        else if (raw.choices && typeof raw.choices === 'object') optSource = raw.choices;
        else if (raw.Opts && typeof raw.Opts === 'object') optSource = raw.Opts;
        else if (raw.Options && typeof raw.Options === 'object') optSource = raw.Options;
        else if (raw.Choices && typeof raw.Choices === 'object') optSource = raw.Choices;
        else optSource = raw; // default to looking in the top-level raw object

        if (Array.isArray(optSource)) {
            opts = optSource;
        } else if (optSource && typeof optSource === 'object') {
            let tempOpts = {};
            for (let k in optSource) {
                let keyTrim = k.trim();
                let keyLower = keyTrim.toLowerCase();
                let m = keyLower.match(/^(?:option|opt|choice|o|ch)[_-]?([a-e1-5])$/);
                if (m) {
                    tempOpts[m[1]] = optSource[k];
                } else {
                    let singleMatch = keyTrim.match(/^[A-E1-5]$/i);
                    if (singleMatch) {
                        tempOpts[singleMatch[0].toLowerCase()] = optSource[k];
                    }
                }
            }
            
            let keys = Object.keys(tempOpts).sort();
            if (keys.length > 0) {
                let isLetter = keys.some(k => /[a-e]/.test(k));
                if (isLetter) {
                    ['a', 'b', 'c', 'd', 'e'].forEach(letter => {
                        if (tempOpts[letter] !== undefined) opts.push(tempOpts[letter]);
                    });
                } else {
                    ['1', '2', '3', '4', '5'].forEach(num => {
                        if (tempOpts[num] !== undefined) opts.push(tempOpts[num]);
                    });
                }
            }
        }
        opts = opts.map(o => o !== undefined && o !== null ? String(o).trim() : "");
        while (opts.length > 0 && opts[opts.length - 1] === "") {
            opts.pop();
        }

        let rawAns = undefined;
        let ansKeys = [
            'correctAnswerIndex',
            'correctIndex',
            'answerIndex',
            'answer',
            'correct',
            'correctAnswer',
            'ans',
            'correct_answer',
            'correct_index',
            'correctOption',
            'correctanswer',
            'CorrectAnswerIndex',
            'CorrectIndex',
            'AnswerIndex',
            'Answer',
            'Correct',
            'CorrectAnswer',
            'Ans',
            'Correct_answer',
            'Correct_index',
            'CorrectOption',
            'Correctanswer',
            'उत्तर',
            'सही_उत्तर',
            'सहीउत्तर'
        ];
        for (let key of ansKeys) {
            if (raw[key] !== undefined) {
                rawAns = raw[key];
                break;
            }
        }

        let ans = normalizeCorrectAnswer(rawAns, opts);

        let sub = raw.sub || raw.subject || raw.Subject || raw.category || raw.Category || raw.topic || raw.Topic || "General";
        sub = normalizeSubjectCasing(sub);

        let expl = raw.expl || raw.Expl || raw.explanation || raw.Explanation || raw.notes || raw.Notes || raw.desc || raw.Desc || raw.description || raw.Description || "";
        expl = String(expl).trim();

        let topic = raw.topic || raw.Topic || raw.chapter || raw.Chapter || raw.unit || raw.Unit || "";
        topic = String(topic).trim();

        let difficulty = raw.difficulty || raw.Difficulty || raw.level || raw.Level || raw.diff || raw.Diff || "Medium";
        difficulty = String(difficulty).trim();
        if (difficulty.toLowerCase() === "easy") difficulty = "Easy";
        else if (difficulty.toLowerCase() === "hard") difficulty = "Hard";
        else difficulty = "Medium";

        let marks = parseInt(raw.marks || raw.Marks || raw.points || raw.Points || raw.score || raw.Score) || 1;
        let status = raw.status || raw.Status || raw.state || raw.State || "published";

        return {
            id: raw.id || (Date.now() + Math.random()),
            q: q,
            opts: opts,
            ans: ans,
            sub: sub,
            expl: expl,
            topic: topic,
            difficulty: difficulty,
            marks: marks,
            status: status,
            
            // Sync & CRDT properties
            deleted: raw.deleted || false,
            updatedAt: (function() {
                let val = Number(raw.updatedAt);
                if (!isNaN(val) && val > 0) return val;
                val = Number(raw.id);
                if (!isNaN(val) && val > 0) return val;
                return Date.now();
            })(),

            // Dual formats to maintain absolute safety with external format requests
            question: q,
            options: opts,
            correctAnswerIndex: ans,
            explanation: expl,
            subject: sub,
            tags: raw.tags || [],
            source: raw.source || ""
        };
    }

    function parseCSVQuestions(text) {
        let rows = parseCSV(text);
        if (rows.length === 0) return [];

        let questions = [];
        let firstRow = rows[0];

        let isHeader = firstRow.some(col => {
            let cl = col.toLowerCase().trim();
            return cl.includes("question") || cl === "q" || cl.includes("option") || cl === "subject" || cl === "sub" || cl.includes("correct") || cl.includes("answer") || cl === "explanation" || cl === "expl";
        });

        let colMap = { q: -1, opts: [], ans: -1, sub: -1, expl: -1, topic: -1, difficulty: -1, marks: -1, status: -1 };

        if (isHeader) {
            firstRow.forEach((col, idx) => {
                let cl = col.toLowerCase().trim();
                if (cl === "q" || cl === "question" || cl === "question text" || cl === "question_text" || cl === "text") {
                    colMap.q = idx;
                } else if (cl === "option a" || cl === "option_a" || cl === "opta" || cl === "opt a" || cl === "a" || cl === "option 1" || cl === "option1" || cl === "opt1") {
                    colMap.opts[0] = idx;
                } else if (cl === "option b" || cl === "option_b" || cl === "optb" || cl === "opt b" || cl === "b" || cl === "option 2" || cl === "option2" || cl === "opt2") {
                    colMap.opts[1] = idx;
                } else if (cl === "option c" || cl === "option_c" || cl === "optc" || cl === "opt c" || cl === "c" || cl === "option 3" || cl === "option3" || cl === "opt3") {
                    colMap.opts[2] = idx;
                } else if (cl === "option d" || cl === "option_d" || cl === "optd" || cl === "opt d" || cl === "d" || cl === "option 4" || cl === "option4" || cl === "opt4") {
                    colMap.opts[3] = idx;
                } else if (cl === "option e" || cl === "option_e" || cl === "opte" || cl === "opt e" || cl === "e" || cl === "option 5" || cl === "option5" || cl === "opt5") {
                    colMap.opts[4] = idx;
                } else if (cl === "correct index" || cl === "correct_index" || cl === "correct" || cl === "correct answer" || cl === "correct_answer" || cl === "ans" || cl === "answer" || cl === "key" || cl === "correct option" || cl === "correctoption") {
                    colMap.ans = idx;
                } else if (cl === "subject" || cl === "sub" || cl === "category") {
                    colMap.sub = idx;
                } else if (cl === "explanation" || cl === "expl" || cl === "notes" || cl === "desc" || cl === "description") {
                    colMap.expl = idx;
                } else if (cl === "topic" || cl === "chapter" || cl === "unit") {
                    colMap.topic = idx;
                } else if (cl === "difficulty" || cl === "level" || cl === "diff") {
                    colMap.difficulty = idx;
                } else if (cl === "marks" || cl === "points" || cl === "score") {
                    colMap.marks = idx;
                } else if (cl === "status" || cl === "state") {
                    colMap.status = idx;
                }
            });
        }

        let startRow = isHeader ? 1 : 0;
        for (let i = startRow; i < rows.length; i++) {
            let cols = rows[i];
            if (cols.length === 0 || (cols.length === 1 && cols[0] === "")) continue;

            let raw = {};
            if (isHeader) {
                if (colMap.q !== -1) raw.q = cols[colMap.q];
                
                let rawOpts = [];
                for (let o = 0; o < 5; o++) {
                    let colIdx = colMap.opts[o];
                    if (colIdx !== undefined && colIdx !== -1 && colIdx < cols.length) {
                        rawOpts.push(cols[colIdx]);
                    }
                }
                raw.opts = rawOpts;
                if (colMap.ans !== -1) raw.ans = cols[colMap.ans];
                if (colMap.sub !== -1) raw.sub = cols[colMap.sub];
                if (colMap.expl !== -1) raw.expl = cols[colMap.expl];
                if (colMap.topic !== -1) raw.topic = cols[colMap.topic];
                if (colMap.difficulty !== -1) raw.difficulty = cols[colMap.difficulty];
                if (colMap.marks !== -1) raw.marks = cols[colMap.marks];
                if (colMap.status !== -1) raw.status = cols[colMap.status];
                
            } else {
                raw.q = cols[0];
                if (cols.length === 6) {
                    raw.opts = [cols[1], cols[2], cols[3], cols[4]];
                    raw.ans = cols[5];
                } else if (cols.length >= 7) {
                    let isOptE = cols[5].length > 4 || (Number.isNaN(parseInt(cols[5])) && cols[5].length > 1);
                    if (isOptE) {
                        raw.opts = [cols[1], cols[2], cols[3], cols[4], cols[5]];
                        raw.ans = cols[6];
                        if (cols.length >= 8) raw.sub = cols[7];
                        if (cols.length >= 9) raw.expl = cols[8];
                    } else {
                        raw.opts = [cols[1], cols[2], cols[3], cols[4]];
                        raw.ans = cols[5];
                        raw.sub = cols[6];
                        if (cols.length >= 8) raw.expl = cols[7];
                    }
                } else if (cols.length === 5) {
                    raw.opts = [cols[1], cols[2], cols[3]];
                    raw.ans = cols[4];
                } else if (cols.length === 4) {
                    raw.opts = [cols[1], cols[2]];
                    raw.ans = cols[3];
                }
            }
            questions.push(raw);
        }
        return questions;
    }

    function parseTXTQuestions(text) {
        let lines = text.split(/\r?\n/);
        let questions = [];
        let curQ = null;
        let parseState = 'question'; // 'question', 'options', 'explanation', 'other'
        
        // Match numbers like 1, 2 or Nepali numbers like १, २ and prefixes like Q:, Question:, प्रश्न:, प्र.
        const qNumRegex = /^(?:[qQ]uestion|[qQ])\s*[:.)-]?\s*\d+|^\d+[\s.-]+[.)-]?|^[१२३४५६७८९०]+[\s.-]+[.)-]?|^[qQ]\d+[:.)-]?|^(?:प्रश्न|प्र\s*\.?)\s*\d*[:ः.)-]?/;
        // Match options starting with A-E, 1-5 or Nepali letters क, ख, ग, घ
        const optRegex = /^(?:[A-Ea-e1-5कखगघ]|[a-eA-E1-5कखगघ])(?:\.|\)|-)\s*|^\(\s*(?:[A-Ea-e1-5कखगघ]|[a-eA-E1-5कखगघ])\s*\)\s*/;
        
        function commitCurrent() {
            if (curQ) {
                curQ.q = curQ.q.trim();
                curQ.opts = curQ.opts.map(o => o.trim()).filter(o => o.length > 0);
                curQ.expl = curQ.expl.trim();
                curQ.sub = curQ.sub.trim() || 'General';
                curQ.topic = curQ.topic.trim();
                curQ.difficulty = curQ.difficulty.trim() || 'Medium';
                
                if (curQ.q || curQ.opts.length > 0) {
                    questions.push(curQ);
                }
            }
            curQ = null;
        }
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line.length === 0) continue;
            
            let lower = line.toLowerCase();
            
            // 1. Metadata attributes
            if (lower.startsWith('subject:') || lower.startsWith('sub:') || lower.startsWith('विषय:')) {
                let startIdx = lower.startsWith('subject:') ? 8 : (lower.startsWith('sub:') ? 4 : 5);
                let val = line.substring(startIdx).trim();
                if (curQ) curQ.sub = val;
                continue;
            }
            if (lower.startsWith('topic:') || lower.startsWith('chapter:') || lower.startsWith('शीर्षक:')) {
                let startIdx = lower.startsWith('topic:') ? 6 : (lower.startsWith('chapter:') ? 8 : 7);
                let val = line.substring(startIdx).trim();
                if (curQ) curQ.topic = val;
                continue;
            }
            if (lower.startsWith('difficulty:') || lower.startsWith('level:') || lower.startsWith('स्तर:')) {
                let startIdx = lower.startsWith('difficulty:') ? 11 : (lower.startsWith('level:') ? 6 : 5);
                let val = line.substring(startIdx).trim();
                if (curQ) curQ.difficulty = val;
                continue;
            }
            if (lower.startsWith('marks:') || lower.startsWith('points:') || lower.startsWith('अङ्क:')) {
                let startIdx = lower.startsWith('marks:') ? 6 : (lower.startsWith('points:') ? 7 : 4);
                let val = parseInt(line.substring(startIdx).trim()) || 1;
                if (curQ) curQ.marks = val;
                continue;
            }
            
            // 2. Correct Answer
            if (lower.startsWith('answer:') || lower.startsWith('correct:') || lower.startsWith('ans:') || lower.startsWith('key:') ||
                lower.startsWith('उत्तर:') || lower.startsWith('उत्तरः') || lower.startsWith('सही उत्तर:') || lower.startsWith('सही उत्तरः') ||
                lower.startsWith('कुन:')) {
                
                let startIdx = 0;
                if (lower.startsWith('answer:')) startIdx = 7;
                else if (lower.startsWith('correct:')) startIdx = 8;
                else if (lower.startsWith('ans:')) startIdx = 4;
                else if (lower.startsWith('key:')) startIdx = 4;
                else if (lower.startsWith('उत्तर:')) startIdx = 6;
                else if (lower.startsWith('उत्तरः')) startIdx = 6;
                else if (lower.startsWith('सही उत्तर:')) startIdx = 10;
                else if (lower.startsWith('सही उत्तरः')) startIdx = 10;
                else if (lower.startsWith('कुन:')) startIdx = 4;
                
                let val = line.substring(startIdx).trim();
                if (curQ) curQ.ans = val;
                parseState = 'other';
                continue;
            }
            
            // 3. Explanation
            if (lower.startsWith('explanation:') || lower.startsWith('expl:') || lower.startsWith('व्याख्या:') || lower.startsWith('व्याख्याः') || lower.startsWith('विवरण:')) {
                let startIdx = 0;
                if (lower.startsWith('explanation:')) startIdx = 12;
                else if (lower.startsWith('expl:')) startIdx = 5;
                else if (lower.startsWith('व्याख्या:')) startIdx = 8;
                else if (lower.startsWith('व्याख्याः')) startIdx = 8;
                else if (lower.startsWith('विवरण:')) startIdx = 6;
                
                let val = line.substring(startIdx).trim();
                if (curQ) curQ.expl = val;
                parseState = 'explanation';
                continue;
            }
            
            // 4. Check for New Question Start
            if (qNumRegex.test(line)) {
                commitCurrent();
                curQ = {
                    q: line.replace(qNumRegex, '').trim(),
                    opts: [],
                    ans: '',
                    expl: '',
                    sub: 'General',
                    topic: '',
                    difficulty: 'Medium',
                    marks: 1,
                    status: 'published'
                };
                parseState = 'question';
                continue;
            }
            
            // 5. Check for Option Line
            if (optRegex.test(line) && curQ) {
                let optText = line.replace(optRegex, '').trim();
                curQ.opts.push(optText);
                parseState = 'options';
                continue;
            }
            
            // 6. Generic Text Accumulation
            if (curQ) {
                if (parseState === 'question') {
                    curQ.q += ' ' + line;
                } else if (parseState === 'explanation') {
                    curQ.expl += ' ' + line;
                } else if (parseState === 'options') {
                    if (line.includes('?') && !line.match(/^[A-Ea-e1-5कखगघ]/)) {
                        // Fallback new question detector
                        commitCurrent();
                        curQ = {
                            q: line,
                            opts: [],
                            ans: '',
                            expl: '',
                            sub: 'General',
                            topic: '',
                            difficulty: 'Medium',
                            marks: 1,
                            status: 'published'
                        };
                        parseState = 'question';
                    } else if (curQ.opts.length > 0) {
                        curQ.opts[curQ.opts.length - 1] += ' ' + line;
                    }
                } else {
                    if (curQ.opts.length === 0) {
                        curQ.q += ' ' + line;
                        parseState = 'question';
                    }
                }
            } else {
                curQ = {
                    q: line,
                    opts: [],
                    ans: '',
                    expl: '',
                    sub: 'General',
                    topic: '',
                    difficulty: 'Medium',
                    marks: 1,
                    status: 'published'
                };
                parseState = 'question';
            }
        }
        commitCurrent();
        return questions;
    }

    function parseJSONQuestions(text) {
        let cleanText = (text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
        let parsed = null;
        try {
            parsed = JSON.parse(cleanText);
        } catch(e) {
            console.warn('[AI Parse] Direct JSON parse failed, trying array extraction:', e);
            let firstBracket = cleanText.indexOf('[');
            let lastBracket = cleanText.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                try {
                    parsed = JSON.parse(cleanText.substring(firstBracket, lastBracket + 1));
                } catch(e2){}
            }
        }
        if (!parsed) return [];
        let rawList = [];
        if (Array.isArray(parsed)) {
            rawList = parsed;
        } else if (parsed && typeof parsed === "object") {
            let arrKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
            if (arrKey) {
                rawList = parsed[arrKey];
            } else {
                if (parsed.q || parsed.question) {
                    rawList = [parsed];
                } else {
                    throw new Error("JSON structure is missing questions array.");
                }
            }
        } else {
            throw new Error("Parsed content is not a valid JSON structure.");
        }
        return rawList;
    }

    function validateImportQuestion(q) {
        let errors = [];
        let quesText = q.q !== undefined ? q.q : q.question;
        let optionsList = q.opts !== undefined ? q.opts : q.options;
        let correctAns = q.ans !== undefined ? q.ans : q.correctAnswerIndex;

        if (!quesText || String(quesText).trim().length === 0) {
            errors.push("Missing question text.");
        }
        
        let validOpts = (optionsList || []).filter(o => o !== undefined && o !== null && String(o).trim().length > 0);
        if (validOpts.length < 2) {
            errors.push("Must have at least 2 non-empty options.");
        }
        
        if (correctAns === undefined || correctAns === null || correctAns === -1) {
            errors.push("Missing correct answer.");
        } else {
            let ansIdx = parseInt(correctAns);
            if (isNaN(ansIdx) || ansIdx < 0 || ansIdx >= (optionsList || []).length) {
                errors.push(`Correct answer index (${correctAns}) is out of options range (0 to ${(optionsList || []).length - 1}).`);
            } else if (!optionsList[ansIdx] || String(optionsList[ansIdx]).trim().length === 0) {
                errors.push(`Correct answer index points to an empty option.`);
            }
        }
        return errors;
    }

    function getNormalizedText(txt) {
        if (!txt) return "";
        let plain = String(txt).replace(/<\/?[^>]+(>|$)/g, ""); // strip HTML tags
        return plain.toLowerCase().replace(/[^a-z0-9]/g, ""); // strip non-alphanumeric
    }

    function detectDuplicatesAndErrors(questions) {
        let allExisting = getAllQuestions();
        let existingNorms = allExisting.map(eq => getNormalizedText(eq.q));
        
        let processed = [];
        let currentBatchNorms = [];
        
        questions.forEach((q, idx) => {
            let errors = validateImportQuestion(q);
            let qNorm = getNormalizedText(q.q);
            
            let isDup = false;
            let dupSource = "";
            
            if (qNorm && qNorm.length > 0) {
                let existingIdx = existingNorms.indexOf(qNorm);
                if (existingIdx !== -1) {
                    isDup = true;
                    let matchedQ = allExisting[existingIdx];
                    dupSource = matchedQ.sub ? `Matches existing item in subject '${matchedQ.sub}'` : "Matches an existing question";
                } else {
                    let batchDupIdx = currentBatchNorms.indexOf(qNorm);
                    if (batchDupIdx !== -1) {
                        isDup = true;
                        dupSource = `Duplicate of item #${batchDupIdx + 1} in this import batch`;
                    }
                }
            }
            
            if (qNorm) {
                currentBatchNorms.push(qNorm);
            } else {
                currentBatchNorms.push("");
            }
            
            processed.push({
                ...q,
                errors: errors,
                isValid: errors.length === 0,
                isDuplicate: isDup,
                duplicateSource: dupSource
            });
        });
        return processed;
    }

    function importQuestions() {
        let fileInput = document.getElementById('import-file'); let file = fileInput.files[0];
        let status = document.getElementById('import-status');
        if (!file) { status.textContent = '❌ Target file empty!'; return; }
        
        let reader = new FileReader();
        reader.onload = function(e) {
            let text = e.target.result;
            let ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
            let rawQuestions = [];

            try {
                if (ext === '.json') {
                    rawQuestions = parseJSONQuestions(text);
                } else if (ext === '.csv') {
                    rawQuestions = parseCSVQuestions(text);
                } else if (ext === '.txt') {
                    rawQuestions = parseTXTQuestions(text);
                } else {
                    showToast('Unsupported file format for importer!');
                    status.textContent = '❌ Unsupported format!';
                    return;
                }
                
                if (rawQuestions.length === 0) {
                    status.textContent = '❌ Passed file contains no valid structure!';
                    showToast('No questions found in file!');
                    return;
                }

                // Match fields & normalize structures
                let normalized = rawQuestions.map(raw => normalizeQuestion(raw));
                
                // Identify valid status, issues, and duplicates
                importPreviewQuestions = detectDuplicatesAndErrors(normalized);
                
                // Set default selections: valid non-duplicates only!
                importSelectedIds = [];
                importPreviewQuestions.forEach((q, i) => {
                    if (q.isValid && !q.isDuplicate) {
                        importSelectedIds.push(i);
                    }
                });

                document.getElementById('import-preview-area').classList.remove('hidden');
                status.textContent = `📋 Parsed ${importPreviewQuestions.length} items successfully!`;
                
                renderImportPreview();
                showToast('Parsing finished! Scroll down to preview.', 3000);
            } catch (err) {
                status.textContent = `⚠️ Parsing error: ${err.message}`;
                showToast('Parsing failed! Check exact error logs.');
                console.error(err);
            }
        };
        reader.onerror = function() {
            status.textContent = '⚠️ Read file failure!';
        };
        reader.readAsText(file);
    }

    function renderImportPreview() {
        let list = document.getElementById('import-preview-list');
        if (!list) return;
        list.innerHTML = '';
        
        let validCount = 0;
        let dupCount = 0;
        let invalidCount = 0;

        importPreviewQuestions.forEach((q, i) => {
            if (!q.isValid) invalidCount++;
            else if (q.isDuplicate) dupCount++;
            else validCount++;

            let isChecked = importSelectedIds.includes(i) ? 'checked' : '';
            
            // Generate visual border, badge
            let borderClass = 'border-gray-200';
            let statusBadge = '';
            
            if (!q.isValid) {
                borderClass = 'border-l-red-500 border-red-200 bg-red-50/20';
                statusBadge = `<span class="bg-red-100 text-red-800 text-[9px] font-bold px-1.5 py-0.5 rounded">Invalid</span>`;
            } else if (q.isDuplicate) {
                borderClass = 'border-l-amber-500 border-amber-200 bg-amber-50/20';
                statusBadge = `<span class="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded">Duplicate</span>`;
            } else {
                borderClass = 'border-l-emerald-500 border-emerald-200 bg-emerald-50/20';
                statusBadge = `<span class="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1.5 py-0.5 rounded">Valid</span>`;
            }

            let errorHtml = '';
            if (q.errors && q.errors.length > 0) {
                errorHtml += `
                    <div class="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 p-2 rounded text-[10px] space-y-0.5 border border-red-200 dark:border-red-900/50">
                        ${q.errors.map(err => `<div>❌ ${err}</div>`).join('')}
                    </div>
                `;
            }
            if (q.isDuplicate) {
                errorHtml += `
                    <div class="bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 p-2 rounded text-[10px] border border-amber-200 dark:border-amber-900/30">
                        ⚠️ <b>Duplicate Question:</b> ${q.duplicateSource}
                    </div>
                `;
            }

            list.innerHTML += `
                <div class="p-3 border rounded-xl space-y-2.5 bg-white dark:bg-slate-800 border-l-4 ${borderClass}" style="border-color:var(--border);">
                    <div class="flex justify-between items-start gap-2">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" ${isChecked} onchange="toggleImportSelect(${i})" class="rounded text-emerald-600 focus:ring-emerald-500">
                            <span class="font-bold text-gray-500">#${i + 1}</span>
                        </label>
                        <div class="flex gap-1.5 items-center">
                            ${statusBadge}
                            <button onclick="openEditImportModal(${i})" class="text-blue-500 hover:text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded text-[10px] font-semibold border border-blue-100 dark:border-blue-900/50 cursor-pointer">Edit</button>
                        </div>
                    </div>
                    
                    <div>
                        <p class="font-medium text-xs break-words text-[var(--text)]">${q.q}</p>
                    </div>

                    <div class="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                        ${q.opts.map((opt, oIdx) => {
                            let isCorrect = oIdx === q.ans;
                            let cls = isCorrect ? 'text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/20 rounded px-1.5 py-0.5 border border-emerald-200/50' : 'px-1.5 py-0.5';
                            return `<div class="${cls}"><b>${String.fromCharCode(65+oIdx)}:</b> ${opt || '<span class="text-red-400 font-normal">Empty</span>'}</div>`;
                        }).join('')}
                    </div>

                    ${errorHtml}

                    <div class="text-[9px] text-gray-400 flex flex-wrap gap-x-2 gap-y-1">
                        <span><b>Subject:</b> ${q.sub || 'General'}</span>
                        ${q.topic ? `<span>• <b>Topic:</b> ${q.topic}</span>` : ''}
                        <span>• <b>Diff:</b> ${q.difficulty || 'Medium'}</span>
                        ${q.expl ? `<span>• <b>Expl:</b> ${q.expl.substring(0, 30)}...</span>` : ''}
                    </div>
                </div>
            `;
        });

        // Set counters
        document.getElementById('import-summary-text').textContent = `Total parsed: ${importPreviewQuestions.length}`;
        document.getElementById('import-stat-valid').textContent = validCount;
        document.getElementById('import-stat-dup').textContent = dupCount;
        document.getElementById('import-stat-invalid').textContent = invalidCount;
        
        document.getElementById('import-selected-count').textContent = importSelectedIds.length;
    }

    function toggleImportSelect(idx){
        let i = importSelectedIds.indexOf(idx);
        if(i===-1) importSelectedIds.push(idx);
        else importSelectedIds.splice(i, 1);
        document.getElementById('import-selected-count').textContent = importSelectedIds.length;
    }

    function selectAllImport(status) {
        if (status) {
            importSelectedIds = importPreviewQuestions.map((_, i) => i);
        } else {
            importSelectedIds = [];
        }
        renderImportPreview();
    }

    function selectValidImportOnly() {
        importSelectedIds = [];
        importPreviewQuestions.forEach((q, i) => {
            if (q.isValid && !q.isDuplicate) {
                importSelectedIds.push(i);
            }
        });
        renderImportPreview();
    }

    function importSelectedQuestions() {
        if (importSelectedIds.length === 0) {
            showToast('⚠️ No questions selected for importing!');
            return;
        }
        
        let final = importPreviewQuestions.filter((_, i) => importSelectedIds.includes(i));
        
        // Final validation check to see if we're importing invalid questions by force
        let invalidCount = final.filter(q => !q.isValid).length;
        if (invalidCount > 0) {
            if (!confirm(`⚠️ You have selected ${invalidCount} questions with errors (Invalid). Proceed anyway?`)) {
                return;
            }
        }

        final.forEach((q, i) => { 
            q.id = Date.now() + Math.random() + i; 
            // Clean up UI-only validation helper variables before storing
            delete q.errors;
            delete q.isValid;
            delete q.isDuplicate;
            delete q.duplicateSource;
        });

        localData.customQuestions = localData.customQuestions.concat(final);
        saveData();
        cancelImportPreview();
        showToast(`✅ Loaded ${final.length} custom questions successfully!`);
        
        // Reset file input
        let fileInput = document.getElementById('import-file');
        if (fileInput) fileInput.value = '';
        let status = document.getElementById('import-status');
        if (status) status.textContent = '';
        
        // Reload details
        updatePracticePage();
    }

    function cancelImportPreview(){
        document.getElementById('import-preview-area').classList.add('hidden');
        importPreviewQuestions=[]; importSelectedIds=[];
        let fileInput = document.getElementById('import-file');
        if (fileInput) fileInput.value = '';
        let status = document.getElementById('import-status');
        if (status) status.textContent = '';
    }

    function exportQuestions(format){
        let data = getCustomQuestions();
        if (data.length === 0) {
            showToast('⚠️ Your custom questions bundle is currently empty!');
            return;
        }

        let filename = 'krishi_mcq_export_' + Date.now();
        let blob, type;
        
        if(format==='json'){
            blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            filename += '.json';
        } else {
            // Include ALL available attributes in CSV representation!
            let csv = 'Question,Option A,Option B,Option C,Option D,Option E,Correct Index,Subject,Explanation,Topic,Difficulty,Marks,Status\n';
            data.forEach(q => {
                let optA = q.opts[0] || '';
                let optB = q.opts[1] || '';
                let optC = q.opts[2] || '';
                let optD = q.opts[3] || '';
                let optE = q.opts[4] || '';
                let expl = q.expl || '';
                let topic = q.topic || '';
                let diff = q.difficulty || 'Medium';
                let marks = q.marks !== undefined ? q.marks : 1;
                let status = q.status || 'published';

                let row = [
                    q.q, optA, optB, optC, optD, optE,
                    String(q.ans), q.sub || 'General',
                    expl, topic, diff, String(marks), status
                ].map(val => `"${String(val).replace(/"/g, '""')}"`);

                csv += row.join(',') + '\n';
            });
            blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
            filename += '.csv';
        }
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a'); a.href = url; a.download = filename; a.click();
        showToast('📥 Questions exported successfully!');
    }

    // ==================== EDIT IMPORT MODAL FUNCTIONS ====================
   // ड्रपडाउनलाई उपलब्ध विकल्पहरूको संख्या अनुसार मात्र भर्ने नयाँ सहयोगी फङ्सन
function updateEditImportAnsDropdown(selectedIdx) {
    let ansSelect = document.getElementById('edit-import-ans');
    if (!ansSelect) return;
    
    ansSelect.innerHTML = '';
    let optLetters = ['A', 'B', 'C', 'D', 'E'];
    let count = 0;
    
    for (let i = 0; i < 5; i++) {
        let val = document.getElementById('edit-import-o' + i).value.trim();
        if (val.length > 0 || i < 2) {
            count = i + 1;
        }
    }
    
    for (let i = 0; i < count; i++) {
        let val = document.getElementById('edit-import-o' + i).value.trim() || `Option ${optLetters[i]}`;
        let selected = (i === selectedIdx) ? 'selected' : '';
        ansSelect.innerHTML += `<option value="${i}" ${selected}>Option ${optLetters[i]} (${val.substring(0, 15)})</option>`;
    }
}

function openEditImportModal(idx) {
    let q = importPreviewQuestions[idx];
    if (!q) return;

    document.getElementById('edit-import-index').value = idx;
    document.getElementById('edit-import-q').value = q.q;
    
    document.getElementById('edit-import-o0').value = q.opts[0] || '';
    document.getElementById('edit-import-o1').value = q.opts[1] || '';
    document.getElementById('edit-import-o2').value = q.opts[2] || '';
    document.getElementById('edit-import-o3').value = q.opts[3] || '';
    document.getElementById('edit-import-o4').value = q.opts[4] || '';
    
    // सही उत्तरको संख्या अनुसार मात्र भर्ने
    updateEditImportAnsDropdown(q.ans);

    // प्रयोगकर्ताले टाइप गर्दागर्दै विकल्पहरूको संख्या परिवर्तन भएमा ड्रपडाउन स्वतः अपडेट गर्ने
    for (let i = 0; i < 5; i++) {
        let inputEl = document.getElementById('edit-import-o' + i);
        if (inputEl) {
            inputEl.oninput = () => {
                let currentAns = parseInt(document.getElementById('edit-import-ans').value) || 0;
                updateEditImportAnsDropdown(currentAns);
            };
        }
    }

    let subSelect = document.getElementById('edit-import-sub');
    if (subSelect) {
        subSelect.innerHTML = '';
        let subjects = getAllSubjects();
        subjects.forEach(s => {
            let selected = (s.toLowerCase() === (q.sub || '').toLowerCase()) ? 'selected' : '';
            subSelect.innerHTML += `<option value="${s}" ${selected}>${s}</option>`;
        });
    }

    document.getElementById('edit-import-expl').value = q.expl || '';
    document.getElementById('edit-import-topic').value = q.topic || '';
    document.getElementById('edit-import-difficulty').value = q.difficulty || 'Medium';
    document.getElementById('edit-import-marks').value = q.marks !== undefined ? q.marks : 1;

    document.getElementById('import-edit-modal').classList.remove('hidden');
}

    function closeEditImportModal() {
        document.getElementById('import-edit-modal').classList.add('hidden');
    }

    function saveEditImportedQuestion() {
        let idx = parseInt(document.getElementById('edit-import-index').value);
        if (isNaN(idx) || idx < 0 || idx >= importPreviewQuestions.length) return;

        let qText = document.getElementById('edit-import-q').value.trim();
        
        let opts = [];
        for (let i = 0; i < 5; i++) {
            let optVal = document.getElementById('edit-import-o' + i).value.trim();
            if (optVal.length > 0 || i < 2) { // Keep at least empty items if under index 2 so validation kicks in cleanly
                opts.push(optVal);
            }
        }

        let ans = parseInt(document.getElementById('edit-import-ans').value);
        let sub = document.getElementById('edit-import-sub').value;
        let expl = document.getElementById('edit-import-expl').value.trim();
        let topic = document.getElementById('edit-import-topic').value.trim();
        let difficulty = document.getElementById('edit-import-difficulty').value;
        let marks = parseInt(document.getElementById('edit-import-marks').value) || 1;

        // Update parsed state object with dual format supported everywhere
        importPreviewQuestions[idx] = {
            id: importPreviewQuestions[idx].id || (Date.now() + Math.random()),
            q: qText,
            opts: opts,
            ans: ans,
            sub: sub,
            expl: expl,
            topic: topic,
            difficulty: difficulty,
            marks: marks,
            status: importPreviewQuestions[idx].status || 'published',

            // Dual formats
            question: qText,
            options: opts,
            correctAnswerIndex: ans,
            explanation: expl,
            subject: sub,
            tags: importPreviewQuestions[idx].tags || [],
            source: importPreviewQuestions[idx].source || ""
        };

        // Re-calculate validation statuses and duplicates for the entire list (since duplicates are dependent on list contents)
        importPreviewQuestions = detectDuplicatesAndErrors(importPreviewQuestions);

        // Ensure newly valid elements are selected if they were not previously checked
        if (importPreviewQuestions[idx].isValid && !importPreviewQuestions[idx].isDuplicate && !importSelectedIds.includes(idx)) {
            importSelectedIds.push(idx);
        }

        renderImportPreview();
        closeEditImportModal();
        showToast('✏️ Question updated and re-validated!');
    }

    // ==================== BACKUP & RESTORE ====================
    function backupAllData(){
        let backup = {
            bookmarked: localData.bookmarked, wrong: localData.wrong,
            customQuestions: localData.customQuestions, streak: localData.streak,
            stats: localData.stats, achievements: localData.achievements,
            timingLog: timingLog, // थपिएको: प्रश्नोत्तर गरेको समयको रेकर्ड
            mockTestScores: mockTestScores, // थपिएको: मक टेस्ट स्कोरहरू
            lastBackup: new Date().toISOString()
        };
        let b = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
        let url = URL.createObjectURL(b);
        let a = document.createElement('a'); a.href = url; a.download = 'krishi_mcq_data_backup.json'; a.click();
        KrishiStorage.setItem('krishi_last_backup', new Date().toISOString());
        showToast('Backup compiled and downloaded!');
    }

    function restoreAllData(){ document.getElementById('restore-file').click(); }

    async function downloadCompleteApp() {
    try {
        let response = await fetch(window.location.href);
        if (!response.ok) throw new Error("Network response was not ok");
        let htmlText = await response.text();
        
        let blob = new Blob([htmlText], {type: 'text/html;charset=utf-8'});
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = 'index.html';
        a.click();
        URL.revokeObjectURL(url);
        showToast('📥 Complete offline app (index.html) downloaded successfully!');
    } catch (e) {
        console.error("Fetch failed, falling back to DOM outerHTML serialization:", e);
        
        // १. स्क्रिनको नक्कल (Clone) तयार गर्ने ताकी चलाइरहेको एपमा असर नपरोस्
        let cleanClone = document.documentElement.cloneNode(true);
        
        // २. नक्कल गरिएको स्क्रिनबाट खुल्ला रहेका बक्सहरू (Modals) लुकाउने
        let customizerModal = cleanClone.querySelector('#home-customizer-modal');
        if (customizerModal) {
            customizerModal.classList.add('hidden');
            customizerModal.style.display = 'none';
        }
        
        // ३. नक्कल गरिएको स्क्रिनबाट म्यासेज र नोटिफिकेसनहरू हटाउने
        let updateToast = cleanClone.querySelector('#pwa-update-toast');
        if (updateToast) updateToast.remove();
        
        let activeToast = cleanClone.querySelector('#toast');
        if (activeToast) {
            activeToast.style.opacity = '0';
            activeToast.style.pointerEvents = 'none';
        }
        
        // ४. सफा गरिएको नक्कल स्क्रिनलाई सेभ गर्ने
        let htmlContent = '<!DOCTYPE html>\n' + cleanClone.outerHTML;
        let blob = new Blob([htmlContent], {type: 'text/html;charset=utf-8'});
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = 'index.html';
        a.click();
        URL.revokeObjectURL(url);
        showToast('📥 App downloaded successfully (serialized)!');
    }
}
    
   function handleRestoreFile(event){
        let fileInput = event.target;
        let file = fileInput.files ? fileInput.files[0] : null; 
        if(!file) return;
        
        let reader = new FileReader();
        reader.onload = function(e){
            try {
                let text = e.target.result;
                if (!text || text.trim().length === 0) {
                    throw new Error('Empty file content');
                }
                
                let d;
                try {
                    d = JSON.parse(text);
                } catch(pe) {
                    throw new Error('Syntax error in JSON format: ' + pe.message);
                }
                
                // 1. Structural schema validation checks
                if (!d || typeof d !== 'object' || Array.isArray(d)) {
                    throw new Error('Invalid backup file structure: expected a JSON object.');
                }
                
                // Check for backup signature keys
                const backupKeys = ['bookmarked', 'wrong', 'customQuestions', 'streak', 'stats', 'achievements', 'sm2'];
                const hasBackupKey = backupKeys.some(k => k in d);
                if (!hasBackupKey) {
                    throw new Error('No Krishi MCQ Pro signature keys found in the backup file.');
                }
                
                // 2. Validate data types in temporary staging variables first
                let staged = {};
                
                // Staged bookmarks validation
                if (d.bookmarked !== undefined) {
                    if (!Array.isArray(d.bookmarked)) throw new Error('Bookmarks must be a valid array.');
                    staged.bookmarked = d.bookmarked;
                } else {
                    staged.bookmarked = [];
                }
                
                // Staged wrong answers validation
                if (d.wrong !== undefined) {
                    if (!Array.isArray(d.wrong)) throw new Error('Incorrect answers must be a valid array.');
                    staged.wrong = d.wrong;
                } else {
                    staged.wrong = [];
                }
                
                // Staged custom questions validation
                if (d.customQuestions !== undefined) {
                    if (!Array.isArray(d.customQuestions)) throw new Error('Custom questions must be a valid array.');
                    staged.customQuestions = d.customQuestions;
                } else {
                    staged.customQuestions = [];
                }
                
                // Staged streak validation
                if (d.streak !== undefined) {
                    if (typeof d.streak !== 'object' || d.streak === null) throw new Error('Consistency streak must be a valid object.');
                    staged.streak = d.streak;
                } else {
                    staged.streak = {};
                }
                
                // Staged stats validation
                if (d.stats !== undefined) {
                    if (typeof d.stats !== 'object' || d.stats === null) throw new Error('User statistics must be a valid object.');
                    staged.stats = d.stats;
                } else {
                    staged.stats = { totalSolved: 0, totalCorrect: 0, subjectStats: {} };
                }
                
                // Staged achievements validation
                if (d.achievements !== undefined) {
                    if (!Array.isArray(d.achievements)) throw new Error('Achievements must be a valid array.');
                    staged.achievements = d.achievements;
                } else {
                    staged.achievements = [];
                }
                
                // Staged SM2 Spaced repetition validation
                let stagedSm2 = null;
                if (d.sm2 !== undefined) {
                    if (d.sm2 && typeof d.sm2 !== 'object') throw new Error('Spaced repetition sm2Data must be a valid object.');
                    stagedSm2 = d.sm2;
                }

                // समय रेकर्ड र मक टेस्टका डाटाहरूको सुरक्षात्मक जाँच
                let stagedTimingLog = null;
                if (d.timingLog !== undefined) {
                    if (!Array.isArray(d.timingLog)) throw new Error('Timing log must be a valid array.');
                    stagedTimingLog = d.timingLog;
                }
                
                let stagedMockScores = null;
                if (d.mockTestScores !== undefined) {
                    if (!Array.isArray(d.mockTestScores)) throw new Error('Mock scores must be a valid array.');
                    stagedMockScores = d.mockTestScores;
                } else if (d.mockScores !== undefined) { // क्लाउड सिङ्कसँग कम्प्याटिबिलिटी मिलाउन
                    if (!Array.isArray(d.mockScores)) throw new Error('Mock scores must be a valid array.');
                    stagedMockScores = d.mockScores;
                }
                
                // 3. Rollback Protection: सबै डाटाहरू मिलेपछि मात्र सेभ गर्ने
                localData.bookmarked = staged.bookmarked;
                localData.wrong = staged.wrong;
                localData.customQuestions = staged.customQuestions;
                localData.streak = staged.streak;
                localData.stats = staged.stats;
                localData.achievements = staged.achievements;
                
                if (stagedSm2 !== null) {
                    if (window.KrishiSM2Engine) window.KrishiSM2Engine._saveData(stagedSm2);
                }

                if (stagedTimingLog !== null) {
                    timingLog = stagedTimingLog;
                }
                if (stagedMockScores !== null) {
                    mockTestScores = stagedMockScores;
                }
                
                saveTimingData(); // थपिएको: timingLog र mockTestScores स्थानीय स्टोरमा सेभ गर्ने
                saveData();
                showToast('✅ App Backup restored successfully!');
                navigate('page-home');
            } catch(err){
                console.error('[PWA Backup] Safe restore aborted:', err);
                showToast(`❌ Invalid or corrupted backup file: ${err.message}`, 6000);
            } finally {
                // 4. इनपुट खाली गर्ने
                fileInput.value = '';
            }
        };
        reader.readAsText(file);
    }
    function checkAutoBackupReminder() {
        let last = KrishiStorage.getItem('krishi_last_backup');
        if (!last) {
            showToast('💡 Tip: Don\'t forget to backup your custom questions regularly.');
        }
    }

    // ==================== CLEAR & RESET ====================
    function clearCache(){
        try {
            // Safety: offer a quick backup before destructive clearing
            if (confirm('Download a backup before clearing cache?')) backupAllData();
        } catch(e){}
        localStorage.clear();
        showToast('Storage cache cleared!');
        setTimeout(()=>location.reload(), 500);
    }

    function resetAllData(){
        if(confirm('⚠️ Are you sure you want to reset everything?')){
            try {
                if (confirm('Download a backup before reset?')) backupAllData();
            } catch(e){}
            localStorage.clear();
            location.reload();
        }
    }

    // ==================== BULK PASTE CREATOR ====================
    function bulkParseQuestions(){
        let text = document.getElementById('bulk-input').value.trim();
        if(!text) return;
        
        // Simple line parser
        let lines = text.split('\n');
        let parsed = []; let errors = [];
        let current = null;
        
        lines.forEach((line, i) => {
            let l = line.trim(); if(!l) return;
            if(l.toLowerCase().startsWith('q:')){
                if(current) parsed.push(current);
                current = { q: l.substring(2).trim(), opts: [], ans: 0, expl: 'Bulk inserted', sub: 'General' };
            } else if(current && l.match(/^[A-E][.:)]/i)){
                current.opts.push(l.substring(2).trim());
            } else if(current && l.toLowerCase().startsWith('answer:')){
                let indexMap = { A:0, B:1, C:2, D:3, E:4 };
                current.ans = indexMap[l.substring(7).trim().toUpperCase()] || 0;
            }
        });
        if(current) parsed.push(current);
        
        tempBulkParsed = parsed;
        let preview = document.getElementById('bulk-preview'); preview.innerHTML = '';
        if(parsed.length > 0){
            preview.innerHTML = `<p class="text-xs text-emerald-600 font-bold">Successfully parsed ${parsed.length} questions!</p>`;
            document.getElementById('bulk-save-btn').classList.remove('hidden');
        } else {
            preview.innerHTML = `<p class="text-xs text-red-500">Failed to parse any valid questions. Follow specified templates.</p>`;
        }
    }

    function saveBulkParsedQuestions(){
        tempBulkParsed.forEach((v, i)=>{ v.id = Date.now() + i; });
        localData.customQuestions = localData.customQuestions.concat(tempBulkParsed);
        saveData();
        showToast('Bulk insert completed!');
        tempBulkParsed = [];
        document.getElementById('bulk-save-btn').classList.add('hidden');
        document.getElementById('bulk-input').value = '';
    }

    // ==================== BULK MANAGE QUESTIONS ====================
    const manageListState = {
        filtered: [],
        rendered: 0,
        lastKey: '',
        pageSize: 60
    };
    const manageSearchCache = new Map(); // id -> lowercased question text

    const scheduleRenderQuestionList = (() => {
        const debounced = debounce(() => renderQuestionList(true), 180);
        return function(immediate = false) {
            if (immediate) renderQuestionList(true);
            else debounced();
        };
    })();

    function getManagePageSize() {
        const ps = getPerfSettings();
        if (ps.perfMode === 'battery') return 35;
        if (ps.perfMode === 'smooth120') return 80;
        return 60;
    }

    function buildManageQuestionRow(q) {
        const wrap = document.createElement('div');
        wrap.className = 'p-3 border rounded-xl text-xs space-y-2 bg-white dark:bg-slate-800 prunable-row flex items-start gap-3';

        const checkWrap = document.createElement('div');
        checkWrap.className = 'pt-0.5';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4 cursor-pointer';
        checkbox.checked = selectedManageQIds.includes(q.id);
        checkbox.onchange = () => {
            if (checkbox.checked) {
                if (!selectedManageQIds.includes(q.id)) selectedManageQIds.push(q.id);
            } else {
                selectedManageQIds = selectedManageQIds.filter(id => id !== q.id);
            }
        };
        checkWrap.appendChild(checkbox);

        const contentWrap = document.createElement('div');
        contentWrap.className = 'flex-1 space-y-2';

        const qEl = document.createElement('p');
        qEl.className = 'font-bold';
        // Preserve rich text if present (some questions are created via Quill)
        qEl.innerHTML = q.q || '';

        const meta = document.createElement('p');
        meta.className = 'text-gray-500';
        meta.textContent = `Subject: ${q.sub || 'General'} | Correct: Option ${String.fromCharCode(65 + (q.ans || 0))}`;

        const actions = document.createElement('div');
        actions.className = 'flex gap-2';
        const del = document.createElement('button');
        del.className = 'text-red-500 underline font-bold pressable';
        del.textContent = 'Delete';
        del.onclick = () => deleteCustomQuestion(q.id);

        const dup = document.createElement('button');
        dup.className = 'text-emerald-500 underline font-semibold pressable';
        dup.textContent = 'Duplicate';
        dup.onclick = () => duplicateCustomQuestion(q.id);

        actions.appendChild(del);
        actions.appendChild(dup);

        contentWrap.appendChild(qEl);
        contentWrap.appendChild(meta);
        contentWrap.appendChild(actions);

        wrap.appendChild(checkWrap);
        wrap.appendChild(contentWrap);
        return wrap;
    }

    function updateManageListFooterStats(total, shown) {
        const stats = document.getElementById('manage-list-stats');
        const loadMore = document.getElementById('manage-load-more');
        const empty = document.getElementById('manage-empty-msg');

        if (empty) empty.classList.toggle('hidden', total > 0);
        if (stats) {
            stats.textContent = total > 0 ? `Showing ${shown} / ${total}` : '';
        }
        if (loadMore) {
            loadMore.classList.toggle('hidden', !(total > shown));
        }
    }

    function renderQuestionList(reset = true){
        const container = document.getElementById('question-list-container');
        if (!container) return;

        manageListState.pageSize = getManagePageSize();

        const all = getCustomQuestions();
        if (!all || all.length === 0) {
            container.textContent = '';
            manageListState.filtered = [];
            manageListState.rendered = 0;
            updateManageListFooterStats(0, 0);
            return;
        }

        const searchEl = document.getElementById('manage-search');
        const filterEl = document.getElementById('manage-filter-sub');
        const search = (searchEl && searchEl.value ? searchEl.value.trim().toLowerCase() : '');
        const sub = (filterEl && filterEl.value ? filterEl.value : 'all');

        const key = search + '::' + sub + '::' + all.length;
        if (reset || key !== manageListState.lastKey) {
            manageListState.lastKey = key;
            manageListState.rendered = 0;

            let filtered = all;
            if (sub && sub !== 'all') filtered = filtered.filter(q => (q.sub || 'General').trim().toLowerCase() === sub.trim().toLowerCase());
            if (search) {
                filtered = filtered.filter(q => {
                    const id = q.id;
                    let lc = manageSearchCache.get(id);
                    if (!lc) {
                        lc = String(q.q || '').replace(/<[^>]*>/g, ' ').toLowerCase();
                        manageSearchCache.set(id, lc);
                    }
                    return lc.includes(search);
                });
            }
            manageListState.filtered = filtered;
            container.textContent = '';
        }

        manageLoadMoreQuestions();
    }

    function manageLoadMoreQuestions(){
        const container = document.getElementById('question-list-container');
        if (!container) return;

        const list = manageListState.filtered || [];
        const start = manageListState.rendered;
        const end = Math.min(list.length, start + manageListState.pageSize);
        if (end <= start) {
            updateManageListFooterStats(list.length, manageListState.rendered);
            return;
        }

        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
            const row = buildManageQuestionRow(list[i]);
            frag.appendChild(row);
            if (window.KrishiDOMPruner) window.KrishiDOMPruner.observe(row);
        }
        container.appendChild(frag);
        manageListState.rendered = end;
        updateManageListFooterStats(list.length, manageListState.rendered);
    }

    function deleteCustomQuestion(id){
        const q = localData.customQuestions.find(x => x.id === id);
        if (q) {
            q.deleted = true;
            q.updatedAt = Date.now();
            saveData();
            scheduleRenderQuestionList(true);
            showToast('Question deleted!');
        }
    }

    function duplicateCustomQuestion(id){
        let orig = localData.customQuestions.find(q=>q.id===id); if(!orig) return;
        let dup = {...orig, id: Date.now(), q: orig.q + ' (Copy)', updatedAt: Date.now(), deleted: false};
        localData.customQuestions.push(dup);
        saveData();
        scheduleRenderQuestionList(true);
        showToast('Question Duplicated!');
    }

    function selectAllManage(){
         selectedManageQIds = getCustomQuestions().map(q=>q.id);
         const container = document.getElementById('question-list-container');
         if (container) {
             const checkboxes = container.querySelectorAll('input[type="checkbox"]');
             checkboxes.forEach(cb => cb.checked = true);
         }
         showToast('All items selected!');
    }
    function deselectAllManage(){
         selectedManageQIds = [];
         const container = document.getElementById('question-list-container');
         if (container) {
             const checkboxes = container.querySelectorAll('input[type="checkbox"]');
             checkboxes.forEach(cb => cb.checked = false);
         }
         showToast('Cleared selections.');
    }
    function deleteSelectedQuestions(){
         if (selectedManageQIds.length === 0) {
             showToast('No questions selected!');
             return;
         }
         if (confirm(`Are you sure you want to delete the ${selectedManageQIds.length} selected questions?`)) {
             try { Storage.setJSON('krishi_last_manage_backup', { t: Date.now(), customQuestions: localData.customQuestions }, { immediate: true }); } catch(e){}
             const selectSet = new Set(selectedManageQIds);
             localData.customQuestions.forEach(q => {
                 if (selectSet.has(q.id)) {
                     q.deleted = true;
                     q.updatedAt = Date.now();
                 }
             });
             selectedManageQIds = [];
             saveData();
             scheduleRenderQuestionList(true);
             showToast('Deleted selected custom questions!');
         }
    }

    // ==================== DASHBOARD DETAILS UPDATES ====================
    const DEFAULT_HOME_WIDGETS = [
        { id: 'smartRecommendation', label: '🧠 Today\'s Smart Action Plan' },
        { id: 'examCountdown', label: '⏳ Target Exam Countdown' },
        { id: 'readinessScore', label: '📈 Exam Readiness Score Wheel' },
        { id: 'dailyTarget', label: '🎯 Daily Solved Progress' },
        { id: 'accuracy', label: '📊 Segmented Accuracy Comparison' },
        { id: 'streak', label: '⚡ Learning Streak Heat Wave' },
        { id: 'bookmarks', label: '📌 Bookmarked Collection' },
        { id: 'syllabusProgress', label: '📚 Complete Advanced Syllabus' },
        { id: 'weeklyProgress', label: '🧱 Weekly Dot Matrix Heatmap' },
        { id: 'motivationalQuote', label: '🕯️ Daily Agricultural Quotes' },
        { id: 'quickPractice', label: '🚀 Quick 10-Question MCQ Action' },
        { id: 'spacedReview', label: '🔁 Queued Spaced Review' },
        { id: 'reviewMistakes', label: '🔴 Review Pending Mistakes' },
        { id: 'mockTest', label: '📋 Structured Mock Test Engine' }
    ];

  const DEFAULT_HOME_SETTINGS = {
        compact: false,
        order: [
            "smartRecommendation",
            "examCountdown",
            "readinessScore",
            "dailyTarget",
            "accuracy",
            "streak",
            "bookmarks",
            "syllabusProgress",
            "weeklyProgress",
            "motivationalQuote"
        ],
        hidden: []
    };

    const MOTIVATIONAL_QUOTES = [
        "सफलताको रहस्य हरेक दिन गरिने सानो सानो सुधार हो। 🌱",
        "कृषि क्रान्तिको आधार, अथक प्रयास र ज्ञानको भण्डार! 🌾",
        "Yesterday you said tomorrow. Just do it. 🌟",
        "Focus on progress, not perfection. Keep going! 💪",
        "ज्ञान जति बाँड्यो त्यति बढ्छ, परिश्रमले सफलताको शिखर चुम्छ। 🏔️",
        "The best way to predict the future is to create it. 🎯",
        "Stay positive, work hard, and make it happen. ⚡",
        "कृषि अनुसन्धान र निरन्तर अभ्यास नै लोकसेवा पार गर्ने कडी हो! 🎓"
    ];

    let dailyConfettiTriggered = false;
    let activePlanSequenceHTML = '';

    function getHomeSettings() {
        let saved = KrishiStorage.getItem('krishi_home_settings');
        if (!saved) return JSON.parse(JSON.stringify(DEFAULT_HOME_SETTINGS));
        try {
            let parsed = JSON.parse(saved);
            // Ensure any new widgets are added
            DEFAULT_HOME_SETTINGS.order.forEach(w => {
                if (!parsed.order.includes(w)) parsed.order.push(w);
            });
            if (!parsed.hidden) parsed.hidden = [];
            return parsed;
        } catch(e) {
            return JSON.parse(JSON.stringify(DEFAULT_HOME_SETTINGS));
        }
    }

    // Duplicate saveHomeSettings removed

    // Duplicate getGoalSettings removed

    function saveGoalSettings(obj) {
        KrishiStorage.setItem('krishi_goal_settings', JSON.stringify(obj));
    }

    function getWeakestSubject() {
        let subjects = getAllSubjects();
        let weakestSub = subjects[0] || "Agronomy (कृषि विकास)";
        let weakestAccuracy = Infinity;
        let hasData = false;
        
        subjects.forEach(s => {
            let stats = (localData.stats.subjectStats && localData.stats.subjectStats[s]) || {solved:0, correct:0};
            if(stats.solved > 0) {
                hasData = true;
                let acc = (stats.correct / stats.solved) * 100;
                if(acc < weakestAccuracy) {
                    weakestAccuracy = acc;
                    weakestSub = s;
                }
            }
        });
        return { 
            subject: weakestSub, 
            accuracy: Math.round(hasData ? weakestAccuracy : 100),
            hasData: hasData
        };
    }

    function getWeeklyProgressStats() {
        let target = getDailyTarget() || 50;
        let today = new Date();
        let past7Days = [];
        let completedDays = 0;
        let missedDays = 0;
        let totalSolvedThisWeek = 0;
        let totalSolvedLastWeek = 0;

        for (let i = 6; i >= 0; i--) {
            let d = new Date();
            d.setDate(today.getDate() - i);
            let stamp = getLocalDateString(d);
            let solved = (localData.streak && localData.streak[stamp] && localData.streak[stamp].solved) || 0;
            past7Days.push({
                stamp: stamp,
                dateObj: d,
                solved: solved,
                targetMet: solved >= target,
                dayName: d.toLocaleDateString('ne-NP', { weekday: 'short' }) || d.toLocaleString('en-US', { weekday: 'short' })
            });
            if (solved >= target) completedDays++;
            else if (solved === 0) missedDays++;
            totalSolvedThisWeek += solved;
        }

        // Last week (days 13 to 7)
        for (let i = 13; i >= 7; i--) {
            let d = new Date();
            d.setDate(today.getDate() - i);
            let stamp = getLocalDateString(d);
            let solved = (localData.streak && localData.streak[stamp] && localData.streak[stamp].solved) || 0;
            totalSolvedLastWeek += solved;
        }

        return {
            past7Days,
            completedDays,
            missedDays,
            totalSolvedThisWeek,
            totalSolvedLastWeek,
            target
        };
    }

    function getHeatmapSquaresHTML() {
        let today = new Date();
        let html = '';
        for (let i = 27; i >= 0; i--) {
            let d = new Date();
            d.setDate(today.getDate() - i);
            let stamp = getLocalDateString(d);
            let solved = (localData.streak && localData.streak[stamp] && localData.streak[stamp].solved) || 0;
            
            let colorClass = 'bg-slate-100 dark:bg-slate-800';
            if (solved >= 30) colorClass = 'bg-emerald-800 dark:bg-emerald-400';
            else if (solved >= 15) colorClass = 'bg-emerald-650 dark:bg-emerald-500';
            else if (solved >= 6) colorClass = 'bg-emerald-400 dark:bg-emerald-600/70';
            else if (solved >= 1) colorClass = 'bg-emerald-200 dark:bg-emerald-800/40';
            
            let tipText = `${stamp}: ${solved} solved`;
            html += `<div class="w-3.5 h-3.5 rounded-xs ${colorClass} transition duration-150 hover:scale-125 cursor-pointer" title="${tipText}"></div>`;
        }
        return html;
    }

    function getWeeklyDotsRowHTML() {
        let weekly = getWeeklyProgressStats();
        let target = weekly.target;
        let html = '';
        weekly.past7Days.forEach(day => {
            let color = "bg-slate-250 dark:bg-slate-750 text-slate-500";
            if (day.solved >= target) {
                color = "bg-emerald-500 text-white shadow-sm ring-1 ring-emerald-300";
            } else if (day.solved > 0) {
                color = "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300";
            }
            html += `
                <div class="flex flex-col items-center gap-1">
                    <span class="text-[8px] uppercase text-slate-400 font-bold">${day.dayName.slice(0, 3)}</span>
                    <div class="w-6 h-6 rounded-full flex items-center justify-center font-black text-[9px] ${color}" title="${day.solved} solved">
                        ${day.solved}
                    </div>
                </div>
            `;
        });
        return html;
    }

    // Dedicated object pool and requestAnimationFrame loop for 60fps, zero-GC layout-shift-free confetti
    const ConfettiEngine = (function() {
        const MAX_PARTICLES = 155;
        const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#e11d48', '#ff3366', '#33ccff', '#ffcc00'];
        
        class ConfettiPiece {
            constructor() {
                this.active = false;
            }

            reset(w = window.innerWidth, h = window.innerHeight) {
                const mode = Math.random() > 0.45 ? 'fall' : 'burst';
                if (mode === 'fall') {
                    this.x = Math.random() * w;
                    this.y = -20 - Math.random() * 100;
                    this.vx = (Math.random() - 0.5) * 3;
                    this.vy = 3 + Math.random() * 5;
                } else {
                    const side = Math.random();
                    if (side < 0.33) {
                        this.x = 0;
                        this.y = h;
                        this.vx = 4 + Math.random() * 8;
                        this.vy = -6 - Math.random() * 10;
                    } else if (side < 0.66) {
                        this.x = w;
                        this.y = h;
                        this.vx = -4 - Math.random() * 8;
                        this.vy = -6 - Math.random() * 10;
                    } else {
                        this.x = w / 2;
                        this.y = h;
                        this.vx = (Math.random() - 0.5) * 10;
                        this.vy = -8 - Math.random() * 12;
                    }
                }

                this.size = 6 + Math.random() * 7;
                this.color = colors[Math.floor(Math.random() * colors.length)];
                this.isCircle = Math.random() > 0.45;
                this.gravity = 0.15 + Math.random() * 0.15;
                this.drag = 0.98 + Math.random() * 0.015;
                this.rotation = Math.random() * Math.PI * 2;
                this.rotationSpeed = (Math.random() - 0.5) * 0.15;
                this.alpha = 1.0;
                this.decay = 0.003 + Math.random() * 0.006;
                this.active = true;
            }

            update(w, h) {
                this.vx *= this.drag;
                this.vy += this.gravity;
                this.x += this.vx;
                this.y += this.vy;
                this.rotation += this.rotationSpeed;
                
                if (this.y > h - 50) {
                    this.alpha -= 0.02;
                } else {
                    this.alpha -= this.decay;
                }
                
                this.active = this.alpha > 0 && this.x >= -55 && this.x <= w + 55 && this.y <= h + 55;
                return this.active;
            }

            draw(ctx) {
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha));
                ctx.translate(this.x, this.y);
                ctx.rotate(this.rotation);
                ctx.fillStyle = this.color;

                if (this.isCircle) {
                    ctx.beginPath();
                    ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
                }
                ctx.restore();
            }
        }

        // Particle pool to completely bypass garbage collection allocations
        const pool = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
            pool.push(new ConfettiPiece());
        }

        let activeParticles = [];
        let canvas = null;
        let ctx = null;
        let frameId = null;

        function initCanvas() {
            if (canvas) return;
            canvas = document.createElement('canvas');
            canvas.style.position = 'fixed';
            canvas.style.inset = '0';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '999999';
            
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            
            document.body.appendChild(canvas);
            ctx = canvas.getContext('2d');
        }

        function tick() {
            if (!canvas) {
                cleanup();
                return;
            }
            const ps = getPerfSettings();
            if (document.hidden || ps.perfMode === 'battery' || ps.reduceMotion || ps.animIntensity === 'off') {
                cleanup();
                return;
            }

            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth;
            const h = window.innerHeight;

            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr;
                canvas.height = h * dpr;
                canvas.style.width = w + 'px';
                canvas.style.height = h + 'px';
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.scale(dpr, dpr);

            for (let i = activeParticles.length - 1; i >= 0; i--) {
                const p = activeParticles[i];
                if (p.update(w, h)) {
                    p.draw(ctx);
                } else {
                    p.active = false;
                    activeParticles.splice(i, 1);
                }
            }

            ctx.restore();

            if (activeParticles.length > 0) {
                frameId = requestAnimationFrame(tick);
            } else {
                cleanup();
            }
        }

        function cleanup() {
            if (frameId) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            if (canvas) {
                canvas.remove();
                canvas = null;
                ctx = null;
            }
            activeParticles.forEach(p => p.active = false);
            activeParticles = [];
        }

        function trigger(count = 90) {
            initCanvas();
            
            const w = window.innerWidth;
            const h = window.innerHeight;

            let spawned = 0;
            for (let i = 0; i < pool.length; i++) {
                const p = pool[i];
                if (!p.active) {
                    p.reset(w, h);
                    activeParticles.push(p);
                    spawned++;
                    if (spawned >= count) break;
                }
            }

            // Dynamically expand pool if necessary
            const missing = count - spawned;
            for (let i = 0; i < missing; i++) {
                const p = new ConfettiPiece();
                p.reset(w, h);
                pool.push(p);
                activeParticles.push(p);
            }

            if (!frameId) {
                frameId = requestAnimationFrame(tick);
            }
        }

        return {
            trigger: trigger
        };
    })();

    function triggerConfetti() {
        if (window.AnimationOrchestrator) {
            window.AnimationOrchestrator.dispatch('animation.achievement', {});
            return;
        }
        // Original fallback when orchestrator is not loaded
        const ps = getPerfSettings();
        if (ps.perfMode === 'battery' || ps.reduceMotion || ps.animIntensity === 'off') return;
        
        if (window.LottieAdapter) {
            window.LottieAdapter.play('lottie.reward.achievement').then(lottieSuccess => {
                if (!lottieSuccess) {
                    // Disabled old engine safely:
                    // ConfettiEngine.trigger(ps.perfMode === 'smooth120' ? 110 : 90);
                }
            });
        } else {
            // ConfettiEngine.trigger(ps.perfMode === 'smooth120' ? 110 : 90);
        }
    }

    // ==================== FIRE CELEBRATION MODULE ====================
    const FireCelebrationModule = (function() {
        const EMOJI_OPTIONS = ['✨', '🔥', '⚡', '🌟', '💥', '🌾', '🌱'];

        class Particle {
            constructor(x, y, type) {
                this.x = x;
                this.y = y;
                this.type = type; // 'spark' or 'confetti'
                
                if (type === 'spark') {
                    this.emoji = EMOJI_OPTIONS[Math.floor(Math.random() * EMOJI_OPTIONS.length)];
                    const angle = Math.random() * Math.PI * 2;
                    const speed = 2 + Math.random() * 5;
                    this.vx = Math.cos(angle) * speed;
                    this.vy = Math.sin(angle) * speed - 1.2; // subtle upward bias
                    this.alpha = 1.0;
                    this.decay = 0.015 + Math.random() * 0.012;
                    this.rotation = Math.random() * Math.PI * 2;
                    this.rotationSpeed = (Math.random() - 0.5) * 0.12;
                    this.scale = 0.9 + Math.random() * 0.5;
                } else {
                    const hue = Math.floor(Math.random() * 360);
                    this.color = `hsl(${hue}, 95%, 65%)`;
                    // Parabolic soft cascading confetti showering outwards and falling beautifully
                    const angle = Math.PI * 1.05 + (Math.random() - 0.5) * Math.PI * 0.8; 
                    const speed = 4 + Math.random() * 7;
                    this.vx = Math.cos(angle) * speed;
                    this.vy = Math.sin(angle) * speed - 2.5; 
                    this.gravity = 0.22;
                    this.alpha = 1.0;
                    this.decay = 0.005 + Math.random() * 0.005;
                    this.rotation = Math.random() * Math.PI * 2;
                    this.rotationSpeed = (Math.random() - 0.5) * 0.08;
                    this.size = 5 + Math.random() * 7;
                    this.isCircle = Math.random() > 0.5;
                }
            }

            update() {
                this.x += this.vx;
                this.y += this.vy;
                if (this.gravity) {
                    this.vy += this.gravity;
                    // Add wind drift waves dynamically using sine waves
                    this.x += Math.sin(this.y * 0.04 + this.rotation) * 0.5;
                }
                
                // Bouncing boundaries off the viewport sides
                const w = window.innerWidth;
                if (this.x < 0) {
                    this.x = 0;
                    this.vx *= -0.6;
                } else if (this.x > w) {
                    this.x = w;
                    this.vx *= -0.6;
                }

                this.alpha -= this.decay;
                this.rotation += this.rotationSpeed;
                return this.alpha > 0;
            }

            draw(ctx) {
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha));
                ctx.translate(this.x, this.y);
                ctx.rotate(this.rotation);
                
                if (this.type === 'spark') {
                    ctx.font = `${Math.round(15 * this.scale)}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(this.emoji, 0, 0);
                } else {
                    ctx.fillStyle = this.color;
                    if (this.isCircle) {
                        ctx.beginPath();
                        ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
                    }
                }
                ctx.restore();
            }
        }

        class HaloPulse {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.radius = 10;
                this.maxRadius = 110;
                this.alpha = 1.0;
                this.decay = 0.025;
            }
            update() {
                this.radius += (this.maxRadius - this.radius) * 0.16;
                this.alpha -= this.decay;
                return this.alpha > 0;
            }
            draw(ctx) {
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha));
                const gradient = ctx.createRadialGradient(
                    this.x, this.y, 0,
                    this.x, this.y, this.radius
                );
                gradient.addColorStop(0, 'rgba(239, 68, 68, 0.6)');
                gradient.addColorStop(0.5, 'rgba(245, 158, 11, 0.25)');
                gradient.addColorStop(1, 'rgba(245, 158, 11, 0)');
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        let particles = [];
        let halos = [];
        let animationFrameId = null;
        let activeCanvas = null;

        function createOverlayCanvas() {
            const canvas = document.createElement('canvas');
            canvas.style.position = 'fixed';
            canvas.style.inset = '0';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '999999';
            
            // Set initial sizing to prevent standard frame-1 flicker
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth;
            const h = window.innerHeight;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            
            document.body.appendChild(canvas);
            return canvas;
        }

        // Play the celebration audio exactly once per day using localStorage flags
        function playCelebrationSound(isAutoTrigger) {
            if (typeof playSound !== 'function') return;
            const todayStr = getLocalDateString();
            const key = isAutoTrigger 
                ? 'target_sound_played_' + todayStr 
                : 'streak_fire_interaction_played_' + todayStr;

            if (!KrishiStorage.getItem(key)) {
                KrishiStorage.setItem(key, 'true');
                playSound('celebrate');
            }
        }

        // Trigger the non-blocking fire sparks canvas animation using requestAnimationFrame
        function triggerVisuals(clientX, clientY, targetElement) {
            let startX, startY;
            if (clientX !== undefined && clientY !== undefined) {
                startX = clientX;
                startY = clientY;
            } else if (targetElement) {
                const rect = targetElement.getBoundingClientRect();
                startX = rect.left + rect.width / 2;
                startY = rect.top + rect.height / 2;
            } else {
                startX = window.innerWidth / 2;
                startY = window.innerHeight / 2;
            }

            if (!activeCanvas) {
                activeCanvas = createOverlayCanvas();
            }

            // Generate particles
            for (let i = 0; i < 22; i++) {
                particles.push(new Particle(startX, startY, 'spark'));
            }

            for (let i = 0; i < 40; i++) {
                particles.push(new Particle(startX, startY, 'confetti'));
            }

            // Add halo pulse
            halos.push(new HaloPulse(startX, startY));

            // Apply smooth click scaling class to the local target icon
            if (targetElement) {
                targetElement.classList.add('fire-sparked');
                setTimeout(() => {
                    targetElement.classList.remove('fire-sparked');
                }, 750);
            }

            if (!animationFrameId) {
                const tick = () => {
                    if (!activeCanvas) return;
                    const ps = getPerfSettings();
                    if (document.hidden || ps.perfMode === 'battery' || ps.reduceMotion || ps.animIntensity === 'off') {
                        particles = [];
                        halos = [];
                        activeCanvas.remove();
                        activeCanvas = null;
                        animationFrameId = null;
                        return;
                    }
                    
                    const dpr = window.devicePixelRatio || 1;
                    const w = window.innerWidth;
                    const h = window.innerHeight;
                    
                    if (activeCanvas.width !== w * dpr || activeCanvas.height !== h * dpr) {
                        activeCanvas.width = w * dpr;
                        activeCanvas.height = h * dpr;
                        activeCanvas.style.width = w + 'px';
                        activeCanvas.style.height = h + 'px';
                    }

                    const ctx = activeCanvas.getContext('2d');
                    // Clear the entire physical backing store to avoid artifacts on high-DPI displays
                    ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
                    ctx.save();
                    ctx.scale(dpr, dpr);

                    // Update and draw halos
                    halos = halos.filter(pulse => {
                        const active = pulse.update();
                        if (active) pulse.draw(ctx);
                        return active;
                    });

                    // Update and draw particles
                    particles = particles.filter(part => {
                        const active = part.update();
                        if (active) part.draw(ctx);
                        return active;
                    });

                    ctx.restore();

                    if (particles.length === 0 && halos.length === 0) {
                        if (activeCanvas) {
                            activeCanvas.remove();
                            activeCanvas = null;
                        }
                        animationFrameId = null;
                    } else {
                        animationFrameId = requestAnimationFrame(tick);
                    }
                };
                animationFrameId = requestAnimationFrame(tick);
            }
        }

        // Unified trigger flow orchestrator
        function playAllInteractiveEffects(event, isAutoTrigger = false) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }

            // 1. Decoupled sound playback check (using a daily flag in localStorage to ensure exactly-once performance)
            playCelebrationSound(isAutoTrigger);

            // 2. Compute dynamic start positions
            let clientX, clientY;
            if (event && event.clientX && event.clientY) {
                clientX = event.clientX;
                clientY = event.clientY;
            }

            const targetIcon = (event && event.currentTarget) || (event && event.target) || document.querySelector('.planner-streak-fire-icon');

            // 3. Trigger visual effects (shockwave, sparks, and fall cascade) via RAF canvas
            if (window.AnimationOrchestrator) {
                window.AnimationOrchestrator.dispatch('animation.streak', { targetEl: targetIcon });
            } else if (window.LottieAdapter) {
                window.LottieAdapter.play('lottie.reward.streak').then(lottieSuccess => {
                    if (!lottieSuccess) {
                        if (targetIcon) {
                            targetIcon.classList.add('fire-sparked');
                            setTimeout(() => { targetIcon.classList.remove('fire-sparked'); }, 750);
                        }
                    }
                });
            } else {
                if (targetIcon) {
                    targetIcon.classList.add('fire-sparked');
                    setTimeout(() => { targetIcon.classList.remove('fire-sparked'); }, 750);
                }
            }

        }

        return {
            playCelebrationSound: playCelebrationSound,
            triggerVisuals: triggerVisuals,
            triggerInteractive: playAllInteractiveEffects
        };
    })();

    function triggerInteractiveFireSpark(event, isAutoTrigger = false) {
        const ps = getPerfSettings();
        if (ps.perfMode === 'battery' || ps.reduceMotion || ps.animIntensity === 'off') return;
        FireCelebrationModule.triggerInteractive(event, isAutoTrigger);
    }

    // Active Tab in the customizer
    let currentCustomizerTab = 'profiles';
    let activeWidgetCategory = 'All';

    // --- EXAM PROFILES DATABASE INTERFACE ---
    function getExamProfiles() {
        let saved = KrishiStorage.getItem('krishi_exam_profiles');
        if (!saved) return [DEFAULT_EXAM_PROFILE];
        try {
            let parsed = JSON.parse(saved);
            if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_EXAM_PROFILE];
            return parsed;
        } catch(e) {
            return [DEFAULT_EXAM_PROFILE];
        }
    }

    function saveExamProfiles(profiles) {
        KrishiStorage.setItem('krishi_exam_profiles', JSON.stringify(profiles));
    }

    function getActiveProfile() {
        let profiles = getExamProfiles();
        let active = profiles.find(p => p.active);
        if (!active && profiles.length > 0) {
            profiles[0].active = true;
            saveExamProfiles(profiles);
            return profiles[0];
        }
        return active;
    }

    // Overriding system-level settings seamlessly to route values dynamically
    function getGoalSettings() {
        let active = getActiveProfile();
        return {
            name: active.name,
            level: active.level,
            province: active.province
        };
    }

    function getPlannerSettings() {
        let active = getActiveProfile();
        let defaults = {
            dailyTarget: active.dailyTarget,
            weeklyTarget: active.weeklyTarget,
            examDate: active.targetDate,
            weakThreshold: 60,
            slots: ["morning", "evening"],
            syllabusVisible: true,
            adaptiveReview: true,
            intensity: 'normal',
            restDays: [6],
            studyHours: 2,
            newRatio: 50,
            difficultyBias: 'balanced',
            retryDelay: 3,
            focusSubject: 'all',
            soundEnabled: true,
            compactMode: false
        };
        try {
            let saved = KrishiStorage.getItem('krishi_planner_settings');
            if (saved) {
                let parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    // Sync parsed targets with the active profile to prevent old cached values from overriding them
                    parsed.dailyTarget = active.dailyTarget;
                    parsed.weeklyTarget = active.weeklyTarget;
                    parsed.examDate = active.targetDate;
                    return { ...defaults, ...parsed };
                } else {
                    console.warn('[PWA Safety] Planner settings was not an object, auto-removing corrupted cache.');
                    KrishiStorage.removeItem('krishi_planner_settings');
                }
            }
        } catch(e){
            console.warn('[PWA Safety] Failed to parse planner settings, auto-removing corrupted cache:', e);
            KrishiStorage.removeItem('krishi_planner_settings');
        }
        return defaults;
    }

    function getDailyTarget() {
        return getActiveProfile().dailyTarget;
    }

    function switchSettingsTab(tabId) {
        let generalGroup = document.getElementById('settings-group-general');
        let generalGroupBottom = document.getElementById('settings-group-general-bottom');
        let visualsGroup = document.getElementById('settings-group-visuals');
        let soundGroup = document.getElementById('settings-group-sound');
        let generalBtn = document.getElementById('settings-tab-btn-general');
        let visualsBtn = document.getElementById('settings-tab-btn-visuals');
        let soundBtn = document.getElementById('settings-tab-btn-sound');

        const activeClass = 'flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400 cursor-pointer';
        const inactiveClass = 'flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer';

        if (generalGroup) generalGroup.classList.add('hidden');
        if (generalGroupBottom) generalGroupBottom.classList.add('hidden');
        if (visualsGroup) visualsGroup.classList.add('hidden');
        if (soundGroup) soundGroup.classList.add('hidden');

        if (generalBtn) generalBtn.className = inactiveClass;
        if (visualsBtn) visualsBtn.className = inactiveClass;
        if (soundBtn) soundBtn.className = inactiveClass;

        if (tabId === 'general') {
            if (generalGroup) generalGroup.classList.remove('hidden');
            if (generalGroupBottom) generalGroupBottom.classList.remove('hidden');
            if (generalBtn) generalBtn.className = activeClass;
        } else if (tabId === 'sound') {
            if (soundGroup) soundGroup.classList.remove('hidden');
            if (soundBtn) soundBtn.className = activeClass;
        } else if (tabId === 'visuals') {
            if (visualsGroup) visualsGroup.classList.remove('hidden');
            if (visualsBtn) visualsBtn.className = activeClass;
        }
        playSound('click');
    }
    window.switchSettingsTab = switchSettingsTab;

    function switchCustomizerTab(tabId) {
        currentCustomizerTab = tabId;
        // Hide all panes
        document.querySelectorAll('.customizer-pane').forEach(p => p.classList.add('hidden'));
        // Show target pane
        let pane = document.getElementById('customizer-pane-' + tabId);
        if (pane) pane.classList.remove('hidden');

        // Toggle button styling
        document.querySelectorAll('[id^="tabBtn-"]').forEach(btn => {
            btn.classList.remove('bg-slate-100', 'dark:bg-slate-850', 'text-slate-700', 'dark:text-slate-300', 'bg-indigo-600', 'text-white');
            btn.classList.add('text-slate-500', 'dark:text-slate-400');
        });
        let activeBtn = document.getElementById('tabBtn-' + tabId);
        if (activeBtn) {
            activeBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
            activeBtn.classList.add('bg-indigo-600', 'text-white');
        }

        // Trigger building of components for that specific tab
        if (tabId === 'profiles') {
            renderProfilesInventory();
        } else if (tabId === 'widgets') {
            buildCustomizerWidgetsList();
        } else if (tabId === 'appearance') {
            loadAppearanceTabForm();
        } else if (tabId === 'backup') {
            renderBackupLayouts();
        } else if (tabId === 'appearance-lang') {
            loadAppearanceLangTabForm();
        }
        playSound('click');
    }
    window.switchCustomizerTab = switchCustomizerTab;

    // --- PROFILES TAB LOGIC ---
    function renderProfilesInventory() {
        let container = document.getElementById('profile-inventory-container');
        if (!container) return;
        let profiles = getExamProfiles();
        container.innerHTML = '';

        profiles.forEach(p => {
            let activeBorder = p.active ? 'border-emerald-500 ring-2 ring-emerald-400/20' : 'border-slate-200 dark:border-slate-800';
            let activeLabel = p.active ? '<span class="text-[9px] font-black bg-emerald-500 text-white rounded-full px-2 py-0.5 animate-pulse">ACTIVE</span>' : '';
            
            let cardDiv = document.createElement('div');
            cardDiv.className = `p-3.5 bg-white dark:bg-slate-900 border rounded-2xl flex flex-col justify-between ${activeBorder} transition duration-200 hover:scale-[1.01] hover:shadow-xs relative`;
            cardDiv.innerHTML = `
                <div class="space-y-1">
                    <div class="flex justify-between items-start">
                        <h4 class="font-bold text-xs truncate max-w-[130px]" title="${p.name}">${p.name}</h4>
                        ${activeLabel}
                    </div>
                    <p class="text-[10px] text-slate-400">${p.level} • ${p.province}</p>
                    <div class="pt-2 grid grid-cols-2 gap-x-1 gap-y-1 text-[9px] font-semibold text-slate-500">
                        <span>🎯 Daily: ${p.dailyTarget} MCQs</span>
                        <span>📅 Date: ${p.targetDate}</span>
                        <span>📊 Weekly: ${p.weeklyTarget} MCQs</span>
                        <span class="truncate">Syllabus: ${p.syllabusTarget || 80}%</span>
                    </div>
                    ${p.preferredSubjects && p.preferredSubjects.length > 0 ? `
                        <p class="text-[8px] text-indigo-500 font-bold truncate mt-1">🏷️ Topics: ${Array.isArray(p.preferredSubjects) ? p.preferredSubjects.join(', ') : p.preferredSubjects}</p>
                    ` : ''}
                </div>
                <div class="flex gap-1.5 mt-3.5 pt-2 border-t border-slate-100 dark:border-slate-850 justify-end">
                    ${!p.active ? `<button onclick="switchActiveProfile('${p.id}')" class="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-500 hover:text-white rounded text-[10px] font-extrabold cursor-pointer transition">Set Active</button>` : ''}
                    <button onclick="editProfileDirectly('${p.id}')" class="px-2 py-1 bg-slate-55 hover:bg-slate-200 dark:bg-slate-850 rounded text-[10px] font-bold cursor-pointer transition">Edit</button>
                    <button onclick="duplicateProfileDirectly('${p.id}')" class="px-2 py-1 bg-slate-55 hover:bg-slate-200 dark:bg-slate-850 rounded text-[10px] font-bold cursor-pointer transition">Duplicate</button>
                    ${profiles.length > 1 ? `<button onclick="deleteProfileDirectly('${p.id}')" class="px-2 py-1 hover:bg-red-500 hover:text-white rounded text-[10px] font-bold text-red-500 cursor-pointer transition">Delete</button>` : ''}
                </div>
            `;
            container.appendChild(cardDiv);
        });
    }

    function switchActiveProfile(profileId) {
        let profiles = getExamProfiles();
        profiles.forEach(p => {
            p.active = (p.id === profileId);
        });
        saveExamProfiles(profiles);
        showToast('🎯 Profile switched! Re-indexing goal metrics...');
        renderProfilesInventory();
        updateHomePage();
        if (typeof refreshPlannerPage === 'function') {
            refreshPlannerPage();
        }
        playSound('success');
    }

    function showNewProfileForm() {
        document.getElementById('profile-edit-id').value = '';
        document.getElementById('prof-entry-name').value = 'New Agriculture Exam';
        document.getElementById('prof-entry-level').value = '5th Level';
        document.getElementById('prof-entry-province').value = 'Bagmati Province';
        document.getElementById('prof-entry-date').value = '2026-07-03';
        document.getElementById('prof-entry-daily').value = '50';
        document.getElementById('prof-entry-weekly').value = '250';
        document.getElementById('prof-entry-syllabus').value = '80';
        document.getElementById('prof-entry-subjects').value = 'Agronomy (कृषि विकास), Soil Science (माटो विज्ञान)';
        
        document.getElementById('profile-upsert-title').textContent = '🎯 Create New Profile';
        document.getElementById('profile-upsert-card').classList.remove('hidden');
        document.getElementById('profile-upsert-card').scrollIntoView({ behavior: 'smooth' });
        playSound('click');
    }

    function editProfileDirectly(profileId) {
        let profiles = getExamProfiles();
        let target = profiles.find(p => p.id === profileId);
        if (!target) return;

        document.getElementById('profile-edit-id').value = target.id;
        document.getElementById('prof-entry-name').value = target.name || '';
        document.getElementById('prof-entry-level').value = target.level || '';
        document.getElementById('prof-entry-province').value = target.province || '';
        document.getElementById('prof-entry-date').value = target.targetDate || '';
        document.getElementById('prof-entry-daily').value = target.dailyTarget || 50;
        document.getElementById('prof-entry-weekly').value = target.weeklyTarget || 250;
        document.getElementById('prof-entry-syllabus').value = target.syllabusTarget || 80;
        document.getElementById('prof-entry-subjects').value = Array.isArray(target.preferredSubjects) ? target.preferredSubjects.join(', ') : (target.preferredSubjects || '');

        document.getElementById('profile-upsert-title').textContent = '📝 Edit Exam Profile';
        document.getElementById('profile-upsert-card').classList.remove('hidden');
        document.getElementById('profile-upsert-card').scrollIntoView({ behavior: 'smooth' });
        playSound('click');
    }

    function duplicateProfileDirectly(profileId) {
        let profiles = getExamProfiles();
        let target = profiles.find(p => p.id === profileId);
        if (!target) return;

        let clone = {...target, id: 'profile_' + Date.now(), name: target.name + ' (Copy)', active: false};
        profiles.push(clone);
        saveExamProfiles(profiles);
        showToast('📋 Duplicated exam profile!');
        renderProfilesInventory();
        playSound('success');
    }

    function deleteProfileDirectly(profileId) {
        let profiles = getExamProfiles();
        let target = profiles.find(p => p.id === profileId);
        if (!target) return;
        if (target.active) {
            showToast('Warning: Cannot delete active exam profile!');
            return;
        }

        if (confirm('Are you sure you want to remove profile "' + target.name + '"?')) {
            profiles = profiles.filter(p => p.id !== profileId);
            saveExamProfiles(profiles);
            showToast('🗑️ Profile completely deleted.');
            renderProfilesInventory();
            playSound('success');
        }
    }

    function saveProfileUpsertForm() {
        let idVal = document.getElementById('profile-edit-id').value;
        let nameVal = document.getElementById('prof-entry-name').value.trim() || 'Agriculture Exam';
        let levelVal = document.getElementById('prof-entry-level').value.trim() || '5th Level';
        let provinceVal = document.getElementById('prof-entry-province').value.trim() || 'Bagmati';
        let dateVal = document.getElementById('prof-entry-date').value || '2026-07-03';
        let dailyVal = parseInt(document.getElementById('prof-entry-daily').value) || 50;
        let weeklyVal = parseInt(document.getElementById('prof-entry-weekly').value) || 250;
        let syllabusVal = parseInt(document.getElementById('prof-entry-syllabus').value) || 80;
        let subjectsVal = document.getElementById('prof-entry-subjects').value.trim();
        let subjectsArr = subjectsVal ? subjectsVal.split(',').map(s => s.trim()) : [];

        let profiles = getExamProfiles();

        if (idVal) {
            // Edit
            let existing = profiles.find(p => p.id === idVal);
            if (existing) {
                existing.name = nameVal;
                existing.level = levelVal;
                existing.province = provinceVal;
                existing.targetDate = dateVal;
                existing.dailyTarget = dailyVal;
                existing.weeklyTarget = weeklyVal;
                existing.syllabusTarget = syllabusVal;
                existing.preferredSubjects = subjectsArr;
            }
        } else {
            // New
            let newP = {
                id: 'profile_' + Date.now(),
                name: nameVal,
                level: levelVal,
                province: provinceVal,
                targetDate: dateVal,
                dailyTarget: dailyVal,
                weeklyTarget: weeklyVal,
                syllabusTarget: syllabusVal,
                preferredSubjects: subjectsArr,
                active: false
            };
            profiles.push(newP);
        }

        saveExamProfiles(profiles);
        showToast('🎉 Exam profiles database saved successfully!');
        hideProfileUpsertCard();
        renderProfilesInventory();
        updateHomePage();
        if (typeof refreshPlannerPage === 'function') {
            refreshPlannerPage();
        }
        playSound('success');
    }

    function hideProfileUpsertCard() {
        document.getElementById('profile-upsert-card').classList.add('hidden');
        playSound('click');
    }

    // --- APPEARANCE TAB STORAGE ---
    function getAppearanceSettings() {
        let saved = KrishiStorage.getItem('krishi_appearance_settings');
        let defaults = {
            themeStyle: 'classic',
            animationIntensity: 'medium',
            cardRadius: 'medium',
            greetingLanguage: 'nepali',
            quickActionLayout: 'grid',
            showMQuote: true,
            showAgriQuote: true,
            showProgressAnims: true
        };
        if (!saved) return defaults;
        try {
            return {...defaults, ...JSON.parse(saved)};
        } catch(e) {
            return defaults;
        }
    }

    /* ── ONE source of truth for corners / density / language ────────────────
       These three settings used to exist twice: here (Settings → Appearance,
       key krishi_appearance_settings) and in Home → Customize → Appearance &
       Language (key krishi_custom_appearance_settings), so the two panels could
       disagree and the last one saved silently won.

       The customizer key is now the canonical one, and this tab is a second view
       onto the same values. The maps below translate the older vocabulary
       (small/medium/large, balanced density) into the canonical steps, so an
       install saved before this change keeps the exact look it already had. */
    const LEGACY_RADIUS_TO_CORNERS = { small: 'sharp', medium: 'balanced', large: 'round' };
    const LEGACY_DENSITY_TO_CANON  = { compact: 'compact', balanced: 'comfortable', detailed: 'spacious' };

    // True once the customizer has been saved at least once on this device.
    // Until then every canonical read falls back to the older Appearance-tab
    // value, so existing installs see zero change.
    function hasCustomAppearanceKey() {
        return !!KrishiStorage.getItem('krishi_custom_appearance_settings');
    }

    function getCanonicalCornerValue() {
        let steps = SURFACE_STYLE_OPTIONS.cardCorners.steps;
        if (hasCustomAppearanceKey()) {
            let v = getCustomAppearanceAndLangSettings().cardCorners;
            if (steps.indexOf(v) !== -1) return v;
        }
        let legacy = getAppearanceSettings().cardRadius;
        if (steps.indexOf(legacy) !== -1) return legacy;
        return LEGACY_RADIUS_TO_CORNERS[legacy] || SURFACE_STYLE_OPTIONS.cardCorners.fallback;
    }

    function getCanonicalDensityValue() {
        let steps = SURFACE_STYLE_OPTIONS.layoutDensity.steps;
        if (hasCustomAppearanceKey()) {
            let v = getCustomAppearanceAndLangSettings().layoutDensity;
            if (steps.indexOf(v) !== -1) return v;
        }
        // Older installs only stored the compact on/off flag used by the widgets.
        return getHomeSettings().compact ? 'compact'
                                        : (LEGACY_DENSITY_TO_CANON.balanced || SURFACE_STYLE_OPTIONS.layoutDensity.fallback);
    }

    function getCanonicalLanguageValue() {
        if (hasCustomAppearanceKey()) {
            let v = getCustomAppearanceAndLangSettings().languageMode;
            if (v) return v;
        }
        return getAppearanceSettings().greetingLanguage || 'nepali';
    }

    /* Read-modify-write of the shared customizer key: only the listed keys move,
       every other customizer value (fonts, colours, custom labels) is preserved. */
    function patchCustomAppearanceValues(patch) {
        let settings = getCustomAppearanceAndLangSettings();
        for (let key in patch) settings[key] = patch[key];
        KrishiStorage.setItem('krishi_custom_appearance_settings', JSON.stringify(settings));
        if (typeof applyCustomAppearanceAndLanguageSettings === 'function') {
            applyCustomAppearanceAndLanguageSettings();
        }
    }

    // Set a <select> only to a value it actually offers, so a legacy or unknown
    // value can never leave the control blank.
    function setSelectSafe(id, value, fallback) {
        let el = document.getElementById(id);
        if (!el) return;
        let has = Array.prototype.some.call(el.options, function(o) { return o.value === value; });
        el.value = has ? value : fallback;
    }

    /* Both appearance forms populate lazily, only when their customizer tab is
       opened (switchCustomizerTab → loadAppearance*TabForm). These flags record
       that, so the shared corner / density / language values are never written
       from a form that is still holding its markup defaults. */
    let appearanceFormsPopulated = { appearance: false, appearanceLang: false };

    // Apply specific classes of the appearance preset configurations
    function saveAppearanceSettings(settings) {
        KrishiStorage.setItem('krishi_appearance_settings', JSON.stringify(settings));
        applyAppearanceSettings();
    }

    function applyAppearanceSettings() {
        let settings = getAppearanceSettings();
        let body = document.body;

        // Apply theme style preset
        body.classList.remove('theme-classic', 'theme-minimal', 'theme-pro', 'theme-focus');
        body.classList.add('theme-' + (settings.themeStyle || 'classic'));

        /* Border radius. The five steps are the same px pairs the ui-corner-*
           rules in index.css declare, so the inline value on <html> (which the
           older code path still writes) and the body class can never disagree.
           The step itself comes from the canonical corner setting, i.e. from
           whichever of the two panels the user saved last. */
        const CORNER_RADIUS_PX = {
            sharp:    ['8px',  '6px'],
            subtle:   ['13px', '8px'],
            balanced: ['18px', '10px'],
            soft:     ['24px', '14px'],
            round:    ['28px', '18px']
        };
        let rPair = CORNER_RADIUS_PX[getCanonicalCornerValue()] || CORNER_RADIUS_PX.balanced;
        document.documentElement.style.setProperty('--radius', rPair[0]);
        document.documentElement.style.setProperty('--radius-sm', rPair[1]);

        // Animation rules (animation-duration / transitions multipliers)
        if (settings.animationIntensity === 'off') {
            document.documentElement.style.setProperty('--ani-duration', '0s');
        } else if (settings.animationIntensity === 'low') {
            document.documentElement.style.setProperty('--ani-duration', '0.7s');
        } else if (settings.animationIntensity === 'medium') {
            document.documentElement.style.setProperty('--ani-duration', '0.35s');
        } else if (settings.animationIntensity === 'high') {
            document.documentElement.style.setProperty('--ani-duration', '0.15s');
        }
    }

    function loadAppearanceTabForm() {
        let s = getAppearanceSettings();
        // Corners, density and language are shared with Home → Customize →
        // Appearance & Language, so they are read through the canonical resolvers.
        setSelectSafe('app-density', getCanonicalDensityValue(), 'comfortable');
        setSelectSafe('app-radius', getCanonicalCornerValue(), 'balanced');
        setSelectSafe('app-language', getCanonicalLanguageValue(), 'nepali');
        document.getElementById('app-theme').value = s.themeStyle || 'classic';
        document.getElementById('app-animations').value = s.animationIntensity || 'medium';
        document.getElementById('app-opt-mquote').checked = s.showMQuote !== false;
        document.getElementById('app-opt-agri').checked = s.showAgriQuote !== false;
        document.getElementById('app-opt-panims').checked = s.showProgressAnims !== false;
        appearanceFormsPopulated.appearance = true;
    }

    function saveAppearanceFromForm() {
        /* Both appearance forms populate lazily, so a form whose tab was never
           opened still holds its markup defaults — nothing in it can be a user
           choice. Writing it would silently reset saved values (this is what used
           to flip Animations back to "Off" when Save was pressed from the Widgets
           tab), so an unopened form is skipped instead. */
        if (!appearanceFormsPopulated.appearance) return;

        let denseVal = document.getElementById('app-density').value;
        let themeVal = document.getElementById('app-theme').value;
        let radiusVal = document.getElementById('app-radius').value;
        let langVal = document.getElementById('app-language').value;
        let animVal = document.getElementById('app-animations').value;
        let mquoteVal = document.getElementById('app-opt-mquote').checked;
        let agriVal = document.getElementById('app-opt-agri').checked;
        let panimsVal = document.getElementById('app-opt-panims').checked;

        let homeSettings = getHomeSettings();
        homeSettings.compact = (denseVal === 'compact');
        saveHomeSettings(homeSettings);

        /* Push the three shared values into the canonical customizer key, so the
           other panel shows the same thing. */
        patchCustomAppearanceValues({
            cardCorners: radiusVal,
            layoutDensity: denseVal,
            languageMode: langVal
        });

        /* "Custom Labels Mode" has no greeting of its own, so the older dialect
           is kept instead of being overwritten with the word "custom" — that way
           the greeting stays as it was while the user edits UI strings. */
        let greetVal = (langVal === 'custom')
            ? (getAppearanceSettings().greetingLanguage || 'nepali')
            : langVal;

        let s = {
            themeStyle: themeVal,
            animationIntensity: animVal,
            cardRadius: radiusVal,
            greetingLanguage: greetVal,
            quickActionLayout: 'grid',
            showMQuote: mquoteVal,
            showAgriQuote: agriVal,
            showProgressAnims: panimsVal
        };
        saveAppearanceSettings(s);
    }
    // ==================== ADVANCED APPEARANCE & LANGUAGE CUSTOMIZER ====================
    const defaultCustomSettings = {
        fontSize: 'medium',
        fontWeight: '400',
        fontFamily: 'Inter',
        textHierarchy: 'balanced',
        cardCorners: 'balanced',
        cardDepth: 'balanced',
        layoutDensity: 'comfortable',
        textColor: 'default',
        textColorCustom: '#1e293b',
        accentColor: 'emerald',
        accentColorCustom: '#059669',
        bgSoftness: 'default',
        languageMode: 'english',
        customLabels: {
            home: "Home",
            practice: "Practice",
            create: "Create",
            analytics: "Analytics",
            planner: "Planner",
            settings: "Settings",
            startPractice: "Start Practice",
            saveQuestion: "Save Question",
            addToBatchList: "Add to Batch List",
            quickPractice: "Quick Practice",
            weakTopics: "Weak Topics",
            mistakesMode: "Mistakes Mode",
            bookmarks: "Bookmarks",
            dailyTarget: "Daily Target",
            examSimulation: "Exam Simulation",
            customizeHome: "Customize Home",
            generatePlan: "Generate Plan",
            manage: "Manage"
        }
    };

    const defaultLabels = {
        english: {
            home: "Home",
            practice: "Practice",
            create: "Create",
            analytics: "Analytics",
            planner: "Planner",
            settings: "Settings",
            startPractice: "Start Practice",
            saveQuestion: "Save Question",
            addToBatchList: "Add to Batch List",
            quickPractice: "Quick Practice",
            weakTopics: "Weak Topics",
            mistakesMode: "Mistakes Mode",
            bookmarks: "Bookmarks",
            dailyTarget: "Daily Target",
            examSimulation: "Exam Simulation",
            customizeHome: "Customize Home",
            generatePlan: "Generate Plan",
            manage: "Manage"
        },
        nepali: {
            home: "गृहपृष्ठ",
            practice: "अभ्यास",
            create: "सिर्जना गर्नुहोस्",
            analytics: "विश्लेषण",
            planner: "योजनाकार",
            settings: "सेटिङहरू",
            startPractice: "अभ्यास सुरु गर्नुहोस्",
            saveQuestion: "प्रश्न बचत गर्नुहोस्",
            addToBatchList: "ब्याच सूचीमा थप्नुहोस्",
            quickPractice: "द्रुत अभ्यास",
            weakTopics: "कमजोर विषयहरू",
            mistakesMode: "गलती मोड",
            bookmarks: "बुकमार्कहरू",
            dailyTarget: "दैनिक लक्ष्य",
            examSimulation: "परीक्षा सिमुलेशन",
            customizeHome: "गृहपृष्ठ अनुकूलन",
            generatePlan: "योजना बनाउनुहोस्",
            manage: "व्यवस्थापन गर्नुहोस्"
        },
        mixed: {
            home: "होम (Home)",
            practice: "अभ्यास (Practice)",
            create: "सिर्जना (Create)",
            analytics: "विश्लेषण (Analytics)",
            planner: "योजना (Planner)",
            settings: "सेटिङ (Settings)",
            startPractice: "अभ्यास सुरु (Start)",
            saveQuestion: "प्रश्न बचत (Save)",
            addToBatchList: "ब्याचमा थप्नुहोस् (Add)",
            quickPractice: "द्रुत अभ्यास (Quick)",
            weakTopics: "कमजोर विषय (Weak)",
            mistakesMode: "गलती मोड (Mistakes)",
            bookmarks: "बुकमार्क (Bookmarks)",
            dailyTarget: "दैनिक लक्ष्य (Target)",
            examSimulation: "परीक्षा (Simulation)",
            customizeHome: "होम अनुकूलन (Customize)",
            generatePlan: "योजना बनाउनुहोस् (Plan)",
            manage: "व्यवस्थापन (Manage)"
        }
    };

    function hexToRgb(hex) {
        let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        let fullHex = hex.replace(shorthandRegex, function(m, r, g, b) {
            return r + r + g + g + b + b;
        });
        let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function colorShade(hex, percent) {
        let rgb = hexToRgb(hex);
        if (!rgb) return hex;
        let r = Math.round(Math.min(255, Math.max(0, rgb.r + (255 - rgb.r) * percent)));
        let g = Math.round(Math.min(255, Math.max(0, rgb.g + (255 - rgb.g) * percent)));
        let b = Math.round(Math.min(255, Math.max(0, rgb.b + (255 - rgb.b) * percent)));
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    function colorDarken(hex, percent) {
        let rgb = hexToRgb(hex);
        if (!rgb) return hex;
        let r = Math.round(Math.min(255, Math.max(0, rgb.r * (1 - percent))));
        let g = Math.round(Math.min(255, Math.max(0, rgb.g * (1 - percent))));
        let b = Math.round(Math.min(255, Math.max(0, rgb.b * (1 - percent))));
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    function getCustomAppearanceAndLangSettings() {
        let saved = KrishiStorage.getItem('krishi_custom_appearance_settings');
        if (!saved) return JSON.parse(JSON.stringify(defaultCustomSettings));
        try {
            let parsed = JSON.parse(saved);
            let merged = { ...defaultCustomSettings, ...parsed };
            merged.customLabels = { ...defaultCustomSettings.customLabels, ...(parsed.customLabels || {}) };
            return merged;
        } catch(e) {
            return JSON.parse(JSON.stringify(defaultCustomSettings));
        }
    }

    function getBgSoftnessColors(softness, isDark) {
        if (isDark) {
            if (softness === 'light') return { bg: '#0f172a', card: '#1e293b' };
            if (softness === 'soft-green') return { bg: '#061f14', card: '#0b2e1f' };
            if (softness === 'warm') return { bg: '#1c1917', card: '#292524' };
            if (softness === 'dark-friendly') return { bg: '#030712', card: '#111827' };
            return { bg: '#0f172a', card: '#1e293b' }; // default
        } else {
            if (softness === 'light') return { bg: '#f8fafc', card: '#ffffff' };
            if (softness === 'soft-green') return { bg: '#f4fbf7', card: '#ffffff' };
            if (softness === 'warm') return { bg: '#fdfaf6', card: '#ffffff' };
            if (softness === 'dark-friendly') return { bg: '#f1f5f9', card: '#ffffff' };
            return { bg: '#f0fdf4', card: '#ffffff' }; // default
        }
    }

    /* Surface / type-hierarchy presets from the Appearance & Language tab.
       Each one is a <body> class whose values live in index.css (see the
       "SURFACE, DEPTH & DENSITY CONTROLS" block), the same arrangement the
       theme presets already use. Keeping the values in the stylesheet is what
       lets every step carry its own light and dark variant. */
    const SURFACE_STYLE_OPTIONS = {
        textHierarchy: { prefix: 'ui-hier-',    steps: ['soft', 'balanced', 'strong'],                  fallback: 'balanced' },
        cardCorners:   { prefix: 'ui-corner-',  steps: ['sharp', 'subtle', 'balanced', 'soft', 'round'], fallback: 'balanced' },
        cardDepth:     { prefix: 'ui-depth-',   steps: ['flat', 'subtle', 'balanced', 'elevated'],       fallback: 'balanced' },
        layoutDensity: { prefix: 'ui-density-', steps: ['compact', 'comfortable', 'spacious'],           fallback: 'comfortable' }
    };

    function applySurfaceStyleSettings(settings) {
        if (!document.body) return;
        let src = settings || {};
        for (let key in SURFACE_STYLE_OPTIONS) {
            let opt = SURFACE_STYLE_OPTIONS[key];
            let active = opt.steps.indexOf(src[key]) !== -1 ? src[key] : opt.fallback;
            opt.steps.forEach(function(step) {
                document.body.classList.toggle(opt.prefix + step, step === active);
            });
        }
    }

    /* --- ONE-TAP STYLE PRESETS (Appearance & Language tab) ----------------
       A preset is one tap that fills the four surface <select>s below it and
       nothing more: it owns no storage key of its own, so "Save and Apply
       Dashboard" stays the only thing that persists anything. Every value used
       here is a step that already exists in SURFACE_STYLE_OPTIONS. */
    const STYLE_PRESETS = {
        minimal: {
            name: 'Minimal',
            values: { textHierarchy: 'soft', cardCorners: 'subtle', cardDepth: 'flat', layoutDensity: 'compact' }
        },
        balanced: {
            name: 'Balanced',
            values: { textHierarchy: 'balanced', cardCorners: 'balanced', cardDepth: 'balanced', layoutDensity: 'comfortable' }
        },
        bold: {
            name: 'Bold',
            values: { textHierarchy: 'strong', cardCorners: 'soft', cardDepth: 'elevated', layoutDensity: 'comfortable' }
        },
        relaxed: {
            name: 'Relaxed',
            values: { textHierarchy: 'balanced', cardCorners: 'round', cardDepth: 'subtle', layoutDensity: 'spacious' }
        }
    };

    const STYLE_PRESET_FIELDS = {
        textHierarchy: 'cust-text-hierarchy',
        cardCorners:   'cust-card-corners',
        cardDepth:     'cust-card-depth',
        layoutDensity: 'cust-layout-density'
    };

    // The four surface values exactly as the open form holds them right now.
    function readStylePresetFormValues() {
        let values = {};
        for (let key in STYLE_PRESET_FIELDS) {
            values[key] = readCustSelect(STYLE_PRESET_FIELDS[key], SURFACE_STYLE_OPTIONS[key].fallback);
        }
        return values;
    }

    // id of the preset those four values spell out, or null for a hand-made mix.
    function matchStylePreset(values) {
        for (let id in STYLE_PRESETS) {
            let wanted = STYLE_PRESETS[id].values;
            let same = true;
            for (let key in wanted) {
                if (values[key] !== wanted[key]) { same = false; break; }
            }
            if (same) return id;
        }
        return null;
    }

    /* Keeps the chip row honest: exactly one chip is lit when the four
       controls match a preset, none when the user has their own mix. Called
       from previewAppearanceAndLang(), so every path that changes a control —
       manual, preset, form load, reset — refreshes it. */
    function updateStylePresetChips() {
        let row = document.getElementById('style-preset-row');
        if (!row) return;
        let active = matchStylePreset(readStylePresetFormValues());
        let chips = row.querySelectorAll('[data-preset]');
        Array.prototype.forEach.call(chips, function(chip) {
            let on = chip.getAttribute('data-preset') === active;
            chip.setAttribute('aria-pressed', on ? 'true' : 'false');
            chip.classList.toggle('bg-emerald-100', on);
            chip.classList.toggle('dark:bg-emerald-950/40', on);
            chip.classList.toggle('border-emerald-500', on);
            chip.classList.toggle('ring-1', on);
            chip.classList.toggle('ring-emerald-500/40', on);
            chip.classList.toggle('bg-white', !on);
            chip.classList.toggle('dark:bg-slate-900', !on);
            chip.classList.toggle('border-slate-200', !on);
            chip.classList.toggle('dark:border-slate-800', !on);
        });
        let note = document.getElementById('style-preset-note');
        if (note) {
            note.textContent = active
                ? STYLE_PRESETS[active].name + ' preset is active. Change any of the four controls below and it becomes a custom mix.'
                : 'Custom mix — your own combination. Tap a preset above to replace all four controls at once.';
        }
    }

    function applyStylePreset(id) {
        let preset = STYLE_PRESETS[id];
        if (!preset) return;
        let current = readStylePresetFormValues();
        let currentId = matchStylePreset(current);
        if (currentId === id) {
            showToast('✅ ' + preset.name + ' preset is already selected.');
            return;
        }
        /* A hand-made mix is the only thing a preset can take away, so that is
           the only case that earns a confirm. */
        if (!currentId && !confirm('Apply the ' + preset.name + ' preset?\n\nThis replaces your custom Heading Contrast, Corner Roundness, Card Depth and Layout Density.')) {
            return;
        }
        for (let key in preset.values) {
            setSelectSafe(STYLE_PRESET_FIELDS[key], preset.values[key], SURFACE_STYLE_OPTIONS[key].fallback);
        }
        // Same call a manual change makes: live preview plus the chip refresh.
        previewAppearanceAndLang();
        showToast('✨ ' + preset.name + ' preset ready — press Save and Apply Dashboard to keep it.');
        playSound('click');
    }
    window.applyStylePreset = applyStylePreset;

    // Null-safe read of one customizer <select>, so a missing control can never
    // break the live preview of the controls that are present.
    function readCustSelect(id, fallback) {
        let el = document.getElementById(id);
        return (el && el.value) ? el.value : fallback;
    }

    function applyCustomAppearanceAndLanguageSettings() {
        let settings = getCustomAppearanceAndLangSettings();

        // 1. Font Size
        let fontScale = "100%";
        if (settings.fontSize === 'small') fontScale = "85%";
        else if (settings.fontSize === 'medium') fontScale = "100%";
        else if (settings.fontSize === 'large') fontScale = "115%";
        else if (settings.fontSize === 'xlarge') fontScale = "130%";
        document.documentElement.style.setProperty('--app-font-scale', fontScale);

        // 2. Font Weight
        document.documentElement.style.setProperty('--app-font-weight', settings.fontWeight);

        // 3. Font Family
        let fontFamily = "'Inter', sans-serif";
        if (settings.fontFamily === 'system-ui') fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        else if (settings.fontFamily === 'Noto Sans') fontFamily = "'Noto Sans', sans-serif";
        else if (settings.fontFamily === 'Poppins') fontFamily = "'Poppins', sans-serif";
        else if (settings.fontFamily === 'Roboto') fontFamily = "'Roboto', sans-serif";
        else if (settings.fontFamily === 'Mukta') fontFamily = "'Mukta', sans-serif";
        document.documentElement.style.setProperty('--app-font-family', fontFamily);

        // 4. Accent Color
        let activeAccent = settings.accentColor;
        let accentHex = '#059669';
        let lightHex = '#d1fae5';
        let darkHex = '#047857';
        let rgbStr = '5, 150, 105';

        if (activeAccent === 'blue') {
            accentHex = '#2563eb'; lightHex = '#dbeafe'; darkHex = '#1d4ed8'; rgbStr = '37, 99, 235';
        } else if (activeAccent === 'purple') {
            accentHex = '#7c3aed'; lightHex = '#f3e8ff'; darkHex = '#6d28d9'; rgbStr = '124, 58, 237';
        } else if (activeAccent === 'orange') {
            accentHex = '#ea580c'; lightHex = '#ffedd5'; darkHex = '#c2410c'; rgbStr = '234, 88, 12';
        } else if (activeAccent === 'red') {
            accentHex = '#dc2626'; lightHex = '#fee2e2'; darkHex = '#b91c1c'; rgbStr = '220, 38, 38';
        } else if (activeAccent === 'custom') {
            accentHex = settings.accentColorCustom || '#059669';
            lightHex = colorShade(accentHex, 0.85);
            darkHex = colorDarken(accentHex, 0.20);
            let rgb = hexToRgb(accentHex);
            rgbStr = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '5, 150, 105';
        }
        
        document.documentElement.style.setProperty('--primary', accentHex);
        document.documentElement.style.setProperty('--primary-light', lightHex);
        document.documentElement.style.setProperty('--primary-dark', darkHex);
        document.documentElement.style.setProperty('--primary-rgb', rgbStr);
        
        document.body.classList.add('custom-accent-active');

        // 5. Background Softness
        let isDark = document.documentElement.classList.contains('dark');
        let colors = getBgSoftnessColors(settings.bgSoftness, isDark);
        document.documentElement.style.setProperty('--bg', colors.bg);
        document.documentElement.style.setProperty('--card', colors.card);
        document.documentElement.style.setProperty('--nav-bg', colors.card);

        // 6. Text Color
        let activeText = settings.textColor;
        if (activeText === 'default') {
            document.body.classList.remove('custom-text-active');
            document.documentElement.style.removeProperty('--text');
            document.documentElement.style.removeProperty('--text-secondary');
        } else {
            document.body.classList.add('custom-text-active');
            let textHex = '#1e293b';
            let secHex = '#64748b';
            if (isDark) {
                if (activeText === 'darkslate') { textHex = '#cbd5e1'; secHex = '#94a3b8'; }
                else if (activeText === 'emerald') { textHex = '#a7f3d0'; secHex = '#059669'; }
                else if (activeText === 'indigo') { textHex = '#e0e7ff'; secHex = '#a5b4fc'; }
                else if (activeText === 'warmbrown') { textHex = '#fef3c7'; secHex = '#f59e0b'; }
                else if (activeText === 'custom') {
                    textHex = settings.textColorCustom || '#cbd5e1';
                    secHex = colorShade(textHex, -0.25);
                }
            } else {
                if (activeText === 'darkslate') { textHex = '#334155'; secHex = '#64748b'; }
                else if (activeText === 'emerald') { textHex = '#064e3b'; secHex = '#34d399'; }
                else if (activeText === 'indigo') { textHex = '#1e1b4b'; secHex = '#6366f1'; }
                else if (activeText === 'warmbrown') { textHex = '#451a03'; secHex = '#d97706'; }
                else if (activeText === 'custom') {
                    textHex = settings.textColorCustom || '#1e293b';
                    secHex = colorShade(textHex, 0.40);
                }
            }
            document.documentElement.style.setProperty('--text', textHex);
            document.documentElement.style.setProperty('--text-secondary', secHex);
        }

        // 7. Card surface: corner roundness, depth and density
        /* Corners and density are the shared values, so they come from the
           canonical resolvers: an install that only ever used Settings →
           Appearance keeps the radius and density it saved there, instead of
           being reset to this key's defaults. When the customizer key exists the
           resolvers return exactly settings.cardCorners / settings.layoutDensity. */
        applySurfaceStyleSettings({
            ...settings,
            cardCorners: getCanonicalCornerValue(),
            layoutDensity: getCanonicalDensityValue()
        });

        // 8. Translate labels
        translateAppLabels();
    }

    function translateAppLabels() {
        let settings = getCustomAppearanceAndLangSettings();
        let mode = settings.languageMode;
        let labels = {};

        if (mode === 'english') {
            labels = defaultLabels.english;
        } else if (mode === 'nepali') {
            labels = defaultLabels.nepali;
        } else if (mode === 'mixed') {
            labels = defaultLabels.mixed;
        } else if (mode === 'custom') {
            labels = { ...defaultCustomSettings.customLabels, ...(settings.customLabels || {}) };
        }

        // Apply Nav
        let nav0 = document.querySelector('#nav-btn-0 span:nth-child(2)');
        if (nav0) nav0.textContent = labels.home;
        let nav1 = document.querySelector('#nav-btn-1 span:nth-child(2)');
        if (nav1) nav1.textContent = labels.practice;
        let nav2 = document.querySelector('#nav-btn-2 span:nth-child(2)');
        if (nav2) nav2.textContent = labels.create;
        let nav3 = document.querySelector('#nav-btn-3 span:nth-child(2)');
        if (nav3) nav3.textContent = labels.analytics;
        let navPlanner = document.querySelector('#nav-btn-planner span:nth-child(2)');
        if (navPlanner) navPlanner.textContent = labels.planner;

        // Apply dynamic buttons in page using non-destructive data caching
document.querySelectorAll('button').forEach(btn => {
    let txt = btn.textContent.trim();
    if (!btn.dataset.originalText) {
        btn.dataset.originalText = txt;
    }
    let orig = btn.dataset.originalText;
    
    // Start Practice
    if (orig === '🎯 Start Practice' || orig === 'Start Practice' || orig.includes('Start Practice Challenge')) {
        let prefix = orig.includes('🎯') ? '🎯 ' : (orig.includes('⚡') ? '⚡ ' : '');
        btn.textContent = prefix + labels.startPractice;
    }
    
    // Save Question
    if (orig.toLowerCase() === 'save question') {
        btn.textContent = labels.saveQuestion;
    }
    
    // Add to Batch List
    if (orig.toLowerCase() === 'add to batch list') {
        btn.textContent = labels.addToBatchList;
    }
    
    // Customize Home
    if (orig.includes('Customize Home')) {
        btn.textContent = '⚙️ ' + labels.customizeHome;
    }
    
    // Generate Plan
    if (orig.includes('Generate Plan')) {
        btn.textContent = '📋 ' + labels.generatePlan;
    }
    
    // Manage
    if (orig === 'Manage') {
        btn.textContent = labels.manage;
    } else if (orig.includes('Manage Subjects')) {
        btn.textContent = '📚 ' + labels.manage;
    }
});

        // Dynamic Grid block texts
        document.querySelectorAll('p, div, span').forEach(el => {
            let txt = el.textContent.trim();
            if (txt === 'Quick Practice') {
                el.textContent = labels.quickPractice;
            } else if (txt === 'Weak Topics') {
                el.textContent = labels.weakTopics;
            } else if (txt === 'Mistakes Mode') {
                el.textContent = labels.mistakesMode;
            } else if (txt === 'Bookmarks') {
                el.textContent = labels.bookmarks;
            } else if (txt === 'Daily Target') {
                el.textContent = labels.dailyTarget;
            } else if (txt === 'Exam Simulation') {
                el.textContent = labels.examSimulation;
            }
        });
    }

    function previewAppearanceAndLang() {
        let fontScale = "100%";
        let fontSize = document.getElementById('cust-font-size').value;
        if (fontSize === 'small') fontScale = "85%";
        else if (fontSize === 'medium') fontScale = "100%";
        else if (fontSize === 'large') fontScale = "115%";
        else if (fontSize === 'xlarge') fontScale = "130%";

        let fontWeight = document.getElementById('cust-font-weight').value;

        let fontFamily = "'Inter', sans-serif";
        let fontFamilyVal = document.getElementById('cust-font-family').value;
        if (fontFamilyVal === 'system-ui') fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        else if (fontFamilyVal === 'Noto Sans') fontFamily = "'Noto Sans', sans-serif";
        else if (fontFamilyVal === 'Poppins') fontFamily = "'Poppins', sans-serif";
        else if (fontFamilyVal === 'Roboto') fontFamily = "'Roboto', sans-serif";
        else if (fontFamilyVal === 'Mukta') fontFamily = "'Mukta', sans-serif";

        let activeAccent = document.getElementById('cust-accent-color').value;
        let accentHex = '#059669';
        if (activeAccent === 'blue') accentHex = '#2563eb';
        else if (activeAccent === 'purple') accentHex = '#7c3aed';
        else if (activeAccent === 'orange') accentHex = '#ea580c';
        else if (activeAccent === 'red') accentHex = '#dc2626';
        else if (activeAccent === 'custom') accentHex = document.getElementById('cust-accent-picker').value || '#059669';

        let activeText = document.getElementById('cust-text-color').value;
        let isDark = document.documentElement.classList.contains('dark');
        let textHex = isDark ? '#f1f5f9' : '#1e293b';
        let secHex = isDark ? '#94a3b8' : '#64748b';

        if (activeText !== 'default') {
            if (isDark) {
                if (activeText === 'darkslate') { textHex = '#cbd5e1'; secHex = '#94a3b8'; }
                else if (activeText === 'emerald') { textHex = '#a7f3d0'; secHex = '#059669'; }
                else if (activeText === 'indigo') { textHex = '#e0e7ff'; secHex = '#a5b4fc'; }
                else if (activeText === 'warmbrown') { textHex = '#fef3c7'; secHex = '#f59e0b'; }
                else if (activeText === 'custom') {
                    textHex = document.getElementById('cust-text-picker').value || '#cbd5e1';
                    secHex = colorShade(textHex, -0.25);
                }
            } else {
                if (activeText === 'darkslate') { textHex = '#334155'; secHex = '#64748b'; }
                else if (activeText === 'emerald') { textHex = '#064e3b'; secHex = '#34d399'; }
                else if (activeText === 'indigo') { textHex = '#1e1b4b'; secHex = '#6366f1'; }
                else if (activeText === 'warmbrown') { textHex = '#451a03'; secHex = '#d97706'; }
                else if (activeText === 'custom') {
                    textHex = document.getElementById('cust-text-picker').value || '#1e293b';
                    secHex = colorShade(textHex, 0.40);
                }
            }
        }

        let bgSoftness = document.getElementById('cust-bg-softness').value;
        let colors = getBgSoftnessColors(bgSoftness, isDark);

        // Apply strictly to preview box
        let box = document.getElementById('custom-live-preview-box');
        if (box) {
            box.style.fontFamily = fontFamily;
            box.style.fontSize = fontScale;
            box.style.fontWeight = fontWeight;
            box.style.backgroundColor = colors.card;
            box.style.borderColor = isDark ? '#334155' : '#e2e8f0';
            box.style.color = textHex;
            
            let title = document.getElementById('preview-sample-title');
            if (title) {
                title.style.color = textHex;
                title.style.fontWeight = parseInt(fontWeight) + 200;
            }
            let desc = document.getElementById('preview-sample-desc');
            if (desc) {
                desc.style.color = secHex;
            }
            let btn = document.getElementById('preview-sample-btn');
            if (btn) {
                btn.style.backgroundColor = accentHex;
                btn.style.fontWeight = parseInt(fontWeight) + 200;
            }
            let navLbl = document.getElementById('preview-sample-nav-label');
            if (navLbl) {
                navLbl.style.color = accentHex;
                navLbl.style.fontWeight = parseInt(fontWeight) + 200;
            }
        }

        // Update dynamic text
        let langMode = document.getElementById('cust-language-mode').value;
        let labels = {};
        if (langMode === 'english') labels = defaultLabels.english;
        else if (langMode === 'nepali') labels = defaultLabels.nepali;
        else if (langMode === 'mixed') labels = defaultLabels.mixed;
        else if (langMode === 'custom') {
            labels = {
                home: document.getElementById('lbl-home').value || "Home",
                startPractice: document.getElementById('lbl-startPractice').value || "Start Practice"
            };
        }
        
        let sampleNav = document.getElementById('preview-sample-nav-label');
        if (sampleNav) sampleNav.textContent = labels.home;
        let sampleBtn = document.getElementById('preview-sample-btn');
        if (sampleBtn) sampleBtn.textContent = '🎯 ' + labels.startPractice;

        // Apply styles live to the whole app!
        applyLiveStyles({
            fontSize,
            fontWeight,
            fontFamily: fontFamilyVal,
            accentColor: activeAccent,
            accentColorCustom: document.getElementById('cust-accent-picker').value,
            textColor: activeText,
            textColorCustom: document.getElementById('cust-text-picker').value,
            bgSoftness,
            textHierarchy: readCustSelect('cust-text-hierarchy', 'balanced'),
            cardCorners: readCustSelect('cust-card-corners', 'balanced'),
            cardDepth: readCustSelect('cust-card-depth', 'balanced'),
            layoutDensity: readCustSelect('cust-layout-density', 'comfortable'),
            languageMode: langMode,
            customLabels: {
                home: document.getElementById('lbl-home').value,
                practice: document.getElementById('lbl-practice').value,
                create: document.getElementById('lbl-create').value,
                analytics: document.getElementById('lbl-analytics').value,
                planner: document.getElementById('lbl-planner').value,
                settings: document.getElementById('lbl-settings').value,
                startPractice: document.getElementById('lbl-startPractice').value,
                saveQuestion: document.getElementById('lbl-saveQuestion').value,
                addToBatchList: document.getElementById('lbl-addToBatchList').value,
                quickPractice: document.getElementById('lbl-quickPractice').value,
                weakTopics: document.getElementById('lbl-weakTopics').value,
                mistakesMode: document.getElementById('lbl-mistakesMode').value,
                bookmarks: document.getElementById('lbl-bookmarks').value,
                dailyTarget: document.getElementById('lbl-dailyTarget').value,
                examSimulation: document.getElementById('lbl-examSimulation').value,
                customizeHome: document.getElementById('lbl-customizeHome').value,
                generatePlan: document.getElementById('lbl-generatePlan').value,
                manage: document.getElementById('lbl-manage').value
            }
        });

        updateStylePresetChips();
    }

    function applyLiveStyles(settings) {
        let fontScale = "100%";
        if (settings.fontSize === 'small') fontScale = "85%";
        else if (settings.fontSize === 'medium') fontScale = "100%";
        else if (settings.fontSize === 'large') fontScale = "115%";
        else if (settings.fontSize === 'xlarge') fontScale = "130%";
        document.documentElement.style.setProperty('--app-font-scale', fontScale);

        document.documentElement.style.setProperty('--app-font-weight', settings.fontWeight);

        let fontFamily = "'Inter', sans-serif";
        if (settings.fontFamily === 'system-ui') fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        else if (settings.fontFamily === 'Noto Sans') fontFamily = "'Noto Sans', sans-serif";
        else if (settings.fontFamily === 'Poppins') fontFamily = "'Poppins', sans-serif";
        else if (settings.fontFamily === 'Roboto') fontFamily = "'Roboto', sans-serif";
        else if (settings.fontFamily === 'Mukta') fontFamily = "'Mukta', sans-serif";
        document.documentElement.style.setProperty('--app-font-family', fontFamily);

        let activeAccent = settings.accentColor;
        let accentHex = '#059669';
        let lightHex = '#d1fae5';
        let darkHex = '#047857';
        let rgbStr = '5, 150, 105';

        if (activeAccent === 'blue') {
            accentHex = '#2563eb'; lightHex = '#dbeafe'; darkHex = '#1d4ed8'; rgbStr = '37, 99, 235';
        } else if (activeAccent === 'purple') {
            accentHex = '#7c3aed'; lightHex = '#f3e8ff'; darkHex = '#6d28d9'; rgbStr = '124, 58, 237';
        } else if (activeAccent === 'orange') {
            accentHex = '#ea580c'; lightHex = '#ffedd5'; darkHex = '#c2410c'; rgbStr = '234, 88, 12';
        } else if (activeAccent === 'red') {
            accentHex = '#dc2626'; lightHex = '#fee2e2'; darkHex = '#b91c1c'; rgbStr = '220, 38, 38';
        } else if (activeAccent === 'custom') {
            accentHex = settings.accentColorCustom || '#059669';
            lightHex = colorShade(accentHex, 0.85);
            darkHex = colorDarken(accentHex, 0.20);
            let rgb = hexToRgb(accentHex);
            rgbStr = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '5, 150, 105';
        }
        
        document.documentElement.style.setProperty('--primary', accentHex);
        document.documentElement.style.setProperty('--primary-light', lightHex);
        document.documentElement.style.setProperty('--primary-dark', darkHex);
        document.documentElement.style.setProperty('--primary-rgb', rgbStr);
        
        document.body.classList.add('custom-accent-active');

        let isDark = document.documentElement.classList.contains('dark');
        let colors = getBgSoftnessColors(settings.bgSoftness, isDark);
        document.documentElement.style.setProperty('--bg', colors.bg);
        document.documentElement.style.setProperty('--card', colors.card);
        document.documentElement.style.setProperty('--nav-bg', colors.card);

        let activeText = settings.textColor;
        if (activeText === 'default') {
            document.body.classList.remove('custom-text-active');
            document.documentElement.style.removeProperty('--text');
            document.documentElement.style.removeProperty('--text-secondary');
        } else {
            document.body.classList.add('custom-text-active');
            let textHex = '#1e293b';
            let secHex = '#64748b';
            if (isDark) {
                if (activeText === 'darkslate') { textHex = '#cbd5e1'; secHex = '#94a3b8'; }
                else if (activeText === 'emerald') { textHex = '#a7f3d0'; secHex = '#059669'; }
                else if (activeText === 'indigo') { textHex = '#e0e7ff'; secHex = '#a5b4fc'; }
                else if (activeText === 'warmbrown') { textHex = '#fef3c7'; secHex = '#f59e0b'; }
                else if (activeText === 'custom') {
                    textHex = settings.textColorCustom || '#cbd5e1';
                    secHex = colorShade(textHex, -0.25);
                }
            } else {
                if (activeText === 'darkslate') { textHex = '#334155'; secHex = '#64748b'; }
                else if (activeText === 'emerald') { textHex = '#064e3b'; secHex = '#34d399'; }
                else if (activeText === 'indigo') { textHex = '#1e1b4b'; secHex = '#6366f1'; }
                else if (activeText === 'warmbrown') { textHex = '#451a03'; secHex = '#d97706'; }
                else if (activeText === 'custom') {
                    textHex = settings.textColorCustom || '#1e293b';
                    secHex = colorShade(textHex, 0.40);
                }
            }
            document.documentElement.style.setProperty('--text', textHex);
            document.documentElement.style.setProperty('--text-secondary', secHex);
        }

        applySurfaceStyleSettings(settings);

        let mode = settings.languageMode;
        let labels = {};
        if (mode === 'english') labels = defaultLabels.english;
        else if (mode === 'nepali') labels = defaultLabels.nepali;
        else if (mode === 'mixed') labels = defaultLabels.mixed;
        else if (mode === 'custom') labels = { ...defaultCustomSettings.customLabels, ...(settings.customLabels || {}) };

        let nav0 = document.querySelector('#nav-btn-0 span:nth-child(2)');
        if (nav0) nav0.textContent = labels.home;
        let nav1 = document.querySelector('#nav-btn-1 span:nth-child(2)');
        if (nav1) nav1.textContent = labels.practice;
        let nav2 = document.querySelector('#nav-btn-2 span:nth-child(2)');
        if (nav2) nav2.textContent = labels.create;
        let nav3 = document.querySelector('#nav-btn-3 span:nth-child(2)');
        if (nav3) nav3.textContent = labels.analytics;
        let navPlanner = document.querySelector('#nav-btn-planner span:nth-child(2)');
        if (navPlanner) navPlanner.textContent = labels.planner;
    }

    function selectAccentColor(color, element) {
        document.getElementById('cust-accent-color').value = color;
        
        document.querySelectorAll('.accent-swatch').forEach(btn => {
            btn.classList.remove('border-slate-900', 'dark:border-white', 'scale-110', 'ring-2', 'ring-offset-2', 'ring-slate-500');
            btn.classList.add('border-transparent');
        });
        
        if (element && color !== 'custom') {
            element.classList.remove('border-transparent');
            element.classList.add('border-slate-900', 'dark:border-white', 'scale-110', 'ring-2', 'ring-offset-2', 'ring-slate-500');
        }
        
        previewAppearanceAndLang();
    }

    function selectTextColor(color, element) {
        document.getElementById('cust-text-color').value = color;

        document.querySelectorAll('.text-swatch').forEach(btn => {
            btn.classList.remove('border-slate-900', 'dark:border-white', 'scale-110', 'ring-2', 'ring-offset-2', 'ring-slate-500');
            btn.classList.add('border-transparent');
        });

        if (element && color !== 'custom') {
            element.classList.remove('border-transparent');
            element.classList.add('border-slate-900', 'dark:border-white', 'scale-110', 'ring-2', 'ring-offset-2', 'ring-slate-500');
        }

        previewAppearanceAndLang();
    }

    function toggleLanguageModeView() {
        let mode = document.getElementById('cust-language-mode').value;
        let panel = document.getElementById('custom-labels-editor-panel');
        if (panel) {
            if (mode === 'custom') {
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        }
        previewAppearanceAndLang();
    }

    function updateSwatchBorders(className, selectedValue) {
        document.querySelectorAll('.' + className).forEach(btn => {
            let title = btn.getAttribute('title') || '';
            let isSelected = false;
            
            if (className === 'accent-swatch') {
                if (selectedValue === 'emerald' && title === 'Emerald') isSelected = true;
                else if (selectedValue === 'blue' && title === 'Blue') isSelected = true;
                else if (selectedValue === 'purple' && title === 'Purple') isSelected = true;
                else if (selectedValue === 'orange' && title === 'Orange') isSelected = true;
                else if (selectedValue === 'red' && title === 'Red') isSelected = true;
            } else if (className === 'text-swatch') {
                let txt = btn.textContent.trim();
                if (selectedValue === 'default' && txt === 'Def') isSelected = true;
                else if (selectedValue === 'darkslate' && title === 'Dark Slate') isSelected = true;
                else if (selectedValue === 'emerald' && title === 'Emerald') isSelected = true;
                else if (selectedValue === 'indigo' && title === 'Indigo') isSelected = true;
                else if (selectedValue === 'warmbrown' && title === 'Warm Brown') isSelected = true;
            }

            if (isSelected) {
                btn.classList.remove('border-transparent');
                btn.classList.add('border-slate-900', 'dark:border-white', 'scale-110', 'ring-2', 'ring-offset-2', 'ring-slate-500');
            } else {
                btn.classList.add('border-transparent');
                btn.classList.remove('border-slate-900', 'dark:border-white', 'scale-110', 'ring-2', 'ring-offset-2', 'ring-slate-500');
            }
        });
    }

    function loadAppearanceLangTabForm() {
        let settings = getCustomAppearanceAndLangSettings();
        
        document.getElementById('cust-font-family').value = settings.fontFamily || 'Inter';
        document.getElementById('cust-font-size').value = settings.fontSize || 'medium';
        document.getElementById('cust-font-weight').value = settings.fontWeight || '400';

        let hierarchySel = document.getElementById('cust-text-hierarchy');
        if (hierarchySel) hierarchySel.value = settings.textHierarchy || 'balanced';
        let cornersSel = document.getElementById('cust-card-corners');
        if (cornersSel) cornersSel.value = settings.cardCorners || 'balanced';
        let depthSel = document.getElementById('cust-card-depth');
        if (depthSel) depthSel.value = settings.cardDepth || 'balanced';
        let densitySel = document.getElementById('cust-layout-density');
        if (densitySel) densitySel.value = settings.layoutDensity || 'comfortable';

        document.getElementById('cust-accent-color').value = settings.accentColor || 'emerald';
        document.getElementById('cust-accent-picker').value = settings.accentColorCustom || '#059669';
        updateSwatchBorders('accent-swatch', settings.accentColor);

        document.getElementById('cust-text-color').value = settings.textColor || 'default';
        document.getElementById('cust-text-picker').value = settings.textColorCustom || '#1e293b';
        updateSwatchBorders('text-swatch', settings.textColor);

        document.getElementById('cust-bg-softness').value = settings.bgSoftness || 'default';
        document.getElementById('cust-language-mode').value = settings.languageMode || 'english';
        
        let cl = settings.customLabels || defaultCustomSettings.customLabels;
        for (let key in defaultCustomSettings.customLabels) {
            let el = document.getElementById('lbl-' + key);
            if (el) el.value = cl[key] || defaultCustomSettings.customLabels[key];
        }

        toggleLanguageModeView();
        previewAppearanceAndLang();
        appearanceFormsPopulated.appearanceLang = true;
    }

    function saveCustomAppearanceAndLanguageSettings() {
        // Same reason as saveAppearanceFromForm(): an unopened form holds only
        // markup defaults, so saving it would overwrite good values with them.
        if (!appearanceFormsPopulated.appearanceLang) return;

        let fontSize = document.getElementById('cust-font-size').value;
        let fontWeight = document.getElementById('cust-font-weight').value;
        let fontFamily = document.getElementById('cust-font-family').value;
        let accentColor = document.getElementById('cust-accent-color').value;
        let accentColorCustom = document.getElementById('cust-accent-picker').value;
        let textColor = document.getElementById('cust-text-color').value;
        let textColorCustom = document.getElementById('cust-text-picker').value;
        let bgSoftness = document.getElementById('cust-bg-softness').value;
        let languageMode = document.getElementById('cust-language-mode').value;
        let textHierarchy = readCustSelect('cust-text-hierarchy', 'balanced');
        let cardCorners = readCustSelect('cust-card-corners', 'balanced');
        let cardDepth = readCustSelect('cust-card-depth', 'balanced');
        let layoutDensity = readCustSelect('cust-layout-density', 'comfortable');

        let customLabels = {};
        for (let key in defaultCustomSettings.customLabels) {
            let el = document.getElementById('lbl-' + key);
            customLabels[key] = el ? el.value : defaultCustomSettings.customLabels[key];
        }

        let settings = {
            fontSize,
            fontWeight,
            fontFamily,
            accentColor,
            accentColorCustom,
            textColor,
            textColorCustom,
            bgSoftness,
            textHierarchy,
            cardCorners,
            cardDepth,
            layoutDensity,
            languageMode,
            customLabels
        };

        KrishiStorage.setItem('krishi_custom_appearance_settings', JSON.stringify(settings));
        applyCustomAppearanceAndLanguageSettings();

        /* The other view onto these same three values is Settings → Appearance.
           Keep its two consumers in step: the widget renderer still reads
           homeSettings.compact, and the older appearance key stays truthful so
           both panels report the same thing. */
        let homeSettings = getHomeSettings();
        let wantCompact = (layoutDensity === 'compact');
        if (homeSettings.compact !== wantCompact) {
            homeSettings.compact = wantCompact;
            saveHomeSettings(homeSettings);
        }

        let legacy = getAppearanceSettings();
        // 'custom' has no greeting of its own — keep the dialect already stored.
        let legacyGreeting = (languageMode === 'custom') ? (legacy.greetingLanguage || 'nepali') : languageMode;
        if (legacy.cardRadius !== cardCorners || legacy.greetingLanguage !== legacyGreeting) {
            legacy.cardRadius = cardCorners;
            legacy.greetingLanguage = legacyGreeting;
            saveAppearanceSettings(legacy);
        }
    }

    function resetAppearanceAndLanguageSettings() {
        if (confirm('Are you sure you want to reset all appearance & language settings back to defaults?')) {
            KrishiStorage.removeItem('krishi_custom_appearance_settings');

            /* Corners, density and language are mirrored into the older key and
               into homeSettings.compact, and those become the fallback the moment
               this key is gone. Put them back to their defaults too, otherwise
               "reset" would keep whatever roundness or density was last saved. */
            let legacy = getAppearanceSettings();
            legacy.cardRadius = 'medium';        // → balanced (18px)
            legacy.greetingLanguage = 'nepali';  // fresh-install greeting
            KrishiStorage.setItem('krishi_appearance_settings', JSON.stringify(legacy));
            let homeSettings = getHomeSettings();
            if (homeSettings.compact) {
                homeSettings.compact = false;    // → comfortable density
                saveHomeSettings(homeSettings);
            }

            applyAppearanceSettings();
            applyCustomAppearanceAndLanguageSettings();
            loadAppearanceLangTabForm();
            if (appearanceFormsPopulated.appearance) loadAppearanceTabForm();
            showToast('🔄 Appearance & language settings reset to defaults!');
            playSound('success');
        }
    }


    // --- WIDGETS MANAGER EXTENSIONS ---
    function filterWidgetCategory(category) {
        activeWidgetCategory = category;
        // Toggle filters buttons
        document.querySelectorAll('[id^="catBtn-"]').forEach(btn => {
            btn.classList.add('text-slate-500');
            btn.classList.remove('bg-slate-200', 'dark:bg-slate-850', 'text-slate-850', 'dark:text-slate-200', 'font-black');
        });
        let activeBtn = document.getElementById('catBtn-' + category);
        if (activeBtn) {
            activeBtn.classList.remove('text-slate-500');
            activeBtn.classList.add('bg-slate-200', 'dark:bg-slate-850', 'text-slate-850', 'dark:text-slate-200', 'font-black');
        }
        buildCustomizerWidgetsList();
        playSound('click');
    }

    const WIDGET_METADATA = {
        smartRecommendation: { label: "Today's Study Roadmap", category: 'Progress', priority: 'High', locked: true },
        examCountdown: { label: "Exam Date Countdown", category: 'Progress', priority: 'Critical', locked: true },
        readinessScore: { label: "Exam Readiness Score Meter", category: 'Analytics', priority: 'High', locked: false },
        dailyTarget: { label: "Daily Core MCQ Target Tracker", category: 'Progress', priority: 'High', locked: false },
        accuracy: { label: "Average Performance Accuracy", category: 'Analytics', priority: 'Normal', locked: false },
        streak: { label: "Daily Consistency Streaks Heatmap", category: 'Analytics', priority: 'Normal', locked: false },
        bookmarks: { label: "Bookmarked Review Questions", category: 'Revision', priority: 'Low', locked: false },
        syllabusProgress: { label: "Overall Syllabus Coverage Progress", category: 'Progress', priority: 'High', locked: false },
        weeklyProgress: { label: "Weekly Progression Charts", category: 'Analytics', priority: 'Normal', locked: false },
        motivationalQuote: { label: "Inspirational Greet Block Quotes", category: 'Motivation', priority: 'Low', locked: false },
        quickPractice: { label: "Launch Drill Quick Practice Options", category: 'Practice', priority: 'Normal', locked: false },
        spacedReview: { label: "Spaced Reinforcement Retrieval Queue", category: 'Revision', priority: 'High', locked: false },
        reviewMistakes: { label: "Incorrect MCQ Error Review Stack", category: 'Revision', priority: 'High', locked: false },
        mockTest: { label: "Agri Mock Simulation Exams Suite", category: 'Practice', priority: 'Normal', locked: false }
    };

    function applyWidgetPreset(presetName) {
        let order = Object.keys(WIDGET_METADATA);
        let hidden = [];
        
        if (presetName === 'focus') {
            hidden = ['readinessScore', 'bookmarks', 'weeklyProgress', 'motivationalQuote', 'streak', 'syllabusProgress'];
        } else if (presetName === 'exam') {
            hidden = ['bookmarks', 'reviewMistakes', 'spacedReview', 'motivationalQuote', 'streak', 'weeklyProgress'];
        } else if (presetName === 'revision') {
            hidden = ['accuracy', 'streak', 'syllabusProgress', 'weeklyProgress', 'motivationalQuote', 'quickPractice', 'mockTest'];
        } else if (presetName === 'analytics') {
            hidden = ['bookmarks', 'reviewMistakes', 'spacedReview', 'quickPractice', 'mockTest', 'motivationalQuote'];
        } else if (presetName === 'minimal') {
            hidden = ['readinessScore', 'bookmarks', 'syllabusProgress', 'weeklyProgress', 'motivationalQuote', 'quickPractice', 'spacedReview', 'reviewMistakes', 'mockTest', 'streak', 'accuracy', 'smartRecommendation'];
        } else if (presetName === 'custom') {
            hidden = [];
        }

        let current = getHomeSettings();
        current.order = order;
        current.hidden = hidden;
        saveHomeSettings(current);
        
        showToast('🎯 Layout preset applied: ' + presetName.toUpperCase());
        buildCustomizerWidgetsList();
        updateHomePage();
        playSound('success');
    }

    function buildCustomizerWidgetsList() {
        let container = document.getElementById('cust-widgets-list-container');
        if (!container) return;
        
        let settings = getHomeSettings();
        container.innerHTML = '';
        
        if (!settings.widgetSizes) settings.widgetSizes = {};
        if (!settings.widgetPins) settings.widgetPins = {};
        if (!settings.widgetLocks) settings.widgetLocks = {};

        let orderList = settings.order || Object.keys(WIDGET_METADATA);

        // Filter based on category
        let filteredList = orderList.filter(wId => {
            if (activeWidgetCategory === 'All') return true;
            let cat = WIDGET_METADATA[wId]?.category || 'Progress';
            return cat === activeWidgetCategory;
        });

        filteredList.forEach((wId, idx) => {
            let isHidden = settings.hidden && settings.hidden.includes(wId);
            let meta = WIDGET_METADATA[wId] || { label: wId, priority: 'Normal', locked: false };
            let label = meta.label;
            
            let isPinned = settings.widgetPins[wId] || false;
            let isLocked = meta.locked || settings.widgetLocks[wId] || false;
            let currentSize = settings.widgetSizes[wId] || 'Medium';

            let itemDiv = document.createElement('div');
            itemDiv.className = "flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-3xs cursor-grab active:cursor-grabbing transition duration-150 hover:border-indigo-350";
            itemDiv.draggable = true;
            
            // Drag and Drop handlers
            itemDiv.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', wId);
                itemDiv.classList.add('widget-ghost');
            };
            itemDiv.ondragend = () => {
                itemDiv.classList.remove('widget-ghost');
            };
            itemDiv.ondragover = (e) => {
                e.preventDefault();
                itemDiv.classList.add('bg-indigo-50/50', 'dark:bg-indigo-950/20');
            };
            itemDiv.ondragleave = () => {
                itemDiv.classList.remove('bg-indigo-50/50', 'dark:bg-indigo-950/20');
            };
            itemDiv.ondrop = (e) => {
                e.preventDefault();
                itemDiv.classList.remove('bg-indigo-50/50', 'dark:bg-indigo-950/20');
                let draggedWId = e.dataTransfer.getData('text/plain');
                if (draggedWId !== wId) {
                    swapWidgetsInOrder(draggedWId, wId);
                }
            };

            let priorityColor = "text-slate-400";
            if (meta.priority === 'Critical') priorityColor = "bg-red-100 dark:bg-red-955/20 text-red-650 dark:text-red-400";
            else if (meta.priority === 'High') priorityColor = "bg-amber-100 dark:bg-amber-955/20 text-indigo-700 dark:text-amber-400";
            else if (meta.priority === 'Normal') priorityColor = "bg-blue-100 dark:bg-blue-955/20 text-blue-700 dark:text-blue-400";

            itemDiv.innerHTML = `
                <div class="flex items-start gap-2 max-w-[70%]">
                    <button onclick="toggleWidgetHiddenState('${wId}')" class="text-xs cursor-pointer hover:scale-110  transition pt-0.5">
                        ${isHidden ? '❌' : '✅'}
                    </button>
                    <div>
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-extrabold text-[11px] ${isHidden ? 'line-through text-slate-400' : 'text-slate-850 dark:text-slate-200'}">${label}</span>
                            <span class="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md ${priorityColor}">${meta.priority || 'Normal'}</span>
                            ${isPinned ? '📌' : ''}
                        </div>
                        <p class="text-[9px] text-slate-400 mt-0.5">Category: ${meta.category || 'General'}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 mt-2.5 sm:mt-0 w-full sm:w-auto justify-end">
                    <!-- Size Selector -->
                    <select onchange="changeWidgetSize('${wId}', this.value)" class="p-1 px-1.5 bg-slate-55 dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded font-bold text-[9px] cursor-pointer">
                        <option value="Small" ${currentSize === 'Small' ? 'selected' : ''}>Small Size</option>
                        <option value="Medium" ${currentSize === 'Medium' ? 'selected' : ''}>Medium Size</option>
                        <option value="Large" ${currentSize === 'Large' ? 'selected' : ''}>Large Size</option>
                    </select>

                    <button onclick="toggleWidgetPinState('${wId}')" title="Pin to top" class="p-1 hover:bg-slate-100 dark:hover:bg-slate-900 rounded cursor-pointer text-[10px] transition">
                        ${isPinned ? '📍' : '📌'}
                    </button>

                    <div class="flex gap-0.5 bg-slate-55 dark:bg-slate-900 p-0.5 rounded border border-slate-200/50 dark:border-slate-800">
                        <button onclick="moveWidgetInOrderDirectly('${wId}', -1)" class="p-0.5 px-1 hover:bg-slate-200 dark:hover:bg-slate-850 rounded text-[8px] font-black cursor-pointer transition ${idx === 0 ? 'opacity-30 cursor-not-allowed' : ''}">▲</button>
                        <button onclick="moveWidgetInOrderDirectly('${wId}', 1)" class="p-0.5 px-1 hover:bg-slate-200 dark:hover:bg-slate-850 rounded text-[8px] font-black cursor-pointer transition ${idx === filteredList.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
                    </div>
                </div>
            `;
            container.appendChild(itemDiv);
        });
    }

    function swapWidgetsInOrder(wId1, wId2) {
        let settings = getHomeSettings();
        let idx1 = settings.order.indexOf(wId1);
        let idx2 = settings.order.indexOf(wId2);
        if (idx1 === -1 || idx2 === -1) return;
        
        let temp = settings.order[idx1];
        settings.order[idx1] = settings.order[idx2];
        settings.order[idx2] = temp;

        saveHomeSettings(settings);
        buildCustomizerWidgetsList();
        updateHomePage();
        playSound('click');
    }

    function toggleWidgetHiddenState(wId) {
        let meta = WIDGET_METADATA[wId];
        if (meta && meta.locked) {
            showToast('⚠️ This widget is locked for layout integrity and cannot be hidden!');
            playSound('click');
            return;
        }

        let settings = getHomeSettings();
        if (!settings.hidden) settings.hidden = [];
        let idx = settings.hidden.indexOf(wId);
        
        if (idx > -1) {
            settings.hidden.splice(idx, 1);
        } else {
            if (meta && ['Critical', 'High'].includes(meta.priority)) {
                if (!confirm(`Widget "${meta.label}" is a high-priority preparation segment. Are you sure you want to hide it?`)) {
                    return;
                }
            }
            settings.hidden.push(wId);
        }

        saveHomeSettings(settings);
        buildCustomizerWidgetsList();
        updateHomePage();
        playSound('success');
    }

    function changeWidgetSize(wId, val) {
        let settings = getHomeSettings();
        if (!settings.widgetSizes) settings.widgetSizes = {};
        settings.widgetSizes[wId] = val;
        saveHomeSettings(settings);
        updateHomePage();
        showToast('📏 Re-sized widget and updated layout density.');
        playSound('click');
    }

    function toggleWidgetPinState(wId) {
        let settings = getHomeSettings();
        if (!settings.widgetPins) settings.widgetPins = {};
        settings.widgetPins[wId] = !settings.widgetPins[wId];

        if (settings.widgetPins[wId]) {
            settings.order = settings.order.filter(id => id !== wId);
            settings.order.unshift(wId);
        }

        saveHomeSettings(settings);
        buildCustomizerWidgetsList();
        updateHomePage();
        playSound('success');
    }

    function moveWidgetInOrderDirectly(wId, direction) {
        let settings = getHomeSettings();
        let idx = settings.order.indexOf(wId);
        if (idx === -1) return;
        
        let targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= settings.order.length) return;
        
        let temp = settings.order[idx];
        settings.order[idx] = settings.order[targetIdx];
        settings.order[targetIdx] = temp;
        
        saveHomeSettings(settings);
        buildCustomizerWidgetsList();
        updateHomePage();
        playSound('click');
    }

    // Modal customized display logic
    function openHomeCustomizerModal() {
        let modal = document.getElementById('home-customizer-modal');
        if (!modal) return;
        
        switchCustomizerTab('profiles');
        
        let inner = document.getElementById('home-customizer-inner');
        modal.classList.remove('hidden');
        setTimeout(() => {
            if (inner) {
                inner.classList.remove('scale-95', 'opacity-0');
                inner.classList.add('scale-100', 'opacity-100');
            }
        }, 10);
        playSound('click');
    }

    function closeHomeCustomizerModal() {
        // Revert live appearance settings back to saved state when closing without saving
        if (typeof applyCustomAppearanceAndLanguageSettings === 'function') {
            applyCustomAppearanceAndLanguageSettings();
        }
        let modal = document.getElementById('home-customizer-modal');
        let inner = document.getElementById('home-customizer-inner');
        if (inner) {
            inner.classList.remove('scale-100', 'opacity-100');
            inner.classList.add('scale-95', 'opacity-0');
        }
        setTimeout(() => {
            if (modal) modal.classList.add('hidden');
        }, 150);
        playSound('click');
    }

    function resetHomeCustomizer() {
        if (confirm('Are you sure you want to revert all exam profiles and widgets back to defaults?')) {
            KrishiStorage.removeItem('krishi_home_settings');
            KrishiStorage.removeItem('krishi_exam_profiles');
            KrishiStorage.removeItem('krishi_appearance_settings');
            KrishiStorage.removeItem('krishi_layout_backups');
            syncSettingsToCloud('Dashboard layout reset');
            showToast('🔄 Restored default dashboard profile settings!');
            closeHomeCustomizerModal();
            applyAppearanceSettings();
            updateHomePage();
            playSound('success');
        }
    }

    function saveHomeCustomizerSettings() {
        try {
            saveAppearanceFromForm();
            if (typeof saveCustomAppearanceAndLanguageSettings === 'function') {
                saveCustomAppearanceAndLanguageSettings();
            }
            syncSettingsToCloud('Dashboard layout updated');
            
            showToast('🎯 Perfect! Dashboard configurations applied successfully.');
            
            let streakIcon = document.getElementById('home-avatar-circle');
            if (streakIcon) {
                streakIcon.classList.add('ring-4', 'ring-emerald-400');
                setTimeout(() => streakIcon.classList.remove('ring-4', 'ring-emerald-400'), 1500);
            }

            closeHomeCustomizerModal();
            updateHomePage();
            if (typeof refreshPlannerPage === 'function') {
                refreshPlannerPage();
            }
            playSound('success');
        } catch(e) {
            console.error(e);
            showToast('Could not save goal profile settings!');
        }
    }

    // --- AUTO SUGGEST TARGET LOGIC ---
    let pendingSmartTarget = null;

    function calculateSmartTargetSuggestion() {
        let active = getActiveProfile();
        let daysLeft = Math.ceil((new Date(active.targetDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (isNaN(daysLeft) || daysLeft <= 0) daysLeft = 30;

        let totalTopics = 0;
        let pendingTopics = 0;
        try {
            let syllabus = getSyllabusData();
            syllabus.forEach(sub => {
                sub.topics.forEach(t => {
                    totalTopics++;
                    if (['Pending', 'Studying', 'Weak'].includes(t.status)) {
                        pendingTopics++;
                    }
                });
            });
        } catch(e){}
        if (totalTopics === 0) { totalTopics = 50; pendingTopics = 40; }

        let accuracy = 75;
        try {
            accuracy = localData.stats.totalSolved > 0 ? (localData.stats.totalCorrect / localData.stats.totalSolved) * 100 : 75;
        } catch(e){}

        let suggestedDaily = 30;
        if (daysLeft < 30) suggestedDaily += Math.round((30 - daysLeft) * 0.8);
        else if (daysLeft > 90) suggestedDaily -= 5;

        suggestedDaily += Math.round(pendingTopics * 0.4);

        if (accuracy < 70) suggestedDaily += Math.round((70 - accuracy) * 0.5);

        suggestedDaily = Math.max(25, Math.min(150, suggestedDaily));
        suggestedDaily = Math.round(suggestedDaily / 5) * 5;

        let suggestedWeekly = suggestedDaily * 5;

        pendingSmartTarget = { daily: suggestedDaily, weekly: suggestedWeekly };

        let explainText = `💡 <b>Smart Recommendation Result:</b><br>
            Because your active exam "<b>${active.name}</b>" is <b>${daysLeft} days</b> away, you have <b>${pendingTopics}</b> pending syllabus segments, and your current core accuracy sits at <b>${Math.round(accuracy)}%</b>, the intelligence module suggests completing:<br>
            • Recommended Daily Target: <b>${suggestedDaily} MCQs</b> (was ${active.dailyTarget})<br>
            • Recommended Weekly Target: <b>${suggestedWeekly} MCQs</b> (was ${active.weeklyTarget})`;

        let resBox = document.getElementById('smart-suggest-result-box');
        let explEl = document.getElementById('smart-suggest-explanation');
        if (explEl) explEl.innerHTML = explainText;
        if (resBox) resBox.classList.remove('hidden');
        playSound('success');
    }

    function applySmartTargetSuggestion() {
        if (!pendingSmartTarget) return;
        let profiles = getExamProfiles();
        let active = profiles.find(p => p.active);
        if (active) {
            active.dailyTarget = pendingSmartTarget.daily;
            active.weeklyTarget = pendingSmartTarget.weekly;
            saveExamProfiles(profiles);
            showToast(`🎯 Applied targets: ${pendingSmartTarget.daily} Daily / ${pendingSmartTarget.weekly} Weekly!`);
            
            let targetDailyField = document.getElementById('prof-entry-daily');
            if (targetDailyField) targetDailyField.value = pendingSmartTarget.daily;
            let targetWeeklyField = document.getElementById('prof-entry-weekly');
            if (targetWeeklyField) targetWeeklyField.value = pendingSmartTarget.weekly;
            
            updateHomePage();
            if (typeof refreshPlannerPage === 'function') {
                refreshPlannerPage();
            }
            rejectSmartTargetSuggestion();
            playSound('success');
        }
    }

    function rejectSmartTargetSuggestion() {
        let resBox = document.getElementById('smart-suggest-result-box');
        if (resBox) resBox.classList.add('hidden');
        pendingSmartTarget = null;
        playSound('click');
    }

    // --- AUTOMATED LAYOUT BACKUPS SYSTEM ---
    function saveHomeSettings(settings) {
        let old = KrishiStorage.getItem('krishi_home_settings');
        if (old) {
            try {
                let parsedOld = JSON.parse(old);
                let backups = [];
                try {
                    backups = JSON.parse(KrishiStorage.getItem('krishi_layout_backups')) || [];
                } catch(e){}
                
                let backupItem = {
                    time: new Date().toLocaleTimeString() + ' ' + new Date().toLocaleDateString(),
                    timestamp: Date.now(),
                    settings: parsedOld
                };
                backups.unshift(backupItem);
                if (backups.length > 3) backups = backups.slice(0, 3);
                KrishiStorage.setItem('krishi_layout_backups', JSON.stringify(backups));
            } catch(e){}
        }

        KrishiStorage.setItem('krishi_home_settings', JSON.stringify(settings));
    }

    function renderBackupLayouts() {
        let container = document.getElementById('layout-backups-container');
        if (!container) return;
        let backups = [];
        try {
            backups = JSON.parse(KrishiStorage.getItem('krishi_layout_backups')) || [];
        } catch(e){}

        container.innerHTML = '';
        if (backups.length === 0) {
            container.innerHTML = `
                <p class="text-[9.5px] italic text-slate-400">No layout recovery points captured yet. Modify some widgets to trigger auto-backup!</p>
            `;
            return;
        }

        backups.forEach((b, idx) => {
            let divObj = document.createElement('div');
            divObj.className = "flex items-center justify-between p-2.5 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-lg";
            divObj.innerHTML = `
                <div>
                    <p class="font-bold text-[10px] text-slate-700 dark:text-slate-200">#${idx + 1} Recovery Point</p>
                    <p class="text-[8.5px] text-slate-400">${b.time}</p>
                </div>
                <button onclick="restoreBackupPoint(${b.timestamp})" class="p-1 px-2.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded font-extrabold text-[9px] hover:bg-emerald-500 hover:text-white transition cursor-pointer">Restore</button>
            `;
            container.appendChild(divObj);
        });
    }

    function restoreBackupPoint(timestamp) {
        let backups = [];
        try {
            backups = JSON.parse(KrishiStorage.getItem('krishi_layout_backups')) || [];
        } catch(e){}
        
        let target = backups.find(b => b.timestamp === timestamp);
        if (target) {
            KrishiStorage.setItem('krishi_home_settings', JSON.stringify(target.settings));
            showToast('🔄 Successfully restored selected dashboard recovery point!');
            buildCustomizerWidgetsList();
            updateHomePage();
            closeHomeCustomizerModal();
            playSound('success');
        }
    }

    function exportDashboardLayoutSettings() {
        let data = {
            version: '1.0.0',
            home: getHomeSettings(),
            profiles: getExamProfiles(),
            appearance: getAppearanceSettings()
        };
        let blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = `krishi_dashboard_backup_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('📥 Exported dashboard backup package successfully!');
        playSound('success');
    }

    function importDashboardLayoutSettings(event) {
        let fileInput = event.target;
        let file = fileInput.value ? fileInput.files[0] : null;
        if (!file) return;

        let reader = new FileReader();
        reader.onload = (e) => {
            try {
                let text = e.target.result;
                if (!text || text.trim().length === 0) throw new Error('Empty file content');
                
                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch(pe) {
                    throw new Error('Syntax error in JSON format: ' + pe.message);
                }
                
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('Expected a valid layout JSON object.');
                }
                
                let importedAny = false;
                let stagedHome = null;
                let stagedProfiles = null;
                let stagedAppearance = null;
                
                // Validate home configuration
                if (parsed.home !== undefined) {
                    if (typeof parsed.home !== 'object' || parsed.home === null || !Array.isArray(parsed.home.order)) {
                        throw new Error('Home settings order must be a valid list.');
                    }
                    stagedHome = parsed.home;
                }
                
                // Validate profiles configuration
                if (parsed.profiles !== undefined) {
                    if (!Array.isArray(parsed.profiles)) {
                        throw new Error('Exam profiles must be a valid array.');
                    }
                    stagedProfiles = parsed.profiles;
                }
                
                // Validate appearance settings
                if (parsed.appearance !== undefined) {
                    if (typeof parsed.appearance !== 'object' || parsed.appearance === null) {
                        throw new Error('Appearance settings must be a valid object.');
                    }
                    stagedAppearance = parsed.appearance;
                }
                
                if (stagedHome) {
                    KrishiStorage.setItem('krishi_home_settings', JSON.stringify(stagedHome));
                    importedAny = true;
                }
                if (stagedProfiles) {
                    KrishiStorage.setItem('krishi_exam_profiles', JSON.stringify(stagedProfiles));
                    importedAny = true;
                }
                if (stagedAppearance) {
                    KrishiStorage.setItem('krishi_appearance_settings', JSON.stringify(stagedAppearance));
                    importedAny = true;
                }
                
                if (importedAny) {
                    showToast('📤 Restored fully validated layout and profiles packet!');
                    closeHomeCustomizerModal();
                    updateHomePage();
                    applyAppearanceSettings();
                    if (typeof refreshPlannerPage === 'function') {
                        refreshPlannerPage();
                    }
                    playSound('success');
                } else {
                    throw new Error('File contains no valid home, profiles, or appearance layout subkeys.');
                }
            } catch(err) {
                console.error('[PWA Layout] Safe restore aborted:', err);
                showToast(`❌ Invalid or corrupted layout file: ${err.message}`, 6000);
            } finally {
                fileInput.value = '';
            }
        };
        reader.readAsText(file);
    }

    // --- MULTI-VALUE GRAPHICS ANIMATIONS DRIVER ---
    function animateNumericText(element, newValue) {
        if (!element) return;
        let parsedNew = parseInt(newValue.toString().replace(/[^0-9]/g, ''));
        if (isNaN(parsedNew)) {
            element.textContent = newValue;
            return;
        }
        let parsedOld = parseInt(element.textContent.replace(/[^0-9]/g, '')) || 0;
        if (parsedOld === parsedNew) {
            element.textContent = newValue;
            return;
        }
        let prefix = newValue.toString().match(/^[^0-9]+/);
        let suffix = newValue.toString().match(/[^\d]+$/);
        
        let startTimestamp = null;
        let duration = 800;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            let val = Math.floor(progress * (parsedNew - parsedOld) + parsedOld);
            element.textContent = (prefix ? prefix[0] : '') + val + (suffix ? suffix[0] : '');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                element.textContent = newValue;
            }
        };
        window.requestAnimationFrame(step);
    }

    // Individual Widget Card Template Renderers
    function renderWidgetSmartRecommendation(compact) {
        
        let wrongCount = getValidWrongCount();
        let dueCount = getPromoDueCount();
        let target = getDailyTarget() || 50;
        let todayStr = getLocalDateString();
        let solvedToday = (localData.streak && localData.streak[todayStr] && localData.streak[todayStr].solved) || 0;
        let weakInfo = getWeakestSubject();
        
        let recommendationText = '';
        let recommendationIcon = '💡';
        let recommendationAction = 'general';
        let explanation = '';

        if (activePlanSequenceHTML) {
            return `
                <div class="p-4 rounded-2xl border bg-gradient-to-br from-indigo-50 to-indigo-100/35 dark:from-indigo-950/20 dark:to-slate-900 border-indigo-200/50 dark:border-indigo-900 shadow-xs relative overflow-hidden flex flex-col justify-between">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-[9px] font-black uppercase bg-indigo-600 dark:bg-indigo-950 text-indigo-100 px-2.5 py-1 rounded-full tracking-wider badge-floating">⚡ Today's Study Roadmap</span>
                        <button onclick="clearSmartPlan()" class="text-[10px] text-indigo-500 font-bold hover:underline cursor-pointer">Clear Plan</button>
                    </div>
                    ${activePlanSequenceHTML}
                </div>
            `;
        }

        if (dueCount > 0) {
            recommendationText = "Spaced Retention Review";
            recommendationIcon = "🔁";
            recommendationAction = "spaced";
            explanation = "You have outstanding memory reinforcement queries scheduled inside the retrieval queue.";
        } else if (wrongCount >= 6) {
            recommendationText = "Pruning Practice Errors";
            recommendationIcon = "🔴";
            recommendationAction = "mistakes";
            explanation = "Target your persistent incorrect responses inside the error stack to elevate baseline accuracy.";
        } else if (solvedToday < target) {
            recommendationText = "Milestone Progression Target";
            recommendationIcon = "🎯";
            recommendationAction = "general";
            explanation = `Resolve ${target - solvedToday} additional agricultural questions today to secure your consistency metrics.`;
        } else if (weakInfo.hasData && weakInfo.accuracy < (getPlannerSettings().weakThreshold || 60)) {
            recommendationText = `Improving performance in ${weakInfo.subject.split('(')[0]}`;
            recommendationIcon = "⚡";
            recommendationAction = "subject";
            explanation = `Current performance is sitting under optimal margins. Targeted drills will resolve index parameters.`;
        } else {
            recommendationText = "General Agricultural Drill";
            recommendationIcon = "🌾";
            recommendationAction = "general";
            explanation = "Maintain momentum status with a general mixed agriculture progression drill.";
        }

        return `
            <div class="p-4 rounded-2xl border hover-card-trigger" style="background:var(--card); border-color:var(--border);">
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-2">
                        <span class="text-xl">${recommendationIcon}</span>
                        <div>
                            <p class="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Personal Study Recommendation</p>
                            <h3 class="font-extrabold text-xs text-slate-850 dark:text-slate-100 mt-0.5">${recommendationText}</h3>
                        </div>
                    </div>
                    <span id="recommend-badge" class="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-250">Recommended</span>
                </div>
                
                <p class="text-[10.5px] mt-2 leading-relaxed" style="color:var(--text-secondary);">${explanation}</p>
                
                <div class="mt-3 grid grid-cols-2 gap-2 text-[10px] bg-slate-50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-100 dark:border-slate-850">
                    <div class="flex justify-between">
                        <span class="text-slate-400">Due Reviews:</span>
                        <span class="font-extrabold text-slate-750 dark:text-slate-350">${dueCount}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-400">Daily Goal:</span>
                        <span class="font-extrabold text-slate-750 dark:text-slate-350">${solvedToday}/${target}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-400">Error Stack:</span>
                        <span class="font-extrabold text-rose-500">${wrongCount}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-400">Weak Area:</span>
                        <span class="font-extrabold text-amber-500 truncate max-w-[80px]">${weakInfo.subject.split('(')[0].slice(0, 10)}...</span>
                    </div>
                </div>

                <div class="flex gap-2 mt-3">
                    <button onclick="startRecommendationPractice('${recommendationAction}', '${weakInfo.subject}')" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[10.5px] py-2 rounded-xl  transition cursor-pointer text-center">
                        🎯 Start Practice
                    </button>
                    <button onclick="generateTodaySmartPlanSequence()" class="flex-1 border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-extrabold text-[10.5px] py-2 rounded-xl  transition cursor-pointer text-center">
                        📋 Generate Plan
                    </button>
                </div>
            </div>
        `;
    }

    function clearSmartPlan() {
        activePlanSequenceHTML = '';
        updateHomePage();
    }

    function generateTodaySmartPlanSequence() {
        activePlanSequenceHTML = `
            <div class="py-4 text-center space-y-2">
                <div class="inline-block w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <p class="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest animate-pulse">Generating Custom Plan...</p>
            </div>
        `;
        updateHomePage();

        setTimeout(() => {
            let sGoal = getGoalSettings();
            let weakSub = getWeakestSubject().subject;
            let target = getDailyTarget() || 50;
            let incorrects = getValidWrongCount();
            
            activePlanSequenceHTML = `
                <div class="space-y-2.5 text-xs text-slate-800 dark:text-slate-250">
                    <p class="text-[10.5px] font-semibold leading-relaxed">System compiled 3-step actionable schedule customized for <span class="text-indigo-600 dark:text-indigo-400 font-bold">${sGoal.name}</span>:</p>
                    <div class="space-y-1.5 font-medium text-[10.5px]">
                        <div class="flex items-start gap-2 bg-white/50 dark:bg-white/5 p-2 rounded-lg border border-indigo-100/40 dark:border-indigo-900/40">
                            <span class="p-1 px-1.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-[9px] font-extrabold text-indigo-700 dark:text-indigo-300">1</span>
                            <div>
                                <h4 class="font-bold text-slate-850 dark:text-white text-[10px]">REINFORCE DIFFICULT CORE</h4>
                                <p class="text-[9px] text-slate-500">Solve 20 MCQs from <span class="font-bold underline">${weakSub.split('(')[0]}</span> to balance performance indices.</p>
                            </div>
                        </div>
                        <div class="flex items-start gap-2 bg-white/50 dark:bg-white/5 p-2 rounded-lg border border-indigo-100/40 dark:border-indigo-900/40">
                            <span class="p-1 px-1.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-[9px] font-extrabold text-indigo-700 dark:text-indigo-300">2</span>
                            <div>
                                <h4 class="font-bold text-slate-850 dark:text-white text-[10px]">SM-2 QUEUES & ERRORS</h4>
                                <p class="text-[9px] text-slate-500">Run 10 card spaced revision cycles and clear ${Math.min(incorrects, 5)} pending errors.</p>
                            </div>
                        </div>
                        <div class="flex items-start gap-2 bg-white/50 dark:bg-white/5 p-2 rounded-lg border border-indigo-100/40 dark:border-indigo-900/40">
                            <span class="p-1 px-1.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-[9px] font-extrabold text-indigo-700 dark:text-indigo-300">3</span>
                            <div>
                                <h4 class="font-bold text-slate-850 dark:text-white text-[10px]">CONSISTENCY RUN</h4>
                                <p class="text-[9px] text-slate-500">Complete standard simulated quiz testing metrics up to ${target} daily solved milestone.</p>
                            </div>
                        </div>
                    </div>
                    <div class="pt-1.5 flex gap-2">
                        <button onclick="startPractice('${weakSub}', 20)" class="flex-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold shadow-xs transition  cursor-pointer text-center">Launch Study Sequence</button>
                    </div>
                </div>
            `;
            updateHomePage();
        }, 1200);
    }

    function startRecommendationPractice(action, sub) {
        if (action === 'spaced') {
            startSpacedReview();
        } else if (action === 'mistakes') {
            navigate('page-wrong-questions');
        } else if (action === 'subject') {
            openPracticeSetupPage(sub, 'all');
        } else {
            startPractice('all', 10);
        }
    }

    function renderWidgetExamCountdown(compact) {
        let pSettings = getPlannerSettings();
        let goalMeta = getGoalSettings();
        let dateVal = pSettings.examDate || "2026-07-03";
        let diff = Math.ceil((new Date(dateVal) - new Date()) / (1000 * 60 * 60 * 24));
        
        let headerColor = "from-emerald-600 to-teal-700";
        let subText = "Keep up study consistency!";
        
        if (diff <= 7) {
            headerColor = "from-red-600 to-rose-700 animate-pulse-alert";
            subText = "⚠️ EXAM IS VERY NEAR! Intensive final review.";
        } else if (diff <= 15) {
            headerColor = "from-amber-600 to-orange-750";
            subText = "⚠️ 15 days left till exam. Revise weak modules.";
        } else if (diff <= 30) {
            headerColor = "from-indigo-600 to-emerald-700";
            subText = "Under 30 days left. Boost practice intensity.";
        }

        let daysText = diff > 0 ? `${diff} Days Left` : (diff === 0 ? "🎯 EXAM DAY!" : "Passed");

        return `
            <!-- Countdown Card Widget - Audited container: no modal triggering onclick handler so event remains untriggered from parents -->
            <div class="bg-gradient-to-br ${headerColor} rounded-2xl p-4 text-white shadow-md">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-[9.5px] font-black uppercase opacity-90 tracking-wider">${goalMeta.province} • ${goalMeta.level}</p>
                        <h3 class="font-extrabold text-[13px] tracking-tight mt-0.5 truncate max-w-[200px]">${goalMeta.name}</h3>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] bg-white/20 px-2.5 py-1 rounded-full font-extrabold">📅 ${dateVal}</span>
                        <button onclick="navigate('page-study-planner'); event.stopPropagation();" class="px-2.5 py-1 bg-white/20 hover:bg-white/35 text-white font-bold text-[10px] rounded-xl shadow-3xs transition duration-150 cursor-pointer hover:scale-105 ">Manage</button>
                    </div>
                </div>
                <div class="flex items-baseline gap-2 mt-4">
                    <p class="text-3xl font-black tracking-tight" id="days-left">${daysText}</p>
                    <p class="text-[10px] font-semibold opacity-90">${subText}</p>
                </div>
                <div class="flex gap-2 mt-3 flex-wrap text-[10px]">
                    <span class="bg-white/20 px-2.5 py-1 rounded-full font-bold">🔥 ${getStreakCount()} Day Streak</span>
                    <span class="bg-white/20 px-2.5 py-1 rounded-full font-bold">📝 ${localData.stats.totalSolved} Solved</span>
                    <span class="bg-white/20 px-2.5 py-1 rounded-full font-bold">🎯 Aiming ${pSettings.dailyTarget} Daily MCQ</span>
                </div>
            </div>
        `;
    }

    function renderWidgetReadinessScore(compact) {
        let score = getExamReadinessScore();
        let color = "text-emerald-500";
        let title = "Stellar Study Pacing";
        
        if (score < 45) {
            color = "text-rose-500";
            title = "Needs Prompt Practice";
        } else if (score < 75) {
            color = "text-amber-500";
            title = "Stable Exam Standing";
        }

        return `
            <div class="p-4 rounded-xl border flex items-center justify-between hover-card-trigger" style="background:var(--card); border-color:var(--border);">
                <div class="space-y-1">
                    <p class="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Exam Readiness Score</p>
                    <h3 class="font-black text-xs text-slate-800 dark:text-slate-100">${title}</h3>
                    <p class="text-[9.5px]" style="color:var(--text-secondary);">Accuracy, streak logs, & completion tracker weightage.</p>
                </div>
                <div class="relative w-16 h-16 flex items-center justify-center">
                    <svg class="absolute transform -rotate-90 w-16 h-16">
                        <circle cx="32" cy="32" r="26" stroke="var(--border)" stroke-width="4.5" fill="transparent" class="text-slate-200 dark:text-slate-800"></circle>
                        <circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="4.5" fill="transparent" 
                            class="${color} stroke-current transition-all duration-500"
                            stroke-dasharray="163" stroke-dashoffset="${163 - (163 * score / 100)}"></circle>
                    </svg>
                    <span class="font-black text-xs ${color}">${score}%</span>
                </div>
            </div>
        `;
    }

    function getExamReadinessScore() {
        let solved = localData.stats.totalSolved || 0;
        let correct = localData.stats.totalCorrect || 0;
        let baseAcc = solved > 0 ? (correct / solved) : 0;
        let streak = getStreakCount();
        let syllabus = calculateSyllabusPercentages().overall;
        
        let score = Math.round((baseAcc * 50) + (Math.min(30, streak) / 30 * 10) + (syllabus * 0.4));
        return Math.min(100, Math.max(0, score));
    }

    function renderWidgetDailyTarget(compact) {
        let stats = localData.stats;
        let target = getDailyTarget() || 50;
        let todayStr = getLocalDateString();
        let solvedToday = (localData.streak && localData.streak[todayStr] && localData.streak[todayStr].solved) || 0;
        let percent = Math.min(100, Math.round((solvedToday / target) * 100));

        if (percent >= 100) {
            // 1. Separate celebratory sound trigger: plays exactly once upon target completion
            if (!KrishiStorage.getItem('target_sound_played_' + todayStr)) {
                KrishiStorage.setItem('target_sound_played_' + todayStr, 'true');
                if (typeof playSound === 'function') {
                    playSound('celebrate');
                }
            }
            // 2. Separate animation trigger
            if (!KrishiStorage.getItem('confetti_fired_' + todayStr)) {
                KrishiStorage.setItem('confetti_fired_' + todayStr, 'true');
                setTimeout(() => { triggerConfetti(); }, 500);
            }
        }

        let isElite = KrishiStorage.getItem('krishi_elite_animations') !== 'false';

        // Calculate seedling morph progression (even at 0%, a tiny seedling is visible)
        let stemOffset = 100 - 12 - (percent * 0.68);
        let leaf1Scale = percent >= 30 ? 1 : (0.15 + (percent / 30) * 0.85).toFixed(2);
        let leaf1Opacity = percent >= 30 ? 1 : (0.3 + (percent / 30) * 0.7).toFixed(2);
        let leaf2Scale = percent >= 65 ? 1 : (percent >= 30 ? (0.1 + ((percent - 30) / 35) * 0.9).toFixed(2) : 0);
        let leaf2Opacity = percent >= 65 ? 1 : (percent >= 30 ? (0.2 + ((percent - 30) / 35) * 0.8).toFixed(2) : 0);
        let flowerScale = percent >= 100 ? 1 : 0;
        let flowerOpacity = percent >= 100 ? 1 : 0;

        return `
            <div class="p-3.5 rounded-xl border hover-card-trigger" style="background:var(--card); border-color:var(--border);">
                <div class="flex justify-between items-center mb-1">
                    <div class="space-y-0.5">
                        <p class="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Daily Solved Milestone</p>
                        <h4 class="font-black text-xs text-slate-850 dark:text-slate-100">${solvedToday} / ${target} Solved</h4>
                        ${percent >= 100 ? `<p class="text-[9px] text-emerald-500 mt-1 font-semibold flex items-center gap-1">🏆 Target met! Great commitment!</p>` : ''}
                    </div>
                    <div class="flex items-center gap-3">
                        ${isElite ? `
                        <div class="w-12 h-12 flex items-center justify-center bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800/80">
                            <canvas id="daily-target-3d-canvas" class="w-12 h-12 select-none cursor-grab active:cursor-grabbing"></canvas>
                        </div>
                        ` : ''}
                        <span class="text-[10px] font-bold ${percent >= 100 ? 'text-emerald-500' : 'text-slate-500'} bg-slate-50 dark:bg-slate-950 px-2 py-0.5 rounded-full border border-slate-150 dark:border-slate-850">${percent}%</span>
                    </div>
                </div>
                <div class="w-full h-2 bg-slate-150 dark:bg-slate-850 rounded-full mt-2 overflow-hidden shadow-inner">
                    <div class="bg-emerald-500 h-full rounded-full transition-all duration-500 ease" style="width: ${percent}%;"></div>
                </div>
            </div>
        `;
    }

    function renderWidgetAccuracy(compact) {
        let stats = localData.stats;
        let total = stats.totalSolved || 0;
        let accuracyVal = total > 0 ? Math.round((stats.totalCorrect / total) * 100) : 0;
        
        let weeklyStats = getWeeklyProgressStats();
        let prevWeekSolved = weeklyStats.totalSolvedLastWeek;
        let thisWeekSolved = weeklyStats.totalSolvedThisWeek;
        
        // Calculate style label
        let label = "Stable";
        let colorClass = "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-250 border-amber-200";
        let trendHTML = "<span class='text-slate-400'>• Steady pacing vs last week</span>";

        if (thisWeekSolved > prevWeekSolved + 5) {
            label = "Improving";
            colorClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200";
            trendHTML = `<span class='text-emerald-500 font-bold'>▲ Solved +${thisWeekSolved - prevWeekSolved} more vs last week</span>`;
        } else if (thisWeekSolved < prevWeekSolved - 5) {
            label = "Dropping";
            colorClass = "bg-rose-100 text-rose-500 dark:bg-rose-950 dark:text-rose-300 border-rose-200";
            trendHTML = `<span class='text-rose-500 font-bold'>▼ Solved -${prevWeekSolved - thisWeekSolved} less vs last week</span>`;
        }

        return `
            <div class="p-3.5 rounded-xl border hover-card-trigger" style="background:var(--card); border-color:var(--border);">
                <div class="flex justify-between items-center mb-1">
                    <div>
                        <p class="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Baseline Study Accuracy</p>
                        <h4 class="font-black text-xs text-slate-850 dark:text-slate-100">${total > 0 ? accuracyVal : '--'}% Overall Accuracy</h4>
                    </div>
                    <span class="text-[9px] font-bold border rounded px-1.5 py-0.5 ${colorClass}">${label}</span>
                </div>
                <div class="mt-2 text-[9.5px]">
                    ${trendHTML}
                </div>
                <div class="grid grid-cols-2 mt-2 gap-2 text-[9px] border-t border-slate-100 dark:border-slate-850 pt-2 opacity-90">
                    <div class="flex justify-between">
                        <span class="text-slate-400">This Week:</span>
                        <span class="font-bold text-slate-700 dark:text-slate-350">${thisWeekSolved} MCQs</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-slate-400">Last Week:</span>
                        <span class="font-bold text-slate-700 dark:text-slate-350">${prevWeekSolved} MCQs</span>
                    </div>
                </div>
            </div>
        `;
    }

    function renderWidgetStreak(compact) {
        let streak = getStreakCount();
        let dates = Object.keys(localData.streak || {}).sort();
        let bestStreak = 0;
        if (dates.length > 0) {
            let cur = 0;
            let lastDate = null;
            dates.forEach(d => {
                let currentD = new Date(d);
                if (!lastDate) {
                    cur = 1;
                } else {
                    let diffTime = Math.abs(currentD - lastDate);
                    let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays === 1) {
                        cur++;
                    } else if (diffDays > 1) {
                        cur = 1;
                    }
                }
                if (cur > bestStreak) bestStreak = cur;
                lastDate = currentD;
            });
        }
        if (streak > bestStreak) bestStreak = streak;

        let todayStr = getLocalDateString();
        let solvedToday = (localData.streak && localData.streak[todayStr] && localData.streak[todayStr].solved) || 0;
        let target = getDailyTarget() || 50;
        let hasReachedTarget = solvedToday >= target && target > 0;
        
        let fireHTML = '';
        if (hasReachedTarget) {
            fireHTML = `<span onclick="triggerInteractiveFireSpark(event)" class="animate-fire-reached text-lg select-none" title="Daily Target Reached! Tap for epic fire sparks! ⚡">🔥</span>`;
        } else {
            fireHTML = `<span onclick="triggerInteractiveFireSpark(event)" class="animate-fire text-lg select-none hover:scale-125 cursor-pointer transition duration-150" title="Progress your daily milestone of ${target} to ignite this fire! Click for sparks.">🔥</span>`;
        }

        // 1. Premium Learner Class Badge calculation
        let badgeName = 'Novice 🌾';
        if (streak >= 15) badgeName = 'Unstoppable Legend 🏆';
        else if (streak >= 7) badgeName = 'Elite Competitor ⚡';
        else if (streak >= 3) badgeName = 'Steady Pioneer 🌱';

        // 2. Next milestone progress bar
        let milestones = [3, 5, 7, 10, 15, 21, 30, 50, 100, 365];
        let nextMilestone = milestones.find(m => m > streak) || 365;
        let prevMilestone = milestones[milestones.indexOf(nextMilestone) - 1] || 0;
        let milestoneDiff = nextMilestone - prevMilestone;
        let currentDiff = streak - prevMilestone;
        let milestonePercent = Math.min(100, Math.round((currentDiff / milestoneDiff) * 100));

        // 3. Dynamic motivational text
        let streakMotivationalText = "Start your daily learning target to ignite the streak! 🌾";
        if (streak >= 15) {
            streakMotivationalText = "Unstoppable! You've entered the legendary learner class! 👑";
        } else if (streak >= 7) {
            streakMotivationalText = "Incredible dedication! The agriculture civil service is waiting for you! 🚀";
        } else if (streak >= 3) {
            streakMotivationalText = "Awesome momentum! Keep this flame burning strong! 🔥";
        } else if (streak > 0) {
            streakMotivationalText = "Great start! One step closer to mastering your exam targets! 🌱";
        } else if (solvedToday > 0) {
            streakMotivationalText = "First step done today! Complete your targets to lock in the streak! 💡";
        }

        // 4. 7-Day Mini Calendar
        let calendarHTML = '';
        let today = new Date();
        let shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = 6; i >= 0; i--) {
            let d = new Date();
            d.setDate(today.getDate() - i);
            let stamp = getLocalDateString(d);
            let solved = (localData.streak && localData.streak[stamp] && localData.streak[stamp].solved) || 0;
            let met = solved >= target;
            
            let dayLabel = shortDays[d.getDay()][0]; // single letter or short label
            let bgClass = '';
            let borderClass = '';
            let textClass = 'text-slate-400 dark:text-slate-600';
            
            if (met) {
                bgClass = 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20';
                borderClass = 'border-emerald-500';
                textClass = 'text-emerald-500 font-black';
            } else if (solved > 0) {
                bgClass = 'bg-amber-500 text-white shadow-sm shadow-amber-500/20';
                borderClass = 'border-amber-500';
                textClass = 'text-amber-500 font-bold';
            } else {
                bgClass = 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500';
                borderClass = 'border-slate-200 dark:border-slate-700 border-dashed';
            }
            
            calendarHTML += `
                <div class="flex flex-col items-center gap-1">
                    <span class="text-[7.5px] font-black ${textClass} uppercase">${shortDays[d.getDay()]}</span>
                    <div class="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black border ${borderClass} ${bgClass} transition duration-150 hover:scale-110" title="${stamp}: ${solved}/${target} MCQs">
                        ${met ? '✓' : (solved > 0 ? '🔥' : dayLabel)}
                    </div>
                </div>
            `;
        }

        if (compact) {
            return `
                <div class="premium-streak-card p-3 rounded-xl border flex items-center justify-between hover-card-trigger">
                    <div class="flex items-center gap-2.5">
                        <div class="glowing-fire-container w-9 h-9">
                            ${fireHTML}
                        </div>
                        <div>
                            <h3 class="font-black text-xs text-slate-850 dark:text-slate-100 flex items-center gap-1.5">
                                <span class="streak-counter-value streak-number-glowing font-black text-base">${streak}</span> Day Streak
                            </h3>
                            <p class="text-[8px] text-slate-500">Milestone: ${streak}/${nextMilestone}d</p>
                        </div>
                    </div>
                    <span class="premium-badge text-[8px] font-black text-white px-2 py-0.5 rounded-full select-none">${badgeName}</span>
                </div>
            `;
        }

        return `
            <div class="premium-streak-card p-4 rounded-2xl border hover-card-trigger flex flex-col gap-3">
                <!-- Top Block: streak & badge info -->
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <div class="glowing-fire-container">
                            ${fireHTML}
                        </div>
                        <div>
                            <p class="text-[8px] font-extrabold uppercase tracking-widest text-amber-500 dark:text-amber-450">Active Consistency Streak</p>
                            <h3 class="font-black text-slate-850 dark:text-slate-100 mt-0.5 flex items-baseline gap-1">
                                <span class="streak-counter-value streak-number-glowing font-black text-2xl">${streak}</span>
                                <span class="text-xs font-black text-slate-400">Days Solved</span>
                            </h3>
                        </div>
                    </div>
                    <span class="premium-badge text-[8.5px] font-black text-white px-3 py-1 rounded-xl select-none">${badgeName}</span>
                </div>

                <!-- 7-Day Mini Streak Calendar Grid -->
                <div class="bg-white/60 dark:bg-slate-900/40 border border-slate-150/45 dark:border-slate-800/45 p-2 rounded-xl">
                    <p class="text-[7.5px] font-black text-slate-400 uppercase tracking-wider mb-2 text-center">Consistency Dot Grid (7 Days)</p>
                    <div class="flex justify-around items-center gap-1">
                        ${calendarHTML}
                    </div>
                </div>

                <!-- Next Milestone Progress Bar Section -->
                <div class="space-y-1">
                    <div class="flex justify-between text-[8px] font-extrabold text-slate-400 tracking-wider">
                        <span>MILESTONE PROGRESS (${streak}/${nextMilestone} DAYS)</span>
                        <span class="text-amber-500 font-black">${milestonePercent}%</span>
                    </div>
                    <div class="w-full h-2 bg-slate-100 dark:bg-slate-800/60 rounded-full overflow-hidden shadow-inner border border-slate-200/20">
                        <div class="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 h-full rounded-full transition-all duration-700 ease" style="width: ${milestonePercent}%;"></div>
                    </div>
                </div>

                <!-- Footer Motivation & Best Stats -->
                <div class="flex justify-between items-center text-[9px] pt-1 border-t border-slate-100 dark:border-slate-850 opacity-90">
                    <p class="text-slate-500 dark:text-slate-400 italic font-medium leading-tight max-w-[70%]">${streakMotivationalText}</p>
                    <div class="text-right shrink-0 text-slate-400">
                        <p class="text-[7.5px] font-bold uppercase">Peak Peak</p>
                        <p class="font-extrabold text-slate-600 dark:text-slate-350">${bestStreak} Days</p>
                    </div>
                </div>
            </div>
        `;
    }

    function animateStreakCountUp(targetVal, element) {
        if (!element) return;
        let currentVal = 0;
        if (targetVal === 0) {
            element.textContent = "0";
            return;
        }
        let duration = 800; // ms
        let stepTime = Math.max(12, Math.round(duration / targetVal));
        let timer = setInterval(() => {
            currentVal++;
            element.textContent = currentVal;
            if (currentVal >= targetVal) {
                clearInterval(timer);
                element.textContent = targetVal;
            }
        }, stepTime);
    }

    function renderWidgetBookmarks(compact) {
        let count = getValidBookmarkedCount();
        return `
            <div class="p-3.5 rounded-xl border flex items-center justify-between hover-card-trigger cursor-pointer" style="background:var(--card); border-color:var(--border);" onclick="navigate('page-planner')">
                <div class="flex items-center gap-2.5">
                    <span class="text-xl">📌</span>
                    <div>
                        <p class="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Pinned Repository</p>
                        <h4 class="font-black text-xs text-slate-850 dark:text-slate-100">${count} Bookmark Items</h4>
                    </div>
                </div>
                <span class="text-xs font-black text-slate-400">➜</span>
            </div>
        `;
    }

    function renderWidgetSyllabusProgress(compact) {
        let percentObj = calculateSyllabusPercentages();
        let overall = percentObj.overall;
        return `
            <div class="p-3.5 rounded-xl border hover-card-trigger cursor-pointer" style="background:var(--card); border-color:var(--border);" onclick="navigate('page-planner')">
                <div class="flex justify-between items-center mb-1">
                    <div>
                        <p class="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Syllabus Complete Percent</p>
                        <h4 class="font-black text-xs text-slate-850 dark:text-slate-100">${overall}% Topics Met</h4>
                    </div>
                    <span class="text-xs">📚</span>
                </div>
                <div class="w-full h-2 bg-slate-100 dark:bg-slate-850 rounded-full mt-2 overflow-hidden shadow-inner font-mono">
                    <div class="bg-indigo-505 bg-indigo-500 h-full rounded-full transition-all duration-300" style="width: ${overall}%;"></div>
                </div>
            </div>
        `;
    }

    function renderWidgetWeeklyProgress(compact) {
        let heatmapHTML = getHeatmapSquaresHTML();
        return `
            <div class="p-3.5 rounded-xl border" style="background:var(--card); border-color:var(--border);">
                <p class="text-[9.5px] font-extrabold uppercase mb-2 text-slate-400 tracking-wider">Weekly Progression Dots Matrix</p>
                <div id="week-streak-dots" class="flex justify-between mb-3 text-[10px]">
                     ${getWeeklyDotsRowHTML()}
                </div>
                <p class="text-[8.5px] font-extrabold uppercase mb-1.5 text-slate-400 tracking-wider">Contribution logs (Past 28 Days)</p>
                <div class="flex flex-wrap gap-1.5 justify-start py-1">
                    ${heatmapHTML}
                </div>
            </div>
        `;
    }

    function renderWidgetMotivationalQuote(compact) {
        let index = new Date().getDate() % MOTIVATIONAL_QUOTES.length;
        let quote = MOTIVATIONAL_QUOTES[index];
        return `
            <div class="p-3.5 rounded-xl border border-dashed border-emerald-600/25 bg-emerald-50/15 dark:bg-slate-900/40 flex items-start gap-2.5">
                <span class="text-lg">🕯️</span>
                <p class="text-[10.5px] leading-relaxed italic text-slate-600 dark:text-slate-350 font-medium">"${quote}"</p>
            </div>
        `;
    }

    function renderWidgetQuickPractice(compact) {
        return `
            <button onclick="startPractice('all', 10); playSound('click');" class="w-full p-3.5 rounded-xl border text-left flex justify-between items-center hover-card-trigger bg-gradient-to-r from-emerald-500/5 to-teal-500/5" style="border-color:var(--border);">
                <div>
                    <h4 class="font-extrabold text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">🚀 Quick MCQ Practice</h4>
                    <p class="text-[9.5px] text-slate-400 mt-0.5">Solve 10 Random Agriculture Questions instantly.</p>
                </div>
                <span class="text-xs p-1.5 rounded-full bg-emerald-100 dark:bg-slate-800 text-emerald-700">▶️</span>
            </button>
        `;
    }

    function renderWidgetSpacedReview(compact) {
        let dueCount = getPromoDueCount();
        let pulseClass = dueCount > 0 ? 'pulse-spaced-accent' : '';
        return `
            <button onclick="startSpacedReview(); playSound('click');" class="w-full p-3.5 rounded-xl border text-left flex justify-between items-center hover-card-trigger ${pulseClass}" style="background:var(--card); border-color:var(--border);">
                <div>
                    <h4 class="font-extrabold text-xs text-amber-500 flex items-center gap-1.5">🔁 Study Spaced Review</h4>
                    <p class="text-[9.5px] text-slate-400 mt-0.5">Reinforce active agricultural spaced retention flashcards.</p>
                </div>
                <span class="text-[9.5px] font-black bg-amber-100 dark:bg-amber-950/40 text-amber-850 dark:text-amber-300 px-2.5 py-1 rounded-full">${dueCount} due</span>
            </button>
        `;
    }

    function renderWidgetReviewMistakes(compact) {
        
        let wrongCount = getValidWrongCount();
        let pulseClass = wrongCount > 0 ? 'pulse-wrong-accent' : '';
        return `
            <button onclick="navigate('page-wrong-questions'); playSound('click');" class="w-full p-3.5 rounded-xl border text-left flex justify-between items-center hover-card-trigger ${pulseClass}" style="background:var(--card); border-color:var(--border);">
                <div>
                    <h4 class="font-extrabold text-xs text-rose-500 flex items-center gap-1.5">🔴 Review Mistakes Stack</h4>
                    <p class="text-[9.5px] text-slate-400 mt-0.5">Correct questions answered incorrectly during drills.</p>
                </div>
                <span class="text-[9.5px] font-black bg-rose-100 dark:bg-rose-955/40 text-rose-800 dark:text-rose-300 px-2.5 py-1 rounded-full">${wrongCount} errors</span>
            </button>
        `;
    }

    function renderWidgetMockTest(compact) {
        return `
            <button onclick="navigate('page-mock-config'); playSound('click');" class="w-full p-3.5 rounded-xl border text-left flex justify-between items-center hover-card-trigger bg-gradient-to-r from-indigo-500/5 to-indigo-500/5" style="border-color:var(--border);">
                <div>
                    <h4 class="font-extrabold text-xs text-indigo-650 dark:text-indigo-400 flex items-center gap-1.5">📋 Mock Test Simulator</h4>
                    <p class="text-[9.5px] text-slate-400 mt-0.5">Draft and experience simulated mock examinations.</p>
                </div>
                <span class="text-xs p-1.5 rounded-full bg-indigo-100 dark:bg-slate-800 text-indigo-700">▶️</span>
            </button>
        `;
    }

    function updateHomePage(){
        let all = getAllQuestions();
        try {
            let settings = getHomeSettings();
            let container = document.getElementById('home-widgets-container');
            if (!container) return;

            let sGoal = getGoalSettings();
            let sPlanner = getPlannerSettings();

            // Set values on active profile card dynamically
            let hprofileName = document.getElementById('hprofile-name');
            if (hprofileName) hprofileName.textContent = sGoal.name;

            let hprofileMeta = document.getElementById('hprofile-meta');
            if (hprofileMeta) hprofileMeta.textContent = `${sGoal.level} • ${sGoal.province}`;

            let hprofileCountdown = document.getElementById('hprofile-countdown');
            if (hprofileCountdown) {
                let targetDate = new Date(sPlanner.examDate || "2026-07-03");
                let diffDays = Math.ceil((targetDate - new Date()) / (1000 * 60 * 60 * 24));
                if (isNaN(diffDays)) diffDays = 0;
                if (diffDays > 0) {
                    let newHtml = `📅 <span id="anim-countdownVal">${diffDays}</span> days remaining`;
                    if (hprofileCountdown.innerHTML !== newHtml) {
                        hprofileCountdown.innerHTML = newHtml;
                        animateNumericText(document.getElementById('anim-countdownVal'), diffDays);
                    }
                } else {
                    hprofileCountdown.textContent = `📅 Exam date passed / today`;
                }
            }

            let hprofileTargets = document.getElementById('hprofile-targets');
            if (hprofileTargets) {
                let dailyT = sPlanner.dailyTarget || 50;
                let newHtml = `🎯 <span id="anim-dailyTargetVal">${dailyT}</span> Daily`;
                if (hprofileTargets.innerHTML !== newHtml) {
                    hprofileTargets.innerHTML = newHtml;
                    animateNumericText(document.getElementById('anim-dailyTargetVal'), dailyT);
                }
            }

            let greetingEl = document.getElementById('home-greeting');
            let sidebarGreeting = document.getElementById('sidebar-greeting');
            let greetText = `${getGreetingText(getProfileName())} 👋`;
            if (greetingEl && greetingEl.innerHTML !== greetText) {
                greetingEl.innerHTML = greetText;
            }
            if (sidebarGreeting && sidebarGreeting.innerHTML !== greetText) {
                sidebarGreeting.innerHTML = greetText;
            }
            // Keep the header avatar in step with the stored photo / display name
            renderProfileAvatars();

            // Sync learning streak count to sidebar dynamically
            let sidebarStreak = document.getElementById('sidebar-streak-badge');
            if (sidebarStreak) {
                sidebarStreak.textContent = `${typeof getStreakCount === 'function' ? getStreakCount() : 0} Day Streak`;
            }

            let htmlStr = '';

            if (settings.compact) {
                container.classList.add('space-y-2');
                container.classList.remove('space-y-4');
            } else {
                container.classList.add('space-y-4');
                container.classList.remove('space-y-2');
            }

            settings.order.forEach(widgetId => {
                if (settings.hidden && settings.hidden.includes(widgetId)) {
                    return;
                }

                let widgetHTML = '';
                switch(widgetId) {
                    case 'smartRecommendation':
                        widgetHTML = renderWidgetSmartRecommendation(settings.compact);
                        break;
                    case 'examCountdown':
                        widgetHTML = renderWidgetExamCountdown(settings.compact);
                        break;
                    case 'readinessScore':
                        widgetHTML = renderWidgetReadinessScore(settings.compact);
                        break;
                    case 'dailyTarget':
                        widgetHTML = renderWidgetDailyTarget(settings.compact);
                        break;
                    case 'accuracy':
                        widgetHTML = renderWidgetAccuracy(settings.compact);
                        break;
                    case 'streak':
                        widgetHTML = renderWidgetStreak(settings.compact);
                        break;
                    case 'bookmarks':
                        widgetHTML = renderWidgetBookmarks(settings.compact);
                        break;
                    case 'syllabusProgress':
                        widgetHTML = renderWidgetSyllabusProgress(settings.compact);
                        break;
                    case 'weeklyProgress':
                        widgetHTML = renderWidgetWeeklyProgress(settings.compact);
                        break;
                    case 'motivationalQuote':
                        widgetHTML = renderWidgetMotivationalQuote(settings.compact);
                        break;
                    case 'quickPractice':
                        widgetHTML = renderWidgetQuickPractice(settings.compact);
                        break;
                    case 'spacedReview':
                        widgetHTML = renderWidgetSpacedReview(settings.compact);
                        break;
                    case 'reviewMistakes':
                        widgetHTML = renderWidgetReviewMistakes(settings.compact);
                        break;
                    case 'mockTest':
                        widgetHTML = renderWidgetMockTest(settings.compact);
                        break;
                }

                if (widgetHTML) {
                    htmlStr += `<div class="slide-up-card ${settings.compact ? 'p-0.5' : ''}">${widgetHTML}</div>`;
                }
            });
            
            if (container.innerHTML !== htmlStr) {
                container.innerHTML = htmlStr;
            }

            // Trigger the premium streak count-up animation if the counter exists
            let elStreakCounters = document.querySelectorAll('.streak-counter-value');
            if (elStreakCounters.length > 0) {
                let streakVal = getStreakCount();
                elStreakCounters.forEach(el => animateStreakCountUp(streakVal, el));
            }
            
            // Initialize 3D Crop Growth sandbox if canvas exists
            let cropCanvas = document.getElementById('daily-target-3d-canvas');
            if (cropCanvas && typeof window.init3DCropGrowthSandbox === 'function') {
                let stats = localData.stats;
                let target = getDailyTarget() || 50;
                let todayStr = getLocalDateString();
                let solvedToday = (localData.streak && localData.streak[todayStr] && localData.streak[todayStr].solved) || 0;
                let percent = Math.min(100, Math.round((solvedToday / target) * 100));
                
                setTimeout(() => {
                    window.init3DCropGrowthSandbox(cropCanvas, percent);
                }, 50);
            }
            
            // Compatibility fallback elements
            let elStreak = document.getElementById('streak-display');
            if (elStreak) elStreak.textContent = '🔥 ' + getStreakCount() + ' Day Streak';
            let elSolved = document.getElementById('total-solved-display');
            if (elSolved) elSolved.textContent = '📝 ' + localData.stats.totalSolved + ' Solved';
            let target = getDailyTarget();
            let elDaily = document.getElementById('daily-target-display');
            if (elDaily) elDaily.textContent = Math.min(localData.stats.totalSolved, target) + '/' + target;
            let elAcc = document.getElementById('accuracy-display');
            if (elAcc) elAcc.textContent = localData.stats.totalSolved > 0 ? Math.round((localData.stats.totalCorrect/localData.stats.totalSolved)*100)+'%' : '--%';
            let elBk = document.getElementById('bookmark-count-display');
            if (elBk) elBk.textContent = getValidBookmarkedCount();
            let dueCount = getPromoDueCount();
            let elSpaced = document.getElementById('spaced-count');
            if (elSpaced) elSpaced.textContent = '(' + dueCount + ' due)';
            let elWrong = document.getElementById('wrong-count-home');
            if (elWrong) elWrong.textContent = getValidWrongCount() + ' pending';

            if (typeof translateAppLabels === 'function') {
                translateAppLabels();
            }
        } catch(err) {
            console.error('Error in updateHomePage rendering:', err);
        }
      

        // Update general dashboard counts
        let customCount = getCustomQuestions().length;
        let wrongCount = getValidWrongCount();
        let bookmarkedCount = getValidBookmarkedCount();
        let totalCount = all.length;
        
        // Toggle empty state vs active modules
        let elEmpty = document.getElementById('practice-empty-state');
        let elActivePanels = document.getElementById('practice-active-state-panels');
        if (totalCount === 0) {
            if (elEmpty) elEmpty.classList.remove('hidden');
            if (elActivePanels) elActivePanels.classList.add('hidden');
        } else {
            if (elEmpty) elEmpty.classList.add('hidden');
            if (elActivePanels) elActivePanels.classList.remove('hidden');
        }

        // Setup practice widgets count text and dashboard badges
        let elQuickCount = document.getElementById('practice-quick-count-badge');
        if (elQuickCount) elQuickCount.textContent = `${totalCount} MCQs`;

        let elWrongCount = document.getElementById('smart-wrong-count-lbl');
        if (elWrongCount) elWrongCount.textContent = `${wrongCount} pending wrongs`;

        let elBkCount = document.getElementById('smart-bookmark-count-lbl');
        if (elBkCount) elBkCount.textContent = `${bookmarkedCount} saved items`;

        let elSpacedCount = document.getElementById('smart-spaced-count-lbl');
        if (elSpacedCount) elSpacedCount.textContent = `${getPromoDueCount()} revision dued`;

        let elDailyCount = document.getElementById('smart-daily-count-lbl');
        if (elDailyCount) {
            let todayStr = getLocalDateString();
            let solved = (localData.streak[todayStr]||{}).solved||0;
            let dailyT = getDailyTarget() || 50;
            elDailyCount.textContent = `${solved} / ${dailyT} solved today`;
        }

        let elStreakFire = document.getElementById('recommended-streak-fire');
        if (elStreakFire) {
            elStreakFire.textContent = `⚡ Day streak: ${getStreakCount()}`;
        }

        // Smart Analytics: Analyze weakness for Recommended Practice Banner
        let weakInfo = getWeakestSubject();
        let weakestSub = weakInfo.hasData ? weakInfo.subject : 'all';
        let minRatio = weakInfo.hasData ? (weakInfo.accuracy / 100) : 1.0;

        let bannerText = document.getElementById('recommended-text-insight');
        if (bannerText) {
            if (weakestSub !== 'all') {
                bannerText.textContent = `Focus recommended for "${weakestSub}" (Accuracy: ${Math.round(minRatio*100)}%). Tap here to configure focused practice!`;
                bannerText.dataset.sub = weakestSub;
            } else {
                // Pick the first subject deterministically for fallback
                let subjects = getAllSubjects();
                if (subjects.length > 0) {
                    let deterministicSub = subjects[0];
                    bannerText.textContent = `Ready to level up? Tap here to start customized Practice for "${deterministicSub}" of your syllabus!`;
                    bannerText.dataset.sub = deterministicSub;
                } else {
                    bannerText.textContent = "Welcome to MCQ Suite! Import or add study materials inside syllabus creator to activate recommendations.";
                    bannerText.dataset.sub = 'all';
                }
            }
        }

        // Render Recent Practice History
       let historyContainer = document.getElementById('recent-practice-list') || document.getElementById('practice-recent-list');
        if (historyContainer) {
            let historyRaw = KrishiStorage.getItem('krishi_practice_recent');
            let historyList = [];
            if (historyRaw) {
                try { historyList = JSON.parse(historyRaw); } catch(ex){}
            }

            if (historyList.length === 0) {
                let newHtml = `
                    <div class="col-span-full py-6 text-center text-slate-400 dark:text-slate-600 italic text-[10px] font-mono select-none">
                        No recent practice runs yet. Start your first session!
                    </div>
                `;
            if (historyContainer.innerHTML !== newHtml) historyContainer.innerHTML = newHtml;
            } else {
                let newHtml2 = historyList.slice(0, 5).map(item => `
                    <div class="p-3 rounded-lg border flex justify-between items-center text-[10px] transition-all" style="background:var(--card);border-color:var(--border);">
                        <div class="space-y-0.5">
                            <p class="font-extrabold text-slate-800 dark:text-slate-200">${item.mode}</p>
                            <p class="text-slate-400 dark:text-slate-500 text-[8px] font-mono">${item.date} • ${item.correct}/${item.total} answered</p>
                        </div>
                        <div class="text-right">
                            <span class="font-black px-2 py-0.5 rounded-full ${item.accuracy >= 80 ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'}">
                                ${item.accuracy}% Acc
                            </span>
                        </div>
                    </div>
                `).join('');
                if (historyContainer.innerHTML !== newHtml2) historyContainer.innerHTML = newHtml2;
            }
        }
    
        if (typeof translateAppLabels === 'function') {
            translateAppLabels();
        }
}

    // ==================== APP SETTINGS CONNECTIONS ====================
    function getApiKey() { 
        let val = KrishiStorage.getItem('krishi_gemini_key');
        if (!val) return '';
        try { return atob(val); } catch(e) { return val; }
    }
    function getGeminiModel() { return KrishiStorage.getItem('krishi_gemini_model') || 'gemini-1.5-flash'; }
    function getGeminiTemp() { return parseFloat(KrishiStorage.getItem('krishi_gemini_temp')) || 0.7; }

    function toggleKeyVisibility() {
        const el = document.getElementById('gemini-api-key');
        const icon = document.getElementById('eye-icon');
        if (el) {
            if (el.type === 'password') {
                el.type = 'text';
                if (icon) icon.innerText = '🙈';
            } else {
                el.type = 'password';
                if (icon) icon.innerText = '👁️';
            }
        }
    }

    function saveGeminiSettings() {
        const model = document.getElementById('gemini-model-select').value;
        const temp = document.getElementById('gemini-temp-select').value;
        KrishiStorage.setItem('krishi_gemini_model', model);
        KrishiStorage.setItem('krishi_gemini_temp', temp);
        KrishiStorage.setItem('krishi_firebase_config', JSON.stringify({})); // keep placeholder clear
        syncSettingsToCloud('Gemini settings updated');
        showToast('Settings saved successfully!');
    }

    function loadApiKeyInput() {
        let el = document.getElementById('gemini-api-key'); 
        if(el) {
            el.value = getApiKey();
        }
        
        let modelSelect = document.getElementById('gemini-model-select');
        if (modelSelect) {
            modelSelect.value = getGeminiModel();
        }

        let tempSelect = document.getElementById('gemini-temp-select');
        if (tempSelect) {
            tempSelect.value = String(getGeminiTemp());
        }

        checkApiKeyStatus(true);
    }

    async function checkApiKeyStatus(silent = false) {
        const key = getApiKey();
        const badge = document.getElementById('gemini-status-badge');
        if (!key) {
            if (badge) {
                badge.innerText = 'Empty ⚪';
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
            }
            toggleAIButtonVisibility();
            return;
        }

        if (badge) {
            badge.innerText = 'Checking... 🟡';
            badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
        }

        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            if (res.ok) {
                if (badge) {
                    badge.innerText = 'Valid Key 🟢';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400';
                }
            } else {
                if (badge) {
                    badge.innerText = 'Invalid Key 🔴';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400';
                }
                if (!silent) showToast('⚠️ Invalid API key, check your Google Console!');
            }
        } catch(e) {
            if (badge) {
                badge.innerText = 'Offline 🟡';
                badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400';
            }
        }
        toggleAIButtonVisibility();
    }

    async function validateAndSaveApiKey() {
        const el = document.getElementById('gemini-api-key');
        const val = el ? el.value.trim() : '';
        const spinner = document.getElementById('key-spinner');
        const btn = document.getElementById('btn-save-key');

        if (!val) {
            showToast('⚠️ Please enter an API key first!');
            return;
        }

        if (spinner) spinner.classList.remove('hidden');
        if (btn) btn.disabled = true;

        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${val}`);
            if (res.ok) {
                KrishiStorage.setItem('krishi_gemini_key', btoa(val));
                saveGeminiSettings();
                showToast('✅ Key verified and saved successfully!');
                await checkApiKeyStatus(true);
            } else {
                showToast('❌ Verification failed! The key is invalid.');
                const badge = document.getElementById('gemini-status-badge');
                if (badge) {
                    badge.innerText = 'Invalid Key 🔴';
                    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400';
                }
            }
        } catch(e) {
            // Save anyway if offline, warn user
            KrishiStorage.setItem('krishi_gemini_key', btoa(val));
            saveGeminiSettings();
            showToast('⚠️ Saved, but offline - could not verify key.');
            await checkApiKeyStatus(true);
        } finally {
            if (spinner) spinner.classList.add('hidden');
            if (btn) btn.disabled = false;
        }
    }

    function clearApiKey() {
        KrishiStorage.removeItem('krishi_gemini_key');
        const el = document.getElementById('gemini-api-key');
        if (el) el.value = '';
        syncSettingsToCloud('Gemini key cleared');
        checkApiKeyStatus(true);
        showToast('🗑️ API Key cleared.');
    }

    function toggleAIButtonVisibility(){
        let key = getApiKey();
        let btn = document.getElementById('generate-ai-btn'); 
        if(!btn) return;
        if(key) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    }

    // ==================== INSERTS PANEL (ADMIN) ====================
    function populateAdminSubjects(){
        let s = document.getElementById('admin-subject'); if(!s) return;
        let subjects = getAllSubjects(); s.innerHTML = '';
        subjects.forEach(sub => s.innerHTML += `<option value="${sub}">${sub}</option>`);
    }
    
    function adminSave(){
        let q = document.getElementById('admin-q').value.trim();
        let opts = [
            document.getElementById('admin-o1').value.trim(),
            document.getElementById('admin-o2').value.trim(),
            document.getElementById('admin-o3').value.trim(),
            document.getElementById('admin-o4').value.trim()
        ];
        let correct = parseInt(document.getElementById('admin-correct').value);
        let sub = document.getElementById('admin-subject').value;
        
        if(!q || opts.some(o=>!o)){
            document.getElementById('admin-status').textContent = '⚠️ Fill in all areas!';
            return;
        }
        localData.customQuestions.push({
            id: Date.now(), q: q, opts: opts, ans: correct, expl: 'Admin Inserted Item', sub: sub
        });
        saveData();
        document.getElementById('admin-status').textContent = '✅ Question saved successfully!';
        document.getElementById('admin-q').value = '';
    }

    function populateMockSubjectFilter(){
        let select = document.getElementById('mock-subject'); if(!select) return;
        select.innerHTML = '<option value="all">All Subjects</option>';
        getAllSubjects().forEach(s=>select.innerHTML += `<option value="${s}">${s}</option>`);
    }

    // ==================== SM-2 SPACED REPETITION ENGINE ====================
    // Note: FSRS Spaced Repetition engine is implemented in pwa_helpers.js via KrishiSM2Engine

    function startSpacedReview() {
        let pool = [];
        let allQ = getAllQuestions();
        if (window.KrishiSM2Engine) {
            pool = window.KrishiSM2Engine.getDueQuestions(allQ);
        }
        
        let data = window.KrishiSM2Engine ? window.KrishiSM2Engine._getData() : {};
        let newQs = allQ.filter(q => {
            let id = String(q.id || q.q);
            let isWrong = localData.wrong && localData.wrong.some(wid => String(wid) === id);
            return (!data[id] || data[id].status === 'new') && !isWrong;
        });

        if (typeof shuffle === 'function') {
            pool = shuffle(pool);
            newQs = shuffle(newQs);
        }

        // Cap due questions to 15 to prevent fatigue
        pool = pool.slice(0, 15);

        // Blend in up to 5 new questions
        if (newQs.length > 0) {
            pool = pool.concat(newQs.slice(0, 5));
            if (typeof shuffle === 'function') pool = shuffle(pool); // Interleave new and due
        }

        if (pool.length === 0) {
            showToast('🎉 No spaced review items pending!'); 
            return;
        }
        
        // Isolating Spaced Review config to prevent leakage from other practice modes
        state.activeConfig = {
            subject: 'all', topic: 'all', difficulty: 'all', count: 'all',
            timer: 'off', timerMin: 0, perQTimer: 'off', perQSec: 0,
            negativeMarking: 'off', feedback: 'immediate', shuffleQs: true, shuffleOpts: true,
            isSpacedReview: true
        };
        
        setupMCQSession(pool, false, 0);
    }

    function startAdaptiveReview(){ startSpacedReview(); }

    // ==================== ADVANCED STUDY PLANNER PLATFORM ENGINE ====================
    let plannerDemoModeActive = false;
    let activePlanMode = 'normal'; // default mode (quick, normal, deep, full)

    // Default Agriculture Syllabus with structured topics and initial statuses
    const DEFAULT_AGRI_SYLLABUS = [
        { subject: "Agronomy (कृषि विज्ञान)", weightage: 25, topics: [
            { name: "Cereal crops cultivation (खाद्यान्न बाली)", status: "Studying" },
            { name: "Pulse crops (दलहन बाली)", status: "Pending" },
            { name: "Oilseed and industrial crops (तेल्हन र औद्योगिक बाली)", status: "Pending" },
            { name: "Weed management (झार नियन्त्रण)", status: "Completed" }
        ]},
        { subject: "Soil Science (माटो विज्ञान)", weightage: 20, topics: [
            { name: "Soil physical properties (माटोको भौतिक गुण)", status: "Weak" },
            { name: "Soil chemical properties (रासायनिक गुण)", status: "Pending" },
            { name: "Soil fertility & fertilizers (मलखाद र उत्पादकत्व)", status: "Revision Needed" }
        ]},
        { subject: "Horticulture (उद्यान विज्ञान)", weightage: 20, topics: [
            { name: "Pomology/Fruit science (फलफूल खेती)", status: "Completed" },
            { name: "Olericulture/Vegetables (तरकारी खेती)", status: "Studying" },
            { name: "Floriculture & Landscaping (पुष्प व्यवसाय)", status: "Pending" }
        ]},
        { subject: "Plant Pathology (पादप रोग विज्ञान)", weightage: 15, topics: [
            { name: "Major fungal disease controls (ढुसीजन्य रोग)", status: "Weak" },
            { name: "Integrated Pest Management - IPM (कीरा नियन्त्रण)", status: "Pending" }
        ]}
    ];

    // Status point weights for syllabus progress integration
    const STATUS_WEIGHTS = {
        'Pending': 0,
        'Studying': 30,
        'Weak': 20,
        'Revision Needed': 50,
        'Completed': 100,
        'Mastered': 100
    };





    function savePlannerSettingsNew(){
        let daily = parseInt(document.getElementById('planner-config-daily-target').value) || 50;
        let weekly = parseInt(document.getElementById('planner-config-weekly-target').value) || 250;
        let exam = document.getElementById('planner-config-exam-date').value || "2026-07-03";
        let threshold = parseInt(document.getElementById('planner-config-weak-threshold').value) || 60;
        let activeSlots = [];
        if (document.getElementById('planner-slot-morning').checked) activeSlots.push('morning');
        if (document.getElementById('planner-slot-afternoon').checked) activeSlots.push('afternoon');
        if (document.getElementById('planner-slot-evening').checked) activeSlots.push('evening');
        
        // Save draft variables
        let restDays = window.draftSettings ? window.draftSettings.restDays : [6];
        let intensity = window.draftSettings ? window.draftSettings.intensity : 'normal';
        let difficultyBias = window.draftSettings ? window.draftSettings.difficultyBias : 'balanced';
        let retryDelay = window.draftSettings ? window.draftSettings.retryDelay : 3;
        
        // Write drafts back to core storage
        KrishiStorage.setItem('krishi_intensity_mode', intensity);
        KrishiStorage.setItem('krishi_difficulty_bias', difficultyBias);
        KrishiStorage.setItem('krishi_retry_delay', retryDelay);
        stampSetting('intensityMode');
        stampSetting('difficultyBias');
        stampSetting('retryDelay');
        
        let studyHours = parseFloat(document.getElementById('planner-config-study-hours').value) || 2;
        let newRatio = parseInt(document.getElementById('planner-config-new-ratio').value) || 50;
        let focusSubject = document.getElementById('planner-config-focus-subject').value || 'all';
        let soundEnabled = document.getElementById('planner-config-sound').checked;
        let compactMode = document.getElementById('planner-config-compact').checked;
        let obj = {
            dailyTarget: daily, weeklyTarget: weekly, examDate: exam, weakThreshold: threshold,
            slots: activeSlots, syllabusVisible: true, adaptiveReview: true,
            intensity, restDays, studyHours, newRatio, difficultyBias, retryDelay,
            focusSubject, soundEnabled, compactMode
        };
        
        // Update active exam profile to keep everything in sync
        let profiles = getExamProfiles();
        let active = profiles.find(p => p.active);
        if (active) {
            active.dailyTarget = daily;
            active.weeklyTarget = weekly;
            active.targetDate = exam;
            saveExamProfiles(profiles);
        }
        
        KrishiStorage.setItem('krishi_planner_settings', JSON.stringify(obj));
        KrishiStorage.setItem('krishi_sound_enabled', soundEnabled ? 'true' : 'false');
        
        // Clean draft settings block
        window.draftSettings = null;
        
        syncSettingsToCloud('Planner settings updated');
        
        applyPlannerPersonalization();
        showToast('⚙️ Planner Settings updated successfully!');
        togglePlannerSettings();
        refreshPlannerPage();
    }

    function resetPlannerSettingsToDefaults(){
        KrishiStorage.removeItem('krishi_planner_settings');
        KrishiStorage.removeItem('krishi_intensity_mode');
        KrishiStorage.removeItem('krishi_difficulty_bias');
        KrishiStorage.removeItem('krishi_retry_delay');
        syncSettingsToCloud('Planner settings reset');
        showToast('🔄 Settings reset to defaults!');
        
        // Clear drafts if any
        window.draftSettings = null;
        
        let settings = getPlannerSettings();
        document.getElementById('planner-config-daily-target').value = settings.dailyTarget;
        document.getElementById('planner-config-weekly-target').value = settings.weeklyTarget;
        document.getElementById('planner-config-exam-date').value = settings.examDate;
        document.getElementById('planner-config-weak-threshold').value = settings.weakThreshold;
        document.getElementById('planner-slot-morning').checked = settings.slots.includes('morning');
        document.getElementById('planner-slot-afternoon').checked = settings.slots.includes('afternoon');
        document.getElementById('planner-slot-evening').checked = settings.slots.includes('evening');
        if(document.getElementById('planner-config-study-hours')) document.getElementById('planner-config-study-hours').value = 2;
        if(document.getElementById('study-hours-lbl')) document.getElementById('study-hours-lbl').textContent = '2 hrs';
        if(document.getElementById('planner-config-new-ratio')) document.getElementById('planner-config-new-ratio').value = 50;
        if(document.getElementById('ratio-new-lbl')) document.getElementById('ratio-new-lbl').textContent = '50% New';
        if(document.getElementById('ratio-rev-lbl')) document.getElementById('ratio-rev-lbl').textContent = '50% Review';
        if(document.getElementById('planner-config-focus-subject')) document.getElementById('planner-config-focus-subject').value = 'all';
        if(document.getElementById('planner-config-sound')) document.getElementById('planner-config-sound').checked = true;
        if(document.getElementById('planner-config-compact')) document.getElementById('planner-config-compact').checked = false;
        setIntensityMode('normal');
        setDifficultyBias('balanced');
        setRetryDelay(3);
        buildRestDayButtons([6]);
        applyPlannerPersonalization();
        refreshPlannerPage();
    }

    function togglePlannerSettings(){
        let p = document.getElementById('planner-settings-panel');
        let overlay = document.getElementById('planner-settings-overlay');
        p.classList.toggle('hidden');
        if(overlay) overlay.classList.toggle('hidden');
        if(!p.classList.contains('hidden')) {
            p.style.transform = 'translateY(-100%)';
            p.style.transition = 'transform 0.3s cubic-bezier(0.25,0.8,0.25,1)';
            requestAnimationFrame(() => { p.style.transform = 'translateY(0)'; });
            
            let settings = getPlannerSettings();
            
            // Initialize draft transactions
            window.draftSettings = {
                intensity: settings.intensity || 'normal',
                difficultyBias: settings.difficultyBias || 'balanced',
                retryDelay: settings.retryDelay || 3,
                restDays: [...(settings.restDays || [6])]
            };
            
            document.getElementById('planner-config-daily-target').value = settings.dailyTarget;
            document.getElementById('planner-config-weekly-target').value = settings.weeklyTarget;
            document.getElementById('planner-config-exam-date').value = settings.examDate;
            document.getElementById('planner-config-weak-threshold').value = settings.weakThreshold;
            document.getElementById('planner-slot-morning').checked = settings.slots.includes('morning');
            document.getElementById('planner-slot-afternoon').checked = settings.slots.includes('afternoon');
            document.getElementById('planner-slot-evening').checked = settings.slots.includes('evening');
            // Populate new fields
            if(document.getElementById('planner-config-study-hours')){
                document.getElementById('planner-config-study-hours').value = settings.studyHours || 2;
                document.getElementById('study-hours-lbl').textContent = (settings.studyHours || 2) + ' hrs';
            }
            if(document.getElementById('planner-config-new-ratio')){
                let nr = settings.newRatio || 50;
                document.getElementById('planner-config-new-ratio').value = nr;
                document.getElementById('ratio-new-lbl').textContent = nr + '% New';
                document.getElementById('ratio-rev-lbl').textContent = (100-nr) + '% Review';
            }
            let focusSelect = document.getElementById('planner-config-focus-subject');
            if (focusSelect) {
                let selectedVal = settings.focusSubject || 'all';
                focusSelect.innerHTML = '<option value="all">📚 All Subjects (Default)</option>';
                
                // Get all active subjects in Subject Manager
                let activeSubjects = getAllSubjects();
                activeSubjects.forEach(sub => {
                    let opt = document.createElement('option');
                    opt.value = sub;
                    opt.textContent = '🎯 ' + sub;
                    if (sub === selectedVal) opt.selected = true;
                    focusSelect.appendChild(opt);
                });
                
                // Fallback to 'all' if selected focus subject is no longer in active subjects
                if (selectedVal !== 'all' && !activeSubjects.includes(selectedVal)) {
                    focusSelect.value = 'all';
                }
            }
            if(document.getElementById('planner-config-sound')) document.getElementById('planner-config-sound').checked = settings.soundEnabled !== false;
            if(document.getElementById('planner-config-compact')) document.getElementById('planner-config-compact').checked = !!settings.compactMode;
            setIntensityMode(settings.intensity || 'normal', false);
            setDifficultyBias(settings.difficultyBias || 'balanced');
            setRetryDelay(settings.retryDelay || 3);
            buildRestDayButtons(settings.restDays || [6]);
            applyPlannerPersonalization();
        } else {
            p.style.transform = '';
            p.style.transition = '';
            // Close event: clean drafts
            window.draftSettings = null;
        }
    }

    // ── NEW SETTINGS FEATURE FUNCTIONS ──────────────────────────────────────

    function setIntensityMode(mode, overrideInputs = true) {
        if (window.draftSettings) {
            window.draftSettings.intensity = mode;
        } else {
            KrishiStorage.setItem('krishi_intensity_mode', mode);
            stampSetting('intensityMode');
        }
        let configs = {
            relaxed: {target:20, hint:'🐢 Relaxed: 20 MCQs/day. Low pressure, steady pace.'},
            normal:  {target:50, hint:'📘 Normal: 50 MCQs/day. Balanced daily routine.'},
            intense: {target:100, hint:'🔥 Intense: 100 MCQs/day. High output for serious prep.'},
            crunch:  {target:150, hint:'💀 Crunch: 150 MCQs/day. Maximum effort before exam!'}
        };
        let cfg = configs[mode] || configs['normal'];
        let ids = ['relaxed','normal','intense','crunch'];
        ids.forEach(m => {
            let btn = document.getElementById('intensity-' + m);
            if (!btn) return;
            if (m === mode) {
                btn.style.background = 'rgba(99,102,241,0.18)';
                btn.style.color = '#6366f1';
                btn.style.outline = '2px solid #6366f1';
            } else {
                btn.style.background = 'var(--bg)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.outline = 'none';
            }
        });
        let hint = document.getElementById('intensity-hint');
        if (hint) hint.textContent = cfg.hint;
        if (overrideInputs) {
            let dtEl = document.getElementById('planner-config-daily-target');
            if (dtEl) dtEl.value = cfg.target;
            let wtEl = document.getElementById('planner-config-weekly-target');
            if (wtEl) wtEl.value = cfg.target * 7; // Fixed: A week has 7 days, so weekly target is daily * 7!
        }
    }

    function setDifficultyBias(bias) {
        if (window.draftSettings) {
            window.draftSettings.difficultyBias = bias;
        } else {
            KrishiStorage.setItem('krishi_difficulty_bias', bias);
            stampSetting('difficultyBias');
        }
        let colors = {easy:'#10b981', balanced:'#f59e0b', hard:'#ef4444'};
        ['easy','balanced','hard'].forEach(b => {
            let btn = document.getElementById('diff-' + b);
            if (!btn) return;
            if (b === bias) {
                btn.style.background = 'rgba(' + (b==='easy'?'16,185,129':b==='balanced'?'245,158,11':'239,68,68') + ',0.15)';
                btn.style.color = colors[b];
                btn.style.outline = '2px solid ' + colors[b];
            } else {
                btn.style.background = 'var(--bg)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.outline = 'none';
            }
        });
    }

    function setRetryDelay(days) {
        if (window.draftSettings) {
            window.draftSettings.retryDelay = days;
        } else {
            KrishiStorage.setItem('krishi_retry_delay', days);
            stampSetting('retryDelay');
        }
        [1,3,7].forEach(d => {
            let btn = document.getElementById('retry-' + d);
            if (!btn) return;
            if (d === days) {
                btn.style.background = 'rgba(99,102,241,0.15)';
                btn.style.color = '#6366f1';
                btn.style.outline = '2px solid #6366f1';
            } else {
                btn.style.background = 'var(--bg)';
                btn.style.color = 'var(--text-secondary)';
                btn.style.outline = 'none';
            }
        });
    }

    function buildRestDayButtons(selectedDays) {
        let container = document.getElementById('rest-day-buttons');
        if (!container) return;
        let labels = ['S','M','T','W','T','F','S'];
        container.innerHTML = '';
        labels.forEach((label, i) => {
            let isSelected = selectedDays.includes(i);
            let btn = document.createElement('button');
            btn.textContent = label;
            btn.id = 'rest-day-' + i;
            btn.className = 'flex-1 py-2 rounded-xl text-[9px] font-black cursor-pointer border-none transition ';
            btn.style.background = isSelected ? 'rgba(99,102,241,0.15)' : 'var(--bg)';
            btn.style.color = isSelected ? '#6366f1' : 'var(--text-secondary)';
            btn.style.outline = isSelected ? '2px solid #6366f1' : 'none';
            btn.setAttribute('data-selected', isSelected ? '1' : '0');
            btn.onclick = function() {
                let sel = this.getAttribute('data-selected') === '1';
                sel = !sel;
                this.setAttribute('data-selected', sel ? '1' : '0');
                this.style.background = sel ? 'rgba(99,102,241,0.15)' : 'var(--bg)';
                this.style.color = sel ? '#6366f1' : 'var(--text-secondary)';
                this.style.outline = sel ? '2px solid #6366f1' : 'none';
                
                // Keep draft restDays transaction in sync
                if (window.draftSettings) {
                    let rest = [];
                    for(let k=0;k<7;k++){
                        let el=document.getElementById('rest-day-'+k);
                        if(el && el.getAttribute('data-selected')==='1') rest.push(k);
                    }
                    window.draftSettings.restDays = rest;
                }
            };
            container.appendChild(btn);
        });
    }

    function applyPlannerPersonalization() {
        let settings = getPlannerSettings();
        
        // Sound toggle visual update
        let soundCb = document.getElementById('planner-config-sound');
        let soundTrack = document.getElementById('sound-track');
        let soundThumb = document.getElementById('sound-thumb');
        if (soundCb && soundTrack && soundThumb) {
            let panel = document.getElementById('planner-settings-panel');
            if (!panel || panel.classList.contains('hidden')) {
                soundCb.checked = settings.soundEnabled !== false;
            }
            soundTrack.style.background = soundCb.checked ? '#10b981' : 'var(--border)';
            soundThumb.style.transform = soundCb.checked ? 'translateX(20px)' : 'translateX(0px)';
            KrishiStorage.setItem('krishi_sound_enabled', soundCb.checked ? 'true' : 'false');
            
            // Sync with Central App Settings sound handlers (Bug 15)
            if (typeof syncPerfSoundToggle === 'function') {
                syncPerfSoundToggle();
            }
        }
        
        // Compact toggle visual update
        let compactCb = document.getElementById('planner-config-compact');
        let compactTrack = document.getElementById('compact-track');
        let compactThumb = document.getElementById('compact-thumb');
        if (compactCb && compactTrack && compactThumb) {
            let panel = document.getElementById('planner-settings-panel');
            if (!panel || panel.classList.contains('hidden')) {
                compactCb.checked = !!settings.compactMode;
            }
            compactTrack.style.background = compactCb.checked ? '#6366f1' : 'var(--border)';
            compactThumb.style.transform = compactCb.checked ? 'translateX(20px)' : 'translateX(0px)';
        }
        
        // Apply compact mode to planner page
        let plannerPage = document.getElementById('page-study-planner');
        if (plannerPage) {
            let isCompact = compactCb ? compactCb.checked : !!settings.compactMode;
            if (isCompact) {
                plannerPage.style.fontSize = '0.85em';
                plannerPage.classList.add('compact-mode');
            } else {
                plannerPage.style.fontSize = '';
                plannerPage.classList.remove('compact-mode');
            }
        }
    }

    function exportStudyReport() {
        try {
            let report = {
                exportDate: new Date().toISOString(),
                appVersion: 'Krishi MCQ Pro v28',
                settings: getPlannerSettings(),
                stats: localData.stats || {},
                wrongQuestions: getValidWrongCount(),
                streakData: { current: localData.stats ? (localData.stats.streakDays || 0) : 0 },
                totalSolved: localData.stats ? (localData.stats.totalSolved || 0) : 0,
                subjectStats: localData.stats ? (localData.stats.subjectStats || {}) : {},
                dailyHistory: localData.dailyHistory || {}
            };
            let json = JSON.stringify(report, null, 2);
            let blob = new Blob([json], {type: 'application/json'});
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = 'krishi-study-report-' + new Date().toISOString().slice(0,10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('📊 Study Report exported successfully!');
        } catch(e) {
            showToast('⚠️ Export failed: ' + e.message);
        }
    }

    function resetSubjectData() {
        let sel = document.getElementById('reset-subject-select');
        if (!sel || !sel.value) { showToast('⚠️ Please select a subject first!'); return; }
        let subject = sel.value;
        if (!confirm('Reset all stats for "' + subject + '"? This cannot be undone.')) return;
        try {
            // 1. Reset practice stats
            if (localData.stats && localData.stats.subjectStats && localData.stats.subjectStats[subject]) {
                delete localData.stats.subjectStats[subject];
            }

            // 2. Reset custom syllabus topic statuses to "Pending"
            let syllabus = getSyllabusData();
            let modified = false;
            syllabus.forEach(sub => {
                if (sub.subject.toLowerCase().includes(subject.toLowerCase()) || subject.toLowerCase().includes(sub.subject.toLowerCase())) {
                    sub.topics.forEach(t => {
                        t.status = 'Pending';
                        modified = true;
                    });
                }
            });
            if (modified) {
                saveSyllabusData(syllabus);
            }

            // 3. Clear from wrong logs and timingLog
            localData.wrong = localData.wrong.filter(qid => {
                let q = getAllQuestions().find(x => x.id === qid);
                return !q || !q.sub || !(q.sub.toLowerCase().includes(subject.toLowerCase()) || subject.toLowerCase().includes(q.sub.toLowerCase()));
            });
            
            timingLog = timingLog.filter(entry => {
                return !entry.subject || !(entry.subject.toLowerCase().includes(subject.toLowerCase()) || subject.toLowerCase().includes(entry.subject.toLowerCase()));
            });
            
            saveLocalData();
            saveTimingData();

            showToast('🔄 ' + subject + ' stats and syllabus progress reset successfully!');
            refreshPlannerPage();
        } catch(e) {
            showToast('⚠️ Reset failed: ' + e.message);
        }
    }

    window.setIntensityMode = setIntensityMode;
    window.setDifficultyBias = setDifficultyBias;
    window.setRetryDelay = setRetryDelay;
    window.buildRestDayButtons = buildRestDayButtons;
    window.applyPlannerPersonalization = applyPlannerPersonalization;
    window.exportStudyReport = exportStudyReport;
    window.resetSubjectData = resetSubjectData;

    // Duplicate getDailyTarget removed

    function getSyllabusData() {
        try {
            let saved = KrishiStorage.getItem('krishi_syllabus_custom');
            if (saved) return JSON.parse(saved);
        } catch(e){}
        return JSON.parse(JSON.stringify(DEFAULT_AGRI_SYLLABUS));
    }

    function saveSyllabusData(data) {
        KrishiStorage.setItem('krishi_syllabus_custom', JSON.stringify(data));
        calculateSyllabusPercentages();
    }

    function toggleAddSubjectView() {
        let form = document.getElementById('add-subject-form');
        form.classList.toggle('hidden');
    }

    function submitCustomSyllabusSubject(){
        let subName = document.getElementById('new-syllabus-subject').value.trim();
        let subWeight = parseInt(document.getElementById('new-syllabus-weight').value) || 10;
        if (!subName) { showToast('⚠️ Subject name is required!'); return; }

        let data = getSyllabusData();
        
        // सुरक्षा जाँच: कुल भार १००% भन्दा बढी हुन नदिने
        let currentTotal = data.reduce((sum, item) => sum + (item.weightage || 0), 0);
        if (currentTotal + subWeight > 100) {
            showToast(`⚠️ पाठ्यक्रम सीमा नाघ्यो! बाँकी भार: ${100 - currentTotal}% मात्र छ। तपाईंले राख्न खोज्नुभएको भार: ${subWeight}%।`);
            return;
        }

        data.push({
            subject: subName,
            weightage: subWeight,
            topics: []
        });
        saveSyllabusData(data);
        document.getElementById('new-syllabus-subject').value = '';
        document.getElementById('new-syllabus-weight').value = '';
        toggleAddSubjectView();
        showToast('✅ Subject added to syllabus!');
        refreshPlannerPage();
    }

    function deleteCustomSubject(subjectIdx) {
        if (confirm('Are you sure you want to delete this subject and all its topics?')) {
            let data = getSyllabusData();
            data.splice(subjectIdx, 1);
            saveSyllabusData(data);
            showToast('🗑️ Subject deleted.');
            refreshPlannerPage();
        }
    }

    function addCustomTopicToSubject(subjectIdx) {
        let topicName = prompt('Enter name of the new chapter/topic:');
        if (!topicName || !topicName.trim()) return;
        
        let data = getSyllabusData();
        data[subjectIdx].topics.push({
            name: topicName.trim(),
            status: 'Pending'
        });
        saveSyllabusData(data);
        showToast('✅ Topic appended.');
        refreshPlannerPage();
    }

    function deleteCustomTopic(subjectIdx, topicIdx) {
        if(confirm('Delete this topic?')) {
            let data = getSyllabusData();
            data[subjectIdx].topics.splice(topicIdx, 1);
            saveSyllabusData(data);
            showToast('🗑️ Topic deleted.');
            refreshPlannerPage();
        }
    }

    function updateCustomTopicStatus(subjectIdx, topicIdx, newStatus) {
        let data = getSyllabusData();
        data[subjectIdx].topics[topicIdx].status = newStatus;
        saveSyllabusData(data);
        showToast(`Updated topic to ${newStatus}`);
        refreshPlannerPage();
    }

   function updateCustomSubjectWeight(subjectIdx, weightVal) {
    let data = getSyllabusData();
    let newWeight = parseInt(weightVal) || 0;
    
    // नयाँ थपिएको सुरक्षा जाँच: भार ० भन्दा कम हुन नदिने
    if (newWeight < 0) {
        showToast(`⚠️ भार ० भन्दा कम (नेगेटिभ) हुन सक्दैन!`);
        refreshPlannerPage();
        return;
    }

    // सुरक्षा जाँच: सम्पादन गर्दा पनि कुल भार १००% भन्दा बढी हुन नदिने
    let otherTotal = data.reduce((sum, item, idx) => {
        return sum + (idx === subjectIdx ? 0 : (item.weightage || 0));
    }, 0);
    
    if (otherTotal + newWeight > 100) {
        showToast(`⚠️ भार १००% भन्दा बढी बनाउन मिल्दैन! अन्य विषयहरूको भार: ${otherTotal}%, यो विषयको भार: ${newWeight}%।`);
        refreshPlannerPage(); // यूआई रिफ्रेस गरेर पुरानै मान देखाउने
        return;
    }

    data[subjectIdx].weightage = newWeight;
    saveSyllabusData(data);
    refreshPlannerPage();
}
    function calculateSyllabusPercentages() {
        let data = getSyllabusData();
        let totalWeight = 0;
        let weightedSum = 0;

        data.forEach(sub => {
            let subWeight = sub.weightage || 0;
            totalWeight += subWeight;
            
            let topicCount = sub.topics.length;
            if (topicCount === 0) {
                // empty subject counts as 0 progress
                return;
            }
            
            let sumTopicProgress = 0;
            sub.topics.forEach(t => {
                let statusVal = t.status || 'Pending';
                sumTopicProgress += STATUS_WEIGHTS[statusVal] !== undefined ? STATUS_WEIGHTS[statusVal] : 0;
            });
            let subProgress = sumTopicProgress / topicCount; // 0 to 100
            weightedSum += subProgress * subWeight;
        });

        let overallPercent = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
        return {
            overall: Math.min(100, overallPercent),
            list: data
        };
    }

    function togglePlannerDemoMode() {
        plannerDemoModeActive = !plannerDemoModeActive;
        let dbg = document.getElementById('planner-demo-active-banner');
        if (dbg) {
            if (plannerDemoModeActive) dbg.classList.remove('hidden');
            else dbg.classList.add('hidden');
        }
        showToast(plannerDemoModeActive ? '🌟 Demo Mode ON (Using artificial performance datasets)' : 'Real state active');
        refreshPlannerPage();
    }

    function setPlanMode(mode) {
        activePlanMode = mode;
        KrishiStorage.setItem('krishi_active_plan_mode', mode); // Persist plan mode selection (Bug 8)
        stampSetting('activePlanMode');
        ['quick', 'normal', 'deep', 'full'].forEach(m => {
            let btn = document.getElementById('pm-tab-' + m);
            if (btn) {
                if (m === mode) {
                    btn.className = "flex-1 py-1.5 text-[9px] font-black rounded-lg text-white cursor-pointer select-none transition-all border-none outline-none";
                    btn.style.backgroundColor = "var(--primary)";
                } else {
                    btn.className = "flex-1 py-1.5 text-[9px] font-black rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer select-none transition-all border-none outline-none";
                    btn.style.backgroundColor = "";
                }
            }
        });
        generateTodaySmartPlan();
    }

    function generateTodaySmartPlan() {
        let settings = getPlannerSettings();
        let sInfo = calculateSyllabusPercentages();
        let subjects = getAllSubjects();
        
        let weakestSub = sInfo.list[0] ? sInfo.list[0].subject : "Fundamentals";
        let weakestAccuracy = 100;

        // Apply Focus Subject Lock dynamically if active (Bug 3)
        if (settings.focusSubject && settings.focusSubject !== 'all') {
            weakestSub = settings.focusSubject;
        } else if (plannerDemoModeActive) {
            weakestSub = "Soil Science (माटो विज्ञान)";
            weakestAccuracy = 42;
        } else {
            let weakInfo = getWeakestSubject();
            if (weakInfo.hasData) {
                weakestSub = weakInfo.subject;
                weakestAccuracy = weakInfo.accuracy;
            }
        }

        let recommendedTopic = weakestSub + " Comprehensive Review";
        let subjectData = sInfo.list.find(s => s.subject.includes(weakestSub) || weakestSub.includes(s.subject));
        if (subjectData && subjectData.topics.length > 0) {
            let incomplete = subjectData.topics.find(t => t.status !== 'Completed' && t.status !== 'Mastered');
            if (incomplete) recommendedTopic = incomplete.name;
            else recommendedTopic = "Comprehensive Core Review";
        }

        let mcqTarget = 30;
        let studyTime = "1 hour";
        let reviewCount = Math.min(10, getPromoDueCount());
        let wrongCount = Math.min(15, getValidWrongCount());

        if (plannerDemoModeActive) {
            wrongCount = 8;
            reviewCount = 5;
        }

        switch(activePlanMode) {
            case 'quick':
                mcqTarget = 15;
                studyTime = "30 mins";
                break;
            case 'normal':
                mcqTarget = 30;
                studyTime = "1 hour";
                break;
            case 'deep':
                mcqTarget = 60;
                studyTime = "2 hours";
                break;
            case 'full':
                mcqTarget = 100;
                studyTime = "4+ hours";
                break;
        }

        let activeSlots = settings.slots || ["morning", "afternoon", "evening"];
        let detailsHTML = `<div class="space-y-4 relative pl-5 border-l border-indigo-500/25 ml-2 mt-2 pt-1 pb-1 animate-slide-up">`;
        let stepIndex = 1;
        
        // Step 1: Core Subject Focus (Morning)
        if (activeSlots.includes('morning')) {
            detailsHTML += `
                <!-- Step 1: Core Subject Focus -->
                <div class="relative">
                    <span class="absolute -left-[26.5px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[8px] text-white font-black ring-4 ring-white dark:ring-slate-800">${stepIndex}</span>
                    <div class="space-y-0.5">
                        <span class="text-[9px] font-black text-indigo-500 uppercase tracking-wider block">🌅 Morning: Core Subject Focus</span>
                        <p class="text-[11px] font-black text-slate-800 dark:text-slate-200">Study weak concepts in <span class="text-indigo-600 dark:text-indigo-400 font-extrabold">${weakestSub}</span></p>
                        <p class="text-[8px] text-slate-400 leading-normal">Focusing on your lowest metrics ensures the fastest path to progress.</p>
                    </div>
                </div>
            `;
            stepIndex++;
        }
        
        // Step 2: Specific Topic Revision (Afternoon)
        if (activeSlots.includes('afternoon')) {
            detailsHTML += `
                <!-- Step 2: Specific Topic Revision -->
                <div class="relative">
                    <span class="absolute -left-[26.5px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[8px] text-white font-black ring-4 ring-white dark:ring-slate-800">${stepIndex}</span>
                    <div class="space-y-0.5">
                        <span class="text-[9px] font-black text-amber-500 uppercase tracking-wider block">☀️ Afternoon: Revision Challenge</span>
                        <p class="text-[11px] font-black text-slate-800 dark:text-slate-200">Revise topic: <span class="bg-amber-500/10 px-2 py-0.5 rounded text-amber-600 dark:text-amber-400 font-extrabold text-[9px]">${recommendedTopic}</span></p>
                        <p class="text-[8px] text-slate-400 leading-normal">Study time budget: <b>${studyTime}</b> to master key definitions.</p>
                    </div>
                </div>
            `;
            stepIndex++;
        }

        // Step 3: Diagnostic MCQ Practice (Evening)
        if (activeSlots.includes('evening')) {
            detailsHTML += `
                <!-- Step 3: Diagnostic MCQ Practice -->
                <div class="relative">
                    <span class="absolute -left-[26.5px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white font-black ring-4 ring-white dark:ring-slate-800">${stepIndex}</span>
                    <div class="space-y-0.5">
                        <span class="text-[9px] font-black text-emerald-500 uppercase tracking-wider block">🌌 Evening: Interactive Study Drills</span>
                        <p class="text-[11px] font-black text-slate-800 dark:text-slate-200">Attempt <b>${mcqTarget} MCQs</b> of weakest topics</p>
                        <p class="text-[8px] text-slate-400 leading-normal">Includes <b>${reviewCount}</b> Spaced SM-2 reviews and corrected <b>${wrongCount}</b> errors in memory.</p>
                    </div>
                </div>
            `;
            stepIndex++;
        }
        
        if (stepIndex === 1) {
            detailsHTML += `<p class="text-[10px] text-slate-400 italic">No study slots selected. Enable practice slots in Planner Settings to build your daily routine!</p>`;
        }
        
        detailsHTML += `</div>`;
        document.getElementById('smart-plan-details').innerHTML = detailsHTML;
        
        let detailsBox = document.getElementById('smart-plan-details');
        detailsBox.setAttribute('data-target-subject', weakestSub);
        detailsBox.setAttribute('data-target-count', mcqTarget);
    }

    function startSmartStudyPlanSession() {
        let settings = getPlannerSettings();
        let detailsBox = document.getElementById('smart-plan-details');
        let subName = detailsBox.getAttribute('data-target-subject') || "Agronomy";
        let count = parseInt(detailsBox.getAttribute('data-target-count')) || 30;

        // 1. Gather all questions matching the subject
        let rawPool = getAllQuestions().filter(q => q.sub && (q.sub.toLowerCase().includes(subName.split(" ")[0].toLowerCase()) || subName.toLowerCase().includes(q.sub.toLowerCase())));
        if (rawPool.length === 0) rawPool = getAllQuestions();

        // 2. Partition by New vs Review Ratio (Bug 4)
        let sm2EngineData = window.KrishiSM2Engine ? window.KrishiSM2Engine._getData() : {};
        let reviewQs = rawPool.filter(q => sm2EngineData[q.id] !== undefined);
        let newQs = rawPool.filter(q => sm2EngineData[q.id] === undefined);

        let newRatio = settings.newRatio || 50; // percentage of new questions
        let targetNewCount = Math.round(count * (newRatio / 100));
        let targetReviewCount = count - targetNewCount;

        let selectedNew = shuffle(newQs).slice(0, targetNewCount);
        let selectedReview = shuffle(reviewQs).slice(0, targetReviewCount);

        // Fallbacks if one pool is empty
        if (selectedNew.length < targetNewCount) {
            let diff = targetNewCount - selectedNew.length;
            let extraReview = shuffle(reviewQs.filter(q => !selectedReview.includes(q))).slice(0, diff);
            selectedReview = selectedReview.concat(extraReview);
        }
        if (selectedReview.length < targetReviewCount) {
            let diff = targetReviewCount - selectedReview.length;
            let extraNew = shuffle(newQs.filter(q => !selectedNew.includes(q))).slice(0, diff);
            selectedNew = selectedNew.concat(extraNew);
        }

        let pool = selectedNew.concat(selectedReview);
        if (pool.length === 0) pool = rawPool;

        // 3. Sort by Difficulty Bias (Easy, Balanced, Hard) (Bug 5)
        let bias = settings.difficultyBias || 'balanced';
        pool.sort((a, b) => {
            let diffA = (a.difficulty || 'medium').toLowerCase();
            let diffB = (b.difficulty || 'medium').toLowerCase();
            
            if (bias === 'easy') {
                if (diffA === 'easy' && diffB !== 'easy') return -1;
                if (diffA !== 'easy' && diffB === 'easy') return 1;
            } else if (bias === 'hard') {
                if (diffA === 'hard' && diffB !== 'hard') return -1;
                if (diffA !== 'hard' && diffB === 'hard') return 1;
            }
            return 0; // balanced / equal weight
        });

        pool = pool.slice(0, count);

        if (pool.length === 0) {
            showToast('⚠️ No diagnostic items are loaded yet!');
            return;
        }

        setupMCQSession(pool, false, 0);
        showToast(`⚡ Smart Study Session active! ${newRatio}% New questions loaded with ${bias} difficulty focus.`);
    }

    function startPracticeWeakestSubject(){
        let pool = getAllQuestions();
        let weakInfo = getWeakestSubject();
        let weakestSub = weakInfo.hasData ? weakInfo.subject : "Agronomy";

        let targetPool = pool.filter(q => q.sub && q.sub.toLowerCase() === weakestSub.toLowerCase());
        if(targetPool.length === 0) targetPool = pool.filter(q => q.sub && q.sub.toLowerCase().includes(weakestSub.toLowerCase()));
        if(targetPool.length === 0) targetPool = pool;

        targetPool = shuffle(targetPool).slice(0, 20);
        setupMCQSession(targetPool, false, 0);
        showToast(`🎯 Weakest subject practice active (${weakestSub})`);
    }

    function startMaintainStrongSubjectPractice() {
        let pool = getAllQuestions();
        let subjects = getAllSubjects();
        let strongestSub = "Soil Science";
        let strongestAccuracy = -1;

        subjects.forEach(s => {
            let stats = localData.stats.subjectStats[s] || {solved:0, correct:0};
            if(stats.solved > 3) {
                let acc = (stats.correct/stats.solved)*105; // slightly weighted
                if(acc > strongestAccuracy) {
                    strongestAccuracy = acc;
                    strongestSub = s;
                }
            }
        });

        let targetPool = pool.filter(q => q.sub && q.sub.toLowerCase().includes(strongestSub.toLowerCase()));
        if(targetPool.length === 0) targetPool = pool;

        targetPool = shuffle(targetPool).slice(0, 25);
        setupMCQSession(targetPool, false, 0);
        showToast(`🌟 Mastery Maintenance started for strong subject: ${strongestSub}`);
    }

    function startWrongQuestionCorrection(){
        let wrongQs = getAllQuestions().filter(q => localData.wrong.includes(q.id));
        if (wrongQs.length === 0) {
            showToast('🎉 You have no wrong questions! Outstanding job.');
            return;
        }
        setupMCQSession(shuffle(wrongQs), false, 0);
        showToast(`📝 Started Correction session of ${wrongQs.length} wrong questions.`);
    }

    function refreshPlannerPage() {
        let settings = getPlannerSettings();
        let sInfo = calculateSyllabusPercentages();

        // 1. Render Exam Countdown
        let eDate = new Date(settings.examDate + "T00:00:00");
        let today = new Date();
        let differenceMs = eDate - today;
        let daysCount = Math.ceil(differenceMs / (1000 * 60 * 60 * 24));
        let countEl = document.getElementById('planner-exam-countdown');
        if (countEl) {
            if (daysCount > 0) {
                countEl.textContent = `⏳ Exam countdown: ${daysCount} Days remaining (${settings.examDate})`;
                countEl.className = "text-[10px] text-emerald-600 font-bold mt-0.5";
            } else if (daysCount === 0) {
                countEl.textContent = `🎯 Today is the exam day! Best of luck.`;
                countEl.className = "text-[10px] text-indigo-600 font-bold mt-0.5";
            } else {
                countEl.textContent = `⚠️ Exam happened ${Math.abs(daysCount)} days ago (${settings.examDate})`;
                countEl.className = "text-[10px] text-rose-500 font-bold mt-0.5";
            }
        }

        // Check if solved database is empty or too low (< 20 solves) to show empty state warning
        let totalSolvedCount = 0;
        Object.values(localData.streak).forEach(d => totalSolvedCount += (d.solved || 0));
        let warnBanner = document.getElementById('planner-empty-state-banner');
        if (warnBanner) {
            if (totalSolvedCount < 20 && !plannerDemoModeActive) {
                warnBanner.classList.remove('hidden');
            } else {
                warnBanner.classList.add('hidden');
            }
        }

        // 2. Render target percentage ring & text
        let syllabusPercent = sInfo.overall;
        document.getElementById('lbl-syllabus-completion-percent').textContent = syllabusPercent + '%';
        let circleStroke = document.getElementById('syllabus-circle-stroke');
        if (circleStroke) {
            let offset = 283 - (283 * syllabusPercent) / 100;
            circleStroke.style.strokeDashoffset = offset;
        }

        // 3. High-priority pending topic listings (up to 3 items)
        let hpListHTML = '';
        let pendingCount = 0;
        sInfo.list.forEach(sub => {
            sub.topics.forEach(t => {
                if(pendingCount < 3 && (t.status === 'Pending' || t.status === 'Weak' || t.status === 'Revision Needed')) {
                    let stBg = t.status === 'Weak' ? 'bg-red-500/10 text-red-700' : (t.status === 'Revision Needed' ? 'bg-amber-500/10 text-amber-700' : 'bg-slate-500/10 text-slate-500');
                    hpListHTML += `
                        <div class="flex justify-between items-center text-[10px] p-2 bg-slate-50 dark:bg-slate-900 border rounded-lg hover:shadow-xs hover-scale">
                            <span class="font-bold text-slate-700 dark:text-slate-350">${t.name} <span class="text-[8px] opacity-75">(${sub.subject})</span></span>
                            <span class="px-2 py-0.5 rounded text-[8px] font-bold ${stBg}">${t.status}</span>
                        </div>
                    `;
                    pendingCount++;
                }
            });
        });
        if(hpListHTML === '') {
            hpListHTML = `<p class="text-[10px] text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950/20 p-2 rounded-lg">✨ All high priority syllabus targets are mastered!</p>`;
        }
        document.getElementById('high-priority-checklist').innerHTML = hpListHTML;

        // 4. Populate subject accordion list
        let accHTML = '';
        sInfo.list.forEach((sub, sIdx) => {
            let topicRows = '';
            sub.topics.forEach((t, tIdx) => {
                topicRows += `
                    <div class="flex justify-between items-center bg-slate-100/35 dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200/40">
                        <span class="text-[10px] font-medium text-slate-700 dark:text-slate-300">📖 ${t.name}</span>
                        <div class="flex items-center gap-1.5">
                            <select onchange="updateCustomTopicStatus(${sIdx}, ${tIdx}, this.value)" class="p-1 text-[8px] bg-white dark:bg-slate-800 border rounded cursor-pointer font-bold outline-none text-slate-700 dark:text-slate-300">
                                <option value="Pending" ${t.status==='Pending'?'selected':''}>Pending</option>
                                <option value="Studying" ${t.status==='Studying'?'selected':''}>Studying</option>
                                <option value="Completed" ${t.status==='Completed'?'selected':''}>Completed</option>
                                <option value="Weak" ${t.status==='Weak'?'selected':''}>Weak</option>
                                <option value="Revision Needed" ${t.status==='Revision Needed'?'selected':''}>Revision</option>
                                <option value="Mastered" ${t.status==='Mastered'?'selected':''}>Mastered</option>
                            </select>
                            <button onclick="deleteCustomTopic(${sIdx}, ${tIdx})" class="text-[10px] hover:text-rose-500 cursor-pointer p-0.5">🗑️</button>
                        </div>
                    </div>
                `;
            });

            if (topicRows === '') {
                topicRows = `<p class="text-[9px] text-slate-400 italic">No topics inside subject. Click Custom Topic below.</p>`;
            }

            accHTML += `
                <div class="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-750 space-y-2">
                    <div class="flex justify-between items-center text-xs">
                        <div class="font-black text-slate-800 dark:text-slate-150 flex items-center gap-2">
                            <span>📂 ${sub.subject}</span>
                            <span class="text-[9px] text-slate-400 font-bold bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">Weight: ${sub.weightage}%</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="addCustomTopicToSubject(${sIdx})" class="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 hover:bg-emerald-500 rounded text-[9px] font-bold cursor-pointer transition">➕ Topic</button>
                            <button onclick="deleteCustomSubject(${sIdx})" class="text-[11px] hover:text-rose-500 cursor-pointer">🗑️ Delete</button>
                        </div>
                    </div>
                    <!-- Inline subject weighting editor -->
                    <div class="flex items-center gap-1">
                        <span class="text-[8px] text-slate-400 font-bold uppercase">Modify weightage % :</span>
                        <input type="number" value="${sub.weightage}" onchange="updateCustomSubjectWeight(${sIdx}, this.value)" class="w-10 p-0.5 border rounded bg-white dark:bg-slate-900 text-center text-[9px]">
                    </div>
                    <div class="space-y-1.5 pl-2 border-l border-dashed border-slate-300 dark:border-slate-700 pt-1">
                        ${topicRows}
                    </div>
                </div>
            `;
        });
        document.getElementById('syllabus-accordion-container').innerHTML = accHTML;

        // 5. Daily and Weekly Targets metrics display
        let target = getDailyTarget();
        let todayStr = getLocalDateString();
        let solved = (localData.streak[todayStr]||{}).solved||0;
        
        if (plannerDemoModeActive) { solved = 38; }

        let targetPercent = target > 0 ? Math.min(100, Math.round((solved / target) * 100)) : 0;
        document.getElementById('planner-target-fraction').textContent = `${solved} / ${target} Completed`;
        let bar = document.getElementById('planner-target-progress-bar');
        if (bar) {
            bar.style.width = targetPercent + '%';
        }
        
        let streak = getStreakCount();
        if (plannerDemoModeActive) { streak = 18; }
        
        let hasReachedTarget = (solved >= target && target > 0) || (plannerDemoModeActive && 38 >= target);
        let fireHTML = '';
        if (hasReachedTarget) {
            fireHTML = `<span class="planner-streak-fire-icon animate-fire-reached text-sm select-none" onclick="triggerInteractiveFireSpark(event)" title="Daily Target Reached! Tap for epic fire sparks! ⚡">🔥</span>`;
        } else {
            fireHTML = `<span class="planner-streak-fire-icon animate-fire text-xs select-none hover:scale-125 cursor-pointer transition duration-150" onclick="triggerInteractiveFireSpark(event)" title="Progress your daily milestone of ${target} to ignite this fire! Click for sparks.">🔥</span>`;
        }
        document.getElementById('planner-streak-count').innerHTML = `${fireHTML} ${streak} Days Active`;

        // Trigger confetti once target is reached exactly
        if (solved >= target && target > 0) {
            // 1. Separate celebratory sound trigger: plays exactly once upon target completion
            if (!KrishiStorage.getItem('target_sound_played_' + todayStr)) {
                KrishiStorage.setItem('target_sound_played_' + todayStr, 'true');
                if (typeof playSound === 'function') {
                    playSound('celebrate');
                }
            }
            // 2. Separate interactive fire animation/confetti trigger
            if (!KrishiStorage.getItem('confetti_fired_' + todayStr)) {
                KrishiStorage.setItem('confetti_fired_' + todayStr, 'true');
                setTimeout(() => {
                    triggerInteractiveFireSpark(null, true);
                }, 400);
            }
        }

        // 6. Active Spaced Repeater Dashboard Metrics values
        let dueList = window.KrishiSM2Engine ? window.KrishiSM2Engine.getDueQuestions(getAllQuestions()) : [];
        let wrongCountReal = getValidWrongCount();
        
        let dueCountVal = 0;
        let overdueCountVal = 0;
        let upcomingCountVal = 0;
        let masteredCountVal = 0;

        if (window.KrishiSM2Engine) {
            let sm2EngineData = window.KrishiSM2Engine._getData();
            let now = new Date();
            let startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            let endOfToday = startOfToday + (24 * 3600 * 1000) - 1;

            for (let id in sm2EngineData) {
                let node = sm2EngineData[id];
                if (node.status === 'mastered') {
                    masteredCountVal++;
                } else if (node.status !== 'suspended') {
                    if (node.status === 'due') {
                        // Immediately due because of fail
                        dueCountVal++;
                    } else if (node.nextReview) {
                        if (node.nextReview < startOfToday) overdueCountVal++;
                        else if (node.nextReview <= endOfToday) dueCountVal++;
                        else upcomingCountVal++;
                    }
                }
            }
        }

        if (plannerDemoModeActive) {
            dueCountVal = 6;
            overdueCountVal = 3;
            upcomingCountVal = 14;
            masteredCountVal = 21;
        }

        document.getElementById('lbl-review-due').textContent = dueCountVal;
        document.getElementById('lbl-review-overdue').textContent = overdueCountVal;
        document.getElementById('lbl-review-upcoming').textContent = upcomingCountVal;
        document.getElementById('lbl-review-mastered').textContent = masteredCountVal;

        // Update bottom nav Practice Tab badge
        let navPracticeBadge = document.getElementById('nav-practice-badge');
        if (navPracticeBadge) {
            let totalPracticePending = dueCountVal + overdueCountVal + wrongCountReal;
            if (totalPracticePending > 0) {
                navPracticeBadge.textContent = totalPracticePending > 99 ? '99+' : totalPracticePending;
                navPracticeBadge.classList.remove('hidden');
            } else {
                navPracticeBadge.classList.add('hidden');
            }
        }

        // 7. Render Subject Proficiency Matrix Lists
        let matrixHTML = '';
        getAllSubjects().forEach(sub => {
            let stats = localData.stats.subjectStats[sub] || {solved:0, correct:0};
            
            if (plannerDemoModeActive) {
                if (sub.includes("Agronomy")) stats = {solved: 120, correct: 92};
                else if (sub.includes("Soil")) stats = {solved: 80, correct: 34};
                else stats = {solved: 45, correct: 38};
            }

            let acc = stats.solved > 0 ? Math.round((stats.correct/stats.solved)*100) : 0;
            let themeClass = acc >= 80 ? 'bg-emerald-500/10 text-emerald-700' : (acc >= 55 ? 'bg-amber-500/10 text-amber-700' : (stats.solved === 0 ? 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-bold' : 'bg-red-500/10 text-red-700'));
            let ratingText = acc >= 80 ? 'Master' : (acc >= 55 ? 'Improving' : (stats.solved === 0 ? 'Ready to Study' : 'Critical Weakness'));

            matrixHTML += `
                <div class="flex items-center justify-between text-[10px] p-2 hover:bg-slate-50 dark:hover:bg-slate-900 border border-slate-150 dark:border-slate-700 rounded-lg hover-scale">
                    <div class="space-y-0.5">
                        <span class="font-black text-slate-800 dark:text-slate-100">${sub}</span>
                        <p class="text-[8px] text-slate-400 font-bold">${stats.correct} correct of ${stats.solved} attempts</p>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="text-xs font-black text-slate-700 dark:text-slate-200">${acc}%</span>
                        <span class="px-2 py-0.5 text-[7px] font-black uppercase rounded ${themeClass}">${ratingText}</span>
                    </div>
                </div>
            `;
        });
        document.getElementById('planner-proficiency-list').innerHTML = matrixHTML;

        // 8. Render full 15-week matrix heatmap and weekly metrics
        renderMonthlyHeatmap(target);

        // Populate dead Quick Stats elements (Bug 7)
        let quickToday = document.getElementById('planner-quick-today');
        if (quickToday) quickToday.textContent = `${solved}/${target}`;
        
        let quickDays = document.getElementById('planner-quick-days');
        if (quickDays) quickDays.textContent = daysCount > 0 ? daysCount : '--';
        
        let quickStreak = document.getElementById('planner-quick-streak');
        if (quickStreak) quickStreak.textContent = streak;

        // Highlight activePlanMode tabs (Bug 8)
        ['quick', 'normal', 'deep', 'full'].forEach(m => {
            let btn = document.getElementById('pm-tab-' + m);
            if (btn) {
                if (m === activePlanMode) {
                    btn.className = "flex-1 py-1.5 text-[9px] font-black rounded-lg text-white cursor-pointer select-none transition-all border-none outline-none";
                    btn.style.backgroundColor = "var(--primary)";
                } else {
                    btn.className = "flex-1 py-1.5 text-[9px] font-black rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer select-none transition-all border-none outline-none";
                    btn.style.backgroundColor = "";
                }
            }
        });

        // 9. Recalculate Smart Daily schedule details
        generateTodaySmartPlan();
        
        // Apply planner personalization styling/compactness dynamically
        applyPlannerPersonalization();
    }

    function renderMonthlyHeatmap(target) {
        let container = document.getElementById('planner-heatmap-calendar-container');
        if(!container) return;

        let today = new Date();
        let daysOfWeek = 7;
        let totalWeeks = 15;
        let totalDays = totalWeeks * daysOfWeek; // 105 days total display grid

        let html = '';
        let totalSolvedInScope = 0;
        let missedCount = 0;
        let targetCompletedCount = 0;

        for (let i = totalDays - 1; i >= 0; i--) {
            let offsetDate = new Date(today);
            offsetDate.setDate(offsetDate.getDate() - i);
            let stamp = getLocalDateString(offsetDate);
            
            let dayData = localData.streak[stamp] || {solved: 0};
            let solved = dayData.solved;

            if (plannerDemoModeActive) {
                // inject randomized demo values representing high consistency history
                let randIntensity = Math.floor(Math.random() * 6);
                if (i % 8 === 0) solved = 0; // missed
                else if (i % 5 === 0) solved = 10;
                else if (i % 3 === 0) solved = target + 5; // target met
                else solved = Math.floor(target * (randIntensity / 5));
            }

            totalSolvedInScope += solved;
            if (solved === 0) {
                missedCount++;
            }
            if (solved >= target && target > 0) {
                targetCompletedCount++;
            }

            // Decide Intensity Color Class based on solved volume
            let intensityClass = 'bg-slate-100 dark:bg-slate-800'; // level 0 (missed/empty)
            if (solved > 0 && solved < target * 0.3) {
                intensityClass = 'bg-emerald-200 dark:bg-emerald-950/40 text-emerald-800'; // light
            } else if (solved >= target * 0.3 && solved < target * 0.7) {
                intensityClass = 'bg-emerald-450 dark:bg-emerald-800/60 text-emerald-100'; // medium
            } else if (solved >= target * 0.7 && solved < target) {
                intensityClass = 'bg-emerald-650 dark:bg-emerald-600 text-white'; // strong
            } else if (solved >= target) {
                intensityClass = 'bg-emerald-850 dark:bg-emerald-500 font-extrabold text-white'; // target met
            }

            html += `
                <div class="w-4 h-4 rounded-xs text-[7px] flex items-center justify-center cursor-help border border-slate-200/20 ${intensityClass}"
                     title="Date: ${stamp} | Solved: ${solved} questions">
                    ${solved > 0 ? solved : ''}
                </div>
            `;
        }
        container.innerHTML = html;

        // Update Average Solve Value and missed metrics summary indicators
        let avgSolve = totalDays > 0 ? Math.round(totalSolvedInScope / totalDays) : 0;
        let elAvgWeekly = document.getElementById('lbl-heatmap-weekly-avg');
        if (elAvgWeekly) elAvgWeekly.textContent = `Avg Solve: ${avgSolve} / day | Target met: ${targetCompletedCount}d | Off: ${missedCount}d`;

        // Render mini weekly column charts underneath
        let miniChartHTML = '';
        let dayNames = ['S','M','T','W','T','F','S'];
        for (let i = 6; i >= 0; i--) {
            let offsetDate = new Date(today);
            offsetDate.setDate(offsetDate.getDate() - i);
            let stamp = getLocalDateString(offsetDate);
            let dayData = localData.streak[stamp] || {solved: 0};
            let solvedVal = dayData.solved;

            if (plannerDemoModeActive) { 
                solvedVal = i % 2 === 0 ? target + 12 : 12; 
            }

            let heightPercent = target > 0 ? Math.min(100, Math.round((solvedVal / target) * 100)) : 0;
            let themeBarBg = solvedVal >= target ? 'bg-emerald-500' : (solvedVal > 0 ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700');

            miniChartHTML += `
                <div class="flex-1 flex flex-col items-center gap-1 border border-slate-200/20 p-1 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <span class="text-[8px] font-black text-slate-400">${dayNames[offsetDate.getDay()]}</span>
                    <div class="w-3.5 h-16 bg-slate-100 dark:bg-slate-800 rounded-t-lg flex flex-col justify-end overflow-hidden">
                        <div class="w-full ${themeBarBg} transition-all duration-500" style="height: ${heightPercent}%;"></div>
                    </div>
                    <span class="text-[8px] font-black ${solvedVal === 0 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-250'}">${solvedVal === 0 ? '🎯 0' : solvedVal}</span>
                </div>
            `;
        }
        let elWeeklyBarIndicator = document.getElementById('planner-weekly-bar-indicators');
        if (elWeeklyBarIndicator) elWeeklyBarIndicator.innerHTML = miniChartHTML;
    }

    // ==================== RE-ROUTE / ADAPTIVE WRAPPERS ====================
    function renderWeeklyCalendar(){
        // Handled completely in the updated renderMonthlyHeatmap + mini target bar indicators framework
    }
    function startSmartRecommendation(){
        startSmartStudyPlanSession();
    }


    // ==================== EXPANDED STATS & TIMING LOGS ====================
    const KrishiStorageManager = (function() {
        let _timingLog = [];
        let _mockTestScores = [];

        function checkQuotaAndSave() {
            try {
                let timingStr = JSON.stringify(_timingLog);
                // Enforce strict size bound to prevent QuotaExceededError (~250KB)
                while (timingStr.length > 250000 && _timingLog.length > 0) { 
                    _timingLog.shift();
                    timingStr = JSON.stringify(_timingLog);
                }
                KrishiStorage.setItem('krishi_timingLog', timingStr);
                KrishiStorage.setItem('krishi_mockScores', JSON.stringify(_mockTestScores));
            } catch (e) {
                console.warn("[StorageManager] Quota exceeded or save error:", e);
            }
        }

        return {
            get timingLog() { return _timingLog; },
            set timingLog(val) { _timingLog = val; checkQuotaAndSave(); },
            get mockTestScores() { return _mockTestScores; },
            set mockTestScores(val) { _mockTestScores = val; checkQuotaAndSave(); },
            
            recordQuestionTime: function(qid, subject, difficulty, isCorrect, startTime) {
                if(!startTime) return;
                let timeSec = Math.round((Date.now() - startTime)/1000);
                let today = getLocalDateString();
                // `ts` gives each record a unique identity so the cloud merge can key on
                // it; `date` alone is a per-day string and collapsed records together.
                _timingLog.push({qid: qid, timeSec: timeSec, subject: subject, difficulty: difficulty, date: today, correct: isCorrect, ts: Date.now()});
                if(_timingLog.length > 500) _timingLog.shift();
                checkQuotaAndSave();
            },
            recordMockScore: function(acc) {
                _mockTestScores.push(acc); 
                if(_mockTestScores.length > 10) _mockTestScores.shift();
                checkQuotaAndSave();
            },
            loadTimingData: function() {
                try {
                    let log = KrishiStorage.getItem('krishi_timingLog'); 
                    if(log) _timingLog = JSON.parse(log);
                    let scr = KrishiStorage.getItem('krishi_mockScores'); 
                    if(scr) _mockTestScores = JSON.parse(scr);
                } catch(e){
                    console.error("[StorageManager] Error loading data:", e);
                }
            },
            calculatePredictiveScore: function() {
                if(_mockTestScores.length === 0) return null;
                let sum = _mockTestScores.reduce((s, x) => s + x, 0);
                return Math.round(sum / _mockTestScores.length);
            }
        };
    })();

    // Expose proxy functions/variables for backward compatibility within the script scope
    let timingLog = KrishiStorageManager.timingLog;
    let mockTestScores = KrishiStorageManager.mockTestScores;
    let analyticsUseDemoMode = null;
    let analyticsFilterRange = 'all';

    function saveTimingData() {
        KrishiStorageManager.timingLog = timingLog;
        KrishiStorageManager.mockTestScores = mockTestScores;
    }

    function recordQuestionTime(qid, subject, difficulty, isCorrect) {
        KrishiStorageManager.recordQuestionTime(qid, subject, difficulty, isCorrect, questionStartTime);
        timingLog = KrishiStorageManager.timingLog;
    }

    function recordMockScore(acc) {
        KrishiStorageManager.recordMockScore(acc);
        mockTestScores = KrishiStorageManager.mockTestScores;
    }

    function loadTimingData() {
        KrishiStorageManager.loadTimingData();
        timingLog = KrishiStorageManager.timingLog;
        mockTestScores = KrishiStorageManager.mockTestScores;
    }

    function calculatePredictiveScore() {
        return KrishiStorageManager.calculatePredictiveScore();
    }

    function setDemoMode(isDemo) {
        analyticsUseDemoMode = isDemo;
        updateEnhancedAnalyticsPage();
        showToast(isDemo ? 'Using interactive demo data' : 'Using real statistics');
    }

    function setAnalyticsFilter(filter) {
        analyticsFilterRange = filter;
        
        let ranges = ['7', '14', '30', 'all'];
        ranges.forEach(k => {
            let btn = document.getElementById('btn-filter-' + k);
            if(btn) {
                if(k === String(filter)) {
                    btn.className = 'px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-all duration-300 bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-100 cursor-pointer';
                } else {
                    btn.className = 'px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 cursor-pointer';
                }
            }
        });

        updateEnhancedAnalyticsPage();
    }

    function isWithinDays(dateStr, limitDays) {
        if (!limitDays) return true;
        let limitMs = limitDays * 24 * 3600 * 1000;
        let dateMs = new Date(dateStr).getTime();
        let nowMs = Date.now();
        return (nowMs - dateMs) <= limitMs;
    }

    function updateEnhancedAnalyticsPage(){
        let solvedCount = localData.stats.totalSolved || 0;
        if (analyticsUseDemoMode === null) {
            analyticsUseDemoMode = (solvedCount < 20);
        }

        // --- SUB-BLOCK 1: Warning blocks & mode elements ---
        try {
            let solvedCountEl = document.getElementById('lock-solved-count');
            if (solvedCountEl) solvedCountEl.textContent = solvedCount;

            let lockWarning = document.getElementById('analytics-lock-warning');
            if (lockWarning) {
                if (solvedCount < 20 && analyticsUseDemoMode) {
                    lockWarning.classList.remove('hidden');
                } else {
                    lockWarning.classList.add('hidden');
                }
            }

            let demoBanner = document.getElementById('analytics-active-demo-banner');
            if (demoBanner) {
                if (analyticsUseDemoMode) {
                    demoBanner.classList.remove('hidden');
                } else {
                    demoBanner.classList.add('hidden');
                }
            }
        } catch (e) {
            console.warn("Failed updating demo banner or lock warning elements in dashboard:", e);
        }

        // Active range filtering variables
        let solved = 0;
        let correct = 0;
        let limitDays = analyticsFilterRange === 'all' ? null : parseInt(analyticsFilterRange);

        if (analyticsUseDemoMode) {
            solved = 148;
            correct = 124;
            if (limitDays === 7) { solved = 35; correct = 31; }
            else if (limitDays === 14) { solved = 68; correct = 58; }
            else if (limitDays === 30) { solved = 112; correct = 95; }
        } else {
            if (limitDays) {
                let cutOffDate = new Date(Date.now() - limitDays * 24 * 3600 * 1000).toISOString().slice(0,10);
                Object.keys(localData.streak).forEach(dateStr => {
                    if (dateStr >= cutOffDate) {
                        solved += localData.streak[dateStr].solved || 0;
                        correct += localData.streak[dateStr].correct || 0;
                    }
                });
            } else {
                solved = localData.stats.totalSolved || 0;
                correct = localData.stats.totalCorrect || 0;
            }
        }

        // Exam Readiness Score
        let readinessPercent = 0;
        if (analyticsUseDemoMode) {
            readinessPercent = 84;
        } else {
            readinessPercent = solved > 0 ? Math.round((correct / solved) * 100) : 0;
        }

        // --- SUB-BLOCK 2: Exam Readiness Score ---
        try {
            let rdPercentEl = document.getElementById('readiness-percent');
            if (rdPercentEl) rdPercentEl.textContent = readinessPercent;

            let circleStroke = document.getElementById('readiness-circle-stroke');
            if (circleStroke) {
                let offset = 264 * (1 - readinessPercent / 100);
                circleStroke.style.strokeDashoffset = String(offset);
            }

            let rdBadge = document.getElementById('readiness-badge');
            if (rdBadge) {
                let label = "High Risk";
                rdBadge.className = 'inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase mb-3 shadow-sm transition-all duration-300 ';
                if (readinessPercent < 40) {
                    label = "High Risk";
                    rdBadge.className += 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200';
                } else if (readinessPercent < 70) {
                    label = "Progressing";
                    rdBadge.className += 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200';
                } else {
                    label = "Ready";
                    rdBadge.className += 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200';
                }
                rdBadge.textContent = label;
            }

            let rdSummary = document.getElementById('readiness-summary');
            if (rdSummary) {
                if (analyticsUseDemoMode) {
                    rdSummary.textContent = "Analyzing simulated study tracks. Solid competence in Agronomy and Horticulture, while Soil Science requires attention.";
                } else {
                    if (localData.stats.totalSolved < 5) {
                        rdSummary.textContent = "Solve at least 5 questions to generate a dynamic intelligence report advice.";
                    } else if (readinessPercent < 50) {
                        rdSummary.textContent = "High priority: focus on weak topics. Build up accuracy by practicing specific, bite-size modules.";
                    } else if (readinessPercent < 75) {
                        rdSummary.textContent = "On track, but needs consistency. Start practicing hard difficulty questions to boost confidence.";
                    } else {
                        rdSummary.textContent = "Excellent standing! Maintain your daily streak to preserve elite performance metrics.";
                    }
                }
            }
        } catch (e) {
            console.warn("Failed updating readiness card:", e);
        }

        // --- SUB-BLOCK 3: Attempted Items Card ---
        try {
            let totalSolvedEl = document.getElementById('stat-total-solved');
            if (totalSolvedEl) totalSolvedEl.textContent = solved;

            let statSolvedSub = document.getElementById('stat-solved-sub');
            if (statSolvedSub) {
                let todayStr = getLocalDateString();
                let todaySolved = analyticsUseDemoMode ? 12 : ((localData.streak[todayStr] && localData.streak[todayStr].solved) || 0);
                statSolvedSub.textContent = `${todaySolved} today`;
            }
        } catch (e) {
            console.warn("Failed updating attempted items card:", e);
        }

        // --- SUB-BLOCK 4: Overall Accuracy ---
        let accPercent = solved > 0 ? Math.round((correct / solved) * 100) : 0;
        try {
            let statAccuracy = document.getElementById('stat-overall-accuracy');
            if (statAccuracy) statAccuracy.textContent = `${accPercent}%`;

            let statAccuracyTrend = document.getElementById('stat-accuracy-trend');
            if (statAccuracyTrend) {
                if (accPercent >= 80) {
                    statAccuracyTrend.textContent = '▲ Elite';
                    statAccuracyTrend.className = 'font-black flex items-center gap-0.5 text-emerald-600';
                } else if (accPercent >= 50) {
                    statAccuracyTrend.textContent = '▲ Moderate';
                    statAccuracyTrend.className = 'font-black flex items-center gap-0.5 text-amber-500';
                } else if (solved > 0) {
                    statAccuracyTrend.textContent = '▼ Focus Required';
                    statAccuracyTrend.className = 'font-black flex items-center gap-0.5 text-rose-500';
                } else {
                    statAccuracyTrend.textContent = '--';
                    statAccuracyTrend.className = 'font-bold text-slate-400';
                }
            }
        } catch (e) {
            console.warn("Failed updating overall accuracy trend card:", e);
        }

        // --- SUB-BLOCK 5: Response Breakdown segment ---
        try {
            let lblCorrect = document.getElementById('lbl-correct-count');
            if (lblCorrect) lblCorrect.textContent = correct;

            let lblWrong = document.getElementById('lbl-wrong-count');
            let wrong = solved - correct;
            if (lblWrong) lblWrong.textContent = wrong;

            let barCorrect = document.getElementById('bar-correct-segment');
            if (barCorrect) barCorrect.style.width = solved > 0 ? `${(correct / solved) * 100}%` : '0%';

            let barWrong = document.getElementById('bar-wrong-segment');
            if (barWrong) barWrong.style.width = solved > 0 ? `${(wrong / solved) * 100}%` : '0%';
        } catch (e) {
            console.warn("Failed updating response breakdown segment:", e);
        }

        // Times stats setup
        let logs = timingLog;
        if (limitDays) {
            let cutOffDate = new Date(Date.now() - limitDays * 24 * 3600 * 1000).toISOString().slice(0,10);
            logs = timingLog.filter(log => log.date >= cutOffDate);
        }

        let avgTimeStr = '--';
        let fastTimeStr = '--';
        let slowTimeStr = '--';

        if (analyticsUseDemoMode) {
            avgTimeStr = '14s';
            fastTimeStr = '4s';
            slowTimeStr = '42s';
        } else if (logs.length > 0) {
            let totalTime = logs.reduce((sum, log) => sum + log.timeSec, 0);
            avgTimeStr = Math.round(totalTime / logs.length) + 's';
            let times = logs.map(log => log.timeSec);
            fastTimeStr = Math.min(...times) + 's';
            slowTimeStr = Math.max(...times) + 's';
        }

        // --- SUB-BLOCK 6: Times stats ---
        try {
            let elAvgTime = document.getElementById('stat-avg-time');
            if (elAvgTime) elAvgTime.textContent = avgTimeStr;

            let elFastTime = document.getElementById('stat-fast-time');
            if (elFastTime) elFastTime.textContent = fastTimeStr;

            let elSlowTime = document.getElementById('stat-slow-time');
            if (elSlowTime) elSlowTime.textContent = slowTimeStr;
        } catch (e) {
            console.warn("Failed updating times stats card:", e);
        }

        // --- SUB-BLOCK 7: Recommendations ---
        try {
            let recSubEl = document.getElementById('rec-subject');
            let recTopicEl = document.getElementById('rec-topic');
            let recPracticeEl = document.getElementById('rec-practice');
            let recMockEl = document.getElementById('rec-mock');

            if (analyticsUseDemoMode) {
                if (recSubEl) recSubEl.textContent = 'Soil Science';
                if (recTopicEl) recTopicEl.textContent = 'Soil profile and soil horizon elements';
                if (recPracticeEl) recPracticeEl.textContent = 'Practice 15 specialized MCQs';
                if (recMockEl) recMockEl.textContent = 'Take a dedicated Soil Chemistry Mock Test';
            } else {
                let weakInfo = getWeakestSubject();
                let weakSub = weakInfo.hasData ? weakInfo.subject : 'Fundamentals';
                let leastAcc = weakInfo.hasData ? weakInfo.accuracy : 100;

                if (recSubEl) recSubEl.textContent = weakSub;
                if (recTopicEl) recTopicEl.textContent = `Revise core concepts of ${weakSub} structures`;
                if (recPracticeEl) recPracticeEl.textContent = `Solve 10 random ${weakSub} MCQs`;
                if (recMockEl) recMockEl.textContent = 'Take a quick targeted practice session';
            }
        } catch (e) {
            console.warn("Failed updating recommendations card:", e);
        }

        // Diagnoses prep
        let weakList = [];
        let strongList = [];

        if (analyticsUseDemoMode) {
            weakList = [
                { sub: 'Soil Science', acc: 48, solved: 25 },
                { sub: 'Plant Pathology', acc: 42, solved: 12 }
            ];
            strongList = [
                { sub: 'Agronomy', acc: 92, solved: 45 },
                { sub: 'Horticulture', acc: 88, solved: 30 },
                { sub: 'Entomology', acc: 85, solved: 20 }
            ];
        } else {
            let subjects = getAllSubjects();
            subjects.forEach(sub => {
                let s = localData.stats.subjectStats[sub] || {solved:0, correct:0};
                if (s.solved > 0) {
                    let acc = Math.round((s.correct / s.solved) * 100);
                    let dynamicWeakThreshold = getPlannerSettings().weakThreshold || 60;
                    if (acc < dynamicWeakThreshold) {
                        weakList.push({sub: sub, acc: acc, solved: s.solved});
                    } else if (acc >= 75) {
                        strongList.push({sub: sub, acc: acc, solved: s.solved});
                    }
                }
            });
        }

        // --- SUB-BLOCK 8: Diagnosis ---
        try {
            let dWeakEl = document.getElementById('diagnose-weak-topics');
            if (dWeakEl) {
                dWeakEl.innerHTML = weakList.length > 0 ? weakList.map(item => `
                    <div class="flex items-center justify-between text-[11px] p-2 bg-slate-50 dark:bg-slate-950/20 border border-slate-150 dark:border-slate-800 rounded-lg">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="h-2 w-2 rounded-full bg-rose-500 shrink-0"></span>
                            <span class="font-bold text-slate-700 dark:text-slate-300 truncate">${item.sub}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] text-slate-400">(${item.solved} solved)</span>
                            <span class="font-bold text-rose-500 shrink-0">${item.acc}% acc</span>
                        </div>
                    </div>
                `).join('') : '<p class="text-[10px] text-slate-500 text-center py-2">No weak subjects detected yet!</p>';
            }

            let dStrongEl = document.getElementById('diagnose-strong-topics');
            if (dStrongEl) {
                dStrongEl.innerHTML = strongList.length > 0 ? strongList.map(item => `
                    <div class="flex items-center justify-between text-[11px] p-2 bg-slate-50 dark:bg-slate-950/20 border border-slate-150 dark:border-slate-800 rounded-lg">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="h-2 w-2 rounded-full bg-emerald-500 shrink-0"></span>
                            <span class="font-bold text-slate-700 dark:text-slate-300 truncate">${item.sub}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] text-slate-400">(${item.solved} solved)</span>
                            <span class="font-bold text-emerald-500 shrink-0">${item.acc}% acc</span>
                        </div>
                    </div>
                `).join('') : '<p class="text-[10px] text-slate-500 text-center py-2">Solve more questions to discover your strong subjects!</p>';
            }

            let repMistakeEl = document.getElementById('rec-repeated-mistake');
            if (repMistakeEl) {
                if (analyticsUseDemoMode) {
                    repMistakeEl.textContent = "You missed 'Soil profile and horizon layers' 3 times in your simulated tests.";
                } else {
                    let _filteredWr = getValidWrongCount();
                    if (_filteredWr > 0) {
                        repMistakeEl.textContent = `You currently have ${_filteredWr} pending incorrect questions requiring correction.`;
                    } else {
                        repMistakeEl.textContent = "No repeated errors found! Keeping a pristine progress record.";
                    }
                }
            }
        } catch (e) {
            console.warn("Failed updating diagnoses lists inside dashboard:", e);
        }

        // --- SUB-BLOCK 9: Subject mastery detailed grid with fallback warning ---
        try {
            let subGridEl = document.getElementById('analytics-subjects-v2');
            if (subGridEl) {
                let subjects = getAllSubjects();
                subGridEl.innerHTML = subjects.map(sub => {
                    let solvedCount = 0;
                    let correctCount = 0;
                    
                    if (analyticsUseDemoMode) {
                        if (sub === 'Agronomy') { solvedCount = 45; correctCount = 41; }
                        else if (sub === 'Horticulture') { solvedCount = 30; correctCount = 26; }
                        else if (sub === 'Soil Science') { solvedCount = 25; correctCount = 12; }
                        else if (sub === 'Plant Pathology') { solvedCount = 12; correctCount = 5; }
                        else { solvedCount = 10; correctCount = 6; }
                    } else {
                        let s = localData.stats.subjectStats[sub] || {solved:0, correct:0};
                        solvedCount = s.solved;
                        correctCount = s.correct;
                    }
                    
                    let acc = solvedCount > 0 ? Math.round((correctCount / solvedCount) * 100) : 0;
                    let colorClass = acc >= 75 ? 'bg-emerald-500' : (acc >= 50 ? 'bg-amber-500' : 'bg-rose-500');
                    let textClass = acc >= 75 ? 'text-emerald-600' : (acc >= 50 ? 'text-amber-500' : 'text-rose-500');
                    
                    return `
                        <div onclick="showSubjectDetailsModal('${sub}', ${solvedCount}, ${correctCount}, ${acc})" class="p-3 bg-slate-50 dark:bg-slate-950/20 rounded-xl border border-slate-150 dark:border-slate-800 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all duration-300 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div class="flex-1 min-w-0">
                                <span class="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5 truncate">
                                    📚 ${sub}
                                </span>
                                <div class="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                    <span>Solved: <strong>${solvedCount}</strong></span>
                                    <span>•</span>
                                    <span>Correct: <strong>${correctCount}</strong></span>
                                </div>
                            </div>
                            <div class="flex items-center gap-4">
                                <!-- Progress Bar -->
                                <div class="w-32 bg-slate-150 dark:bg-slate-800 h-2 rounded-full hidden md:block overflow-hidden">
                                    <div class="h-full ${colorClass}" style="width: ${acc}%"></div>
                                </div>
                                <span class="text-xs font-black ${textClass} shrink-0">${acc}% Accuracy</span>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                console.warn("Debug: 'analytics-subjects-v2' element is missing from the DOM. Skipping subject mastery grid render.");
            }
        } catch (e) {
            console.warn("Failed updating subject mastery detailed grid:", e);
        }

        // Difficult breakdown indexes
        let easySolved = 0, easyCorrect = 0;
        let mediumSolved = 0, mediumCorrect = 0;
        let hardSolved = 0, hardCorrect = 0;

        if (analyticsUseDemoMode) {
            easySolved = 50; easyCorrect = 48;
            mediumSolved = 60; mediumCorrect = 49;
            hardSolved = 38; hardCorrect = 22;
        } else {
            timingLog.forEach(log => {
                let diff = (log.difficulty || 'Easy').toLowerCase();
                let isCorr = log.correct !== undefined ? log.correct : true;
                if (diff === 'easy') {
                    easySolved++;
                    if (isCorr) easyCorrect++;
                } else if (diff === 'medium') {
                    mediumSolved++;
                    if (isCorr) mediumCorrect++;
                } else if (diff === 'hard') {
                    hardSolved++;
                    if (isCorr) hardCorrect++;
                }
            });
        }

        let easyAcc = easySolved > 0 ? Math.round((easyCorrect / easySolved) * 100) : 0;
        let mediumAcc = mediumSolved > 0 ? Math.round((mediumCorrect / mediumSolved) * 100) : 0;
        let hardAcc = hardSolved > 0 ? Math.round((hardCorrect / hardSolved) * 100) : 0;

        // --- SUB-BLOCK 10: Difficulty level breakdown cards ---
        try {
            let elEasyAcc = document.getElementById('diff-easy-acc');
            let barEasy = document.getElementById('bar-diff-easy');
            if (elEasyAcc) elEasyAcc.textContent = `${easyAcc}%`;
            if (barEasy) barEasy.style.width = `${easyAcc}%`;

            let elMediumAcc = document.getElementById('diff-medium-acc');
            let barMedium = document.getElementById('bar-diff-medium');
            if (elMediumAcc) elMediumAcc.textContent = `${mediumAcc}%`;
            if (barMedium) barMedium.style.width = `${mediumAcc}%`;

            let elHardAcc = document.getElementById('diff-hard-acc');
            let barHard = document.getElementById('bar-diff-hard');
            if (elHardAcc) elHardAcc.textContent = `${hardAcc}%`;
            if (barHard) barHard.style.width = `${hardAcc}%`;
        } catch (e) {
            console.warn("Failed updating difficulty level breakdowns:", e);
        }

        // --- SUB-BLOCK 11: Draw and update charts ---
        // Debounce canvas redraws to ensure tab slide transitions execute at a solid 60fps/120Hz
        if (window.analyticsDebounceTimeout) {
            clearTimeout(window.analyticsDebounceTimeout);
        }
        window.analyticsDebounceTimeout = setTimeout(() => {
            try {
                drawGrowthChart();
            } catch (e) {
                console.warn("Failed drawing growth chart:", e);
            }
            
            try {
                drawRadarChart();
            } catch (e) {
                console.warn("Failed drawing radar chart:", e);
            }

            try {
                drawHeatmapCalendar();
            } catch (e) {
                console.warn("Failed drawing heatmap calendar:", e);
            }
        }, 150);

        // --- SUB-BLOCK 12: Refresh lucide icons ---
        try {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } catch (e) {
            console.warn("Failed calling lucide.createIcons():", e);
        }
    }

    
// Function drawGrowthChart moved to external module


    
// Function drawRadarChart moved to external module


    
// Function drawHeatmapCalendar moved to external module


    function showSubjectDetailsModal(sub, solved, correct, acc) {
        let titleEl = document.getElementById('sub-modal-title');
        let fileContentEl = document.getElementById('sub-modal-content');
        let practiceBtn = document.getElementById('sub-modal-practice-btn');
        let overlay = document.getElementById('subject-modal-overlay');
        
        if (titleEl) titleEl.textContent = `Subject Insights: ${sub}`;
        
        let strengthMessage = "";
        if (acc >= 75) {
            strengthMessage = "🌟 <strong>Super Power:</strong> You have solid control over this subject. Keep doing quick spaced-repetition refreshers to maintain top status!";
        } else if (acc >= 50) {
            strengthMessage = "📈 <strong>Progressing:</strong> Solid foundations established. Work on Medium and Hard difficulty level questions to build complete subject mastery.";
        } else {
            strengthMessage = "⚠️ <strong>High Priority Revision Required:</strong> Understanding this subject is critical to improving overall readiness. Run focused practice sessions on 'Easy' questions to secure safe marks first.";
        }
        
        if (fileContentEl) {
            fileContentEl.innerHTML = `
                <div class="space-y-4 text-xs">
                    <div class="grid grid-cols-3 gap-3 text-center bg-slate-50 dark:bg-slate-950/20 p-3 rounded-xl border border-slate-150 dark:border-slate-800">
                        <div>
                            <span class="text-[9px] text-slate-400 font-bold block">TOTAL ITEMS</span>
                            <span class="text-base font-black text-slate-800 dark:text-slate-200">${solved}</span>
                        </div>
                        <div>
                            <span class="text-[9px] text-slate-400 font-bold block">CORRECT</span>
                            <span class="text-base font-black text-emerald-600">${correct}</span>
                        </div>
                        <div>
                            <span class="text-[9px] text-slate-400 font-bold block">ACCURACY</span>
                            <span class="text-base font-black text-indigo-500">${acc}%</span>
                        </div>
                    </div>
                    <div class="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl space-y-1">
                        <span class="font-bold text-indigo-600 dark:text-indigo-400">Preparation Diagnosis</span>
                        <p class="text-slate-600 dark:text-slate-400 leading-relaxed text-[11px]">${strengthMessage}</p>
                    </div>
                </div>
            `;
        }
        
        if (practiceBtn) {
            practiceBtn.setAttribute('onclick', `closeSubjectDetailsModal(); startPractice('${sub}', 10);`);
        }
        
        if (overlay) {
            overlay.classList.remove('hidden');
            setTimeout(() => {
                overlay.classList.remove('opacity-0');
                let inner = overlay.querySelector('.transform');
                if (inner) {
                    inner.classList.remove('scale-95');
                    inner.classList.add('scale-100');
                }
            }, 10);
        }
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    function closeSubjectDetailsModal() {
        let overlay = document.getElementById('subject-modal-overlay');
        if (overlay) {
            overlay.classList.add('opacity-0');
            let inner = overlay.querySelector('.transform');
            if (inner) {
                inner.classList.remove('scale-100');
                inner.classList.add('scale-95');
            }
            setTimeout(() => {
                overlay.classList.add('hidden');
            }, 300);
        }
    }

    // ==================== FILE SYNC BACKUPS DUMMIES ====================
    async function generateAIQuestions() {
        let text = document.getElementById('file-extracted-text').value.trim();
        if(!text) { showToast('Text extracted empty!'); return; }
        let key = getApiKey(); if(!key){ showToast('Enter API key inside settings first!'); return; }
        
        let status = document.getElementById('ai-status'); status.classList.remove('hidden'); status.textContent = 'Generating...';
        let prompt = `Analyze the provided text and generate 3 multiple-choice questions based on it. CRITICAL INSTRUCTION: You MUST generate the questions and options in the EXACT SAME LANGUAGE as the provided text (e.g., if the text is in Nepali, generate Nepali questions in Devanagari script). 
Format strictly as a JSON array of objects. Each object must have:
- "q": The question string.
- "opts": An array of exactly 4 option strings.
- "ans": The integer index (0 to 3) of the correct option.
- "sub": A short string for the subject category.
Do not wrap in markdown. ONLY return valid JSON array.

Text:
${text}`;
        
        try {
            const model = getGeminiModel();
            const temp = getGeminiTemp();
            let res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: temp } })
            });
            
            if (!res.ok) {
                if (res.status === 429) throw new Error('API Quota Exceeded (429). Please wait a moment before trying again.');
                if (res.status === 400) throw new Error('Invalid API Key (400). Please check your Gemini settings.');
            }

            let d = await res.json();
            if (d.error) {
                throw new Error(d.error.message || 'Gemini API call failed.');
            }
            if (!d.candidates || d.candidates.length === 0 || !d.candidates[0].content || !d.candidates[0].content.parts || d.candidates[0].content.parts.length === 0) {
                throw new Error('API returned an empty response. This can happen if the prompt was flagged by safety filters.');
            }
            
            let rawText = d.candidates[0].content.parts[0].text;
            if (!rawText || rawText.trim().length === 0) {
                throw new Error('Empty text content received from Gemini.');
            }
            
            let cleanJSON = rawText.trim();
            // Remove markdown code fences if present (e.g. ```json ... ``` or ``` ... ```)
            if (cleanJSON.startsWith('```')) {
                cleanJSON = cleanJSON.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '');
            }
            cleanJSON = cleanJSON.trim();
            
            // Find valid JSON array boundaries safely
            let startIdx = cleanJSON.indexOf('[');
            let endIdx = cleanJSON.lastIndexOf(']');
            if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
                throw new Error('Could not locate a valid JSON questions array in the response structure.');
            }
            
            let questionsJsonStr = cleanJSON.substring(startIdx, endIdx + 1);
            let questions;
            try {
                questions = JSON.parse(questionsJsonStr);
            } catch(e) {
                console.error('[PWA AI] Raw JSON parsing failed:', e);
                throw new Error('The generated text contained malformed JSON elements: ' + e.message);
            }
            
            if (!Array.isArray(questions)) {
                throw new Error('Expected JSON array of questions, but received a different data type.');
            }
            
            if (questions.length === 0) {
                throw new Error('API generated 0 questions. Please try again with a different text section.');
            }
            
            // Validate and normalize generated questions structure
            questions.forEach((q, i) => {
                q.id = Date.now() + i;
                q.q = q.q || q.question || 'Untitled Question';
                q.opts = q.opts || q.options || ['Option A', 'Option B', 'Option C', 'Option D'];
                if (!Array.isArray(q.opts) || q.opts.length < 2) {
                    q.opts = ['Option A', 'Option B', 'Option C', 'Option D'];
                }
                q.ans = (q.ans !== undefined) ? parseInt(q.ans) : ((q.correctAnswerIndex !== undefined) ? parseInt(q.correctAnswerIndex) : 0);
                if (isNaN(q.ans) || q.ans < 0 || q.ans >= q.opts.length) {
                    q.ans = 0;
                }
                q.sub = q.sub || q.category || 'General';
            });
            
            state.tempGeneratedQuestions = questions;
            showEditMCQPage(questions);
            navigate('page-edit-mcq');
            status.textContent = '✅ Conversion successful!';
        } catch(err){
            console.error('[PWA AI] Question generation failed:', err);
            status.textContent = `⚠️ Failed: ${err.message}`;
            showToast(`⚠️ AI Generation Error: ${err.message}`, 5000);
        }
    }

    function collectAllAppData() {
        const payload = {
            updatedAt: Date.now()
        };

        // Profile identity always rides along (not gated by selective sync) — it is who the account is
        payload.userProfile = {
            name: (KrishiStorage.getItem(PROFILE_NAME_KEY) || '').trim(),
            photo: KrishiStorage.getItem(PROFILE_PHOTO_KEY) || '',
            updatedAt: Number(KrishiStorage.getItem(PROFILE_STAMP_KEY) || 0)
        };

        if (syncSelectiveBookmarks) {
            payload.bookmarked = localData.bookmarked || [];
            payload.bookmarkedLog = localData.bookmarkedLog || {};
        }
        if (syncSelectiveErrors) {
            payload.wrong = localData.wrong || [];
            payload.wrongLog = localData.wrongLog || {};
        }
        if (syncSelectiveCustom) {
            // Only ship the question bank once it is proven to reflect IndexedDB. An
            // unhydrated or unreadable bank is [], and uploading that empty array is
            // how the cloud copy used to get erased. Omitting the key is safe because
            // every users/{uid} write merges.
            if (customQuestionsHydrated && Array.isArray(localData.customQuestions)) {
                payload.customQuestions = localData.customQuestions;
            }
        }
        if (syncSelectiveLogs) {
            payload.streak = localData.streak || {};
            payload.stats = localData.stats || {};
            payload.achievements = localData.achievements || [];
            payload.progression = localData.progression || { xp: 0 };
            // Omit rather than send {} — an unloaded SM2 module must not blank the
            // cloud copy of all spaced-repetition scheduling state.
            if (window.KrishiSM2Engine) payload.sm2 = window.KrishiSM2Engine._getData();
            
            // config data packs
            payload.examProfiles = safeJsonParse(KrishiStorage.getItem('krishi_exam_profiles'), []);
            payload.homeSettings = safeJsonParse(KrishiStorage.getItem('krishi_home_settings'), {});
            payload.appearanceSettings = safeJsonParse(KrishiStorage.getItem('krishi_appearance_settings'), {});
            payload.customAppearanceSettings = safeJsonParse(KrishiStorage.getItem('krishi_custom_appearance_settings'), {});
            payload.plannerSettings = safeJsonParse(KrishiStorage.getItem('krishi_planner_settings'), {});
            payload.syllabusCustom = safeJsonParse(KrishiStorage.getItem('krishi_syllabus_custom'), []);
            payload.timingLog = safeJsonParse(KrishiStorage.getItem('krishi_timingLog'), []);
            payload.mockScores = safeJsonParse(KrishiStorage.getItem('krishi_mockScores'), []);
            payload.practiceRecent = safeJsonParse(KrishiStorage.getItem('krishi_practice_recent'), []);
            payload.goalSettings = safeJsonParse(KrishiStorage.getItem('krishi_goal_settings'), {});
            payload.customSubjects = safeJsonParse(KrishiStorage.getItem('krishi_custom_subjects'), []);
            payload.customSubjectsLog = safeJsonParse(KrishiStorage.getItem(SUBJECT_LOG_KEY), {});
            payload.layoutBackups = safeJsonParse(KrishiStorage.getItem('krishi_layout_backups'), []);
            payload.lastPracticeConfig = safeJsonParse(KrishiStorage.getItem('krishi_last_practice_config'), {});
            payload.soundEnabled = KrishiStorage.getItem('krishi_sound_enabled');
            payload.soundMuted = KrishiStorage.getItem('krishi_sound_muted');
            payload.soundVolume = KrishiStorage.getItem('krishi_sound_volume');
            payload.dark = KrishiStorage.getItem('krishi_dark');
            payload.batterySaver = KrishiStorage.getItem('krishi_battery_saver');
            payload.hapticEnabled = KrishiStorage.getItem('krishi_haptic_enabled');
            payload.eliteAnimations = KrishiStorage.getItem('krishi_elite_animations');
            payload.difficultyBias = KrishiStorage.getItem('krishi_difficulty_bias');
            payload.intensityMode = KrishiStorage.getItem('krishi_intensity_mode');
            payload.activePlanMode = KrishiStorage.getItem('krishi_active_plan_mode');
            payload.retryDelay = KrishiStorage.getItem('krishi_retry_delay');
            // Per-setting write clocks travel with the settings they order.
            payload.settingStamps = getSettingStamps();
        }

        if (window.currentAuthUser && window.currentAuthUser.uid) {
            payload.ownerUid = window.currentAuthUser.uid;
        } else if (firebaseAuth && firebaseAuth.currentUser) {
            payload.ownerUid = firebaseAuth.currentUser.uid;
        }

        return payload;
    }

    // Guards every incoming collection against the one pattern that destroys data:
    // an empty (or degenerate) value arriving for a collection that is currently
    // populated. [] is an Array and {} is an object, so a plain type check accepts
    // them; this refuses them unless the local side is empty too.
    function isSafeIncomingCollection(incoming, current, label) {
        if (Array.isArray(incoming)) {
            const currentLen = Array.isArray(current) ? current.length : 0;
            if (incoming.length === 0 && currentLen > 0) {
                console.warn('[Cloud Sync] Rejected empty "' + label + '" from payload; keeping ' + currentLen + ' local entries.');
                return false;
            }
            return true;
        }
        if (incoming && typeof incoming === 'object') {
            const incomingKeys = Object.keys(incoming).length;
            const currentKeys = (current && typeof current === 'object') ? Object.keys(current).length : 0;
            if (incomingKeys === 0 && currentKeys > 0) {
                console.warn('[Cloud Sync] Rejected empty "' + label + '" from payload; keeping ' + currentKeys + ' local keys.');
                return false;
            }
            return true;
        }
        return false;
    }

    // Same protection as isSafeIncomingCollection, for the collections that are stored
    // directly in KrishiStorage instead of in localData. Array.isArray([]) is true, so
    // the plain type checks these replaced happily overwrote a populated history with
    // an empty one.
    function setJSONArraySafely(key, incoming, label) {
        if (!Array.isArray(incoming)) return;
        if (incoming.length === 0) {
            let currentLen = 0;
            try {
                const parsed = JSON.parse(KrishiStorage.getItem(key) || '[]');
                if (Array.isArray(parsed)) currentLen = parsed.length;
            } catch(e) { currentLen = 0; }
            if (currentLen > 0) {
                console.warn('[Cloud Sync] Rejected empty "' + label + '"; keeping ' + currentLen + ' stored entries.');
                return;
            }
        }
        KrishiStorage.setItem(key, JSON.stringify(incoming));
    }

    function applyAllAppData(data) {
        if (!data) return;

        // Capture current appearance settings before overwriting (for diff check below)
        const _prevAppearanceJSON = KrishiStorage.getItem('krishi_appearance_settings') || '';
        const _prevCustomAppearanceJSON = KrishiStorage.getItem('krishi_custom_appearance_settings') || '';

        let changed = false;
        // customQuestionsChanged is tracked separately: the IndexedDB write below is a
        // clear-then-rewrite and must never fire just because an unrelated field changed.
        let customQuestionsChanged = false;
        if (syncSelectiveBookmarks && isSafeIncomingCollection(data.bookmarked, localData.bookmarked, 'bookmarked')) { localData.bookmarked = data.bookmarked; changed = true; }
        if (syncSelectiveBookmarks && isSafeIncomingCollection(data.bookmarkedLog, localData.bookmarkedLog, 'bookmarkedLog') && !Array.isArray(data.bookmarkedLog)) { localData.bookmarkedLog = data.bookmarkedLog; changed = true; }
        if (syncSelectiveErrors && isSafeIncomingCollection(data.wrong, localData.wrong, 'wrong')) { localData.wrong = data.wrong; changed = true; }
        if (syncSelectiveErrors && isSafeIncomingCollection(data.wrongLog, localData.wrongLog, 'wrongLog') && !Array.isArray(data.wrongLog)) { localData.wrongLog = data.wrongLog; changed = true; }
        // The question bank is only replaced once the local copy is hydrated, so an
        // unhydrated [] can never be "confirmed" as the new truth.
        if (syncSelectiveCustom && customQuestionsHydrated && isSafeIncomingCollection(data.customQuestions, localData.customQuestions, 'customQuestions')) {
            localData.customQuestions = data.customQuestions;
            changed = true;
            customQuestionsChanged = true;
        }

        if (syncSelectiveLogs) {
            if (isSafeIncomingCollection(data.streak, localData.streak, 'streak') && !Array.isArray(data.streak)) { localData.streak = data.streak; changed = true; }
            if (isSafeIncomingCollection(data.stats, localData.stats, 'stats') && !Array.isArray(data.stats)) {
                localData.stats = data.stats;
                KrishiStorage.setItem('krishi_stats_baseline', JSON.stringify(data.stats));
                changed = true;
            }
            if (isSafeIncomingCollection(data.achievements, localData.achievements, 'achievements')) { localData.achievements = data.achievements; changed = true; }
            if (isSafeIncomingCollection(data.progression, localData.progression, 'progression') && !Array.isArray(data.progression)) { localData.progression = data.progression; changed = true; }

            if (data.sm2 && typeof data.sm2 === 'object' && Object.keys(data.sm2).length > 0) {
                if (window.KrishiSM2Engine) window.KrishiSM2Engine._saveData(data.sm2);
                changed = true;
            }
        }

        // Profile identity — newest write wins, so a stale cloud copy never overwrites a fresh local edit
        if (data.userProfile && typeof data.userProfile === 'object') {
            const cloudStamp = Number(data.userProfile.updatedAt || 0);
            const localStamp = Number(KrishiStorage.getItem(PROFILE_STAMP_KEY) || 0);
            if (cloudStamp >= localStamp) {
                if (typeof data.userProfile.name === 'string') {
                    KrishiStorage.setItem(PROFILE_NAME_KEY, data.userProfile.name.trim());
                }
                if (typeof data.userProfile.photo === 'string') {
                    if (data.userProfile.photo) KrishiStorage.setItem(PROFILE_PHOTO_KEY, data.userProfile.photo);
                    else KrishiStorage.removeItem(PROFILE_PHOTO_KEY);
                }
                if (cloudStamp) KrishiStorage.setItem(PROFILE_STAMP_KEY, cloudStamp);
                renderProfileIdentity();
                refreshHomeGreeting();
            }
        }

        // Save localData keys
        if (changed) {
            Object.entries(localData).forEach(([k,v]) => {
                if (k !== 'customQuestions') {
                    Storage.setJSON('krishi_'+k, v);
                }
            });
            
            // Write custom questions to IndexedDB asynchronously.
            // Only when the payload actually carried questions (customQuestionsChanged) —
            // saveAll() clears the store first, so firing it on an unrelated bookmark
            // change used to rewrite the whole bank from possibly-stale memory.
            if (syncSelectiveCustom && customQuestionsChanged && customQuestionsHydrated && Array.isArray(localData.customQuestions)) {
                KrishiDB.saveAll(localData.customQuestions)
                    .then(() => console.log('[IndexedDB] Custom questions saved successfully.'))
                    .catch(err => console.error('[IndexedDB] Custom questions save failed:', err));
            }
        }
        
        if (syncSelectiveLogs) {
            // Save extra config lists
            if (Array.isArray(data.examProfiles)) setJSONArraySafely('krishi_exam_profiles', data.examProfiles, 'examProfiles');
            if (data.homeSettings) KrishiStorage.setItem('krishi_home_settings', JSON.stringify(data.homeSettings));
            if (data.appearanceSettings) KrishiStorage.setItem('krishi_appearance_settings', JSON.stringify(data.appearanceSettings));
            if (data.customAppearanceSettings) KrishiStorage.setItem('krishi_custom_appearance_settings', JSON.stringify(data.customAppearanceSettings));
            if (data.plannerSettings) KrishiStorage.setItem('krishi_planner_settings', JSON.stringify(data.plannerSettings));
            setJSONArraySafely('krishi_syllabus_custom', data.syllabusCustom, 'syllabusCustom');
            setJSONArraySafely('krishi_timingLog', data.timingLog, 'timingLog');
            setJSONArraySafely('krishi_mockScores', data.mockScores, 'mockScores');
            setJSONArraySafely('krishi_practice_recent', data.practiceRecent, 'practiceRecent');
            
            if (data.soundEnabled !== undefined && data.soundEnabled !== null) KrishiStorage.setItem('krishi_sound_enabled', data.soundEnabled);
            if (data.soundMuted !== undefined && data.soundMuted !== null) KrishiStorage.setItem('krishi_sound_muted', data.soundMuted);
            if (data.soundVolume !== undefined && data.soundVolume !== null) KrishiStorage.setItem('krishi_sound_volume', data.soundVolume);

            if (data.dark !== undefined && data.dark !== null) {
                const isDark = (data.dark === 'true' || data.dark === true);
                KrishiStorage.setItem('krishi_dark', isDark);
                if (isDark) document.documentElement.classList.add('dark');
                else document.documentElement.classList.remove('dark');
            }
            if (data.batterySaver !== undefined && data.batterySaver !== null) {
                KrishiStorage.setItem('krishi_battery_saver', data.batterySaver);
            }

            if (data.goalSettings) KrishiStorage.setItem('krishi_goal_settings', JSON.stringify(data.goalSettings));
            if (data.lastPracticeConfig) KrishiStorage.setItem('krishi_last_practice_config', JSON.stringify(data.lastPracticeConfig));
            setJSONArraySafely('krishi_custom_subjects', data.customSubjects, 'customSubjects');
            if (data.customSubjectsLog && typeof data.customSubjectsLog === 'object') {
                KrishiStorage.setItem(SUBJECT_LOG_KEY, JSON.stringify(data.customSubjectsLog));
            }
            // Persist the merged write clocks, otherwise the next merge on this device
            // compares the incoming value against a stale stamp and flips it straight back.
            if (data.settingStamps && typeof data.settingStamps === 'object') {
                KrishiStorage.setItem(SETTING_STAMPS_KEY, JSON.stringify(data.settingStamps));
            }
            setJSONArraySafely('krishi_layout_backups', data.layoutBackups, 'layoutBackups');

            [['hapticEnabled',  'krishi_haptic_enabled'],
             ['eliteAnimations','krishi_elite_animations'],
             ['difficultyBias', 'krishi_difficulty_bias'],
             ['intensityMode',  'krishi_intensity_mode'],
             ['activePlanMode', 'krishi_active_plan_mode'],
             ['retryDelay',     'krishi_retry_delay']].forEach(([field, key]) => {
                if (data[field] !== undefined && data[field] !== null) {
                    KrishiStorage.setItem(key, data[field]);
                }
            });
        }
        
        // Reload state into active memory (no DOM involvement)
        loadData();
        loadTimingData();
        if (typeof initPracticeSoundSettings === 'function') initPracticeSoundSettings();

        // ── Mark dirty modules based on what actually changed ──────────────
        // applyAllAppData() no longer triggers UI renders directly.
        // krishiScheduleSyncRender() (called by onSnapshot after this) will
        // render only the currently visible page in a single RAF frame.
        // navigate() always re-renders the target page, so inactive pages
        // will never show stale data when the user visits them.
        if (syncSelectiveBookmarks && (Array.isArray(data.bookmarked) || data.bookmarkedLog)) {
            _krishiDirty.home     = true;
            _krishiDirty.practice = true;
        }
        if (syncSelectiveErrors && (Array.isArray(data.wrong) || data.wrongLog)) {
            _krishiDirty.home     = true;
            _krishiDirty.practice = true;
        }
        if (syncSelectiveCustom && Array.isArray(data.customQuestions)) {
            _krishiDirty.questions = true;
            _krishiDirty.practice  = true;
        }
        if (syncSelectiveLogs) {
            if (data.streak)      { _krishiDirty.home = true; _krishiDirty.planner = true; }
            if (data.stats)       { _krishiDirty.home = true; _krishiDirty.practice = true; }
            if (data.achievements){ _krishiDirty.home = true; }
            if (data.progression) { _krishiDirty.home = true; }
            if (data.examProfiles){ _krishiDirty.profiles = true; }
            if (data.plannerSettings) { _krishiDirty.planner = true; }
            if (data.appearanceSettings || data.customAppearanceSettings) {
                // Only mark appearance dirty if settings actually changed (prevents
                // unnecessary CSS variable storm + full document style recalculation)
                const _newAppearanceJSON = KrishiStorage.getItem('krishi_appearance_settings') || '';
                const _newCustomAppearanceJSON = KrishiStorage.getItem('krishi_custom_appearance_settings') || '';
                if (_prevAppearanceJSON !== _newAppearanceJSON || _prevCustomAppearanceJSON !== _newCustomAppearanceJSON) {
                    _krishiDirty.appearance = true;
                    _krishiDirty.home       = true;
                }
            }
        }
    }

    function mergeCloudAndLocalData(cloud) {
        cloud = cloud || {};
        // Normalize the compressed fields BEFORE anything reads them, and do it on the
        // field's actual type rather than on the isCompressed flag (which can be stale).
        // If a compressed field cannot be decoded we abort the whole merge: letting a
        // string reach .forEach() below threw an uncaught TypeError that latched
        // syncInProgress and silently killed sync for the rest of the session, and
        // substituting [] would push the local copy over the cloud's real history.
        ['timingLog', 'mockScores'].forEach(field => {
            if (typeof cloud[field] === 'string') {
                if (typeof LZString === 'undefined' || !LZString.decompressFromUTF16) {
                    throw new Error('[Sync] Cannot read compressed ' + field + ': LZString unavailable. Sync skipped to protect existing history.');
                }
                try {
                    cloud[field] = JSON.parse(LZString.decompressFromUTF16(cloud[field]) || '[]');
                } catch (e) {
                    console.error('[Sync] Decompression failed for ' + field, e);
                    throw new Error('[Sync] Corrupt compressed ' + field + '. Sync skipped to protect existing history.');
                }
            }
            if (!Array.isArray(cloud[field])) cloud[field] = [];
        });

        let local = collectAllAppData();
        let merged = {};

        // 🧠 Helper function to merge CRDT Logs using Last-Write-Wins (LWW)
        function mergeCRDTLogs(localLog, cloudLog) {
            const mergedLog = { ...(cloudLog || {}), ...(localLog || {}) };
            Object.keys(mergedLog).forEach(qid => {
                const lVal = localLog?.[qid];
                const cVal = cloudLog?.[qid];
                if (lVal && cVal) {
                    if (lVal.timestamp === cVal.timestamp) {
                        mergedLog[qid] = ((lVal._rev || 0) >= (cVal._rev || 0)) ? lVal : cVal;
                    } else {
                        mergedLog[qid] = (lVal.timestamp > cVal.timestamp) ? lVal : cVal;
                    }
                }
            });
            return mergedLog;
        }

        // Merge Bookmarks via CRDT & Array Union (Prevents data wipe when log is missing)
        const rawBms = new Set([...(local.bookmarked || []), ...(cloud.bookmarked || [])]);
        const mergedBmLog = mergeCRDTLogs(local.bookmarkedLog, cloud.bookmarkedLog);
        Object.entries(mergedBmLog).forEach(([qid, info]) => {
            const typedId = isNaN(Number(qid)) ? qid : Number(qid);
            if (info && info.action === 'add') rawBms.add(typedId);
            // Object keys are always strings, so the id may be stored as either type in
            // the arrays. Delete both forms or the un-bookmark never takes effect.
            else if (info && info.action === 'remove') { rawBms.delete(typedId); rawBms.delete(qid); }
        });
        merged.bookmarkedLog = mergedBmLog;
        merged.bookmarked = Array.from(rawBms);

        // Merge Mistakes via CRDT & Array Union (Prevents data wipe when log is missing)
        const rawWrongs = new Set([...(local.wrong || []), ...(cloud.wrong || [])]);
        const mergedWrLog = mergeCRDTLogs(local.wrongLog, cloud.wrongLog);
        Object.entries(mergedWrLog).forEach(([qid, info]) => {
            const typedId = isNaN(Number(qid)) ? qid : Number(qid);
            if (info && info.action === 'add') rawWrongs.add(typedId);
            else if (info && info.action === 'remove') { rawWrongs.delete(typedId); rawWrongs.delete(qid); }
        });
        merged.wrongLog = mergedWrLog;
        merged.wrong = Array.from(rawWrongs);

        merged.achievements = Array.from(new Set([...(local.achievements || []), ...(cloud.achievements || [])]));

        // Merge Stats using Delta Counters to prevent Offline Data Loss
        let baselineStats = {};
        try { baselineStats = JSON.parse(KrishiStorage.getItem('krishi_stats_baseline') || '{}'); } catch(e){}
        // When the cloud has no stats it has nothing to contribute. Because
        // applyAllAppData() writes the applied stats back AS the baseline, in steady
        // state baseline === local, so the delta arithmetic below would evaluate to
        // 0 + max(0, local - local) = 0 and zero out the user's totals.
        if (!cloud.stats || typeof cloud.stats !== 'object') {
            merged.stats = local.stats || { totalSolved: 0, totalCorrect: 0, subjectStats: {} };
        } else {
        merged.stats = {
            totalSolved: (cloud.stats?.totalSolved || 0) + Math.max(0, (local.stats?.totalSolved || 0) - (baselineStats.totalSolved || 0)),
            totalCorrect: (cloud.stats?.totalCorrect || 0) + Math.max(0, (local.stats?.totalCorrect || 0) - (baselineStats.totalCorrect || 0)),
            streakDays: Math.max(local.stats?.streakDays || 0, cloud.stats?.streakDays || 0),
            subjectStats: {}
        };
        let allSubjects = new Set([...Object.keys(local.stats?.subjectStats || {}), ...Object.keys(cloud.stats?.subjectStats || {})]);
        allSubjects.forEach(sub => {
            let lSub = (local.stats?.subjectStats || {})[sub] || {solved:0, correct:0};
            let cSub = (cloud.stats?.subjectStats || {})[sub] || {solved:0, correct:0};
            let bSub = (baselineStats.subjectStats || {})[sub] || {solved:0, correct:0};
            merged.stats.subjectStats[sub] = {
                solved: cSub.solved + Math.max(0, lSub.solved - bSub.solved),
                correct: cSub.correct + Math.max(0, lSub.correct - bSub.correct)
            };
        });
        // A merge must never reduce a lifetime counter.
        merged.stats.totalSolved = Math.max(merged.stats.totalSolved, local.stats?.totalSolved || 0, cloud.stats?.totalSolved || 0);
        merged.stats.totalCorrect = Math.max(merged.stats.totalCorrect, local.stats?.totalCorrect || 0, cloud.stats?.totalCorrect || 0);
        }
        merged.progression = {
            xp: Math.max(local.progression?.xp || 0, cloud.progression?.xp || 0)
        };

        // 🧠 Helper function for Deep Field-Level Merging of Custom Questions (Feature 3)
        function deepMergeCustomQuestion(localQ, cloudQ) {
            if (!cloudQ) return localQ;
            if (!localQ) return cloudQ;
            
            const mergedQ = { ...cloudQ };
            const isLocalNewer = (localQ.updatedAt || 0) > (cloudQ.updatedAt || 0);
            
            // Iterate over all local keys
            Object.keys(localQ).forEach(k => {
                // If local is newer, OR cloud doesn't have this field (e.g. newly added field), prefer local.
                if (isLocalNewer || cloudQ[k] === undefined || cloudQ[k] === null || cloudQ[k] === '') {
                    mergedQ[k] = localQ[k];
                }
            });
            
            mergedQ.updatedAt = Math.max(localQ.updatedAt || 0, cloudQ.updatedAt || 0);
            return mergedQ;
        }

        // Custom Questions merge - Deep Merge Field-Level (CRDT/LWW)
        let questionMap = new Map();
        // Fall back to a content-derived key so a question with a missing/falsy id is
        // kept instead of being silently dropped out of the merge result.
        const qKey = q => (q.id !== undefined && q.id !== null && q.id !== '')
            ? 'id:' + q.id
            : 'anon:' + JSON.stringify([q.question || '', q.options || '', q.subject || '']);
        (cloud.customQuestions || []).forEach(q => { if (q) questionMap.set(qKey(q), q); });
        (local.customQuestions || []).forEach(q => {
            if (q) {
                const k = qKey(q);
                questionMap.set(k, deepMergeCustomQuestion(q, questionMap.get(k)));
            }
        });
        merged.customQuestions = Array.from(questionMap.values());

        // A union can never legitimately hold fewer items than either input. If it does,
        // the merge is unsound — refuse rather than hand a shrunken bank to the writers.
        const _cqExpected = Math.max((local.customQuestions || []).length, (cloud.customQuestions || []).length);
        if (merged.customQuestions.length < _cqExpected) {
            throw new Error('[Sync] Custom-question merge produced ' + merged.customQuestions.length +
                ' of at least ' + _cqExpected + ' expected; aborting sync to protect the question bank.');
        }

        // Streak merging - Date-map union
        const mergedStreak = { ...(cloud.streak || {}), ...(local.streak || {}) };
        Object.entries(cloud.streak || {}).forEach(([dateKey, cVal]) => {
            const lVal = local.streak?.[dateKey];
            if (cVal && lVal) {
                mergedStreak[dateKey] = {
                    solved: Math.max(lVal.solved || 0, cVal.solved || 0),
                    correct: Math.max(lVal.correct || 0, cVal.correct || 0)
                };
            }
        });
        merged.streak = mergedStreak;
        
        // Spaced Repetition (SM2) merge - Keep most advanced learning state
        let sm2Map = { ...(cloud.sm2 || {}), ...(local.sm2 || {}) };
        Object.keys(sm2Map).forEach(key => {
            let cVal = cloud.sm2?.[key];
            let lVal = local.sm2?.[key];
            if (cVal && lVal) {
                sm2Map[key] = ((cVal.lastAnswered || 0) >= (lVal.lastAnswered || 0)) ? cVal : lVal;
            }
        });
        merged.sm2 = sm2Map;

        // Custom Exam profiles merging - Unique by id
        let localProfiles = local.examProfiles || [];
        let cloudProfiles = cloud.examProfiles || [];
        let profileMap = new Map();
        cloudProfiles.forEach(p => { if (p) profileMap.set(p.id, p); });
        localProfiles.forEach(p => { if (p) profileMap.set(p.id, p); });
        merged.examProfiles = Array.from(profileMap.values());

        // Custom syllabus merging - Unique by subject
        let localSyllabus = local.syllabusCustom || [];
        let cloudSyllabus = cloud.syllabusCustom || [];
        let syllabusMap = new Map();
        cloudSyllabus.forEach(s => { if (s) syllabusMap.set(s.subject, s); });
        localSyllabus.forEach(s => { if (s) syllabusMap.set(s.subject, s); });
        merged.syllabusCustom = Array.from(syllabusMap.values());
        
        // Study Logs (timingLog) merging.
        // Records are {qid, timeSec, subject, difficulty, date, correct} — there is no
        // `timestamp` and `date` is a per-DAY string, so the previous key
        // (log.timestamp || log.date) collapsed every question solved on the same day
        // into a single record and wrote that loss back to the device and the cloud.
        // Key on the full record content instead (plus `ts` on newly created records).
        let localTimeLog = local.timingLog || [];
        let cloudTimeLog = cloud.timingLog || [];
        const logKey = log => (log.ts !== undefined && log.ts !== null)
            ? 'ts:' + log.ts
            : 'c:' + [log.qid, log.date, log.timeSec, log.subject, log.difficulty, log.correct ? 1 : 0].join('|');
        const logTime = log => {
            if (typeof log.ts === 'number') return log.ts;
            if (typeof log.timestamp === 'number') return log.timestamp;
            const parsed = log.date ? Date.parse(log.date) : NaN;
            return isNaN(parsed) ? 0 : parsed;
        };
        let logMap = new Map();
        cloudTimeLog.forEach(log => { if (log) logMap.set(logKey(log), log); });
        localTimeLog.forEach(log => { if (log) logMap.set(logKey(log), log); });
        merged.timingLog = Array.from(logMap.values())
            .sort((a, b) => logTime(b) - logTime(a))
            .slice(0, 2000); // Prevent unbounded growth in Firebase 1MB doc

        // Mock Scores merging.
        // Entries are plain numbers (KrishiStorageManager.recordMockScore pushes an
        // accuracy value), so `score.id || score.timestamp` was undefined for every
        // element and the Map collapsed the whole history into one value. Numbers carry
        // no identity, so merge by keeping the longer history — this is monotone and can
        // never shrink the record, which is what actually destroyed data.
        let localMockScores = Array.isArray(local.mockScores) ? local.mockScores : [];
        let cloudMockScores = Array.isArray(cloud.mockScores) ? cloud.mockScores : [];
        merged.mockScores = (localMockScores.length >= cloudMockScores.length ? localMockScores : cloudMockScores).slice(-20);

        // Practice Recent merging - Unique by timestamp, sorted, keep latest 50
        let localPracticeRecent = local.practiceRecent || [];
        let cloudPracticeRecent = cloud.practiceRecent || [];
        let recentMap = new Map();
        const recentKey = (item, i) => (item.id ?? item.timestamp ?? ('c:' + JSON.stringify(item)));
        cloudPracticeRecent.forEach((item, i) => { if (item) recentMap.set(recentKey(item, i), item); });
        localPracticeRecent.forEach((item, i) => { if (item) recentMap.set(recentKey(item, i), item); });
        merged.practiceRecent = Array.from(recentMap.values()).sort((a,b) => (b.timestamp||0) - (a.timestamp||0)).slice(0, 50);

        // For audio and interface configs, use Last Write Wins
        const cloudUpdatedAt = cloud.updatedAt && typeof cloud.updatedAt.toMillis === 'function'
            ? cloud.updatedAt.toMillis()
            : (typeof cloud.updatedAt === 'number' ? cloud.updatedAt : 0);
        let useCloud = cloudUpdatedAt > (local.updatedAt || 0);
        merged.homeSettings = useCloud ? (cloud.homeSettings || local.homeSettings) : (local.homeSettings || cloud.homeSettings);
        merged.appearanceSettings = useCloud ? (cloud.appearanceSettings || local.appearanceSettings) : (local.appearanceSettings || cloud.appearanceSettings);
        merged.customAppearanceSettings = useCloud ? (cloud.customAppearanceSettings || local.customAppearanceSettings) : (local.customAppearanceSettings || cloud.customAppearanceSettings);
        merged.plannerSettings = useCloud ? (cloud.plannerSettings || local.plannerSettings) : (local.plannerSettings || cloud.plannerSettings);

        // Profile identity carries its own edit timestamp, so it merges on its own clock
        const localProfileStamp = Number((local.userProfile && local.userProfile.updatedAt) || 0);
        const cloudProfileStamp = Number((cloud.userProfile && cloud.userProfile.updatedAt) || 0);
        if (cloudProfileStamp > localProfileStamp) {
            merged.userProfile = cloud.userProfile;
        } else if (local.userProfile) {
            merged.userProfile = local.userProfile;
        } else if (cloud.userProfile) {
            merged.userProfile = cloud.userProfile;
        }

        merged.soundEnabled = useCloud ? (cloud.soundEnabled ?? local.soundEnabled) : (local.soundEnabled ?? cloud.soundEnabled);
        merged.soundMuted = useCloud ? (cloud.soundMuted ?? local.soundMuted) : (local.soundMuted ?? cloud.soundMuted);
        merged.soundVolume = useCloud ? (cloud.soundVolume ?? local.soundVolume) : (local.soundVolume ?? cloud.soundVolume);

        // Object config packs — same document-clock LWW as the interface configs above.
        merged.goalSettings = useCloud ? (cloud.goalSettings || local.goalSettings) : (local.goalSettings || cloud.goalSettings);
        merged.lastPracticeConfig = useCloud ? (cloud.lastPracticeConfig || local.lastPracticeConfig) : (local.lastPracticeConfig || cloud.lastPracticeConfig);

        // Custom subjects merge through their own CRDT log, exactly like bookmarks. A plain
        // union can only ever grow the list, so a removal on one device was silently undone
        // by the next merge with a peer that still had it.
        const subjectKey = s => (typeof s === 'string' ? s : JSON.stringify(s));
        const subjectSet = new Set();
        (cloud.customSubjects || []).forEach(s => { if (s) subjectSet.add(subjectKey(s)); });
        (local.customSubjects || []).forEach(s => { if (s) subjectSet.add(subjectKey(s)); });
        const mergedSubjectLog = mergeCRDTLogs(local.customSubjectsLog, cloud.customSubjectsLog);
        Object.entries(mergedSubjectLog).forEach(([name, info]) => {
            if (!info) return;
            if (info.action === 'add') subjectSet.add(name);
            else if (info.action === 'remove') subjectSet.delete(name);
        });
        merged.customSubjectsLog = mergedSubjectLog;
        merged.customSubjects = Array.from(subjectSet);

        const layoutKey = b => ((b && (b.timestamp ?? b.id)) ?? JSON.stringify(b));
        const layoutMap = new Map();
        (cloud.layoutBackups || []).forEach(b => { if (b) layoutMap.set(layoutKey(b), b); });
        (local.layoutBackups || []).forEach(b => { if (b) layoutMap.set(layoutKey(b), b); });
        merged.layoutBackups = Array.from(layoutMap.values());

        // Scalar toggles. These merge on their own per-field clock (settingStamps), NOT on
        // the document clock: collectAllAppData() rewrites `updatedAt` to Date.now() on
        // every read, so `useCloud` is essentially always false and the cloud side could
        // never win. That is what stopped a dark-mode OFF from ever reaching the peer while
        // the initial OFF->ON still appeared to work.
        // Where neither side has a stamp yet (settings written before this existed, or
        // toggles with no UI setter) fall back to the old document-clock behaviour.
        // Assigned only when defined — an undefined value in a Firestore write throws.
        const localStamps = (local.settingStamps && typeof local.settingStamps === 'object') ? local.settingStamps : {};
        const cloudStamps = (cloud.settingStamps && typeof cloud.settingStamps === 'object') ? cloud.settingStamps : {};
        const mergedStamps = {};
        ['dark', 'batterySaver', 'hapticEnabled', 'eliteAnimations',
         'difficultyBias', 'intensityMode', 'activePlanMode', 'retryDelay'].forEach(k => {
            const ls = Number(localStamps[k] || 0);
            const cs = Number(cloudStamps[k] || 0);
            let takeCloud;
            if (cs !== ls) takeCloud = cs > ls;       // per-field clock decides
            else takeCloud = useCloud;                 // no stamps to compare: legacy path
            const v = takeCloud ? (cloud[k] ?? local[k]) : (local[k] ?? cloud[k]);
            if (v !== undefined) merged[k] = v;
            const stamp = Math.max(ls, cs);
            if (stamp > 0) mergedStamps[k] = stamp;
        });
        merged.settingStamps = mergedStamps;

        merged.updatedAt = Math.max(local.updatedAt || 0, cloudUpdatedAt);
        return merged;
    }

    function getDifferentialSyncDelta(local, cloud) {
        const delta = {};
        let changed = false;

        const keysToCheck = [
            'bookmarked', 'bookmarkedLog',
            'wrong', 'wrongLog',
            'customQuestions',
            'streak', 'stats', 'achievements', 'sm2', 'progression',
            'examProfiles', 'homeSettings', 'appearanceSettings',
            'customAppearanceSettings', 'plannerSettings', 'syllabusCustom',
            'timingLog', 'mockScores', 'practiceRecent',
            'soundEnabled', 'soundMuted', 'soundVolume',
            // dark and batterySaver were missing here, so even once the merge carried them
            // the delta writer would still never have shipped a change to either.
            'dark', 'batterySaver',
            'goalSettings', 'customSubjects', 'customSubjectsLog', 'layoutBackups', 'lastPracticeConfig',
            'hapticEnabled', 'eliteAnimations', 'difficultyBias',
            'intensityMode', 'activePlanMode', 'retryDelay',
            'settingStamps',
            'userProfile',
            'ownerUid', 'isCompressed'
        ];

        keysToCheck.forEach(key => {
            if (local[key] !== undefined) {
                const localStr = JSON.stringify(local[key]);
                const cloudStr = cloud ? JSON.stringify(cloud[key]) : undefined;
                if (localStr !== cloudStr) {
                    delta[key] = local[key];
                    changed = true;
                }
            }
        });

        if (changed) {
            delta.updatedAt = local.updatedAt || Date.now();
            return delta;
        }
        return null;
    }

    let syncDebounceTimer = null;

    function scheduleCloudSync(reason = "") {
        const key = getSyncKey();
        if (!key) return;

        KrishiStorage.setItem('krishi_sync_pending', 'true');
        
        let pendingCount = parseInt(KrishiStorage.getItem('krishi_sync_pending_count') || '0');
        pendingCount += 1;
        KrishiStorage.setItem('krishi_sync_pending_count', pendingCount.toString());
        
        setSyncStatus('Syncing...');
        updateOfflineQueueBadge();

        // Snappy direct debounced sync (800ms) for true instant real-time performance
        if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
        syncDebounceTimer = setTimeout(() => {
            performCloudSync();
        }, 800);

        // Keep PWA Background Sync as offline-to-online transition fallback in service worker
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then(reg => {
                return reg.sync.register('sync-cloud-data');
            }).catch(err => {});
        }
    }

    // Firestore hard-limits a document to 1 MiB. Refuse an oversized write rather than
    // let it fail and leave the user believing their data is backed up.
    const FIRESTORE_DOC_SOFT_LIMIT = 900 * 1024;
    function assertPayloadFits(payload, label) {
        let size = 0;
        try { size = JSON.stringify(payload).length; } catch(e) { return; }
        if (size > FIRESTORE_DOC_SOFT_LIMIT) {
            throw new Error('[Sync] ' + label + ' is ' + Math.round(size / 1024) +
                ' KB, over the ' + Math.round(FIRESTORE_DOC_SOFT_LIMIT / 1024) +
                ' KB safe limit for one Firestore document. Sync skipped.');
        }
    }

    async function performCloudSync() {
        const uid = getCloudUID();
        if (!uid) return;

        if (!navigator.onLine) {
            setSyncStatus('Offline');
            return;
        }

        setSyncStatus('Syncing...');

        let ownsSyncLock = false;
        try {
            await loadFirebaseSDKs();
            const firestore = firebase.firestore(firebaseApp);
            const docRef = firestore.collection('users').doc(uid);

            const localDataPayload = collectAllAppData();
            const localUpdatedAt = parseInt(KrishiStorage.getItem('krishi_last_updated_at')) || 0;

            // Resolve whether the cloud document exists. The cached value is only
            // trusted for the uid it was populated for — a stale cache from a previous
            // account must never decide this — and `undefined` means "not known yet",
            // which is resolved by an authoritative server read, never guessed.
            let cloudSnapshotData = (cachedCloudUid === uid) ? cachedCloudData : undefined;
            let absenceConfirmedByServer = false;
            if (cloudSnapshotData === undefined) {
                try {
                    const doc = await docRef.get({ source: 'server' });
                    cloudSnapshotData = doc.exists ? doc.data() : null;
                    absenceConfirmedByServer = !doc.exists;
                    cachedCloudData = cloudSnapshotData;
                    cachedCloudUid = uid;
                    window.__krishiSyncListenerInitialized__ = true;
                } catch (e) {
                    // A failed read means UNKNOWN, not "the cloud is empty".
                    // navigator.onLine reports true on captive portals and data-saver
                    // connections, so this path is reached routinely.
                    console.warn('[Cloud Sync] Server read failed; sync deferred instead of guessing document state.', e);
                    setSyncStatus('Sync failed');
                    return;
                }
            }

            const currentCloudData = cloudSnapshotData;

            if (currentCloudData) {
                syncInProgress = true;
                ownsSyncLock = true;
                console.log('[Cloud Sync] Robust CRDT Union Merge executing...');
                const mergedPayload = mergeCloudAndLocalData(currentCloudData);
                applyAllAppData(mergedPayload);

                const delta = getDifferentialSyncDelta(mergedPayload, currentCloudData);
                if (delta && Object.keys(delta).length > 0) {
                    if (typeof LZString !== 'undefined') {
                        if (delta.timingLog) delta.timingLog = LZString.compressToUTF16(JSON.stringify(delta.timingLog));
                        if (delta.mockScores) delta.mockScores = LZString.compressToUTF16(JSON.stringify(delta.mockScores));
                        delta.isCompressed = true;
                    }
                    assertPayloadFits(delta, 'Sync delta');
                    const now = firebase.firestore.FieldValue.serverTimestamp();
                    mergedPayload.updatedAt = Date.now();
                    KrishiStorage.setItem('krishi_last_updated_at', mergedPayload.updatedAt);
                    await docRef.update({ ...delta, updatedAt: now }).catch(async (e) => {
                        // Fallback to set with merge if doc does not exist yet (though checked earlier, race condition possible)
                        await docRef.set({ ...delta, updatedAt: now }, { merge: true });
                    });
                    console.log('[Cloud Sync] CRDT merged DELTA payload written back to cloud.');
                    logSyncActivity('Merged ' + Object.keys(delta).length + ' changed sub-collections to cloud (Delta Sync).');
                } else {
                    KrishiStorage.setItem('krishi_last_updated_at', currentCloudData.updatedAt || Date.now());
                    logSyncActivity('Cloud sync verified: Local data is already up to date.');
                }

                KrishiStorage.removeItem('krishi_sync_pending');
                KrishiStorage.setItem('krishi_sync_pending_count', '0');
                setSyncStatus('Synced');
                updateOfflineQueueBadge();
                if (typeof updateSyncUI === 'function') updateSyncUI();

                // Delegate all page refreshes to the dirty-flag + RAF dispatcher.
                // applyAllAppData() above has already set all _krishiDirty flags.
                // krishiScheduleSyncRender() renders only the currently active+dirty page in
                // the next animation frame, with the quiz-active guard handled internally.
                if (typeof krishiScheduleSyncRender === 'function') krishiScheduleSyncRender();
                window.dispatchEvent(new Event('appDataSynced'));
            } else {
                // Create path. Confirm the absence against the server first: a cached
                // "missing" answer is not proof, and this branch used to replace a
                // populated cloud document with whatever the device happened to hold.
                // Skipped when the read above already came straight from the server.
                if (!absenceConfirmedByServer) {
                    let serverDoc;
                    try {
                        serverDoc = await docRef.get({ source: 'server' });
                    } catch (e) {
                        console.warn('[Cloud Sync] Could not confirm document absence with the server; initial push skipped.', e);
                        setSyncStatus('Sync failed');
                        return;
                    }
                    if (serverDoc.exists) {
                        // It existed after all. Re-run as a merge instead of overwriting.
                        cachedCloudData = serverDoc.data();
                        cachedCloudUid = uid;
                        window.__krishiSyncListenerInitialized__ = true;
                        console.warn('[Cloud Sync] Server reports the document exists — re-running as a merge instead of a full push.');
                        scheduleCloudSync('Document existence re-check');
                        return;
                    }
                }

                const now = firebase.firestore.FieldValue.serverTimestamp();
                if (typeof LZString !== 'undefined') {
                    if (localDataPayload.timingLog) localDataPayload.timingLog = LZString.compressToUTF16(JSON.stringify(localDataPayload.timingLog));
                    if (localDataPayload.mockScores) localDataPayload.mockScores = LZString.compressToUTF16(JSON.stringify(localDataPayload.mockScores));
                    localDataPayload.isCompressed = true;
                }
                assertPayloadFits(localDataPayload, 'Initial full sync payload');
                localDataPayload.updatedAt = now;
                KrishiStorage.setItem('krishi_last_updated_at', Date.now());
                // merge:true even here — a concurrent writer between the get() above and
                // this write must not be silently discarded.
                await docRef.set(localDataPayload, { merge: true });
                cachedCloudUid = uid;
                logSyncActivity('Initial Full Sync completed. All local data backed up to cloud.');
                KrishiStorage.removeItem('krishi_sync_pending');
                KrishiStorage.setItem('krishi_sync_pending_count', '0');
                setSyncStatus('Synced');
                updateOfflineQueueBadge();
            }
        } catch (err) {
            console.error('[Cloud Sync] Sync execution error:', err);
            setSyncStatus('Sync failed');
        } finally {
            // Without this, any throw above latched syncInProgress true for the rest of
            // the session, silently disabling both this path and the snapshot listener.
            if (ownsSyncLock) syncInProgress = false;
        }
    }

    function logSyncActivity(msg) {
        if (!localData.syncActivityLog) localData.syncActivityLog = [];
        localData.syncActivityLog.unshift({ time: Date.now(), msg: msg });
        if (localData.syncActivityLog.length > 20) localData.syncActivityLog.pop();
        saveData();
    }

    window.openSyncHistoryModal = function() {
        const modal = document.getElementById('sync-history-modal');
        const content = document.getElementById('sync-history-content');
        if (modal && content) {
            const logs = localData.syncActivityLog || [];
            if (logs.length === 0) {
                content.innerHTML = '<p class="text-center text-xs text-slate-500 italic py-4">No recent sync activity.</p>';
            } else {
                content.innerHTML = logs.map(l => `
                    <div class="text-xs p-2 rounded bg-slate-50 dark:bg-slate-900 border" style="border-color:var(--border);">
                        <div class="text-[9px] text-slate-400 mb-0.5">${new Date(l.time).toLocaleString()}</div>
                        <div class="font-medium text-slate-700 dark:text-slate-300">${l.msg}</div>
                    </div>
                `).join('');
            }
            modal.classList.remove('hidden');
        }
    };

    window.closeSyncHistoryModal = function() {
        const modal = document.getElementById('sync-history-modal');
        if (modal) modal.classList.add('hidden');
    };

    function setSyncStatus(status) {
        KrishiStorage.setItem('krishi_sync_status', status);
        updateSyncUI();
    }

    // Reconnection listener
    window.addEventListener('online', () => {
        if (KrishiStorage.getItem('krishi_sync_pending') === 'true') {
            scheduleCloudSync('Reconnected to internet');
        } else {
            updateSyncUI();
        }
    });

function updatePracticePage() {
    let container = document.getElementById('subject-buttons-container');
    if (!container) return;
    
    let subjects = getAllSubjects(); 
    let all = getAllQuestions();
    let dueCount = getPromoDueCount();
    let wrongCount = getValidWrongCount();
    let bookmarkedCount = (localData.bookmarked || []).length;

    // १. नयाँ स्मार्ट इन्जिन रेन्डर गर्ने
    let engineContainer = document.getElementById('smart-engine-container');
    if (engineContainer) {
        let engineHtml = `
            <div class="space-y-3">
                <h3 class="font-bold text-xs text-slate-400 uppercase tracking-wider mb-2">🔥 Priority Training Modes</h3>
                
                <button onclick="startSmartPracticeMode('quick'); playSound('click');" class="w-full p-4 rounded-2xl border text-left flex justify-between items-center hover-card-trigger bg-gradient-to-r from-emerald-500/10 to-teal-500/10" style="border-color:var(--border); background:var(--card);">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-emerald-500 text-white rounded-xl flex items-center justify-center text-xl shadow-lg">⚡️</div>
                        <div>
                            <h4 class="font-black text-sm text-slate-800 dark:text-slate-100">Quick MCQ Drill</h4>
                            <p class="text-[10px] text-slate-400">१० वटा मिक्स्ड प्रश्नहरूको द्रुत अभ्यास</p>
                        </div>
                    </div>
                    <span class="text-[10px] font-bold px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-xl">START</span>
                </button>

                <div class="grid grid-cols-2 gap-3">
                    <button onclick="startSmartPracticeMode('spaced'); playSound('click');" class="p-4 rounded-2xl border text-left space-y-3 hover-card-trigger ${dueCount > 0 ? 'pulse-spaced-accent' : ''}" style="border-color:var(--border); background:var(--card);">
                        <div class="flex justify-between items-center">
                            <span class="text-2xl">🧠</span>
                            <span class="text-[9px] font-black px-2 py-1 rounded-full ${dueCount > 0 ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}">${dueCount} DUE</span>
                        </div>
                        <h4 class="font-bold text-xs text-slate-800 dark:text-slate-100">Spaced Review</h4>
                    </button>

                    <button onclick="startSmartPracticeMode('wrong'); playSound('click');" class="p-4 rounded-2xl border text-left space-y-3 hover-card-trigger ${wrongCount > 0 ? 'pulse-wrong-accent' : ''}" style="border-color:var(--border); background:var(--card);">
                        <div class="flex justify-between items-center">
                            <span class="text-2xl">💔</span>
                            <span class="text-[9px] font-black px-2 py-1 rounded-full ${wrongCount > 0 ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'}">${wrongCount} ERRORS</span>
                        </div>
                        <h4 class="font-bold text-xs text-slate-800 dark:text-slate-100">Review Mistakes</h4>
                    </button>
                </div>

                <button onclick="navigate('page-mock-config'); playSound('click');" class="w-full p-4 rounded-2xl border text-left flex justify-between items-center hover-card-trigger bg-gradient-to-r from-indigo-500/10 to-blue-500/10" style="border-color:var(--border); background:var(--card);">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center text-xl shadow-lg">🎯</div>
                        <div>
                            <h4 class="font-black text-sm text-slate-800 dark:text-slate-100">Mock Exam Simulator</h4>
                            <p class="text-[10px] text-slate-500">कठिनस्तर छानेर वास्तविक परीक्षाको झल्को</p>
                        </div>
                    </div>
                    <span class="text-[10px] font-bold px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-xl">OPEN</span>
                </button>
            </div>
        `;
        if (engineContainer.innerHTML !== engineHtml) {
            engineContainer.innerHTML = engineHtml;
        }
    }

    let elWrongCount = document.getElementById('smart-wrong-count-lbl');
    if (elWrongCount) elWrongCount.textContent = `${wrongCount} pending wrongs`;

    let elBkCount = document.getElementById('smart-bookmark-count-lbl');
    if (elBkCount) elBkCount.textContent = `${bookmarkedCount} saved items`;

    let elSpacedCount = document.getElementById('smart-spaced-count-lbl');
    if (elSpacedCount) elSpacedCount.textContent = `${dueCount} revision dued`;

    let elDailyCount = document.getElementById('smart-daily-count-lbl');
    if (elDailyCount) {
        let todayStr = getLocalDateString();
        let solved = (localData.streak[todayStr]||{}).solved||0;
        let dailyT = getDailyTarget() || 50;
        elDailyCount.textContent = `${solved} / ${dailyT} solved today`;
    }

    let subStats = (localData && localData.stats && localData.stats.subjectStats) ? localData.stats.subjectStats : {};

    let htmlStr = '';
    subjects.forEach(sub => {
        let count = all.filter(q => (q.sub || "").trim().toLowerCase() === (sub || "").trim().toLowerCase()).length;
        let stats = subStats[sub] || { solved: 0, correct: 0 };
        let accuracyText = stats.solved > 0 ? `${Math.round((stats.correct / stats.solved) * 100)}% accuracy` : 'Not practiced';
        let accuracyColor = stats.solved > 0 ? (stats.correct / stats.solved >= 0.8 ? 'text-emerald-500' : stats.correct / stats.solved >= 0.5 ? 'text-amber-500' : 'text-rose-500') : 'text-slate-400 dark:text-slate-500';

        htmlStr += `
            <button onclick="openPracticeSetupPage('${sub}', 'all')" class="p-3.5 rounded-xl border text-left bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all  group flex flex-col justify-between" style="border-color:var(--border);">
                <div>
                    <p class="font-extrabold text-xs text-slate-800 dark:text-slate-200 group-hover:text-emerald-600">${sub}</p>
                    <span class="text-[9px] text-slate-400 mt-1 block">${count} Questions</span>
                </div>
                <div class="mt-3 flex items-center justify-between w-full">
                    <span class="text-[8px] font-black uppercase tracking-wider ${accuracyColor}">${accuracyText}</span>
                    <span class="text-[9px] font-black text-emerald-500 group-hover:translate-x-0.5 transition-transform">Configure ➔</span>
                </div>
            </button>
        `;
    });
    
    if (container.innerHTML !== htmlStr) {
        container.innerHTML = htmlStr;
    }
}

function saveUIStateForRestore() {
    let activePage = document.querySelector('.page.active');
    let stateObj = {
        pageId: activePage ? activePage.id : 'page-home',
        scrollPos: window.scrollY || document.documentElement.scrollTop
    };
    sessionStorage.setItem('krishi_pwa_restore_state', JSON.stringify(stateObj));
}

function restoreUIStateIfCached() {
    let raw = sessionStorage.getItem('krishi_pwa_restore_state');
    if (raw) {
        try {
            let stateObj = JSON.parse(raw);
            sessionStorage.removeItem('krishi_pwa_restore_state'); // Clear one-time cache
            if (stateObj.pageId && typeof navigate === 'function') {
                navigate(stateObj.pageId);
                setTimeout(() => {
                    window.scrollTo({ top: stateObj.scrollPos, behavior: 'instant' });
                }, 100);
            }
        } catch(e) {
            console.warn('[PWA Restore] Failed to restore UI state:', e);
        }
    }
}

// भाइब्रेसन सेटिङ सेभ र लोड गर्ने
function toggleHapticSetting() {
    let isEnabled = document.getElementById('haptic-enabled').checked;
    KrishiStorage.setItem('krishi_haptic_enabled', isEnabled);
    stampSetting('hapticEnabled');
    if(isEnabled) {
        document.getElementById('haptic-test-area').classList.remove('hidden');
        triggerHaptic('correct'); // टोगल गर्दा सानो भाइब्रेसन दिने
    } else {
        document.getElementById('haptic-test-area').classList.add('hidden');
    }
}

// कम्प्युटर वा मोबाइल कुन डिभाइस हो र भाइब्रेसन चल्छ कि चल्दैन भनेर सुरुमै एक पटक मात्र जाँच गर्ने प्रविधि (Hardware Cache Check)
const isHapticSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

// मोबाइल भाइब्रेट गराउने मुख्य फङ्सन
function triggerHaptic(type) {
    let hapticEnabled = KrishiStorage.getItem('krishi_haptic_enabled') !== 'false';
    if (!hapticEnabled) return;

    // Feature 9: Capacitor Haptics API (Native APK) — falls back to navigator.vibrate for PWA/browser
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Haptics) {
        try {
            const Haptics = cap.Plugins.Haptics;
            if (type === 'correct') {
                Haptics.impact({ style: 'MEDIUM' }); // সही हुँदा premium medium impact
            } else if (type === 'wrong') {
                Haptics.notification({ type: 'WARNING' }); // गलत हुँदा warning notification
            } else if (type === 'click') {
                Haptics.impact({ style: 'LIGHT' }); // बटन थिच्दा light tap
            } else if (type === 'celebrate') {
                Haptics.notification({ type: 'SUCCESS' }); // लक्ष्य पूरा हुँदा success
            }
            return; // Native haptic successful — no need for vibrate fallback
        } catch(e) {
            console.warn('[Haptics] Capacitor Haptics failed, using vibrate fallback:', e);
        }
    }

    // Fallback: Web Vibration API (PWA / browser)
    if (!isHapticSupported) return;
    try {
        if (type === 'correct') {
            navigator.vibrate([50, 40, 50]);
        } else if (type === 'wrong') {
            navigator.vibrate([120, 80, 120]);
        } else if (type === 'click') {
            navigator.vibrate(10);
        } else if (type === 'celebrate') {
            navigator.vibrate([40, 40, 40, 40, 80, 50, 150]);
        }
    } catch (e) {
        console.warn('[Haptics] Vibration failed safely:', e);
    }
}

// सुरुमा सेटिङ लोड गर्ने (यो फङ्सनलाई DOMContentLoaded भित्र कल गर्न सकिन्छ)
function initHapticUI() {
    let saved = KrishiStorage.getItem('krishi_haptic_enabled') !== 'false';
    let el = document.getElementById('haptic-enabled');
    if(el) {
        el.checked = saved;
        if(saved) document.getElementById('haptic-test-area').classList.remove('hidden');
    }
}

// ==================== 2026 ADVANCED ANIMATION OVERRIDES (Z-TOUCH ENGINE) ====================
(function() {
    // १. Scroll-Driven Progress Variable Tracker
    window.addEventListener('scroll', function() {
        if (!window.__KRISHI_VISIBLE__ && document.hidden) return;
        requestAnimationFrame(function() {
            var docElem = document.documentElement;
            var scrollTop = window.pageYOffset || docElem.scrollTop;
            var scrollHeight = docElem.scrollHeight - window.innerHeight;
            var scrollPercent = scrollHeight > 0 ? (scrollTop / scrollHeight) : 0;
            docElem.style.setProperty('--scroll-percent', scrollPercent);
        });
    }, { passive: true });

    // Scroll progress bar निर्माण (यदि पहिले बनेको छैन भने)
    var scrollBar = document.createElement('div');
    scrollBar.className = 'futuristic-scroll-bar';
    document.body.appendChild(scrollBar);

    // २. Spatiotactile Audio & Multiphase Haptic Upgrades (Backward Compatible Overrides)
    var originalPlaySound = window.playSound;
    window.playSound = function(type, event) {
        // पहिलेकै साउन्ड इन्जिन चलाउने
        if (typeof originalPlaySound === 'function') {
            originalPlaySound(type);
        }
        
        // अतिरिक्त स्थानिक (Spatial panning) प्रभाव
        if (!window.AudioContext && !window.webkitAudioContext) return;
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            var panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
            
            osc.connect(gain);
            if (panner) {
                gain.connect(panner);
                panner.connect(ctx.destination);
                
                // स्थानिक पानिंग: यदि क्लीक ईभेन्ट छ भने स्क्रिनको स्थान अनुसार दायाँ-बायाँ आवाज पठाउने
                if (event && event.clientX) {
                    var panValue = (event.clientX / window.innerWidth) * 2 - 1; // -1 (बायाँ) देखि 1 (दायाँ)
                    panner.pan.setValueAtTime(panValue, ctx.currentTime);
                }
            } else {
                gain.connect(ctx.destination);
            }
            
            var now = ctx.currentTime;
            if (type === 'correct') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                osc.start(now); osc.stop(now + 0.3);
            }
        } catch (e) {
            console.warn('[Spatial Sound] Skipped gracefully:', e);
        }
    };

    var originalTriggerHaptic = window.triggerHaptic;
    window.triggerHaptic = function(type) {
        var hapticEnabled = KrishiStorage.getItem('krishi_haptic_enabled') !== 'false';
        if (!hapticEnabled || typeof navigator.vibrate !== 'function') return;
        
        try {
            if (type === 'correct') {
                // डबल मल्टि-फेज ट्याप (Tactile Double Click)
                navigator.vibrate([20, 40, 20]);
            } else if (type === 'wrong') {
                // घट्दो क्रमको कम्पन्न (Decaying Alarm pulse)
                navigator.vibrate([60, 45, 30, 20, 15]);
            } else if (type === 'click') {
                // सानो सुक्ष्म टिक (Subtle micro tick)
                navigator.vibrate(10);
            } else if (typeof originalTriggerHaptic === 'function') {
                originalTriggerHaptic(type);
            }
        } catch (e) {
            console.warn('[Haptics] Overridden pulse failed safely:', e);
        }
    };

    // ३. Specular 3D Tilt & Light Effect Attacher (Delegated Event Listeners)
    document.addEventListener('mousemove', function(e) {
        if (window.innerWidth < 768) return; // ब्याट्री बचाउन मोबाइलमा ३D झुकाव स्वतः बन्द
        
        var card = e.target.closest('.hover-card-trigger, #mcq-card-container');
        if (!card) return;
        
        var rect = card.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        
        var xc = rect.width / 2;
        var yc = rect.height / 2;
        
        var angleX = -(y - yc) / (rect.height / 8); // maximum tilt angle
        var angleY = (x - xc) / (rect.width / 8);
        
        card.style.transform = `perspective(1000px) rotateX(${angleX}deg) rotateY(${angleY}deg) scale3d(1.02, 1.02, 1.02)`;
        card.style.boxShadow = `0 15px 30px rgba(var(--primary-rgb), 0.1)`;
    });

    document.addEventListener('mouseout', function(e) {
        var card = e.target.closest('.hover-card-trigger, #mcq-card-container');
        if (!card) return;
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
        card.style.boxShadow = '';
    });

    // ४. Gyroscope Orientation Tracking (Device Tilting fallback)
    if (typeof window.DeviceOrientationEvent !== 'undefined') {
        window.addEventListener('deviceorientation', function(event) {
            if (!window.__KRISHI_VISIBLE__ && document.hidden) return;
            var tiltX = Math.min(15, Math.max(-15, event.beta || 0));  // -15 to 15 deg
            var tiltY = Math.min(15, Math.max(-15, event.gamma || 0)); // -15 to 15 deg
            
            requestAnimationFrame(function() {
                var splashBg = document.querySelector('#splash-screen::before');
                if (splashBg) {
                    splashBg.style.transform = `translate3d(${tiltY * 1.5}px, ${tiltX * 1.5}px, 0) scale(1.1) rotate(5deg)`;
                }
            });
        }, { passive: true });
    }

    // ५. Dynamic Vector Field Magnetic Particles Engine overlay
    var canvas, ctx, particles = [], animationFrameId = null;
    
    function createMagneticFieldLayer() {
        if (canvas) return;
        canvas = document.createElement('canvas');
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '99999';
        
        var dpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    function spawnVectorParticles() {
        createMagneticFieldLayer();
        particles = [];
        var count = 30;
        for (var i = 0; i < count; i++) {
            particles.push({
                x: window.innerWidth / 2 + (Math.random() - 0.5) * 100,
                y: window.innerHeight / 2 + (Math.random() - 0.5) * 100,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                life: 1.0,
                decay: 0.01 + Math.random() * 0.02,
                color: 'rgba(' + Math.floor(Math.random()*150) + ',185,129,'
            });
        }
        
        if (!animationFrameId) {
            runVectorLoop();
        }
    }

    function runVectorLoop() {
        if (document.hidden || !canvas) {
            stopVectorLoop();
            return;
        }
        
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        
        for (var i = particles.length - 1; i >= 0; i--) {
            var p = particles[i];
            
            // Vector Field Force Calculations (Magnetic rotational drift)
            var dx = p.x - window.innerWidth / 2;
            var dy = p.y - window.innerHeight / 2;
            var dist = Math.sqrt(dx*dx + dy*dy) || 1;
            
            // Rotational force
            p.vx += (-dy / dist) * 0.15;
            p.vy += (dx / dist) * 0.15;
            
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;
            
            if (p.life <= 0) {
                particles.splice(i, 1);
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2);
                ctx.fillStyle = p.color + p.life + ')';
                ctx.fill();
            }
        }
        
        if (particles.length > 0) {
            animationFrameId = requestAnimationFrame(runVectorLoop);
        } else {
            stopVectorLoop();
        }
    }

    function stopVectorLoop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (canvas) {
            canvas.remove();
            canvas = null;
            ctx = null;
        }
    }

    // ६. Spring Animation Helper function for Page and Card Transitions
    window.applySpringTransition = function(element, properties, callback) {
        if (!element) return;
        element.classList.add('spring-active');
        
        requestAnimationFrame(function() {
            for (var prop in properties) {
                element.style[prop] = properties[prop];
            }
            setTimeout(function() {
                element.classList.remove('spring-active');
                if (typeof callback === 'function') callback();
            }, 600); // matching cubic-bezier duration
        });
    };

    // Achievements वा Milestone पुग्दा चुम्बकीय प्रवाही कणहरू स्वतः देखाउने हुक
    var originalTriggerConfetti = window.triggerConfetti;
    window.triggerConfetti = function() {
        if (typeof originalTriggerConfetti === 'function') {
            originalTriggerConfetti();
        }
        spawnVectorParticles(); // अतिरिक्त प्रवाही चुम्बकीय इफेक्ट थपिएको
    };

    console.log('[Ultra-Futuristic Layer] Successfully applied safely with 0% risk!');
})();
// ==================== 2026 SIX FUTURISTIC ANIMATIONS ENGINE ====================
(function() {
    // कडा सुरक्षा जाँच: एप बाहिर ट्याब बन्द हुँदा एनिमेसन बन्द गर्ने

    // १. बाली वृद्धि र २. पानीको प्रोग्रेस बार डायनामिक रूपमा थप्ने हुक
    var origRenderMCQ = window.renderMCQ;
    window.renderMCQ = function() {
        if (typeof origRenderMCQ === 'function') {
            origRenderMCQ();
        }
        setupPlantAndIrrigationUI();
    };

    var origSubmitMCQAnswer = window.submitMCQAnswer;
    window.submitMCQAnswer = function() {
        if (typeof origSubmitMCQAnswer === 'function') {
            origSubmitMCQAnswer();
        }
        updatePlantAndIrrigationState();
    };

    function setupPlantAndIrrigationUI() {
        var mcqCard = document.getElementById('mcq-card-container');
        if (!mcqCard) return;

        // बाली वृद्धिको बक्स थप्ने
        var plantWidget = document.getElementById('plant-growth-indicator');
        if (!plantWidget) {
            plantWidget = document.createElement('div');
            plantWidget.id = 'plant-growth-indicator';
            plantWidget.className = 'plant-growth-widget';
            mcqCard.appendChild(plantWidget);
        }
        
        // पानीको प्रोग्रेस बार थप्ने (पुरानो बार लुकाएर नयाँ थप्ने)
        var oldBar = document.getElementById('progress-bar');
        if (oldBar) {
            oldBar.style.opacity = '0'; // पुरानो हरियो रङ मात्र लुकाइदिने
            var parent = oldBar.parentElement;
            if (parent && !parent.querySelector('.irrigation-wave-canvas')) {
                parent.className = 'irrigation-wave-container';
                var canvas = document.createElement('canvas');
                canvas.className = 'irrigation-wave-canvas';
                parent.appendChild(canvas);
                animateWaterWave(canvas);
            }
        }
        updatePlantAndIrrigationState();
    }

    // बाली र छालको प्रोग्रेसको ताजा अपडेट
    function updatePlantAndIrrigationState() {
       var total = (typeof state !== 'undefined' && state) ? state.totalQuestions : 10;
var current = (typeof state !== 'undefined' && state) ? state.currentIndex : 0;
var score = (typeof state !== 'undefined' && state) ? state.score : 0;
var answered = (typeof state !== 'undefined' && state) ? state.answered : false;

        var progressPercent = total > 0 ? (current / total) : 0;
        
        // बाली वृद्धिको चरणहरू (Seed -> Sprout -> Growth -> Flower)
        var plantWidget = document.getElementById('plant-growth-indicator');
        if (plantWidget) {
            var plantStageSVG = '';
            var scale = 0.5 + (progressPercent * 0.5); // बोट आकारमा बढ्दै जाने
            
            if (progressPercent < 0.25) {
                // स्टेज १: माटो र सानो बिउ
                plantStageSVG = `<svg class="plant-growth-svg" viewBox="0 0 50 50"><circle cx="25" cy="40" r="4" fill="#a16207"/><line x1="10" y1="42" x2="40" y2="42" stroke="#78350f" stroke-width="3"/></svg>`;
            } else if (progressPercent < 0.6) {
                // स्टेज २: सानो टुसा उम्रेको
                plantStageSVG = `<svg class="plant-growth-svg" viewBox="0 0 50 50"><path d="M25,42 Q25,30 20,24" fill="none" stroke="#22c55e" stroke-width="3"/><path d="M20,24 Q15,20 18,17 Q22,17 21,23" fill="#4ade80"/><line x1="10" y1="42" x2="40" y2="42" stroke="#78350f" stroke-width="3"/></svg>`;
            } else if (progressPercent < 0.85) {
                // स्टेज ३: ठूलो बिरुवा पातहरू सहित
                plantStageSVG = `<svg class="plant-growth-svg" viewBox="0 0 50 50"><path d="M25,42 Q25,20 28,15" fill="none" stroke="#16a34a" stroke-width="4"/><path d="M25,30 Q15,25 20,20 Q28,24 25,30" fill="#22c55e"/><path d="M25,22 Q35,15 32,20 Q26,24 25,22" fill="#22c55e"/><line x1="10" y1="42" x2="40" y2="42" stroke="#78350f" stroke-width="3"/></svg>`;
            } else {
                // स्टेज ४: ढकमक्क फुलेको फूल
                plantStageSVG = `<svg class="plant-growth-svg" viewBox="0 0 50 50"><path d="M25,42 L25,18" fill="none" stroke="#16a34a" stroke-width="4"/><circle cx="25" cy="14" r="7" fill="#fbbf24"/><circle cx="25" cy="7" r="4" fill="#ef4444"/><circle cx="32" cy="14" r="4" fill="#ef4444"/><circle cx="18" cy="14" r="4" fill="#ef4444"/><circle cx="25" cy="21" r="4" fill="#ef4444"/><line x1="10" y1="42" x2="40" y2="42" stroke="#78350f" stroke-width="3"/></svg>`;
            }
            
            plantWidget.innerHTML = plantStageSVG;
            var svgNode = plantWidget.querySelector('svg');
            if (svgNode) {
                svgNode.style.transform = `scale(${scale})`;
            }

            // गल्ती उत्तर हुँदा ओइलाएको देखाउने (Withered Class)
            if (answered && score < current) {
                plantWidget.classList.add('withered-plant');
            } else {
                plantWidget.classList.remove('withered-plant');
            }
        }
    }

    // प्रगति बारमा सिंचाइको छाल देखाउने क्यानभास एनिमेसन
    var waveOffsets = [0, Math.PI];
    
// Function animateWaterWave moved to external module


    // ३. मस्तिष्क-सञ्जाल शैलीको ज्ञान नक्सा (Neural-Network Knowledge Map)
    var origNavigate = window.navigate;
    window.navigate = function(pageId) {
        if (typeof origNavigate === 'function') {
            origNavigate(pageId);
        }
        // Run setups dynamically
        if (pageId === 'page-study-planner') {
            setup3DSeasonalWheel();
        }
        if (pageId === 'page-practice') {
            setTimeout(() => {
                if (typeof window.checkAndPromptResumeSession === 'function') {
                    window.checkAndPromptResumeSession();
                }
            }, 100);
        }
        let isElite = KrishiStorage.getItem('krishi_elite_animations') !== 'false';
        if (isElite) {
            if (pageId === 'page-study-planner') {
                setupNeuralMindMap();
            } else if (pageId === 'page-home') {
                setTimeout(initNepalGlobe, 50);
            }
        }
    };

    window.navigateTab = function(pageId) {
        // Absolute Practice Suite session cleanup & view isolation on any tab switch
        let mcqPage = document.getElementById('page-mcq');
        let resPanel = document.getElementById('practice-result-panel');
        let activePanels = document.getElementById('practice-active-state-panels');
        if (mcqPage) mcqPage.classList.add('hidden');
        if (resPanel) resPanel.classList.add('hidden');
        if (activePanels) activePanels.classList.remove('hidden');
        
        if (typeof stopTimer === 'function') stopTimer();
        if (state && state.perQuestionTimerInterval) {
            clearInterval(state.perQuestionTimerInterval);
            state.perQuestionTimerInterval = null;
        }

        if (pageId !== 'page-practice') {
            // Navigation reset removed. Session key tracking handles re-entry cleanly.
        }
        if (typeof window.navigate === 'function') {
            window.navigate(pageId);
        }
        if (typeof playSound === 'function') {
            playSound('click');
        }
    };

    function setupNeuralMindMap() {
        var plannerPage = document.getElementById('page-study-planner');
        if (!plannerPage) return;

        var mapCard = document.getElementById('neural-map-widget-container');
        if (!mapCard) {
            mapCard = document.createElement('div');
            mapCard.id = 'neural-map-widget-container';
            mapCard.className = 'neural-mindmap-card';
            mapCard.style.background = 'transparent';
            mapCard.style.border = 'none';
            
            // Robust Sibling Search by Text Content
            var syllabusCard = null;
            var divs = plannerPage.querySelectorAll('div');
            for (var i = 0; i < divs.length; i++) {
                if (divs[i].textContent.includes('Advanced Syllabus Tracker')) {
                    syllabusCard = divs[i].closest('.animate-slide-up');
                    break;
                }
            }

            if (syllabusCard) {
                syllabusCard.parentNode.insertBefore(mapCard, syllabusCard);
            } else {
                plannerPage.appendChild(mapCard);
            }
        }
        
        let isElite = KrishiStorage.getItem('krishi_elite_animations') !== 'false';
        if (!isElite) {
            mapCard.style.display = 'none';
            return;
        } else {
            mapCard.style.display = 'block';
        }

        mapCard.innerHTML = `
            <span class="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-1">🧠 Subjects Competence Neural Mindmap</span>
            <canvas class="neural-canvas cursor-grab active:cursor-grabbing"></canvas>
        `;
        
        if (typeof window.init3DSyllabusDome === 'function') {
            window.init3DSyllabusDome(mapCard.querySelector('.neural-canvas'));
        } else {
            drawNeuralMap(mapCard.querySelector('.neural-canvas'));
        }
    }

    
// Function drawNeuralMap moved to external module


    // ४. मौसम अनुकूल वातावरणीय पृष्ठभूमि क्यानभास
    var bgCanvas = document.createElement('canvas');
    bgCanvas.id = 'weather-ambient-canvas';
    document.body.insertBefore(bgCanvas, document.body.firstChild);
    var bgCtx = bgCanvas.getContext('2d');
    var bgParticles = [];
    var lastSeasonIdx = 0;
    var weatherFrontTransition = null;
    var weatherFrontSparks = [];

    function initBgCanvas() {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;
    }
    window.addEventListener('resize', initBgCanvas);
    initBgCanvas();

    function drawAmbientBackground() {
        let eliteEnabled = KrishiStorage.getItem('krishi_elite_animations') !== 'false';
        if (!eliteEnabled || document.hidden) {
            bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
            setTimeout(() => {
                requestAnimationFrame(drawAmbientBackground);
            }, 300);
            return;
        }

        if (bgCanvas.width !== window.innerWidth || bgCanvas.height !== window.innerHeight) {
            bgCanvas.width = window.innerWidth;
            bgCanvas.height = window.innerHeight;
        }

        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        
        let baseDensity = (window.EliteAnimsConfig && typeof window.EliteAnimsConfig.weatherParticleDensity !== 'undefined') ? window.EliteAnimsConfig.weatherParticleDensity : 25;
        let maxP = window.EliteAnimsConfig.throttled ? Math.round(baseDensity * 0.5) : baseDensity;
        let spawnRate = 0.02 + (maxP / 50) * 0.08;
        let season = typeof activeSeasonIdx !== 'undefined' ? activeSeasonIdx : 0;

        // Detect season change to trigger the cinematic Weather Front Wave!
        if (season !== lastSeasonIdx) {
            let transitionColors = [
                'rgba(59, 130, 246, 0.4)',  // Kharif - Cool Blue Rainwave
                'rgba(245, 158, 11, 0.35)', // Autumn - Amber Leaves Gust
                'rgba(16, 185, 129, 0.3)'   // Spring - Emerald Pollen Bloom
            ];
            weatherFrontTransition = {
                progress: 0,
                fromSeason: lastSeasonIdx,
                toSeason: season,
                color: transitionColors[season] || 'rgba(16, 185, 129, 0.3)'
            };
            lastSeasonIdx = season;
            
            if (typeof window.triggerHaptic === 'function') {
                window.triggerHaptic('success');
            }
        }
        
        if (Math.random() < spawnRate && bgParticles.length < maxP) {
            if (season === 0) { // Kharif - Monsoon Rain
                bgParticles.push({
                    type: 'rain',
                    x: Math.random() * bgCanvas.width,
                    y: -20,
                    vy: 3.5 + Math.random() * 3.5,
                    vx: -1.0 - Math.random() * 1.5,
                    len: 8 + Math.random() * 12,
                    color: 'rgba(59, 130, 246, 0.14)'
                });
            } else if (season === 1) { // Autumn Leaves
                bgParticles.push({
                    type: 'leaf',
                    x: Math.random() * bgCanvas.width,
                    y: -20,
                    vy: 0.8 + Math.random() * 1.0,
                    vx: (Math.random() - 0.5) * 1.2,
                    r: 4 + Math.random() * 4,
                    wiggle: Math.random() * 10,
                    wiggleSpeed: 0.02 + Math.random() * 0.02,
                    color: ['rgba(249, 115, 22, 0.12)', 'rgba(234, 179, 8, 0.12)', 'rgba(194, 65, 12, 0.12)'][Math.floor(Math.random() * 3)]
                });
            } else { // Spring Pollen
                bgParticles.push({
                    type: 'pollen',
                    x: Math.random() * bgCanvas.width,
                    y: bgCanvas.height + 20,
                    vy: -0.3 - Math.random() * 0.6,
                    vx: (Math.random() - 0.5) * 0.8,
                    r: 1.5 + Math.random() * 2.5,
                    wiggle: Math.random() * 10,
                    wiggleSpeed: 0.01 + Math.random() * 0.015,
                    color: 'rgba(16, 185, 129, 0.12)'
                });
            }
        }

        for (var i = bgParticles.length - 1; i >= 0; i--) {
            var p = bgParticles[i];
            
            if (p.type === 'rain') {
                p.y += p.vy;
                p.x += p.vx;
                bgCtx.beginPath();
                bgCtx.moveTo(p.x, p.y);
                bgCtx.lineTo(p.x + p.vx * 1.2, p.y + p.vy * 1.2);
                bgCtx.strokeStyle = p.color;
                bgCtx.lineWidth = 1.0;
                bgCtx.stroke();
                
                if (p.y > bgCanvas.height || p.x < -20) {
                    bgParticles.splice(i, 1);
                }
            } else if (p.type === 'leaf') {
                p.y += p.vy;
                p.wiggle += p.wiggleSpeed;
                p.x += p.vx + Math.sin(p.wiggle) * 0.4;
                
                bgCtx.save();
                bgCtx.translate(p.x, p.y);
                bgCtx.rotate(Math.sin(p.wiggle) * 0.3);
                bgCtx.beginPath();
                bgCtx.ellipse(0, 0, p.r * 1.4, p.r * 0.8, 0, 0, Math.PI * 2);
                bgCtx.fillStyle = p.color;
                bgCtx.fill();
                bgCtx.restore();

                if (p.y > bgCanvas.height + 20) {
                    bgParticles.splice(i, 1);
                }
            } else if (p.type === 'pollen') {
                p.y += p.vy;
                p.wiggle += p.wiggleSpeed;
                p.x += p.vx + Math.sin(p.wiggle) * 0.2;
                
                bgCtx.beginPath();
                bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                bgCtx.fillStyle = p.color;
                bgCtx.fill();

                if (p.y < -20) {
                    bgParticles.splice(i, 1);
                }
            }
        }

        // Draw dynamic organic front wave if transition is running
        if (weatherFrontTransition) {
            weatherFrontTransition.progress += 0.015; // smooth speed
            let prog = weatherFrontTransition.progress;
            
            if (prog >= 1.0) {
                weatherFrontTransition = null;
            } else {
                let sweepX = prog * (bgCanvas.width + 200) - 100;
                let segments = 20;
                let segmentHeight = bgCanvas.height / segments;

                // --- 1. Secondary Trailing Parallax Wave ---
                let trailSweepX = sweepX - 80;
                bgCtx.save();
                bgCtx.beginPath();
                for (let j = 0; j <= segments; j++) {
                    let y = j * segmentHeight;
                    let wiggle = Math.sin(y * 0.02 + prog * 8) * 35 * Math.sin(prog * Math.PI);
                    let x = trailSweepX + wiggle;
                    if (j === 0) bgCtx.moveTo(x, y);
                    else bgCtx.lineTo(x, y);
                }
                let softColor = weatherFrontTransition.color.replace('0.4', '0.2').replace('0.35', '0.2').replace('0.3', '0.15');
                bgCtx.strokeStyle = softColor;
                bgCtx.lineWidth = 2.5;
                bgCtx.shadowBlur = 10;
                bgCtx.shadowColor = softColor;
                bgCtx.stroke();
                bgCtx.restore();

                // --- 2. Primary Wave Fill ---
                bgCtx.save();
                bgCtx.beginPath();
                bgCtx.moveTo(0, 0);
                for (let j = 0; j <= segments; j++) {
                    let y = j * segmentHeight;
                    let wiggle = Math.sin(y * 0.015 + prog * 12) * 50 * Math.sin(prog * Math.PI);
                    let x = sweepX + wiggle;
                    bgCtx.lineTo(x, y);
                }
                bgCtx.lineTo(0, bgCanvas.height);
                bgCtx.closePath();
                
                let grad = bgCtx.createLinearGradient(sweepX - 250, 0, sweepX + 50, 0);
                let opacityFill = '0.08';
                grad.addColorStop(0, weatherFrontTransition.color.replace('0.4', opacityFill).replace('0.35', opacityFill).replace('0.3', opacityFill));
                grad.addColorStop(0.8, weatherFrontTransition.color);
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                bgCtx.fillStyle = grad;
                bgCtx.fill();
                
                // --- 3. Neon Glowing Primary Front Edge ---
                bgCtx.beginPath();
                for (let j = 0; j <= segments; j++) {
                    let y = j * segmentHeight;
                    let wiggle = Math.sin(y * 0.015 + prog * 12) * 50 * Math.sin(prog * Math.PI);
                    let x = sweepX + wiggle;
                    if (j === 0) bgCtx.moveTo(x, y);
                    else bgCtx.lineTo(x, y);
                }
                let glowColor = weatherFrontTransition.color.replace('0.4', '0.85').replace('0.35', '0.85').replace('0.3', '0.85');
                bgCtx.strokeStyle = glowColor;
                bgCtx.lineWidth = 4.5;
                bgCtx.shadowBlur = 25;
                bgCtx.shadowColor = glowColor;
                bgCtx.stroke();
                bgCtx.restore();

                // --- 4. Spawn Glowing Transition Sparks ---
                if (Math.random() < 0.6) {
                    let spawnY = Math.random() * bgCanvas.height;
                    let wiggle = Math.sin(spawnY * 0.015 + prog * 12) * 50 * Math.sin(prog * Math.PI);
                    let sparkX = sweepX + wiggle;
                    weatherFrontSparks.push({
                        x: sparkX,
                        y: spawnY,
                        vx: -1.5 - Math.random() * 2.5,
                        vy: (Math.random() - 0.5) * 1.5,
                        alpha: 1.0,
                        size: 2.0 + Math.random() * 3.5,
                        color: glowColor
                    });
                }

                // Dissolve old season particles passed by sweep front
                for (let i = bgParticles.length - 1; i >= 0; i--) {
                    let p = bgParticles[i];
                    if (p.x < sweepX) {
                        let belongsToNewSeason = 
                            (weatherFrontTransition.toSeason === 0 && p.type === 'rain') ||
                            (weatherFrontTransition.toSeason === 1 && p.type === 'leaf') ||
                            (weatherFrontTransition.toSeason === 2 && p.type === 'pollen');
                        if (!belongsToNewSeason) {
                            bgParticles.splice(i, 1);
                        }
                    }
                }
                
                // Dynamically seed new season particles behind the front wave
                if (bgParticles.length < maxP && Math.random() < 0.25) {
                    let spawnX = Math.random() * sweepX;
                    if (spawnX > 0 && spawnX < bgCanvas.width) {
                        if (weatherFrontTransition.toSeason === 0) {
                            bgParticles.push({
                                type: 'rain',
                                x: spawnX,
                                y: -20 - Math.random() * 50,
                                vy: 3.5 + Math.random() * 3.5,
                                vx: -1.0 - Math.random() * 1.5,
                                len: 8 + Math.random() * 12,
                                color: 'rgba(59, 130, 246, 0.14)'
                            });
                        } else if (weatherFrontTransition.toSeason === 1) {
                            bgParticles.push({
                                type: 'leaf',
                                x: spawnX,
                                y: -20 - Math.random() * 50,
                                vy: 0.8 + Math.random() * 1.0,
                                vx: (Math.random() - 0.5) * 1.2,
                                r: 4 + Math.random() * 4,
                                wiggle: Math.random() * 10,
                                wiggleSpeed: 0.02 + Math.random() * 0.02,
                                color: ['rgba(249, 115, 22, 0.12)', 'rgba(234, 179, 8, 0.12)', 'rgba(194, 65, 12, 0.12)'][Math.floor(Math.random() * 3)]
                            });
                        } else {
                            bgParticles.push({
                                type: 'pollen',
                                x: spawnX,
                                y: bgCanvas.height + 20 + Math.random() * 50,
                                vy: -0.3 - Math.random() * 0.6,
                                vx: (Math.random() - 0.5) * 0.8,
                                r: 1.5 + Math.random() * 2.5,
                                wiggle: Math.random() * 10,
                                wiggleSpeed: 0.01 + Math.random() * 0.015,
                                color: 'rgba(16, 185, 129, 0.12)'
                            });
                        }
                    }
                }
            }
        }

        // --- 5. Update and Draw Sparks ---
        for (let i = weatherFrontSparks.length - 1; i >= 0; i--) {
            let s = weatherFrontSparks[i];
            s.x += s.vx;
            s.y += s.vy;
            s.alpha -= 0.022; // smooth fade-out rate
            if (s.alpha <= 0) {
                weatherFrontSparks.splice(i, 1);
            } else {
                bgCtx.save();
                bgCtx.beginPath();
                bgCtx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
                bgCtx.shadowBlur = 12;
                bgCtx.shadowColor = s.color;
                let alphaColor = s.color.replace('0.85', s.alpha).replace('1.0', s.alpha);
                bgCtx.fillStyle = alphaColor;
                bgCtx.fill();
                bgCtx.restore();
            }
        }
        requestAnimationFrame(drawAmbientBackground);
    }
    drawAmbientBackground();

    // ५. कन्सेप्ट स्क्यान लेजर बीम एनिमेसन
    function triggerLaserScanEffect(parentContainer) {
        if (!parentContainer) return;
        var overlay = parentContainer.querySelector('.specular-scan-beam-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'specular-scan-beam-overlay';
            overlay.innerHTML = '<div class="specular-laser-line"></div>';
            parentContainer.style.position = 'relative';
            parentContainer.appendChild(overlay);
        }
        
        overlay.style.display = 'block';
        setTimeout(function() {
            overlay.style.display = 'none';
        }, 2500); // २.५ सेकेन्डसम्म चल्ने
    }

    // पुरानो स्क्यान प्रक्रिया सुरु हुँदा स्वतः लेजर बीम अन गर्ने हुक
    var origProcessFile = window.processFile;
    window.processFile = function() {
        var box = document.querySelector('#page-file-scan .border');
        if (box) triggerLaserScanEffect(box);
        if (typeof origProcessFile === 'function') {
            origProcessFile();
        }
    };

    var origProcessScan = window.processScan;
    window.processScan = function() {
        var box = document.getElementById('page-smart-scan');
        if (box) triggerLaserScanEffect(box);
        if (typeof origProcessScan === 'function') {
            origProcessScan();
        }
    };

    // ६. ३डी ऋतु चक्र र बाली चक्र कनवर्टर (3D Interactive Crop Wheel)
    var activeSeasonIdx = 0;
    window.updateActiveSeasonIndex = function(idx) {
        activeSeasonIdx = idx;
    };
    var seasonsData = [
        { name: "वर्षा (Kharif)", angle: 0, crops: "धान, मकै, कोदो, भटमास", tip: "यो मौसममा सिंचाइ र ढुसीजन्य रोगको बढी सम्भावना हुन्छ। सिंचाइ र वनस्पति रोगको पाठ्यक्रम दोहोर्‍याउनुहोस्।" },
        { name: "शरद (Autumn)", angle: 120, crops: "तोरी, आलु, सागपात, तोरी", tip: "यो माटोमा मल र नाइट्रोजनको मात्रा मिलाउन आवश्यक समय हो। माटो विज्ञान र मलको राम्रो अध्ययन गर्नुहोस्।" },
        { name: "वसन्त (Winter)", angle: 240, crops: "गहुँ, प्याज, गोलभेडा, चना", tip: "कीट नियन्त्रण (IPM) र हरितगृह व्यवस्थापनको परीक्षा प्रश्नहरूमा बढी ध्यान दिनुहोस्।" }
    ];

    function setup3DSeasonalWheel() {
        var plannerPage = document.getElementById('page-study-planner');
        if (!plannerPage) return;

        var wheelCard = document.getElementById('3d-crop-wheel-widget');
        if (!wheelCard) {
            wheelCard = document.createElement('div');
            wheelCard.id = '3d-crop-wheel-widget';
            wheelCard.className = 'seasonal-crop-wheel-card';
            
            // स्टडी प्लानरको अन्त्यमा थप्ने
            plannerPage.appendChild(wheelCard);
        }

        renderCropWheel();
    }

    function renderCropWheel() {
        var widget = document.getElementById('3d-crop-wheel-widget');
        if (!widget) return;

        // Reset and trigger dynamic organic glow pulse animations
        widget.classList.remove('pulse-glow-kharif', 'pulse-glow-autumn', 'pulse-glow-winter');
        let pulseClasses = ['pulse-glow-kharif', 'pulse-glow-autumn', 'pulse-glow-winter'];
        let activePulseClass = pulseClasses[activeSeasonIdx];
        if (activePulseClass) {
            void widget.offsetWidth; // Force hardware reflow to restart CSS keyframes
            widget.classList.add(activePulseClass);
        }

        var current = seasonsData[activeSeasonIdx];
        let isElite = KrishiStorage.getItem('krishi_elite_animations') !== 'false';

        if (isElite) {
            widget.innerHTML = `
                <span class="text-[9px] font-black uppercase text-slate-400 tracking-wider block text-center">📅 ३डी ऋतु चक्र र बाली सिफारिस (Nepal Seasonal Crop Wheel)</span>
                <div class="crop-wheel-3d-wrapper" style="width: 100%; height: 100px;">
                    <canvas id="carousel-3d-canvas" class="w-full h-[100px] cursor-pointer"></canvas>
                </div>
                <div class="text-center space-y-1">
                    <p class="text-xs font-black text-slate-850 dark:text-slate-100">🌾 सिफारिस बाली: <span id="carousel-3d-crops" class="text-emerald-500">${current.crops}</span></p>
                    <p id="carousel-3d-tip" class="text-[10px] text-slate-400 leading-relaxed px-4">${current.tip}</p>
                </div>
                <button id="btn-rotate-wheel" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] rounded-lg cursor-pointer transition">
                    अर्को ऋतु परिवर्तन गर्नुहोस् 🔄
                </button>
            `;

            if (typeof window.init3DSeasonalCarousel === 'function') {
                window.init3DSeasonalCarousel(document.getElementById('carousel-3d-canvas'));
            }

            widget.querySelector('#btn-rotate-wheel').onclick = function() {
                if (typeof window.rotateSeasonal3DCarousel === 'function') {
                    window.rotateSeasonal3DCarousel();
                } else {
                    window.triggerHaptic('click');
                    activeSeasonIdx = (activeSeasonIdx + 1) % seasonsData.length;
                    renderCropWheel();
                }
            };
        } else {
            widget.innerHTML = `
                <span class="text-[9px] font-black uppercase text-slate-400 tracking-wider block text-center">📅 ३डी ऋतु चक्र र बाली सिफारिस (Nepal Seasonal Crop Wheel)</span>
                <div class="crop-wheel-3d-wrapper">
                    <div class="crop-wheel-circle" style="--crop-angle: ${current.angle}deg;">
                        <div style="transform: rotateZ(${-current.angle}deg);">${current.name}</div>
                    </div>
                </div>
                <div class="text-center space-y-1">
                    <p class="text-xs font-black text-slate-800 dark:text-slate-100">🌾 सिफारिस बाली: <span class="text-emerald-500">${current.crops}</span></p>
                    <p class="text-[10px] text-slate-400 leading-relaxed px-4">${current.tip}</p>
                </div>
                <button id="btn-rotate-wheel" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] rounded-lg cursor-pointer transition">
                    अर्को ऋतु परिवर्तन गर्नुहोस् 🔄
                </button>
            `;

            widget.querySelector('#btn-rotate-wheel').onclick = function() {
                window.triggerHaptic('click');
                activeSeasonIdx = (activeSeasonIdx + 1) % seasonsData.length;
                renderCropWheel();
            };
        }
    }

    console.log('[Spec 2026 Enhanced Animations] Activated smoothly!');
})();

// एकीकृत सुरक्षित अभ्यास प्रोग्रेस सेभर (Unified Secure Practice Progress Saver)
function savePracticeProgress() {
    try {
        // A session that has ended must never be persisted again. finishSession() clears the
        // saved-practice record and then calls saveData(), and saveData() calls back into
        // this function — so without these two guards the finished session was written
        // straight back over its own tombstone, both locally and (via the debounce below)
        // to Firestore. That resurrected record is what the other device then offered as a
        // "live session on peer device", and resuming it re-saved it, looping forever.
        if (state && state.isFinishing) return;
        if (state && state.questions && state.currentIndex >= state.questions.length) return;

        if (state && state.questions && state.questions.length > 0 && !state.answered) {
            // Abort saving if it's a completely fresh, untouched session (0% progress)
            // This prevents "ghost popups" from appearing if the user accidentally clicks a subject and leaves immediately.
            if (state.currentIndex === 0 && state.score === 0 && (!state.sessionResults || state.sessionResults.length === 0)) {
                return;
            }

            const progressData = {
                questions: state.questions,
                currentIndex: state.currentIndex,
                score: state.score,
                sessionResults: state.sessionResults,
                isMock: state.isMock,
                timerSec: state.timerSec,
                timeSpentArray: state.timeSpentArray,
                totalTimeSpent: state.totalTimeSpent,
                updatedAt: Date.now(),
                device: (window.Capacitor && window.Capacitor.getPlatform) ? (window.Capacitor.getPlatform() === 'android' ? 'Android App' : 'Web Browser') : 'Web Browser'
            };
            KrishiStorage.setItem('krishi_saved_practice', JSON.stringify(progressData));

            // Update UI Autosave indicator HUD
            let indicator = document.getElementById('game-autosave-indicator');
            if (indicator) {
                let dot = indicator.querySelector('span');
                let txt = indicator.querySelector('.indicator-text');
                if (dot && txt) {
                    dot.className = 'w-1.5 h-1.5 rounded-full transition-colors duration-300';
                    dot.classList.add('autosave-glow-active');
                    txt.textContent = 'Saving...';
                    txt.style.color = '#10b981';
                }
            }

            // Sync to Firestore if online and authenticated (Debounced)
            const uid = (typeof getCloudUID === 'function') ? getCloudUID() : null;
            if (uid && navigator.onLine && window.firebase && firebase.apps && firebase.apps.length) {
                if (window.cloudSavePracticeTimeout) clearTimeout(window.cloudSavePracticeTimeout);
                window.cloudSavePracticeTimeout = setTimeout(() => {
                    let existingApp = firebase.apps.find(app => app.name === "KrishiApp");
                    let firebaseApp = existingApp || firebase.app("KrishiApp");
                    if (firebaseApp) {
                        const firestore = firebase.firestore(firebaseApp);
                        firestore.collection('users').doc(uid).collection('active_session').doc('progress').set(progressData).then(() => {
                            console.log('[Cloud Sync] Active practice session saved successfully (Debounced).');
                            if (indicator) {
                                let dot = indicator.querySelector('span');
                                let txt = indicator.querySelector('.indicator-text');
                                if (dot && txt) {
                                    dot.className = 'w-1.5 h-1.5 rounded-full transition-colors duration-300';
                                    dot.classList.add('autosave-glow-active');
                                    txt.textContent = 'Autosaved';
                                    txt.style.color = '#10b981';
                                    setTimeout(() => {
                                        if (txt.textContent === 'Autosaved') {
                                            txt.textContent = 'Connected';
                                            txt.style.color = '';
                                        }
                                    }, 2000);
                                }
                            }
                        }).catch(err => {
                            console.warn('[Cloud Sync] Active practice session save failed:', err);
                            if (indicator) {
                                let dot = indicator.querySelector('span');
                                let txt = indicator.querySelector('.indicator-text');
                                if (dot && txt) {
                                    dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-350 dark:bg-slate-600 transition-colors duration-300';
                                    txt.textContent = 'Local Only';
                                    txt.style.color = '';
                                }
                            }
                        });
                    }
                }, 3000);
            } else {
                // local only / offline HUD update
                setTimeout(() => {
                    if (indicator) {
                        let dot = indicator.querySelector('span');
                        let txt = indicator.querySelector('.indicator-text');
                        if (dot && txt) {
                            dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-350 dark:bg-slate-600 transition-colors duration-300';
                            txt.textContent = uid ? 'Offline' : 'Local Only';
                            txt.style.color = '';
                        }
                    }
                }, 1000);
            }
        }
    } catch (error) {
        console.warn("[State Safety] savePracticeProgress failed safely:", error);
    }
}

// २. सुरक्षित राखिएको अधुरो अभ्यासलाई हटाउने फङ्सन
function clearPracticeProgress() {
    try {
        // Cancel any autosave that savePracticeProgress() scheduled but has not yet flushed.
        // That write is debounced 3000ms; if it fires after we set the tombstone below it
        // re-uploads the full (now finished) session and undoes the clear — the exact race
        // that made a completed session reappear as "live on peer device".
        if (window.cloudSavePracticeTimeout) {
            clearTimeout(window.cloudSavePracticeTimeout);
            window.cloudSavePracticeTimeout = null;
        }
        KrishiStorage.setItem('krishi_local_session_tombstone', Date.now());
        KrishiStorage.removeItem('krishi_saved_practice');
        
        const uid = (typeof getCloudUID === 'function') ? getCloudUID() : null;
        if (uid && navigator.onLine && window.firebase && firebase.apps && firebase.apps.length) {
            let existingApp = firebase.apps.find(app => app.name === "KrishiApp");
            let firebaseApp = existingApp || firebase.app("KrishiApp");
            if (firebaseApp) {
                const firestore = firebase.firestore(firebaseApp);
                // Instead of deleting, set a tombstone so other devices know it was cleared
                firestore.collection('users').doc(uid).collection('active_session').doc('progress').set({
                    isCleared: true,
                    clearedAt: Date.now()
                })
                .then(() => console.log('[Cloud Sync] Active practice session cleared (Tombstone set).'))
                .catch(err => console.warn('[Cloud Sync] Active practice session clear failed:', err));
            }
        }
    } catch (e) {
        console.warn("[State Safety] clearPracticeProgress failed safely:", e);
    }
}
// ==================== GLOBAL TOUCH/CLICK RIPPLE INJECTOR ====================
// यसले उत्तर छनौट गर्दा औंलाले छोएको ठाउँबाट पानीको लहर फैलाउँछ
document.addEventListener('click', function(e) {
    let btn = e.target.closest('.option-btn');
    if (!btn) return;
    
    // गोलो लहरको तत्व सिर्जना गर्ने
    let ripple = document.createElement('span');
    ripple.className = 'click-ripple';
    
    let rect = btn.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    
    // तरंगको आकार बटनको साइज अनुसार मिलाउने
    let size = Math.max(rect.width, rect.height);
    ripple.style.width = size + 'px';
    ripple.style.height = size + 'px';
    
    ripple.style.left = (x - size / 2) + 'px';
    ripple.style.top = (y - size / 2) + 'px';
    
    btn.appendChild(ripple);
    
    // काम सकिएपछि तत्व हटाउने
    setTimeout(() => {
        ripple.remove();
    }, 500);
});

// ==================== DYNAMIC FIREBASE CONFIG & OCR PREPROCESS HELPERS ====================
window.preprocessImageForOCR = function(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imgData.data;
                let totalLuma = 0;
                const len = data.length;
                for (let i = 0; i < len; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    totalLuma += gray;
                }
                const avgLuma = totalLuma / (len / 4);
                const threshold = Math.max(80, Math.min(180, avgLuma * 0.9));
                
                for (let i = 0; i < len; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    if (gray > threshold) {
                        gray = 255;
                    } else {
                        gray = 0;
                    }
                    data[i] = gray;
                    data[i + 1] = gray;
                    data[i + 2] = gray;
                }
                
                ctx.putImageData(imgData, 0, 0);
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(img.src);
                    if (blob) {
                        resolve(blob);
                    } else {
                        resolve(file);
                    }
                }, 'image/png');
            } catch(e) {
                console.warn('[OCR Preprocessing] Binarization error:', e);
                resolve(file);
            }
        };
        img.onerror = (err) => {
            console.warn('[OCR Preprocessing] Image load error:', err);
            resolve(file);
        };
    });
};

window.openCloudConfigModal = function() {
    const modal = document.getElementById('cloud-config-modal');
    if (!modal) return;
    
    let config = null;
    try {
        config = JSON.parse(KrishiStorage.getItem('krishi_firebase_config'));
    } catch(e) {}
    
    const textarea = document.getElementById('firebase-config-json-textarea');
    const fieldApiKey = document.getElementById('firebase-field-apiKey');
    const fieldAuthDomain = document.getElementById('firebase-field-authDomain');
    const fieldDatabaseURL = document.getElementById('firebase-field-databaseURL');
    const fieldProjectId = document.getElementById('firebase-field-projectId');
    
    if (textarea) textarea.value = config ? JSON.stringify(config, null, 2) : '';
    if (fieldApiKey) fieldApiKey.value = config ? (config.apiKey || '') : '';
    if (fieldAuthDomain) fieldAuthDomain.value = config ? (config.authDomain || '') : '';
    if (fieldDatabaseURL) fieldDatabaseURL.value = config ? (config.databaseURL || '') : '';
    if (fieldProjectId) fieldProjectId.value = config ? (config.projectId || '') : '';
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeCloudConfigModal = function() {
    const modal = document.getElementById('cloud-config-modal');
    if (!modal) return;
    modal.classList.remove('flex');
    modal.classList.add('hidden');
};

window.autoParseFirebaseJSON = function(val) {
    if (!val.trim()) return;
    try {
        let cleanVal = val.trim();
        if (cleanVal.includes('=')) {
            cleanVal = cleanVal.substring(cleanVal.indexOf('{'));
        }
        if (cleanVal.endsWith(';')) {
            cleanVal = cleanVal.substring(0, cleanVal.length - 1);
        }
        
        let parsed = null;
        try {
            parsed = JSON.parse(cleanVal);
        } catch(e) {
            parsed = Function('"use strict";return (' + cleanVal + ')')();
        }
        
        if (parsed && typeof parsed === 'object') {
            const fieldApiKey = document.getElementById('firebase-field-apiKey');
            const fieldAuthDomain = document.getElementById('firebase-field-authDomain');
            const fieldDatabaseURL = document.getElementById('firebase-field-databaseURL');
            const fieldProjectId = document.getElementById('firebase-field-projectId');
            
            if (parsed.apiKey && fieldApiKey) fieldApiKey.value = parsed.apiKey;
            if (parsed.authDomain && fieldAuthDomain) fieldAuthDomain.value = parsed.authDomain;
            if (parsed.databaseURL && fieldDatabaseURL) fieldDatabaseURL.value = parsed.databaseURL;
            if (parsed.projectId && fieldProjectId) fieldProjectId.value = parsed.projectId;
        }
    } catch(e) {}
};

window.saveCloudConfig = function() {
    const fieldApiKey = document.getElementById('firebase-field-apiKey').value.trim();
    const fieldAuthDomain = document.getElementById('firebase-field-authDomain').value.trim();
    const fieldDatabaseURL = document.getElementById('firebase-field-databaseURL').value.trim();
    const fieldProjectId = document.getElementById('firebase-field-projectId').value.trim();
    
    if (!fieldApiKey || !fieldAuthDomain || !fieldDatabaseURL || !fieldProjectId) {
        showToast('All four core fields (apiKey, authDomain, databaseURL, projectId) are required!');
        return;
    }
    
    // Check if we can parse the complete object from the textarea to preserve all fields
    const textarea = document.getElementById('firebase-config-json-textarea');
    let config = null;
    if (textarea && textarea.value.trim()) {
        try {
            let cleanVal = textarea.value.trim();
            if (cleanVal.includes('=')) {
                cleanVal = cleanVal.substring(cleanVal.indexOf('{'));
            }
            if (cleanVal.endsWith(';')) {
                cleanVal = cleanVal.substring(0, cleanVal.length - 1);
            }
            try {
                config = JSON.parse(cleanVal);
            } catch(e) {
                config = Function('"use strict";return (' + cleanVal + ')')();
            }
        } catch(e) {
            console.warn('[Firebase Config Save] Failed to parse textarea JSON:', e);
        }
    }
    
    // If not parsed successfully or does not match inputs, build a clean one
    if (!config || typeof config !== 'object' || config.apiKey !== fieldApiKey || config.projectId !== fieldProjectId) {
        config = {
            apiKey: fieldApiKey,
            authDomain: fieldAuthDomain,
            databaseURL: fieldDatabaseURL,
            projectId: fieldProjectId,
            storageBucket: fieldProjectId + ".appspot.com",
            messagingSenderId: "123456789",
            appId: "1:123456789:web:abcdef123456"
        };
    } else {
        // Enforce the edited inputs if they were modified manually after parsing
        config.apiKey = fieldApiKey;
        config.authDomain = fieldAuthDomain;
        config.databaseURL = fieldDatabaseURL;
        config.projectId = fieldProjectId;
    }
    
    try {
        KrishiStorage.setItem('krishi_firebase_config', JSON.stringify(config));
        showToast('Firebase Config saved! App reloading...');
        closeCloudConfigModal();
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch(e) {
        showToast('Failed to save config: ' + e.message);
    }
};

window.resetCloudConfig = function() {
    if (confirm('Are you sure you want to delete your custom Firebase configuration and restore the default one?')) {
        KrishiStorage.removeItem('krishi_firebase_config');
        showToast('Firebase configuration reset to default. App reloading...');
        closeCloudConfigModal();
        setTimeout(() => {
            window.location.reload();
        }, 1200);
    }
};

window.toggleEliteAnimationsSetting = function() {
    let checkbox = document.getElementById('elite-animations-enabled');
    if (!checkbox) return;
    let isEnabled = checkbox.checked;
    KrishiStorage.setItem('krishi_elite_animations', isEnabled ? 'true' : 'false');
    stampSetting('eliteAnimations');
    
    let bgCanvasEl = document.getElementById('weather-ambient-canvas');
    if (bgCanvasEl) {
        bgCanvasEl.style.display = isEnabled ? 'block' : 'none';
    }
    
    let globeCard = document.getElementById('home-nepal-globe-card');
    if (globeCard) {
        globeCard.style.display = isEnabled ? 'block' : 'none';
        if (isEnabled) {
            setTimeout(initNepalGlobe, 50);
        }
    }
    
    let activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-study-planner') {
        setup3DSeasonalWheel();
        if (isEnabled) {
            setupNeuralMindMap();
        } else {
            let neuralCard = document.getElementById('neural-map-widget-container');
            if (neuralCard) {
                neuralCard.style.display = 'none';
            }
        }
    } else if (isEnabled && activePage && activePage.id === 'page-home') {
        initNepalGlobe();
    }
    
    updateHomePage();
    
    if (isEnabled && typeof window.triggerHaptic === 'function') {
        window.triggerHaptic('correct');
    }
};

window.initEliteAnimationsUI = function() {
    let saved = KrishiStorage.getItem('krishi_elite_animations') !== 'false';
    let el = document.getElementById('elite-animations-enabled');
    if (el) {
        el.checked = saved;
    }
    
    let bgCanvasEl = document.getElementById('weather-ambient-canvas');
    if (bgCanvasEl) {
        bgCanvasEl.style.display = saved ? 'block' : 'none';
    }
    
    let globeCard = document.getElementById('home-nepal-globe-card');
    if (globeCard) {
        globeCard.style.display = saved ? 'block' : 'none';
        if (saved) {
            setTimeout(initNepalGlobe, 50);
        }
    }
};

window.initNepalGlobe = function() {
    // Completely removed as requested
};

// ==================== CAPACITOR NATIVE FEATURES INITIALIZATION ====================
// Feature 5: Back Button Handler + Feature 11: In-App Update
// Only activates in native APK — zero effect on browser/PWA
(function initCapacitorNativeFeatures() {
    'use strict';

    const isCapacitorNative = window.Capacitor &&
                              window.Capacitor.isNativePlatform &&
                              window.Capacitor.isNativePlatform();

    if (!isCapacitorNative) {
        console.log('[Capacitor] Running in browser/PWA mode — native features skipped.');
        return;
    }

    console.log('[Capacitor] Native platform detected — initializing native features.');

    // --- Feature 5: Smart Back Button Handler ---
    try {
        const AppPlugin = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if (AppPlugin) {
            AppPlugin.addListener('backButton', function(e) {
                // 1. Check if bottom sheet is open — close it first
                const sheet = document.getElementById('nav-bottom-sheet');
                if (sheet && sheet.classList.contains('sheet-open')) {
                    if (typeof window.closeNavSheet === 'function') {
                        window.closeNavSheet();
                    } else {
                        sheet.classList.remove('sheet-open');
                        const backdrop = document.getElementById('nav-sheet-backdrop');
                        if (backdrop) backdrop.classList.remove('sheet-backdrop-active');
                    }
                    return;
                }

                // 2. Check if any modal is open — close it
                const openModal = document.querySelector('.modal-overlay:not(.hidden), #home-customizer-modal:not(.hidden), #db-config-modal:not(.hidden)');
                if (openModal) {
                    openModal.classList.add('hidden');
                    return;
                }

                // 3. Check if we are in exam/mock gameplay
                const activePage = document.querySelector('.page.active');
                if (activePage && activePage.id === 'page-practice') {
                    // Check if nested MCQ gameplay is visible
                    const mcqPage = document.getElementById('page-mcq');
                    if (mcqPage && !mcqPage.classList.contains('hidden')) {
                        if (typeof window.confirmExitExam === 'function') {
                            window.confirmExitExam();
                        }
                        return;
                    }
                }

                // 4. Check if we are on a sub-page (not home)
                if (activePage && activePage.id !== 'page-home') {
                    // Navigate back to Home Hub
                    if (typeof navigate === 'function') {
                        navigate('page-home');
                    }
                    return;
                }

                // 5. We are on home page — confirm exit with double-tap
                const now = Date.now();
                if (window.__lastBackPress__ && (now - window.__lastBackPress__) < 2000) {
                    AppPlugin.exitApp();
                } else {
                    window.__lastBackPress__ = now;
                    if (typeof showToast === 'function') {
                        showToast('Exit गर्न Back एकपटक थप थिच्नुहोस् 👋');
                    }
                }
            });
            console.log('[BackButton] Native back button handler registered ✅');
        }
    } catch(backErr) {
        console.warn('[BackButton] Failed to register back button handler:', backErr);
    }

    // --- Feature 8: Status Bar Styling ---
    try {
        const StatusBar = window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
        if (StatusBar) {
            StatusBar.setStyle({ style: 'DARK' });
            StatusBar.setBackgroundColor({ color: '#0a1628' });
            console.log('[StatusBar] Dark status bar set ✅');
        }
    } catch(sbErr) {
        console.warn('[StatusBar] StatusBar styling failed (non-critical):', sbErr);
    }

    // --- Feature 11: In-App Update Check ---
    try {
        const AppUpdate = window.Capacitor.Plugins && window.Capacitor.Plugins.AppUpdate;
        if (AppUpdate) {
            AppUpdate.getAppUpdateInfo().then(function(info) {
                console.log('[AppUpdate] Update info:', info);
                if (info && info.updateAvailability === 2) { // UPDATE_AVAILABLE
                    // Show non-intrusive update toast after 3 seconds
                    setTimeout(function() {
                        if (typeof showToast === 'function') {
                            showToast('🆕 नयाँ Update उपलब्ध छ! Play Store मा Update गर्नुहोस्।', 5000);
                        }
                    }, 3000);
                }
            }).catch(function(updateErr) {
                console.warn('[AppUpdate] Update check failed (non-critical):', updateErr);
            });
        }
    } catch(updateErr) {
        console.warn('[AppUpdate] In-app update init failed (non-critical):', updateErr);
    }

    // --- Capacitor Push Notifications Setup ---
    try {
        const PushNotifications = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
            PushNotifications.checkPermissions().then(function(permStatus) {
                if (permStatus.receive === 'prompt') {
                    return PushNotifications.requestPermissions();
                }
                return permStatus;
            }).then(function(permStatus) {
                if (permStatus.receive === 'granted') {
                    return PushNotifications.register();
                } else {
                    console.warn('[Push] Notification permission denied.');
                }
            }).catch(function(e) {
                console.warn('[Push] Permission check failed:', e);
            });

            PushNotifications.addListener('registration', function(token) {
                console.log('[Push] Registration successful. FCM Token:', token.value);
                KrishiStorage.setItem('krishi_fcm_token', token.value);
                writeFCMTokenToFirebaseSession(token.value);
            });

            PushNotifications.addListener('registrationError', function(err) {
                console.error('[Push] Registration error:', err);
            });

            PushNotifications.addListener('pushNotificationReceived', function(notification) {
                console.log('[Push] Notification received:', notification);
                if (typeof showToast === 'function') {
                    showToast('🔔 ' + (notification.title || 'Notification') + ': ' + (notification.body || ''));
                }
            });
        }
    } catch(pushErr) {
        console.warn('[Push] Initialization failed:', pushErr);
    }

    // ==================== PREMIUM HYBRID TINDER FLASHCARD SWIPER ====================
    window.swiperState = {
        cards: [],
        index: 0,
        listenersAttached: false,
        isAnimating: false
    };

    window.startFlashcardSwiper = function() {
        if (typeof stopTimer === 'function') stopTimer();
        if (state.perQuestionTimerInterval) {
            clearInterval(state.perQuestionTimerInterval);
            state.perQuestionTimerInterval = null;
        }

        let pool = getAllQuestions();
        if (!pool || pool.length === 0) {
            showToast('No questions available to practice!');
            return;
        }

        // Fetch 15 random shuffled questions
        window.swiperState.cards = shuffle([...pool]).slice(0, Math.min(15, pool.length));
        window.swiperState.index = 0;

        navigate('page-tinder-swiper');
        // Force flexbox display to respect layout styling
        const page = document.getElementById('page-tinder-swiper');
        if (page) {
            page.style.setProperty('display', 'flex', 'important');
        }

        window.renderFlashcardCard();
        attachSwiperGestures();

        // Draggable Entrance Wobble Physics to guide new swipe users
        const card = document.getElementById('tinder-card');
        if (card) {
            setTimeout(() => {
                card.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
                card.style.transform = 'translate3d(-30px, 0px, 0) rotate(-3deg)';
                setTimeout(() => {
                    card.style.transform = 'translate3d(30px, 0px, 0) rotate(3deg)';
                    setTimeout(() => {
                        card.style.transform = 'translate3d(0px, 0px, 0) rotate(0deg)';
                        setTimeout(() => {
                            card.style.transition = 'none'; // reset transition for drag physics
                        }, 200);
                    }, 200);
                }, 200);
            }, 450);
        }
    };

    window.renderFlashcardCard = function() {
        const card = document.getElementById('tinder-card');
        const emptyState = document.getElementById('tinder-empty-state');
        if (!card || !emptyState) return;

        if (window.swiperState.index >= window.swiperState.cards.length) {
            card.classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        }

        card.classList.remove('hidden');
        emptyState.classList.add('hidden');

        // Reset positions
        card.style.transition = 'none';
        card.style.transform = 'translate3d(0px, 0px, 0px) rotate(0deg)';
        card.style.opacity = '1';
        card.style.pointerEvents = 'auto'; // ensure clickable
        window.swiperState.isAnimating = false; // unlock interaction
        window.swiperState.cardStartTime = Date.now(); // track time spent
        questionStartTime = window.swiperState.cardStartTime; // sync global timer for session history

        // Reset indicators
        const indRight = document.getElementById('tinder-indicator-right');
        const indLeft = document.getElementById('tinder-indicator-left');
        if (indRight) indRight.style.opacity = '0';
        if (indLeft) indLeft.style.opacity = '0';

        // Hide answer and show clue
        const explContainer = document.getElementById('tinder-card-expl-container');
        const hintText = document.getElementById('tinder-card-hint-text');
        if (explContainer) explContainer.classList.add('hidden');
        if (hintText) hintText.classList.remove('hidden');

        // Load card data
        let q = window.swiperState.cards[window.swiperState.index];
        const subBadge = document.getElementById('tinder-card-subject');
        const numBadge = document.getElementById('tinder-card-number');
        const qText = document.getElementById('tinder-card-q');
        const explText = document.getElementById('tinder-card-expl');

        if (subBadge) subBadge.textContent = q.sub || 'General';
        if (numBadge) numBadge.textContent = `Card ${window.swiperState.index + 1}/${window.swiperState.cards.length}`;
        if (qText) qText.textContent = q.q;
        if (explText) {
            let correctOptionText = '';
            if (q.opts && typeof q.ans !== 'undefined' && q.opts[q.ans]) {
                correctOptionText = `<span class="font-extrabold text-[12px] text-emerald-600 block mb-1">✅ सही उत्तर: ${q.opts[q.ans]}</span>`;
            }
            explText.innerHTML = correctOptionText + (q.expl || 'यो प्रश्नको लागि थप व्याख्या उपलब्ध छैन।');
        }
    };

    window.revealFlashcardAnswer = function() {
        if (window.swiperState.index >= window.swiperState.cards.length) return;
        const explContainer = document.getElementById('tinder-card-expl-container');
        const hintText = document.getElementById('tinder-card-hint-text');
        if (explContainer) {
            explContainer.classList.remove('hidden');
            explContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (hintText) hintText.classList.add('hidden');
        playSound('click');
        triggerHaptic('click');
    };

    window.swipeFlashcardLeft = function() {
        if (window.swiperState.index >= window.swiperState.cards.length) return;
        if (window.swiperState.isAnimating) return;
        window.swiperState.isAnimating = true;

        const card = document.getElementById('tinder-card');
        if (!card) {
            window.swiperState.isAnimating = false;
            return;
        }

        card.style.pointerEvents = 'none'; // disable pointer events during animation

        card.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.35s ease';
        card.style.transform = 'translate3d(-500px, 0px, 0) rotate(-30deg)';
        card.style.opacity = '0';

        let q = window.swiperState.cards[window.swiperState.index];
        if (q) {
            if (!localData.wrong) localData.wrong = [];
            if (localData && localData.wrong && !localData.wrong.includes(q.id)) {
                localData.wrong.push(q.id);
                // saveData() is called below
            }
            
            let secondsSpent = Math.max(1, Math.round((Date.now() - (window.swiperState.cardStartTime || Date.now())) / 1000));
            
            // FSRS
            if (window.KrishiSM2Engine) {
                window.KrishiSM2Engine.recordAnswer(q.id || q.q, false, secondsSpent);
            }

            // Session History
            if (typeof recordQuestionTime === 'function') {
                recordQuestionTime(q.id, q.sub, q.difficulty || 'Medium', false);
            }

            // Stats & Streak
            if (!localData.stats) localData.stats = {totalSolved:0, totalCorrect:0, subjectStats:{}};
            if (!localData.stats.subjectStats) localData.stats.subjectStats = {};
            
            localData.stats.totalSolved++;
            if (!localData.stats.subjectStats[q.sub]) localData.stats.subjectStats[q.sub] = {solved:0, correct:0};
            localData.stats.subjectStats[q.sub].solved++;

            let today = getLocalDateString();
            if (!localData.streak) localData.streak = {};
            if (!localData.streak[today]) localData.streak[today] = {solved:0, correct:0};
            localData.streak[today].solved++;

            saveData();
            if (typeof updateStatsRibbon === 'function') updateStatsRibbon();
        }

        playSound('wrong');
        triggerHaptic('wrong');

        window.swiperState.index++;
        setTimeout(() => {
            window.renderFlashcardCard();
        }, 350);
    };

    window.swipeFlashcardRight = function() {
        if (window.swiperState.index >= window.swiperState.cards.length) return;
        if (window.swiperState.isAnimating) return;
        window.swiperState.isAnimating = true;

        const card = document.getElementById('tinder-card');
        if (!card) {
            window.swiperState.isAnimating = false;
            return;
        }

        card.style.pointerEvents = 'none'; // disable pointer events during animation

        card.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.35s ease';
        card.style.transform = 'translate3d(500px, 0px, 0) rotate(30deg)';
        card.style.opacity = '0';

        let q = window.swiperState.cards[window.swiperState.index];
        if (q) {
            if (!localData.wrong) localData.wrong = [];
            if (localData && localData.wrong && localData.wrong.includes(q.id)) {
                localData.wrong = localData.wrong.filter(id => id !== q.id);
                if (!localData.wrongLog) localData.wrongLog = {};
                let rev = localData.wrongLog[q.id] ? (localData.wrongLog[q.id]._rev || 0) : 0;
                localData.wrongLog[q.id] = { action: 'remove', timestamp: Date.now(), _rev: rev + 1 };
            }

            let secondsSpent = Math.max(1, Math.round((Date.now() - (window.swiperState.cardStartTime || Date.now())) / 1000));
            
            // FSRS
            if (window.KrishiSM2Engine) {
                window.KrishiSM2Engine.recordAnswer(q.id || q.q, true, secondsSpent);
            }

            // Session History
            if (typeof recordQuestionTime === 'function') {
                recordQuestionTime(q.id, q.sub, q.difficulty || 'Medium', true);
            }

            // Stats & Streak
            if (!localData.stats) localData.stats = {totalSolved:0, totalCorrect:0, subjectStats:{}};
            if (!localData.stats.subjectStats) localData.stats.subjectStats = {};
            
            localData.stats.totalSolved++;
            localData.stats.totalCorrect++;
            if (!localData.stats.subjectStats[q.sub]) localData.stats.subjectStats[q.sub] = {solved:0, correct:0};
            localData.stats.subjectStats[q.sub].solved++;
            localData.stats.subjectStats[q.sub].correct++;

            let today = getLocalDateString();
            if (!localData.streak) localData.streak = {};
            if (!localData.streak[today]) localData.streak[today] = {solved:0, correct:0};
            localData.streak[today].solved++;
            localData.streak[today].correct++;

            saveData();
            if (typeof updateStatsRibbon === 'function') updateStatsRibbon();
        }

        playSound('correct');
        triggerHaptic('correct');

        window.swiperState.index++;
        setTimeout(() => {
            window.renderFlashcardCard();
        }, 350);
    };

    window.exitFlashcardSwiper = function() {
        navigate('page-practice');
    };

    function attachSwiperGestures() {
        if (window.swiperState.listenersAttached) return;
        const card = document.getElementById('tinder-card');
        if (!card) return;

        let startX = 0, startY = 0;
        let deltaX = 0, deltaY = 0;
        let isDragging = false;

        const indRight = document.getElementById('tinder-indicator-right');
        const indLeft = document.getElementById('tinder-indicator-left');

        card.addEventListener('pointerdown', function(e) {
            if (window.swiperState.index >= window.swiperState.cards.length) return;
            if (window.swiperState.isAnimating) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            deltaX = 0;
            deltaY = 0;
            card.style.transition = 'none';
            card.setPointerCapture(e.pointerId);
            card.style.cursor = 'grabbing';
        });

        card.addEventListener('pointermove', function(e) {
            if (!isDragging) return;
            deltaX = e.clientX - startX;
            deltaY = e.clientY - startY;

            // Apply translation and slight rotation based on X movement
            card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${deltaX / 12}deg)`;

            // Update swipe indicators opacity based on threshold (100px max)
            if (deltaX > 15) {
                if (indRight) indRight.style.opacity = Math.min(0.9, (deltaX - 15) / 100);
                if (indLeft) indLeft.style.opacity = '0';
            } else if (deltaX < -15) {
                if (indLeft) indLeft.style.opacity = Math.min(0.9, (-deltaX - 15) / 100);
                if (indRight) indRight.style.opacity = '0';
            } else {
                if (indRight) indRight.style.opacity = '0';
                if (indLeft) indLeft.style.opacity = '0';
            }
        });

        const handlePointerUp = function(e) {
            if (!isDragging) return;
            isDragging = false;
            card.releasePointerCapture(e.pointerId);
            card.style.cursor = 'grab';

            card.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.4s ease';

            if (deltaX > 110) {
                // Swipe Right (Know it)
                window.swipeFlashcardRight();
            } else if (deltaX < -110) {
                // Swipe Left (Study later)
                window.swipeFlashcardLeft();
            } else {
                // Return to center
                card.style.transform = 'translate3d(0px, 0px, 0px) rotate(0deg)';
                if (indRight) indRight.style.opacity = '0';
                if (indLeft) indLeft.style.opacity = '0';
            }
        };

        card.addEventListener('pointerup', handlePointerUp);
        card.addEventListener('pointercancel', handlePointerUp);

        // Also add click event to show answer on tap without drag
        card.addEventListener('click', function(e) {
            if (window.swiperState.isAnimating) return;
            // Guard against click triggering after drag
            if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) {
                window.revealFlashcardAnswer();
            }
        });

        window.swiperState.listenersAttached = true;
        console.log('[SwiperGestures] Pointer gestures attached to card ✅');
    }

    // ==================== ADVANCED ADDITIVE AUDITED UPGRADES ====================
    
    // 1. Encrypted/Base64 Progress Exporter
    window.exportLocalProgress = function() {
        try {
            // Read active progress from local memory variables
            const backupObj = {
                version: 'v8-backup',
                timestamp: Date.now(),
                localData: {
                    bookmarked: localData.bookmarked || [],
                    wrong: localData.wrong || [],
                    streak: localData.streak || 0,
                    stats: localData.stats || {},
                    achievements: localData.achievements || [],
                    progression: localData.progression || { xp: 0 }
                },
                sm2Data: window.KrishiSM2Engine ? window.KrishiSM2Engine._getData() : {}
            };
            
            // Encode progress object to Base64 to create a safe progress signature block
            const rawJson = JSON.stringify(backupObj);
            const encodedProgress = btoa(unescape(encodeURIComponent(rawJson)));
            
            const fileName = `krishi_mcq_progress_backup_${getLocalDateString()}.json`;
            const file = new File([encodedProgress], fileName, { type: 'application/json' });
            
            // Try utilizing the native Web Share API on mobile / PWAs / Capacitor WebViews
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({
                    files: [file],
                    title: 'Krishi MCQ Pro Backup',
                    text: 'My study progress backup.'
                })
                .then(() => {
                    showToast('✅ Local progress shared successfully!');
                    triggerHaptic('success');
                })
                .catch(err => {
                    console.warn('[Backup Engine] Share dismissed or failed, falling back to download:', err);
                    triggerFallbackDownload();
                });
            } else {
                triggerFallbackDownload();
            }
            
            function triggerFallbackDownload() {
                // Create download blob
                const blob = new Blob([encodedProgress], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showToast('✅ Local progress successfully exported!');
                triggerHaptic('success');
            }
        } catch (e) {
            console.error('[Backup Engine] Failed to export local progress:', e);
            showToast('❌ Backup failed to export!');
            triggerHaptic('error');
        }
    };
    
    // 2. Base64 Progress Importer & Integrity Verifier
    window.importLocalProgress = function(fileInput) {
        if (!fileInput.files || fileInput.files.length === 0) return;
        const file = fileInput.files[0];
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const encodedData = e.target.result.trim ? e.target.result.trim() : e.target.result;
                // Decode from Base64
                const decodedJson = decodeURIComponent(escape(atob(encodedData)));
                const imported = JSON.parse(decodedJson);
                
                // Integrity checks to prevent system crash
                if (!imported || imported.version !== 'v8-backup' || !imported.localData) {
                    throw new Error("Invalid backup schema version or corrupted data structure");
                }
                
                // Apply values to localData safely
                const keys = ['bookmarked', 'wrong', 'streak', 'stats', 'achievements', 'progression'];
                keys.forEach(k => {
                    if (imported.localData[k] !== undefined) {
                        localData[k] = imported.localData[k];
                    }
                });
                if (imported.localData.stats) {
                    KrishiStorage.setItem('krishi_stats_baseline', JSON.stringify(imported.localData.stats));
                }
                
                // Apply sm2Data safely
                if (imported.sm2Data && window.KrishiSM2Engine) {
                    let currentSm2 = window.KrishiSM2Engine._getData();
                    Object.keys(imported.sm2Data).forEach(id => {
                        currentSm2[id] = imported.sm2Data[id];
                    });
                    window.KrishiSM2Engine._saveData(currentSm2);
                }
                
                // Batch write to LocalStorage
                saveData();
                
                showToast('✅ Study progress imported! Reloading app...', 2500);
                triggerHaptic('success');
                playSound('correct');
                
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } catch (err) {
                console.error('[Backup Engine] Failed to import local progress:', err);
                showToast('❌ Invalid or corrupted backup file!');
                triggerHaptic('error');
                playSound('wrong');
            }
        };
        
        reader.readAsText(file);
    };

    // 3. Real-Time FPS Rendering diagnostics overlay HUD
    let fpsOverlayActive = false;
    let lastFpsDraw = performance.now();
    let fpsFrames = 0;
    
    window.toggleFPSMonitorOverlay = function(isEnabled) {
        const badge = document.getElementById('fps-monitor-badge');
        if (!badge) return;
        
        fpsOverlayActive = isEnabled;
        if (isEnabled) {
            badge.classList.remove('hidden');
            requestAnimationFrame(runDiagnosticsLoop);
            showToast('📊 FPS Diagnostics Monitor active');
            triggerHaptic('click');
        } else {
            badge.classList.add('hidden');
            showToast('⚙️ Diagnostics Monitor disabled');
            triggerHaptic('click');
        }
    };
    
    function runDiagnosticsLoop(now) {
        if (!fpsOverlayActive) return;
        fpsFrames++;
        let elapsed = now - lastFpsDraw;
        
        if (elapsed >= 500) {
            let fps = Math.round((fpsFrames * 1000) / elapsed);
            fpsFrames = 0;
            lastFpsDraw = now;
            
            const badge = document.getElementById('fps-monitor-badge');
            if (badge) {
                badge.textContent = `FPS: ${fps}`;
                // Colorize dynamically depending on performance bounds
                if (fps >= 58) {
                    badge.style.color = '#34d399'; // Emerald-400 (Perfect)
                } else if (fps >= 45) {
                    badge.style.color = '#fbbf24'; // Amber-500 (Throttled/Slowdown)
                } else {
                    badge.style.color = '#ef4444'; // Red-500 (Lag spike)
                }
            }
    }
        requestAnimationFrame(runDiagnosticsLoop);
    }

    // ==================== SETTINGS ACCORDION HANDLER ====================
    // Handled early-bound in index.html to prevent race conditions

    // Export local settings and sync functions globally for HTML inline handlers
    window.toggleKeyVisibility = toggleKeyVisibility;
    window.saveGeminiSettings = saveGeminiSettings;
    window.validateAndSaveApiKey = validateAndSaveApiKey;
    window.clearApiKey = clearApiKey;
    window.handleFirebaseLogin = handleFirebaseLogin;
    window.handleGoogleLogin = handleGoogleLogin;
    window.handleFirebaseSignup = handleFirebaseSignup;
    window.openQRScanner = openQRScanner;
    window.generateNewSyncKey = generateNewSyncKey;
    window.enableCloudSync = enableCloudSync;
    window.copyActiveSyncKey = copyActiveSyncKey;
    window.syncCloudNow = syncCloudNow;
    window.disableCloudSync = disableCloudSync;
    window.handleFirebaseLogout = handleFirebaseLogout;

    // Export core quiz navigation and utility functions for Voice Assistant
    window.nextMCQQuestion = nextMCQQuestion;
    window.toggleBookmarkCurrent = toggleBookmarkCurrent;
    window.showQuizHint = showQuizHint;

    // Export study planner functions globally for HTML inline handlers
    window.togglePlannerSettings = togglePlannerSettings;
    window.togglePlannerDemoMode = togglePlannerDemoMode;
    window.setPlanMode = setPlanMode;
    window.generateTodaySmartPlan = generateTodaySmartPlan;
    window.startSmartStudyPlanSession = startSmartStudyPlanSession;
    window.startAdaptiveReview = startAdaptiveReview;
    window.startWrongQuestionCorrection = startWrongQuestionCorrection;
    window.toggleAddSubjectView = toggleAddSubjectView;
    window.submitCustomSyllabusSubject = submitCustomSyllabusSubject;
    window.startPracticeWeakestSubject = startPracticeWeakestSubject;
    window.startMaintainStrongSubjectPractice = startMaintainStrongSubjectPractice;
    window.resetPlannerSettingsToDefaults = resetPlannerSettingsToDefaults;
    window.savePlannerSettingsNew = savePlannerSettingsNew;

    // ==================== PREMIUM ADAPTIVE DOM PRUNER SYSTEM ====================
    window.KrishiDOMPruner = {
        observer: null,
        init() {
            if (this.observer) return;
            this.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const target = entry.target;
                    if (entry.isIntersecting) {
                        target.classList.remove('is-out-of-view');
                        target.style.minHeight = '';
                    } else {
                        const height = entry.boundingClientRect.height;
                        if (height > 10) {
                            target.style.minHeight = height + 'px';
                            target.classList.add('is-out-of-view');
                        }
                    }
                });
            }, { rootMargin: '300px 0px 300px 0px' });
        },
        observe(el) {
            if (!this.observer) this.init();
            if (el) this.observer.observe(el);
        },
        disconnect() {
            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
        }
    };

})();
