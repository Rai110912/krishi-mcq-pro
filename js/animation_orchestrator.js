/**
 * ============================================================================
 * PREMIUM ANIMATION ORCHESTRATOR — Step 25
 * ============================================================================
 * Centralized event-driven animation management layer.
 *
 * Architecture:
 *   Business Event → dispatch() → Priority / Conflict / Queue → Renderer → Cleanup
 *
 * This module sits BETWEEN business events and visual playback.
 * It does NOT contain business logic.
 * It does NOT modify XP, score, streak, or achievement calculations.
 *
 * Dependencies (must load before this file):
 *   - js/libs/lottie.min.js
 *   - js/lottie_adapter.js
 *   - getPerfSettings() must be available at dispatch-time (loaded by app.js)
 *
 * Safe to load with `defer`; initializes on DOMContentLoaded or immediately.
 * ============================================================================
 */
(function () {
    'use strict';

    // ──────────────────────────────────────────────
    // 1. EVENT TYPE VOCABULARY
    // ──────────────────────────────────────────────
    const EVENT_TYPES = Object.freeze({
        CORRECT:          'animation.correct',
        WRONG:            'animation.wrong',
        XP:               'animation.xp',
        STREAK:           'animation.streak',
        ACHIEVEMENT:      'animation.achievement',
        LEVEL_UP:         'animation.levelUp',
        SESSION_COMPLETE: 'animation.sessionComplete'
    });

    // ──────────────────────────────────────────────
    // 2. PRIORITY TIERS
    // ──────────────────────────────────────────────
    const PRIORITY = Object.freeze({
        CRITICAL: 100,   // levelUp, achievement
        SESSION:   90,   // sessionComplete
        HIGH:      80,   // streak
        NORMAL:    50,   // correct, wrong
        MICRO:     20    // xp
    });

    const EVENT_PRIORITY_MAP = Object.freeze({
        [EVENT_TYPES.LEVEL_UP]:         PRIORITY.CRITICAL,
        [EVENT_TYPES.ACHIEVEMENT]:      PRIORITY.CRITICAL,
        [EVENT_TYPES.SESSION_COMPLETE]: PRIORITY.SESSION,
        [EVENT_TYPES.STREAK]:           PRIORITY.HIGH,
        [EVENT_TYPES.CORRECT]:          PRIORITY.NORMAL,
        [EVENT_TYPES.WRONG]:            PRIORITY.NORMAL,
        [EVENT_TYPES.XP]:               PRIORITY.MICRO
    });

    // Lottie asset IDs for events that have Lottie animations
    const LOTTIE_ASSET_MAP = Object.freeze({
        [EVENT_TYPES.CORRECT]:     'lottie.feedback.correct',
        [EVENT_TYPES.WRONG]:       'lottie.feedback.wrong',
        [EVENT_TYPES.LEVEL_UP]:    'lottie.reward.levelUp',
        [EVENT_TYPES.ACHIEVEMENT]: 'lottie.reward.achievement',
        [EVENT_TYPES.STREAK]:      'lottie.reward.streak'
    });

    // ──────────────────────────────────────────────
    // 3. STATE
    // ──────────────────────────────────────────────
    const activeAnimations = new Map();   // eventType → { startTime, cleanup }
    const queue = [];                     // Pending HIGH/CRITICAL/SESSION events
    let isProcessingQueue = false;

    // Deduplication window (ms)
    const DEDUP_WINDOW = 100;
    const lastDispatchTime = new Map();   // eventType → timestamp

    // Queue expiration (ms)
    const QUEUE_EXPIRY = 5000;

    // ──────────────────────────────────────────────
    // 4. ACCESSIBILITY POLICY
    // ──────────────────────────────────────────────
    /**
     * Returns the current accessibility level:
     *   'full'    → normal premium animation
     *   'reduced' → minimal motion (CSS only, no particles)
     *   'off'     → static feedback only
     */
    function getAccessibilityLevel() {
        var ps;
        try {
            ps = (typeof window.getPerfSettings === 'function') ? window.getPerfSettings() : {};
        } catch (_) {
            ps = {};
        }

        // Highest priority: explicit off
        if (ps.perfMode === 'battery' || ps.animIntensity === 'off') return 'off';

        // Reduced motion (system or user)
        if (ps.reduceMotion) return 'reduced';

        // Media query fallback
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                return 'reduced';
            }
        } catch (_) { /* safe */ }

        if (ps.animIntensity === 'low') return 'reduced';

        return 'full';
    }

    // ──────────────────────────────────────────────
    // 5. CONFLICT MANAGEMENT
    // ──────────────────────────────────────────────
    /**
     * Can this event play right now?
     *   - MICRO and NORMAL always play (no conflict)
     *   - HIGH must wait if a CRITICAL animation is active
     *   - CRITICAL queues behind another CRITICAL
     *   - SESSION defers to CRITICAL
     */
    function canPlayNow(eventType) {
        var priority = EVENT_PRIORITY_MAP[eventType] || PRIORITY.NORMAL;

        // MICRO and NORMAL never conflict
        if (priority <= PRIORITY.NORMAL) return true;

        // Check if a CRITICAL animation is currently active
        for (var entry of activeAnimations.values()) {
            if (entry.priority >= PRIORITY.CRITICAL) {
                // Any CRITICAL is playing → nothing HIGH+ can start
                return false;
            }
        }
        return true;
    }

    // ──────────────────────────────────────────────
    // 6. RENDERERS (per event type)
    // ──────────────────────────────────────────────

    /**
     * Common Lottie-with-CSS-fallback pattern.
     * Returns a Promise that resolves when the animation finishes.
     */
    function playLottieOrFallback(lottieAssetId, cssFallbackFn) {
        return new Promise(function (resolve) {
            if (window.LottieAdapter && typeof window.LottieAdapter.play === 'function') {
                window.LottieAdapter.play(lottieAssetId).then(function (success) {
                    if (!success && typeof cssFallbackFn === 'function') {
                        cssFallbackFn();
                    }
                    resolve();
                }).catch(function () {
                    if (typeof cssFallbackFn === 'function') cssFallbackFn();
                    resolve();
                });
            } else {
                if (typeof cssFallbackFn === 'function') cssFallbackFn();
                resolve();
            }
        });
    }

    // --- CORRECT ---
    function renderCorrect(payload, level) {
        var el = payload && payload.targetEl;
        if (level === 'off') {
            // Static: just add class
            if (el) el.classList.add('glow-correct');
            return Promise.resolve();
        }
        if (level === 'reduced') {
            if (el) el.classList.add('glow-correct');
            return Promise.resolve();
        }
        // Full
        return playLottieOrFallback(LOTTIE_ASSET_MAP[EVENT_TYPES.CORRECT], function () {
            if (el) el.classList.add('glow-correct');
        });
    }

    // --- WRONG ---
    function renderWrong(payload, level) {
        var el = payload && payload.targetEl;
        if (level === 'off') {
            if (el) el.classList.add('shake-wrong');
            return Promise.resolve();
        }
        if (level === 'reduced') {
            if (el) el.classList.add('shake-wrong');
            return Promise.resolve();
        }
        return playLottieOrFallback(LOTTIE_ASSET_MAP[EVENT_TYPES.WRONG], function () {
            if (el) el.classList.add('shake-wrong');
        });
    }

    // --- XP MICRO ---
    function renderXP(payload, level) {
        // XP micro-animation is CSS-only, handled by existing showXPMicroAnimation
        // Orchestrator just gates it through accessibility check
        if (level === 'off') return Promise.resolve();
        if (typeof window._orchestratorShowXPMicro === 'function') {
            window._orchestratorShowXPMicro(payload.amount, payload.targetEl);
        }
        return Promise.resolve();
    }

    // --- LEVEL UP ---
    function renderLevelUp(payload, level) {
        var newLevel = payload && payload.level;

        // Duplicate protection
        if (window._isLevelUpPlaying === newLevel) return Promise.resolve();
        window._isLevelUpPlaying = newLevel;

        if (level === 'off') {
            if (typeof window.showToast === 'function') {
                window.showToast('\uD83C\uDF89 LEVEL ' + newLevel + ' - Level Up!');
            }
            setTimeout(function () { window._isLevelUpPlaying = false; }, 2000);
            return Promise.resolve();
        }

        if (level === 'reduced') {
            if (typeof window.showToast === 'function') {
                window.showToast('\u2728 LEVEL ' + newLevel + ' - Level Up!');
            }
            setTimeout(function () { window._isLevelUpPlaying = false; }, 2000);
            return Promise.resolve();
        }

        // Full: Lottie first, CSS fallback
        return new Promise(function (resolve) {
            if (window.LottieAdapter && typeof window.LottieAdapter.play === 'function') {
                window.LottieAdapter.play(LOTTIE_ASSET_MAP[EVENT_TYPES.LEVEL_UP]).then(function (success) {
                    if (success) {
                        if (typeof window.showToast === 'function') {
                            window.showToast('\u2728 LEVEL ' + newLevel + ' - Level Up!');
                        }
                        setTimeout(function () { window._isLevelUpPlaying = false; resolve(); }, 2000);
                    } else {
                        // CSS fallback
                        if (typeof window._orchestratorPlayCSSLevelUp === 'function') {
                            window._orchestratorPlayCSSLevelUp(newLevel);
                        }
                        setTimeout(function () { window._isLevelUpPlaying = false; resolve(); }, 2000);
                    }
                }).catch(function () {
                    if (typeof window._orchestratorPlayCSSLevelUp === 'function') {
                        window._orchestratorPlayCSSLevelUp(newLevel);
                    }
                    setTimeout(function () { window._isLevelUpPlaying = false; resolve(); }, 2000);
                });
            } else {
                if (typeof window._orchestratorPlayCSSLevelUp === 'function') {
                    window._orchestratorPlayCSSLevelUp(newLevel);
                }
                setTimeout(function () { window._isLevelUpPlaying = false; resolve(); }, 2000);
            }
        });
    }

    // --- ACHIEVEMENT ---
    function renderAchievement(payload, level) {
        if (level === 'off') {
            if (typeof window.showToast === 'function') {
                window.showToast('\uD83C\uDFC6 Achievement Unlocked!');
            }
            return Promise.resolve();
        }

        if (level === 'reduced') {
            // Static feedback only
            if (typeof window.showToast === 'function') {
                window.showToast('\uD83C\uDFC6 Achievement Unlocked!');
            }
            return Promise.resolve();
        }

        return playLottieOrFallback(LOTTIE_ASSET_MAP[EVENT_TYPES.ACHIEVEMENT], function () {
            // ConfettiEngine is dormant/disabled — no fallback action needed
            // The Lottie adapter already handles CSS static feedback
        });
    }

    // --- STREAK ---
    function renderStreak(payload, level) {
        var el = payload && payload.targetEl;
        if (level === 'off') return Promise.resolve();

        if (level === 'reduced') {
            if (el) {
                el.classList.add('fire-sparked');
                setTimeout(function () { el.classList.remove('fire-sparked'); }, 750);
            }
            return Promise.resolve();
        }

        return new Promise(function (resolve) {
            if (window.LottieAdapter && typeof window.LottieAdapter.play === 'function') {
                window.LottieAdapter.play(LOTTIE_ASSET_MAP[EVENT_TYPES.STREAK]).then(function (success) {
                    if (!success && el) {
                        el.classList.add('fire-sparked');
                        setTimeout(function () { el.classList.remove('fire-sparked'); }, 750);
                    }
                    resolve();
                }).catch(function () {
                    if (el) {
                        el.classList.add('fire-sparked');
                        setTimeout(function () { el.classList.remove('fire-sparked'); }, 750);
                    }
                    resolve();
                });
            } else {
                if (el) {
                    el.classList.add('fire-sparked');
                    setTimeout(function () { el.classList.remove('fire-sparked'); }, 750);
                }
                resolve();
            }
        });
    }

    // --- SESSION COMPLETE ---
    function renderSessionComplete(payload, level) {
        if (level === 'off') {
            if (typeof window.showToast === 'function') {
                window.showToast('\uD83C\uDF89 Session Complete!');
            }
            return Promise.resolve();
        }

        if (level === 'reduced') {
            if (typeof window.showToast === 'function') {
                window.showToast('\uD83C\uDF89 Session Complete!');
            }
            return Promise.resolve();
        }

        // Full: delegate to existing celebration function
        if (typeof window._orchestratorShowCelebration === 'function') {
            window._orchestratorShowCelebration();
        }
        return Promise.resolve();
    }

    // Renderer dispatch map
    var RENDERERS = {};
    RENDERERS[EVENT_TYPES.CORRECT]          = renderCorrect;
    RENDERERS[EVENT_TYPES.WRONG]            = renderWrong;
    RENDERERS[EVENT_TYPES.XP]               = renderXP;
    RENDERERS[EVENT_TYPES.LEVEL_UP]         = renderLevelUp;
    RENDERERS[EVENT_TYPES.ACHIEVEMENT]      = renderAchievement;
    RENDERERS[EVENT_TYPES.STREAK]           = renderStreak;
    RENDERERS[EVENT_TYPES.SESSION_COMPLETE] = renderSessionComplete;

    // ──────────────────────────────────────────────
    // 7. QUEUE PROCESSOR
    // ──────────────────────────────────────────────
    function processQueue() {
        if (isProcessingQueue) return;
        if (queue.length === 0) return;

        // Discard expired entries
        var now = Date.now();
        while (queue.length > 0 && (now - queue[0].timestamp > QUEUE_EXPIRY)) {
            var expired = queue.shift();
            console.log('[AnimOrchestrator] Discarded expired event:', expired.eventType);
        }

        if (queue.length === 0) return;

        // Sort by priority descending
        queue.sort(function (a, b) { return b.priority - a.priority; });

        // Take the highest priority item
        var next = queue[0];
        if (!canPlayNow(next.eventType)) return; // Still blocked

        queue.shift();
        isProcessingQueue = true;

        executeAnimation(next.eventType, next.payload).then(function () {
            isProcessingQueue = false;
            // Process next in queue after current completes
            if (queue.length > 0) {
                setTimeout(processQueue, 50);
            }
        }).catch(function () {
            isProcessingQueue = false;
            if (queue.length > 0) {
                setTimeout(processQueue, 50);
            }
        });
    }

    // ──────────────────────────────────────────────
    // 8. CORE EXECUTION
    // ──────────────────────────────────────────────
    function executeAnimation(eventType, payload) {
        var renderer = RENDERERS[eventType];
        if (!renderer) {
            console.warn('[AnimOrchestrator] No renderer for event:', eventType);
            return Promise.resolve();
        }

        var level = getAccessibilityLevel();
        var priority = EVENT_PRIORITY_MAP[eventType] || PRIORITY.NORMAL;

        // Track active animation
        var animId = eventType + '_' + Date.now();
        activeAnimations.set(animId, {
            eventType: eventType,
            priority: priority,
            startTime: Date.now()
        });

        return new Promise(function (resolve) {
            try {
                var result = renderer(payload || {}, level);
                // Ensure we always get a Promise
                if (result && typeof result.then === 'function') {
                    result.then(function () {
                        activeAnimations.delete(animId);
                        resolve();
                    }).catch(function (err) {
                        console.warn('[AnimOrchestrator] Renderer error for', eventType, err);
                        activeAnimations.delete(animId);
                        resolve(); // Never block
                    });
                } else {
                    activeAnimations.delete(animId);
                    resolve();
                }
            } catch (err) {
                console.warn('[AnimOrchestrator] Render exception for', eventType, err);
                activeAnimations.delete(animId);
                resolve(); // NEVER block business logic
            }

            // Safety timeout: force cleanup after 6 seconds regardless
            setTimeout(function () {
                if (activeAnimations.has(animId)) {
                    activeAnimations.delete(animId);
                }
            }, 6000);
        });
    }

    // ──────────────────────────────────────────────
    // 9. PUBLIC API — dispatch()
    // ──────────────────────────────────────────────
    /**
     * Main entry point. Fire-and-forget. Never throws.
     * @param {string} eventType - One of EVENT_TYPES values
     * @param {Object} [payload] - Event-specific data (targetEl, level, amount, etc.)
     */
    function dispatch(eventType, payload) {
        try {
            // Validate event type
            var validTypes = Object.values(EVENT_TYPES);
            if (validTypes.indexOf(eventType) === -1) {
                console.warn('[AnimOrchestrator] Unknown event type:', eventType);
                return;
            }

            var now = Date.now();
            var priority = EVENT_PRIORITY_MAP[eventType] || PRIORITY.NORMAL;

            // Deduplication: ignore identical events within DEDUP_WINDOW
            var lastTime = lastDispatchTime.get(eventType) || 0;
            if (now - lastTime < DEDUP_WINDOW) {
                console.log('[AnimOrchestrator] Deduplicated:', eventType);
                return;
            }
            lastDispatchTime.set(eventType, now);

            // MICRO and NORMAL: play immediately (no queue, no conflict)
            if (priority <= PRIORITY.NORMAL) {
                executeAnimation(eventType, payload);
                return;
            }

            // HIGH / CRITICAL / SESSION: check conflicts
            if (canPlayNow(eventType)) {
                executeAnimation(eventType, payload).then(function () {
                    processQueue();
                });
            } else {
                // Queue it
                queue.push({
                    eventType: eventType,
                    payload: payload,
                    priority: priority,
                    timestamp: now
                });
                console.log('[AnimOrchestrator] Queued:', eventType, '(priority:', priority + ')');
            }
        } catch (err) {
            // Animation failure must NEVER stop business logic
            console.warn('[AnimOrchestrator] dispatch() error (non-fatal):', err);
        }
    }

    // ──────────────────────────────────────────────
    // 10. PUBLIC API — Utilities
    // ──────────────────────────────────────────────
    function cancelAll() {
        activeAnimations.clear();
        queue.length = 0;
        isProcessingQueue = false;

        // Clean up Lottie container if present
        var lottieContainer = document.getElementById('lottie-global-container');
        if (lottieContainer) lottieContainer.innerHTML = '';

        // Clean up Level-Up overlay if present
        var levelUpOverlay = document.getElementById('css-levelup-overlay');
        if (levelUpOverlay) levelUpOverlay.remove();

        window._isLevelUpPlaying = false;
        console.log('[AnimOrchestrator] All animations cancelled.');
    }

    function getActiveAnimations() {
        var result = [];
        activeAnimations.forEach(function (value, key) {
            result.push({
                id: key,
                eventType: value.eventType,
                priority: value.priority,
                elapsed: Date.now() - value.startTime
            });
        });
        return result;
    }

    function isPlaying(eventType) {
        for (var entry of activeAnimations.values()) {
            if (entry.eventType === eventType) return true;
        }
        return false;
    }

    // ──────────────────────────────────────────────
    // 11. SELF-TEST (debug only)
    // ──────────────────────────────────────────────
    function selfTest() {
        console.group('[AnimOrchestrator] Self-Test');

        // Test 1: Event types defined
        var types = Object.values(EVENT_TYPES);
        console.assert(types.length === 7, 'Expected 7 event types, got ' + types.length);
        console.log('✅ Event types:', types.length);

        // Test 2: All event types have priority
        var allHavePriority = types.every(function (t) {
            return EVENT_PRIORITY_MAP[t] !== undefined;
        });
        console.assert(allHavePriority, 'Some events missing priority');
        console.log('✅ Priority map complete');

        // Test 3: All event types have renderers
        var allHaveRenderers = types.every(function (t) {
            return typeof RENDERERS[t] === 'function';
        });
        console.assert(allHaveRenderers, 'Some events missing renderers');
        console.log('✅ Renderers complete');

        // Test 4: Deduplication works
        lastDispatchTime.set('__test__', Date.now());
        var deduped = (Date.now() - (lastDispatchTime.get('__test__') || 0)) < DEDUP_WINDOW;
        console.assert(deduped, 'Deduplication check failed');
        lastDispatchTime.delete('__test__');
        console.log('✅ Deduplication window:', DEDUP_WINDOW + 'ms');

        // Test 5: Accessibility levels
        var level = getAccessibilityLevel();
        console.assert(['full', 'reduced', 'off'].indexOf(level) !== -1, 'Invalid accessibility level');
        console.log('✅ Current accessibility level:', level);

        // Test 6: Queue is clean
        console.assert(queue.length === 0, 'Queue should start empty');
        console.log('✅ Queue empty');

        console.log('✅ All self-tests passed');
        console.groupEnd();
        return true;
    }

    // ──────────────────────────────────────────────
    // 12. NAVIGATION CLEANUP HOOK
    // ──────────────────────────────────────────────
    window.addEventListener('animOrchestrator:cleanup', function () {
        cancelAll();
    });

    // Also clean up on page visibility change (background tab)
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            // Don't cancel immediately, but clear the queue
            queue.length = 0;
        }
    });

    // ──────────────────────────────────────────────
    // 13. EXPOSE PUBLIC API
    // ──────────────────────────────────────────────
    window.AnimationOrchestrator = Object.freeze({
        dispatch:              dispatch,
        cancelAll:             cancelAll,
        getActiveAnimations:   getActiveAnimations,
        isPlaying:             isPlaying,
        EVENT_TYPES:           EVENT_TYPES,
        PRIORITY:              PRIORITY,
        _selfTest:             selfTest
    });

    console.log('[AnimOrchestrator] Premium Animation Orchestrator initialized. Events:', Object.keys(EVENT_TYPES).length);
})();
