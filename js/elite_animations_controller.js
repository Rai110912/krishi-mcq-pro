(function() {
    // 🌾 Advanced Animations Controller Config Core
    const CONFIG_KEY = 'krishi_elite_anims_config';
    
    const defaultConfig = {
        globeRotationSpeed: 1.0,
        weatherParticleDensity: 25,
        laserSignalFrequency: 1.0,
        hapticIntensity: 'medium',
        fpsAutoThrottle: true
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
                fpsAutoThrottle: window.EliteAnimsConfig.fpsAutoThrottle === true
            }));
            
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
            'slider-laser-freq': c.laserSignalFrequency
        };
        
        for (let id in ids) {
            let el = document.getElementById(id);
            if (el) el.value = ids[id];
        }
        
        let hapticEl = document.getElementById('select-haptic-level');
        if (hapticEl) hapticEl.value = c.hapticIntensity;
        
        let throttleEl = document.getElementById('toggle-fps-throttle');
        if (throttleEl) throttleEl.checked = c.fpsAutoThrottle;
        
        updateIndicators();
    }
    
    function updateIndicators() {
        const c = window.EliteAnimsConfig;
        let globeInd = document.getElementById('ind-globe-speed');
        if (globeInd) globeInd.textContent = c.globeRotationSpeed.toFixed(1) + 'x';
        
        let weatherInd = document.getElementById('ind-weather-density');
        if (weatherInd) weatherInd.textContent = c.weatherParticleDensity + ' particles';
        
        let laserInd = document.getElementById('ind-laser-freq');
        if (laserInd) laserInd.textContent = c.laserSignalFrequency.toFixed(1) + 'x';
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
                    let throttleIndicator = document.getElementById('fps-throttle-alert');
                    if (throttleIndicator) throttleIndicator.classList.remove('hidden');
                } else if (fpsHistory.every(f => f >= 58) && window.EliteAnimsConfig.throttled) {
                    window.EliteAnimsConfig.throttled = false;
                    console.log('[FPS Engine] Framerate recovered. Restoring full animations...');
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
        let generalBtn = document.getElementById('settings-tab-btn-general');
        let visualsBtn = document.getElementById('settings-tab-btn-visuals');
        
        if (!generalGroup || !generalGroupBottom || !visualsGroup || !generalBtn || !visualsBtn) return;
        
        if (typeof window.triggerHaptic === 'function') {
            window.triggerHaptic('click');
        }
        
        if (tabId === 'general') {
            generalGroup.classList.remove('hidden');
            generalGroupBottom.classList.remove('hidden');
            visualsGroup.classList.add('hidden');
            
            generalBtn.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400 cursor-pointer";
            visualsBtn.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer";
        } else {
            generalGroup.classList.add('hidden');
            generalGroupBottom.classList.add('hidden');
            visualsGroup.classList.remove('hidden');
            
            generalBtn.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer";
            visualsBtn.className = "flex-1 text-center py-2 text-[10px] font-black rounded-lg transition-all duration-300 bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400 cursor-pointer";
            
            // Sync slider UI elements immediately when visuals tab is rendered
            syncTuningPanelUI();
        }
    };

    console.log('[Advanced Animations Controller] Initialized successfully with 0.0% risk!');
})();
