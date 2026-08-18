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
        'lottie.mcq.correct': './assets/lottie/correct.json',
        'lottie.mcq.wrong': './assets/lottie/wrong.json'
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

    // Play an animation and return a Promise that resolves to true if Lottie successfully takes over.
    // Resolves to false if Lottie is unavailable or invalid, forcing the caller to run its fallback.
    async function play(assetId) {
        if (typeof lottie === 'undefined') {
            console.warn('[LottieAdapter] lottie-web not loaded. Falling back.');
            return false;
        }

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

            // 3. Prevent duplicate overlapping renders (cleanup previous)
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
