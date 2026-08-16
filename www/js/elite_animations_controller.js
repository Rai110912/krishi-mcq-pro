(function() {
    // 🌾 Advanced Animations Controller Config Core
    const CONFIG_KEY = 'krishi_elite_anims_config';
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const defaultConfig = {
        globeRotationSpeed: 1.0,
        weatherParticleDensity: isMobile ? 10 : 25,
        laserSignalFrequency: 1.0,
        hapticIntensity: 'medium',
        fpsAutoThrottle: true,
        appCardOpacity: 100,
        pageTransitionStyle: 'slide'
    };
    
    // Load config from LocalStorage safely
    function loadConfig() {
        try {
            let saved = localStorage.getItem(CONFIG_KEY);
            if (saved) {
                return Object.assign({}, defaultConfig, JSON.parse(saved));
            }
        } catch (e) {
            console.warn('[Animations Controller] Failed to load config:', e);
        }
        return Object.assign({}, defaultConfig);
    }
    
    // Initialize global configuration object
    window.EliteAnimsConfig = loadConfig();
    window.EliteAnimsConfig.throttled = false; // Runtime variable, not persisted
    
    // Apply dynamic App Opacity & Solidity based on user choice
    function applyAppOpacity() {
        const c = window.EliteAnimsConfig;
        const opacity = c.appCardOpacity !== undefined ? c.appCardOpacity : 100;
        const opacityVal = (opacity / 100).toFixed(2);
        document.documentElement.style.setProperty('--app-card-opacity', opacityVal);
        
        const isDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
        
        if (opacity >= 98) {
            // 100% Solid & High-Contrast Mode
            if (isDark) {
                document.documentElement.style.setProperty('--border', '#475569');
                document.documentElement.style.setProperty('--bg', '#090d16');
                document.documentElement.style.setProperty('--card', '#1e293b');
                document.documentElement.style.setProperty('--nav-bg', '#1e293b');
            } else {
                document.documentElement.style.setProperty('--border', '#b4c6b8');
                document.documentElement.style.setProperty('--bg', '#e4f2e6');
                document.documentElement.style.setProperty('--card', '#ffffff');
                document.documentElement.style.setProperty('--nav-bg', '#ffffff');
            }
        } else {
            // Translucent/Glassmorphic Mode
            if (isDark) {
                document.documentElement.style.setProperty('--border', `rgba(71, 85, 105, ${opacityVal})`);
                document.documentElement.style.setProperty('--bg', '#0f172a');
                document.documentElement.style.setProperty('--card', `rgba(30, 41, 59, ${opacityVal})`);
                document.documentElement.style.setProperty('--nav-bg', `rgba(30, 41, 59, ${opacityVal})`);
            } else {
                document.documentElement.style.setProperty('--border', `rgba(180, 198, 184, ${opacityVal})`);
                document.documentElement.style.setProperty('--bg', '#f0fdf4');
                document.documentElement.style.setProperty('--card', `rgba(255, 255, 255, ${opacityVal})`);
                document.documentElement.style.setProperty('--nav-bg', `rgba(255, 255, 255, ${opacityVal})`);
            }
        }
    }
    
    // Apply initially
    applyAppOpacity();
    
    // Automatically re-apply opacity adjustments when dark mode toggles
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                applyAppOpacity();
            }
        });
    });
    observer.observe(document.documentElement, { attributes: true });
    
    // Save configuration safely
    window.saveEliteAnimsConfig = function(newConfig) {
        try {
            if (newConfig) {
                window.EliteAnimsConfig = Object.assign(window.EliteAnimsConfig, newConfig);
            }
            localStorage.setItem(CONFIG_KEY, JSON.stringify({
                globeRotationSpeed: parseFloat(window.EliteAnimsConfig.globeRotationSpeed),
                weatherParticleDensity: parseInt(window.EliteAnimsConfig.weatherParticleDensity, 10),
                laserSignalFrequency: parseFloat(window.EliteAnimsConfig.laserSignalFrequency),
                hapticIntensity: window.EliteAnimsConfig.hapticIntensity,
                fpsAutoThrottle: window.EliteAnimsConfig.fpsAutoThrottle === true,
                appCardOpacity: parseInt(window.EliteAnimsConfig.appCardOpacity !== undefined ? window.EliteAnimsConfig.appCardOpacity : 100, 10),
                pageTransitionStyle: window.EliteAnimsConfig.pageTransitionStyle || 'slide'
            }));
            
            applyAppOpacity();
            
            if (typeof window.syncSettingsToCloud === 'function') {
                window.syncSettingsToCloud('Visual parameters updated');
            }
            
            // Dispatch dynamic update event so visual engines react instantly
            window.dispatchEvent(new CustomEvent('elite-animations-config-updated'));
        } catch (e) {
            console.warn('[Animations Controller] Failed to save config:', e);
        }
    };
    
    // Reset configuration to default values
    window.resetEliteAnimsConfig = function() {
        window.saveEliteAnimsConfig(defaultConfig);
        syncTuningPanelUI();
        if (typeof window.showToast === 'function') {
            window.showToast('🎨 एनिमेसन कन्फिगरेसन रिसेट गरियो!');
        }
    };
    
    // Collapsible Tuning panel trigger
    window.toggleAdvancedAnimationsPanel = function() {
        let panel = document.getElementById('advanced-anim-tuning-panel');
        let icon = document.getElementById('advanced-anim-toggle-icon');
        if (!panel) return;
        
        if (panel.style.maxHeight && panel.style.maxHeight !== '0px') {
            panel.style.maxHeight = '0px';
            panel.style.opacity = '0';
            if (icon) icon.style.transform = 'rotate(0deg)';
        } else {
            panel.style.maxHeight = '500px';
            panel.style.opacity = '1';
            if (icon) icon.style.transform = 'rotate(180deg)';
            syncTuningPanelUI();
        }
    };
    
    // Synchronize UI Slider elements with active configurations
    function syncTuningPanelUI() {
        const c = window.EliteAnimsConfig;
        
        const ids = {
            'slider-globe-speed': c.globeRotationSpeed,
            'slider-weather-density': c.weatherParticleDensity,
            'slider-laser-freq': c.laserSignalFrequency,
            'slider-app-opacity': c.appCardOpacity !== undefined ? c.appCardOpacity : 100
        };
        
        for (let id in ids) {
            let el = document.getElementById(id);
            if (el) el.value = ids[id];
        }
        
        let hapticEl = document.getElementById('select-haptic-level');
        if (hapticEl) hapticEl.value = c.hapticIntensity;
        
        let throttleEl = document.getElementById('toggle-fps-throttle');
        if (throttleEl) throttleEl.checked = c.fpsAutoThrottle;
        
        let autoAdvanceEl = document.getElementById('toggle-auto-advance');
        if (autoAdvanceEl) autoAdvanceEl.checked = localStorage.getItem('krishi_auto_advance') === 'true';
        
        let transitionEl = document.getElementById('select-page-transition');
        if (transitionEl) transitionEl.value = c.pageTransitionStyle || 'slide';
        
        updateIndicators();
    }

    window.handleAutoAdvanceToggle = function(element) {
        localStorage.setItem('krishi_auto_advance', element.checked ? 'true' : 'false');
        if (typeof window.playSound === 'function') window.playSound('click');
        if (typeof window.triggerHaptic === 'function') window.triggerHaptic('click');
        if (typeof window.syncSettingsToCloud === 'function') {
            window.syncSettingsToCloud('Auto-advance toggled');
        }
    };
    
    function updateIndicators() {
        const c = window.EliteAnimsConfig;
        let globeInd = document.getElementById('ind-globe-speed');
        if (globeInd) globeInd.textContent = c.globeRotationSpeed.toFixed(1) + 'x';
        
        let weatherInd = document.getElementById('ind-weather-density');
        if (weatherInd) weatherInd.textContent = c.weatherParticleDensity + ' particles';
        
        let laserInd = document.getElementById('ind-laser-freq');
        if (laserInd) laserInd.textContent = c.laserSignalFrequency.toFixed(1) + 'x';
        
        let opacityInd = document.getElementById('ind-app-opacity');
        if (opacityInd) opacityInd.textContent = (c.appCardOpacity !== undefined ? c.appCardOpacity : 100) + '%';
    }
    
    // Handle slider/control changes dynamically
    window.handleAnimConfigChange = function(element, type) {
        let val;
        if (element.type === 'checkbox') {
            val = element.checked;
        } else {
            val = element.value;
        }
        
        let update = {};
        update[type] = val;
        window.saveEliteAnimsConfig(update);
        updateIndicators();
        
        // Haptic feedback for tactile control adjustments
        if (typeof window.triggerHaptic === 'function') {
            window.triggerHaptic('click');
        }
    };
    
    // Intercept tactile feedback calls to scale intensity
    const originalHaptic = window.triggerHaptic;
    window.triggerHaptic = function(type) {
        const intensity = window.EliteAnimsConfig.hapticIntensity;
        if (intensity === 'off') return;
        
        if (typeof originalHaptic === 'function') {
            // Under standard Web API, navigator.vibrate duration can be scaled
            if ('vibrate' in navigator) {
                let duration = 10;
                if (type === 'correct' || type === 'success') duration = 40;
                else if (type === 'wrong' || type === 'error') duration = 80;
                
                if (intensity === 'soft') duration = Math.max(5, Math.round(duration * 0.5));
                else if (intensity === 'strong') duration = Math.round(duration * 1.5);
                
                navigator.vibrate(duration);
                return;
            }
            originalHaptic(type);
        }
    };
    
    // 🧠 Smart FPS Budget Engine (Auto-Throttle)
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsHistory = [];
    
    function monitorFPS(time) {
        if (document.hidden || !window.EliteAnimsConfig.fpsAutoThrottle) {
            // Background / Idle Mode: sleep monitor for 1 second to conserve 100% CPU/battery
            setTimeout(() => {
                requestAnimationFrame(monitorFPS);
            }, 1000);
            return;
        }
        frameCount++;
        let delta = time - lastTime;
        
        if (delta >= 500) {
            let fps = Math.round((frameCount * 1000) / delta);
            frameCount = 0;
            lastTime = time;
            
            if (window.EliteAnimsConfig.fpsAutoThrottle) {
                fpsHistory.push(fps);
                if (fpsHistory.length > 6) fpsHistory.shift(); // Keep 3-second history
                
                // If FPS is consistently below 55 FPS, trigger throttle
                let lowFpsCount = fpsHistory.filter(f => f < 55).length;
                if (lowFpsCount >= 4 && !window.EliteAnimsConfig.throttled) {
                    window.EliteAnimsConfig.throttled = true;
                    console.log('[FPS Engine] Framerate dropped below budget. Throttling active animations...');
                    document.documentElement.classList.add('fps-throttled');
                    let throttleIndicator = document.getElementById('fps-throttle-alert');
                    if (throttleIndicator) throttleIndicator.classList.remove('hidden');
                } else if (fpsHistory.every(f => f >= 58) && window.EliteAnimsConfig.throttled) {
                    window.EliteAnimsConfig.throttled = false;
                    console.log('[FPS Engine] Framerate recovered. Restoring full animations...');
                    document.documentElement.classList.remove('fps-throttled');
                    let throttleIndicator = document.getElementById('fps-throttle-alert');
                    if (throttleIndicator) throttleIndicator.classList.add('hidden');
                }
            }
        }
        requestAnimationFrame(monitorFPS);
    }
    
    // Launch dynamic FPS monitor frame loop
    requestAnimationFrame(monitorFPS);
    
    // ⚙️ Settings Segmented Tab Selector Switcher Logic
    window.switchSettingsTab = function(tabId) {
        let generalGroup = document.getElementById('settings-group-general');
        let generalGroupBottom = document.getElementById('settings-group-general-bottom');
        let visualsGroup = document.getElementById('settings-group-visuals');
        let soundGroup = document.getElementById('settings-group-sound');
        let generalBtn = document.getElementById('settings-tab-btn-general');
        let visualsBtn = document.getElementById('settings-tab-btn-visuals');
        let soundBtn = document.getElementById('settings-tab-btn-sound');

        if (!generalGroup || !generalGroupBottom || !visualsGroup || !generalBtn || !visualsBtn) return;

        if (typeof window.triggerHaptic === 'function') {
            window.triggerHaptic('click');
        }

        const activeClass = 'flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400 cursor-pointer';
        const inactiveClass = 'flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer';

        // Reset all groups
        generalGroup.classList.add('hidden');
        generalGroupBottom.classList.add('hidden');
        visualsGroup.classList.add('hidden');
        if (soundGroup) soundGroup.classList.add('hidden');

        // Reset all buttons
        generalBtn.className = inactiveClass;
        visualsBtn.className = inactiveClass;
        if (soundBtn) soundBtn.className = inactiveClass;

        if (tabId === 'general') {
            generalGroup.classList.remove('hidden');
            generalGroupBottom.classList.remove('hidden');
            generalBtn.className = activeClass;
        } else if (tabId === 'sound') {
            if (soundGroup) soundGroup.classList.remove('hidden');
            if (soundBtn) soundBtn.className = activeClass;
            // Re-render the ambient grid when sound tab opens
            if (typeof window.ambientRenderGrid === 'function') {
                window.ambientRenderGrid();
            }
        } else {
            visualsGroup.classList.remove('hidden');
            visualsBtn.className = activeClass;
            // Sync slider UI elements immediately when visuals tab is rendered
            syncTuningPanelUI();
        }
    };


    document.addEventListener('DOMContentLoaded', () => {
        syncTuningPanelUI();
    });

    console.log('[Advanced Animations Controller] Initialized successfully with 0.0% risk!');
})();
