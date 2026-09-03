/**
 * Lottie Animation Adapter
 * Handles graceful loading, playback, and fallback of Lottie assets.
 * Respects performance and accessibility settings.
 */
window.LottieAdapter = (function() {
    let container = null;
    let currentAnim = null;
    let isInitialized = false;
    
    const assets = {
        'lottie.reward.achievement': './assets/lottie/achievement.json',
        'lottie.reward.streak': './assets/lottie/streak.json',
        'lottie.feedback.correct': './assets/lottie/correct.json',
        'lottie.feedback.wrong': './assets/lottie/wrong.json',
        'lottie.reward.levelUp': './assets/lottie/levelup.json'
    };

    function initContainer() {
        if (container) return;
        container = document.createElement('div');
        container.id = 'lottie-global-container';
        container.style.position = 'fixed';
        container.style.inset = '0';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '999999';
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.justifyContent = 'center';
        document.body.appendChild(container);
    }

    // lottie-web is 298 KB and was pulled in by a <script> tag on every launch, even
    // though it is only ever needed when a reward animation actually plays. Fetched on
    // first genuine playback now. The promise is cached; a failed load is not, so a later
    // attempt can retry. Resolves to a boolean rather than rejecting, because every caller
    // already treats "no Lottie" as "run the fallback".
    let lottieEnginePromise = null;
    function loadLottieEngine() {
        if (typeof lottie !== 'undefined') return Promise.resolve(true);
        if (lottieEnginePromise) return lottieEnginePromise;
        lottieEnginePromise = new Promise(resolve => {
            const el = document.createElement('script');
            el.src = './js/libs/lottie.min.js';
            el.async = true;
            el.onload = () => resolve(typeof lottie !== 'undefined');
            el.onerror = () => {
                lottieEnginePromise = null;
                el.remove();
                resolve(false);
            };
            document.head.appendChild(el);
        });
        return lottieEnginePromise;
    }

    // Play an animation and return a Promise that resolves to true if Lottie successfully takes over.
    // Resolves to false if Lottie is unavailable or invalid, forcing the caller to run its fallback.
    //
    // Order matters: every cheap reason to bail out is checked BEFORE the engine is
    // fetched, so a battery-mode / reduce-motion user or a missing animation asset never
    // downloads lottie-web at all. It used to be downloaded on boot and then thrown away
    // by these very checks.
    async function play(assetId) {
        // 1. Accessibility & Performance Check
        const ps = window.getPerfSettings ? window.getPerfSettings() : {};
        if (ps.perfMode === 'battery' || ps.reduceMotion || ps.animIntensity === 'off') {
            console.log('[LottieAdapter] Skipped due to accessibility/performance settings. Using fallback.');
            return false;
        }

        let path = assets[assetId];
        if (!path) {
            console.warn(`[LottieAdapter] Unknown asset ID: ${assetId}`);
            return false;
        }

        // 2. Asset Validation
        try {
            const response = await fetch(path, { cache: 'force-cache' });
            if (!response.ok) {
                console.warn(`[LottieAdapter] Lottie asset rejected: HTTP ${response.status} (${assetId}).`);
                return false;
            }
            const json = await response.json();
            
            // At minimum validate: JSON exists, parses, valid dimensions, duration, layers exist, layers.length > 0
            if (!json || typeof json !== 'object' || 
                !Array.isArray(json.layers) || json.layers.length === 0 || 
                !json.w || !json.h || json.op === undefined) {
                console.warn(`[LottieAdapter] Lottie asset rejected: no renderable layers or invalid format (${assetId}).`);
                return false;
            }

            // 3. Engine, fetched only now that we know there is something worth rendering
            const engineReady = await loadLottieEngine();
            if (!engineReady) {
                console.warn('[LottieAdapter] lottie-web could not be loaded. Falling back.');
                return false;
            }

            // 4. Prevent duplicate overlapping renders (cleanup previous)
            if (currentAnim) {
                currentAnim.destroy();
                currentAnim = null;
            }

            initContainer();
            // Clear any lingering DOM nodes
            container.innerHTML = '';

            // Create a dedicated wrapper with explicit dimensions so flexbox doesn't shrink it to 0x0
            const wrapper = document.createElement('div');
            // Scale dynamically but keep a minimum footprint so it's always visible
            wrapper.style.width = '100%';
            wrapper.style.height = '100%';
            wrapper.style.maxWidth = '600px';
            wrapper.style.maxHeight = '600px';
            wrapper.style.flexShrink = '0';
            
            container.appendChild(wrapper);

            currentAnim = lottie.loadAnimation({
                container: wrapper,
                renderer: 'svg',
                loop: false,
                autoplay: true,
                animationData: json,
                rendererSettings: {
                    preserveAspectRatio: 'xMidYMid meet'
                }
            });
            
            // Handle runtime failure gracefully
            currentAnim.addEventListener('data_failed', () => {
                console.warn(`[LottieAdapter] Lottie runtime error playing ${assetId}.`);
                if (currentAnim) currentAnim.destroy();
                currentAnim = null;
            });

            currentAnim.addEventListener('complete', () => {
                if (currentAnim) currentAnim.destroy();
                currentAnim = null;
            });
            
            return true;
        } catch(e) {
            console.warn('[LottieAdapter] Lottie asset rejected: network or parsing error.', e);
            return false;
        }
    }

    return { play };
})();
