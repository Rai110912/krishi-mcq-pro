/**
 * ============================================================
 * 🎧 KRISHI MCQ PRO — NEPAL AMBIENT STUDY PLAYER v2.0
 * Web Audio API Synthesis Engine (Zero External File Dependency)
 * 100% Offline Safe | 0% Firebase/App Logic Impact
 * ============================================================
 */
(function () {
    'use strict';

    // ─── Audio Context (Lazy-initialized on first user gesture) ─────────────
    let ctx = null;
    let masterGain = null;
    const activeSources = {}; // { soundId: { gainNode, sourceNodes[] } }

    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 1.0;
            masterGain.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    // ─── Noise Buffer Generator ───────────────────────────────────────────────
    function createNoiseBuffer(type = 'brown') {
        const c = getCtx();
        const bufferSize = c.sampleRate * 4;
        const buffer = c.createBuffer(2, bufferSize, c.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            let last = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                if (type === 'brown') {
                    data[i] = (last + 0.02 * white) / 1.02;
                    last = data[i];
                    data[i] *= 3.5;
                } else if (type === 'pink') {
                    data[i] = white * 0.65;
                } else {
                    data[i] = white;
                }
            }
        }
        return buffer;
    }

    // ─── SOUND ENGINES ───────────────────────────────────────────────────────

    const SoundEngines = {

        // 1. Chitwan Rain — Bandpass Brown Noise with random drip pops
        chitwanRain(gainNode) {
            const c = getCtx();
            const nodes = [];

            const src = c.createBufferSource();
            src.buffer = createNoiseBuffer('brown');
            src.loop = true;

            const bp = c.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = 700;
            bp.Q.value = 0.4;

            const hp = c.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 200;

            src.connect(bp);
            bp.connect(hp);
            hp.connect(gainNode);
            src.start();
            nodes.push(src);

            // Random drip pops
            function scheduleDrip() {
                if (!activeSources['chitwanRain']) return;
                const t = c.currentTime + Math.random() * 0.8;
                const osc = c.createOscillator();
                const env = c.createGain();
                osc.type = 'sine';
                osc.frequency.value = 1200 + Math.random() * 800;
                env.gain.setValueAtTime(0.05, t);
                env.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
                osc.connect(env);
                env.connect(gainNode);
                osc.start(t);
                osc.stop(t + 0.15);
                setTimeout(scheduleDrip, 200 + Math.random() * 1500);
            }
            scheduleDrip();
            return nodes;
        },

        // 2. Himalayan Wind — Pink Noise + LFO tremolo for gusts
        himalayanWind(gainNode) {
            const c = getCtx();
            const nodes = [];

            const src = c.createBufferSource();
            src.buffer = createNoiseBuffer('pink');
            src.loop = true;

            const lp = c.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 600;

            const lfo = c.createOscillator();
            const lfoGain = c.createGain();
            lfo.type = 'sine';
            lfo.frequency.value = 0.15;
            lfoGain.gain.value = 0.4;

            const tremoloGain = c.createGain();
            tremoloGain.gain.value = 0.6;

            lfo.connect(lfoGain);
            lfoGain.connect(tremoloGain.gain);
            src.connect(lp);
            lp.connect(tremoloGain);
            tremoloGain.connect(gainNode);
            src.start();
            lfo.start();
            nodes.push(src, lfo);
            return nodes;
        },

        // 3. Deep Binaural Focus — Alpha 8Hz binaural (L:200Hz R:208Hz)
        binauralFocus(gainNode) {
            const c = getCtx();
            const nodes = [];
            const splitter = c.createChannelMerger(2);

            const freqL = 200;
            const freqR = 208;

            const oscL = c.createOscillator();
            const gainL = c.createGain();
            oscL.type = 'sine';
            oscL.frequency.value = freqL;
            gainL.gain.value = 0.3;
            oscL.connect(gainL);
            gainL.connect(splitter, 0, 0);

            const oscR = c.createOscillator();
            const gainR = c.createGain();
            oscR.type = 'sine';
            oscR.frequency.value = freqR;
            gainR.gain.value = 0.3;
            oscR.connect(gainR);
            gainR.connect(splitter, 0, 1);

            splitter.connect(gainNode);
            oscL.start();
            oscR.start();
            nodes.push(oscL, oscR);
            return nodes;
        },

        // 4. Singing Bowl — FM cluster with metal decay
        singingBowl(gainNode) {
            const c = getCtx();
            const nodes = [];
            const freqs = [432, 528, 639];

            function strike() {
                if (!activeSources['singingBowl']) return;
                const t = c.currentTime;
                freqs.forEach(freq => {
                    const carrier = c.createOscillator();
                    const env = c.createGain();
                    const mod = c.createOscillator();
                    const modGain = c.createGain();

                    carrier.type = 'sine';
                    carrier.frequency.value = freq;
                    mod.frequency.value = freq * 2.756;
                    modGain.gain.value = freq * 0.8;

                    env.gain.setValueAtTime(0.001, t);
                    env.gain.linearRampToValueAtTime(0.18, t + 0.02);
                    env.gain.exponentialRampToValueAtTime(0.0001, t + 6);

                    mod.connect(modGain);
                    modGain.connect(carrier.frequency);
                    carrier.connect(env);
                    env.connect(gainNode);

                    carrier.start(t);
                    carrier.stop(t + 6.1);
                    mod.start(t);
                    mod.stop(t + 6.1);
                });
                setTimeout(strike, 7500 + Math.random() * 4000);
            }
            strike();
            return nodes;
        },

        // 5. Campfire / Temple Fire — Low rumble noise + crackle pops
        campfire(gainNode) {
            const c = getCtx();
            const nodes = [];

            const src = c.createBufferSource();
            src.buffer = createNoiseBuffer('brown');
            src.loop = true;

            const lp = c.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 320;

            src.connect(lp);
            lp.connect(gainNode);
            src.start();
            nodes.push(src);

            function crackle() {
                if (!activeSources['campfire']) return;
                const t = c.currentTime + Math.random() * 0.4;
                const osc = c.createOscillator();
                const env = c.createGain();
                osc.type = 'sawtooth';
                osc.frequency.value = 800 + Math.random() * 1200;
                env.gain.setValueAtTime(0.04 + Math.random() * 0.08, t);
                env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06 + Math.random() * 0.08);
                osc.connect(env);
                env.connect(gainNode);
                osc.start(t);
                osc.stop(t + 0.1);
                setTimeout(crackle, 150 + Math.random() * 1200);
            }
            crackle();
            return nodes;
        },

        // 6. Himalayan River / Stream — White noise + high resonance
        himalayaRiver(gainNode) {
            const c = getCtx();
            const nodes = [];

            const src = c.createBufferSource();
            src.buffer = createNoiseBuffer('white');
            src.loop = true;

            const bp1 = c.createBiquadFilter();
            bp1.type = 'bandpass';
            bp1.frequency.value = 900;
            bp1.Q.value = 0.9;

            const bp2 = c.createBiquadFilter();
            bp2.type = 'bandpass';
            bp2.frequency.value = 2000;
            bp2.Q.value = 0.5;

            const merge = c.createGain();
            merge.gain.value = 0.6;

            src.connect(bp1);
            src.connect(bp2);
            bp1.connect(merge);
            bp2.connect(merge);
            merge.connect(gainNode);
            src.start();
            nodes.push(src);
            return nodes;
        },

        // 7. Forest Birds of Nepal — Chirp oscillator patterns
        forestBirds(gainNode) {
            const c = getCtx();
            const nodes = [];

            function chirp() {
                if (!activeSources['forestBirds']) return;
                const t = c.currentTime + Math.random() * 2;
                const numChirps = 2 + Math.floor(Math.random() * 4);
                for (let i = 0; i < numChirps; i++) {
                    const osc = c.createOscillator();
                    const env = c.createGain();
                    const freq = 1800 + Math.random() * 2000;
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, t + i * 0.12);
                    osc.frequency.linearRampToValueAtTime(freq * (0.85 + Math.random() * 0.3), t + i * 0.12 + 0.1);
                    env.gain.setValueAtTime(0.0001, t + i * 0.12);
                    env.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.06, t + i * 0.12 + 0.04);
                    env.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.12);
                    osc.connect(env);
                    env.connect(gainNode);
                    osc.start(t + i * 0.12);
                    osc.stop(t + i * 0.12 + 0.15);
                }
                setTimeout(chirp, 1500 + Math.random() * 4000);
            }
            chirp();
            return nodes;
        },

        // 8. Lo-Fi Study Beats — 80BPM kick + hi-hat pattern
        lofiBeats(gainNode) {
            const c = getCtx();
            const bpm = 80;
            const beat = 60 / bpm;
            let nextBeat = c.currentTime + 0.1;
            let step = 0;
            const kickSteps = [0, 4, 6];
            const hihatSteps = [1, 3, 5, 7];
            const totalSteps = 8;
            let timerId = null;

            function scheduleBeats() {
                if (!activeSources['lofiBeats']) return;
                while (nextBeat < c.currentTime + 0.4) {
                    const t = nextBeat;
                    const s = step % totalSteps;

                    if (kickSteps.includes(s)) {
                        const osc = c.createOscillator();
                        const env = c.createGain();
                        osc.frequency.setValueAtTime(150, t);
                        osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
                        env.gain.setValueAtTime(0.8, t);
                        env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
                        osc.connect(env);
                        env.connect(gainNode);
                        osc.start(t);
                        osc.stop(t + 0.2);
                    }
                    if (hihatSteps.includes(s)) {
                        const nSrc = c.createBufferSource();
                        nSrc.buffer = createNoiseBuffer('white');
                        const hpF = c.createBiquadFilter();
                        hpF.type = 'highpass';
                        hpF.frequency.value = 8000;
                        const env = c.createGain();
                        env.gain.setValueAtTime(0.12, t);
                        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
                        nSrc.connect(hpF);
                        hpF.connect(env);
                        env.connect(gainNode);
                        nSrc.start(t);
                        nSrc.stop(t + 0.08);
                    }

                    nextBeat += beat / 2;
                    step++;
                }
                timerId = setTimeout(scheduleBeats, 100);
            }
            scheduleBeats();
            return [{ stop: () => clearTimeout(timerId) }];
        },

        // 9. Thunder & Storm — Heavy brown noise bursts
        thunderStorm(gainNode) {
            const c = getCtx();
            const nodes = [];

            // Continuous rain base
            const rainSrc = c.createBufferSource();
            rainSrc.buffer = createNoiseBuffer('brown');
            rainSrc.loop = true;
            const rainLp = c.createBiquadFilter();
            rainLp.type = 'bandpass';
            rainLp.frequency.value = 900;
            rainLp.Q.value = 0.3;
            rainSrc.connect(rainLp);
            rainLp.connect(gainNode);
            rainSrc.start();
            nodes.push(rainSrc);

            function thunder() {
                if (!activeSources['thunderStorm']) return;
                const t = c.currentTime + 4 + Math.random() * 12;
                const tSrc = c.createBufferSource();
                tSrc.buffer = createNoiseBuffer('brown');
                const env = c.createGain();
                env.gain.setValueAtTime(0.0001, t);
                env.gain.linearRampToValueAtTime(1.2, t + 0.05);
                env.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
                const lp = c.createBiquadFilter();
                lp.type = 'lowpass';
                lp.frequency.value = 200;
                tSrc.connect(lp);
                lp.connect(env);
                env.connect(gainNode);
                tSrc.start(t);
                tSrc.stop(t + 4);
                setTimeout(thunder, (6 + Math.random() * 14) * 1000);
            }
            thunder();
            return nodes;
        },

        // 10. Custom URL Loader — plays user-provided audio URL
        customUrl(gainNode, url) {
            if (!url) return [];
            const audio = new Audio(url);
            audio.crossOrigin = 'anonymous';
            audio.loop = true;
            const c = getCtx();
            const src = c.createMediaElementSource(audio);
            src.connect(gainNode);
            audio.play().catch(() => {});
            return [{ stop: () => { audio.pause(); audio.src = ''; } }];
        }
    };

    // ─── SOUND CATALOG ───────────────────────────────────────────────────────
    window.KrishiAmbientSounds = [
        { id: 'chitwanRain',   label: '🌧️ Chitwan Rain',       engine: 'chitwanRain',   color: '#0ea5e9' },
        { id: 'himalayanWind', label: '🌬️ Himalayan Wind',      engine: 'himalayanWind', color: '#94a3b8' },
        { id: 'binauralFocus', label: '🧠 Binaural Focus',      engine: 'binauralFocus', color: '#8b5cf6' },
        { id: 'singingBowl',   label: '🔔 Singing Bowl',        engine: 'singingBowl',   color: '#f59e0b' },
        { id: 'campfire',      label: '🔥 Temple Campfire',     engine: 'campfire',      color: '#f97316' },
        { id: 'himalayaRiver', label: '💧 Himalaya River',      engine: 'himalayaRiver', color: '#06b6d4' },
        { id: 'forestBirds',   label: '🐦 Forest Birds',        engine: 'forestBirds',   color: '#22c55e' },
        { id: 'lofiBeats',     label: '🎵 Lo-Fi Study Beats',   engine: 'lofiBeats',     color: '#ec4899' },
        { id: 'thunderStorm',  label: '⛈️ Thunder & Storm',     engine: 'thunderStorm',  color: '#64748b' },
    ];

    // ─── PLAY / STOP ─────────────────────────────────────────────────────────
    window.ambientPlay = function(id, volume = 0.5, url = null) {
        if (activeSources[id]) window.ambientStop(id);
        const c = getCtx();
        const gainNode = c.createGain();
        gainNode.gain.value = volume;
        gainNode.connect(masterGain);

        const sound = window.KrishiAmbientSounds.find(s => s.id === id);
        let nodes = [];
        if (id === 'customUrl') {
            nodes = SoundEngines.customUrl(gainNode, url);
        } else if (sound && SoundEngines[sound.engine]) {
            nodes = SoundEngines[sound.engine](gainNode);
        }
        activeSources[id] = { gainNode, nodes };
        _saveState();
    };

    window.ambientStop = function(id) {
        if (!activeSources[id]) return;
        const { gainNode, nodes } = activeSources[id];
        nodes.forEach(n => {
            try { if (n.stop) n.stop(); } catch (e) {}
        });
        try { gainNode.disconnect(); } catch (e) {}
        delete activeSources[id];
        _saveState();
    };

    window.ambientSetVolume = function(id, volume) {
        if (activeSources[id]) {
            activeSources[id].gainNode.gain.value = parseFloat(volume);
        }
        _saveState();
    };

    window.ambientIsPlaying = function(id) {
        return !!activeSources[id];
    };

    // ─── SLEEP TIMER ─────────────────────────────────────────────────────────
    let sleepTimerId = null;
    let sleepFadeId = null;

    window.ambientSleepTimer = function(minutes) {
        clearTimeout(sleepTimerId);
        clearInterval(sleepFadeId);
        if (typeof window.showToast === 'function') {
            window.showToast(`⏱️ Sleep timer set: ${minutes} minutes`);
        }
        sleepTimerId = setTimeout(() => {
            // Gradually fade master gain to 0 over 60s
            const totalSteps = 60;
            let step = 0;
            const startVol = masterGain.gain.value;
            sleepFadeId = setInterval(() => {
                step++;
                masterGain.gain.value = startVol * (1 - step / totalSteps);
                if (step >= totalSteps) {
                    clearInterval(sleepFadeId);
                    Object.keys(activeSources).forEach(id => window.ambientStop(id));
                    masterGain.gain.value = 1.0;
                    _renderDrawer();
                    if (typeof window.showToast === 'function') {
                        window.showToast('🎧 Sleep timer: Ambient player stopped!');
                    }
                }
            }, 1000);
        }, minutes * 60 * 1000);
    };

    window.ambientClearTimer = function() {
        clearTimeout(sleepTimerId);
        clearInterval(sleepFadeId);
        if (masterGain) masterGain.gain.value = 1.0;
        if (typeof window.showToast === 'function') {
            window.showToast('⏱️ Sleep timer cancelled');
        }
    };

    // ─── CUSTOM SOUND MANAGER ─────────────────────────────────────────────────
    window.ambientAddCustomSound = function() {
        const nameEl = document.getElementById('ambient-custom-name');
        const urlEl = document.getElementById('ambient-custom-url');
        if (!nameEl || !urlEl) return;
        const name = nameEl.value.trim();
        const url = urlEl.value.trim();
        if (!name || !url) {
            if (typeof window.showToast === 'function') window.showToast('⚠️ Please enter both a name and a URL!');
            return;
        }
        let customs = _loadCustomSounds();
        const newId = 'custom_' + Date.now();
        customs.push({ id: newId, label: '🎵 ' + name, url, color: '#a78bfa' });
        KrishiStorage.setItem('krishi_ambient_custom', JSON.stringify(customs));
        nameEl.value = '';
        urlEl.value = '';
        window.ambientRenderGrid();
        if (typeof window.showToast === 'function') window.showToast('✅ Custom sound added!');
    };

    window.ambientRemoveCustomSound = function(id) {
        let customs = _loadCustomSounds();
        customs = customs.filter(s => s.id !== id);
        KrishiStorage.setItem('krishi_ambient_custom', JSON.stringify(customs));
        window.ambientStop(id);
        window.ambientRenderGrid();
    };

    function _loadCustomSounds() {
        try { return JSON.parse(KrishiStorage.getItem('krishi_ambient_custom') || '[]'); } catch (e) { window.krishiLogSilent && window.krishiLogSilent('ambient.custom_sounds', e); return []; }
    }

    // ─── PERSISTENT STATE ────────────────────────────────────────────────────
    function _saveState() {
        const state = {};
        Object.keys(activeSources).forEach(id => {
            state[id] = activeSources[id].gainNode.gain.value;
        });
        KrishiStorage.setItem('krishi_ambient_state', JSON.stringify(state));
    }

    // ─── DRAWER RENDERER (now exposed as ambientRenderGrid for settings tab) ──────────────────────────────────────────
    // Custom sound labels/URLs are user input: they are HTML-escaped and all
    // interactions run through delegated listeners on data-* attributes, never
    // through string-interpolated inline handlers.
    function _escAttr(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    window.ambientRenderGrid = function() {
        const container = document.getElementById('ambient-sounds-grid');
        if (!container) return;

        if (!container.__krishiAmbientWired) {
            container.__krishiAmbientWired = true;
            container.addEventListener('click', function(ev) {
                const card = ev.target.closest('.ambient-sound-card');
                if (!card) return;
                if (ev.target.closest('[data-role="remove"]')) {
                    ev.stopPropagation();
                    window.ambientRemoveCustomSound(card.dataset.id);
                    return;
                }
                if (!ev.target.closest('.ambient-card-top')) return;
                window.ambientToggleSound(card.dataset.id, card.dataset.url || '');
            });
            container.addEventListener('input', function(ev) {
                if (!ev.target.matches('[data-role="volume"]')) return;
                const card = ev.target.closest('.ambient-sound-card');
                if (card) window.ambientSetVolume(card.dataset.id, ev.target.value);
            });
        }

        const customs = _loadCustomSounds();
        const allSounds = [...window.KrishiAmbientSounds, ...customs];

        container.innerHTML = allSounds.map(sound => {
            const playing = window.ambientIsPlaying(sound.id);
            const vol = activeSources[sound.id] ? activeSources[sound.id].gainNode.gain.value : 0.5;
            const isCustom = sound.id.startsWith('custom_');
            return `
            <div class="ambient-sound-card ${playing ? 'ambient-card-active' : ''}" style="--accent:${_escAttr(sound.color)}" data-id="${_escAttr(sound.id)}"${isCustom ? ` data-url="${_escAttr(sound.url || '')}"` : ''}>
                <div class="ambient-card-top">
                    <span class="ambient-card-icon">${playing ? '⏸️' : '▶️'}</span>
                    <span class="ambient-card-label">${_escAttr(sound.label)}</span>
                    ${isCustom ? `<button class="ambient-remove-btn" data-role="remove">✕</button>` : ''}
                </div>
                ${playing ? `
                <div class="ambient-vol-row">
                    <span class="ambient-vol-icon">🔊</span>
                    <input type="range" min="0" max="1" step="0.01" value="${vol}"
                        class="ambient-vol-slider" data-role="volume"
                        style="accent-color:${_escAttr(sound.color)}">
                </div>` : ''}
            </div>`;
        }).join('');

        // Update active badge
        const badge = document.getElementById('ambient-active-badge');
        if (badge) {
            const count = Object.keys(activeSources).length;
            if (count > 0) {
                badge.textContent = `${count} PLAYING`;
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#34d399';
            } else {
                badge.textContent = 'OFF';
                badge.style.background = '';
                badge.style.color = '';
            }
        }
    };


    window.ambientToggleSound = function(id, url) {
        if (window.ambientIsPlaying(id)) {
            window.ambientStop(id);
        } else {
            window.ambientPlay(id, 0.5, url || null);
        }
        window.ambientRenderGrid();
    };

    // ─── INIT ─────────────────────────────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', () => {
        // Restore any previously active sounds (best-effort, user gesture required)
        // We don't auto-restore to avoid autoplay policy violations
    });

    console.log('[KrishiAmbient] 🎧 Nepal Ambient Study Player v2.0 initialized');
})();
