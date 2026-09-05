// ─── Silent-failure telemetry ─────────────────────────────────────────────
// Central sink for intentionally-swallowed errors (storage fallbacks,
// migration guards). Resilience is preserved — failures stay non-fatal —
// but they become visible: a rate-limited console.warn plus an in-memory
// ring buffer inspectable via krishiGetSilentFailures() in DevTools.
const KRISHI_SILENT_FAILURE_LOG = [];
const KRISHI_SILENT_WARN_BUDGET = Object.create(null);
window.krishiLogSilent = function (context, err) {
    try {
        const ctx = String(context || 'unknown');
        KRISHI_SILENT_FAILURE_LOG.push({ at: Date.now(), context: ctx, message: err && err.message ? err.message : String(err) });
        if (KRISHI_SILENT_FAILURE_LOG.length > 50) KRISHI_SILENT_FAILURE_LOG.shift();
        if ((KRISHI_SILENT_WARN_BUDGET[ctx] || 0) < 3) {
            KRISHI_SILENT_WARN_BUDGET[ctx] = (KRISHI_SILENT_WARN_BUDGET[ctx] || 0) + 1;
            console.warn('[KrishiSilent]', ctx + ':', err && err.message ? err.message : err);
        }
    } catch (_) {}
};
window.krishiGetSilentFailures = function () { return KRISHI_SILENT_FAILURE_LOG.slice(); };

function initLiveOTAUpdateEngine() {
    let isApplyingOTA = false;

    async function checkOTAPush() {
        if (isApplyingOTA) return;

        // Active Quiz Guard: Do not interrupt ongoing quizzes
        const mcqPage = document.getElementById('page-mcq');
        if (window.__krishiQuizActive__ || (mcqPage && !mcqPage.classList.contains('hidden'))) {
            console.log('[OTA Engine] Quiz in progress. Postponing OTA live update check.');
            return;
        }

        try {
            const versionUrl = './version.json?t=' + Date.now();
            const res = await fetch(versionUrl, { cache: 'no-store' });
            if (!res.ok) return;

            const meta = await res.json();
            if (!meta || !meta.cacheName) return;

            const activeCache = localStorage.getItem('krishi_active_cache_name');
            if (!activeCache) {
                localStorage.setItem('krishi_active_cache_name', meta.cacheName);
                return;
            }

            if (activeCache !== meta.cacheName) {
                isApplyingOTA = true;
                console.log(`[OTA Engine] New live version detected! Current: ${activeCache} -> New: ${meta.cacheName}`);

                if (typeof showUpdateProgressHUD === 'function') {
                    showUpdateProgressHUD('⚡ Instant OTA Update: नयाँ प्रश्न तथा फिचरहरू उपलब्ध भए!', 'success', 3500);
                } else if (typeof showToast === 'function') {
                    showToast('⚡ Instant OTA Update: New questions & features active!', 4000);
                }

                localStorage.setItem('krishi_active_cache_name', meta.cacheName);

                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations().then(regs => {
                        regs.forEach(reg => {
                            try { reg.update(); } catch (e) { window.krishiLogSilent && krishiLogSilent('sw.update', e); }
                        });
                    });
                }

                setTimeout(() => {
                    window.location.reload();
                }, 1200);
            }
        } catch (err) {
            console.warn('[OTA Engine] Check skipped:', err);
        }
    }

    setTimeout(checkOTAPush, 2500);
    setInterval(checkOTAPush, 5 * 60 * 1000);

    window.addEventListener('focus', checkOTAPush);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) checkOTAPush();
    });
}

function initAutoUpdateChecker() {
        let currentLastModified = null;
        let currentContentLength = null;
        let isUpdating = false;

        async function fetchHeaders() {
            try {
                const response = await fetch('index.html?t=' + Date.now(), { method: 'HEAD' });
                if (response.status === 200) {
                    return {
                        lastModified: response.headers.get('Last-Modified'),
                        contentLength: response.headers.get('Content-Length')
                    };
                }
            } catch (e) {}
            return null;
        }

        fetchHeaders().then(headers => {
            if (headers) {
                currentLastModified = headers.lastModified;
                currentContentLength = headers.contentLength;
                console.log('[AutoUpdate] Initial specs loaded:', headers);
            }
        });

        setInterval(async () => {
            if (isUpdating) return;
            const headers = await fetchHeaders();
            if (!headers) return;

            let isModified = false;
            if (currentLastModified && headers.lastModified && currentLastModified !== headers.lastModified) {
                console.log('[AutoUpdate] Code modified on PC (Last-Modified changed).');
                isModified = true;
            } else if (currentContentLength && headers.contentLength && currentContentLength !== headers.contentLength) {
                console.log('[AutoUpdate] Code modified on PC (Content-Length changed).');
                isModified = true;
            }

            if (isModified) {
                isUpdating = true;
                if (typeof showToast === 'function') {
                    showToast('🔄 Code update saved on PC! Updating mobile app...');
                }
                
                if ('serviceWorker' in navigator && window.caches) {
                    try {
                        const keys = await caches.keys();
                        await Promise.all(keys.map(key => caches.delete(key)));
                    } catch (err) {
                        console.warn('[AutoUpdate] Cache deletion error:', err);
                    }
                }
                
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        }, 3000);
    }

function initMobileQROverlay() {
        // Only show developer QR badge if running on localhost / PC server
        if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

        fetch('ip.json')
            .then(res => res.json())
            .then(data => {
                if (!data || !data.ip) return;
                const ip = data.ip;
                // Login-based sync: no sync_key needed in URL — user logs in with their account
                const mobileUrl = `http://${ip}:8080/index.html`;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(mobileUrl)}`;

                // Create the floating button
                const btn = document.createElement('button');
                btn.id = 'mobile-qr-btn';
                btn.innerHTML = '📱 <span>Connect Mobile</span>';
                btn.setAttribute('style', 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; background: linear-gradient(135deg, #059669, #10b981); color: white; border: none; border-radius: 50px; padding: 12px 20px; font-weight: 600; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 14px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);');
                
                // Add hover style effect dynamically
                btn.onmouseover = () => {
                    btn.style.transform = 'translateY(-3px) scale(1.05)';
                    btn.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.5)';
                };
                btn.onmouseout = () => {
                    btn.style.transform = 'none';
                    btn.style.boxShadow = '0 4px 15px rgba(16, 185, 129, 0.4)';
                };

                // Create the modal overlay
                const modal = document.createElement('div');
                modal.id = 'mobile-qr-modal';
                modal.setAttribute('style', 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(8px); z-index: 10000; display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.3s ease;');
                
                const card = document.createElement('div');
                card.id = 'mobile-qr-card';
                
                // Style card depending on theme
                const isDark = document.documentElement.classList.contains('dark');
                const bgColor = isDark ? '#18181b' : '#ffffff';
                const textColor = isDark ? '#ffffff' : '#1f2937';
                
                card.setAttribute('style', `background: ${bgColor}; color: ${textColor}; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 30px; width: 90%; max-width: 400px; text-align: center; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3); transform: scale(0.9); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); font-family: system-ui, -apple-system, sans-serif;`);

                card.innerHTML = `
                    <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 18px; font-weight: 700;">🌾 Mobile Connection</h3>
                    <p style="margin-bottom: 20px; font-size: 13px; opacity: 0.8; line-height: 1.5;">Scan this QR code with your phone's camera to open the app on your mobile instantly!</p>
                    <div style="background: white; padding: 12px; border-radius: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin-bottom: 16px;">
                        <img src="${qrUrl}" alt="Mobile QR Code" style="display: block; width: 200px; height: 200px;" />
                    </div>
                    <div style="font-size: 12px; margin-bottom: 18px; word-break: break-all;">
                        <span style="opacity: 0.7;">Link: </span>
                        <a href="${mobileUrl}" target="_blank" style="color: #10b981; font-weight: 600; text-decoration: none;">${mobileUrl}</a>
                    </div>
                    <button id="close-qr-btn" style="background: #e4e4e7; border: none; border-radius: 50px; padding: 10px 24px; font-weight: 600; color: #3f3f46; cursor: pointer; font-size: 13px; transition: all 0.2s;">Close</button>
                `;

                // Adjust card color dynamically in case theme changes while open
                const observer = new MutationObserver(() => {
                    const currentDark = document.documentElement.classList.contains('dark');
                    card.style.background = currentDark ? '#18181b' : '#ffffff';
                    card.style.color = currentDark ? '#ffffff' : '#1f2937';
                    const closeBtn = card.querySelector('#close-qr-btn');
                    if (closeBtn) {
                        closeBtn.style.background = currentDark ? '#3f3f46' : '#e4e4e7';
                        closeBtn.style.color = currentDark ? '#e4e4e7' : '#3f3f46';
                    }
                });
                observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

                modal.appendChild(card);
                document.body.appendChild(btn);
                document.body.appendChild(modal);

                // Button Click Event: Open Modal
                btn.onclick = () => {
                    modal.style.opacity = '1';
                    modal.style.visibility = 'visible';
                    card.style.transform = 'scale(1)';
                };

                // Close Button Event: Close Modal
                const closeBtn = card.querySelector('#close-qr-btn');
                
                // Style close button initially
                closeBtn.style.background = isDark ? '#3f3f46' : '#e4e4e7';
                closeBtn.style.color = isDark ? '#e4e4e7' : '#3f3f46';
                
                closeBtn.onclick = () => {
                    modal.style.opacity = '0';
                    modal.style.visibility = 'hidden';
                    card.style.transform = 'scale(0.9)';
                };

                // Close Modal on clicking background
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        closeBtn.click();
                    }
                };
            })
            .catch(err => console.log('PC mode only. QR overlay inactive.', err));
    }

function initPWAInstallFlow() {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        if (isStandalone) return;

        const dismissedTime = localStorage.getItem('krishi_pwa_dismissed');
        if (dismissedTime && Date.now() - parseInt(dismissedTime) < 7 * 24 * 60 * 60 * 1000) {
            return;
        }

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.setAttribute('style', `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(180%);
            width: 90%; max-width: 420px; background: linear-gradient(135deg, #064e3b, #065f46);
            color: white; padding: 16px 20px; border-radius: 20px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2);
            z-index: 9998; display: flex; flex-direction: column; gap: 12px;
            font-family: system-ui, -apple-system, sans-serif;
            transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            border: 1px solid rgba(255, 255, 255, 0.1);
        `);

        banner.innerHTML = `
            <div class="pwa-banner-header" style="display: flex; align-items: center; gap: 12px;">
                <div class="pwa-banner-icon" style="font-size: 24px; background: rgba(255, 255, 255, 0.15); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border-radius: 12px;">📥</div>
                <div class="pwa-banner-text">
                    <h4 style="margin: 0; font-size: 14px; font-weight: 700;">🌾 Install Krishi MCQ Pro</h4>
                    <p id="pwa-banner-desc" style="margin: 2px 0 0 0; font-size: 11px; opacity: 0.85; line-height: 1.4;">Install as an app for offline study, faster loading, and quick home-screen access!</p>
                </div>
            </div>
            <div class="pwa-banner-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="pwa-btn-later" style="background: transparent; color: rgba(255, 255, 255, 0.7); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 50px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">Later</button>
                <button id="pwa-btn-install" style="background: #10b981; color: white; border: none; border-radius: 50px; padding: 6px 16px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;">Install</button>
            </div>
        `;

        document.body.appendChild(banner);

        let deferredPrompt = null;
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

        const laterBtn = banner.querySelector('#pwa-btn-later');
        const installBtn = banner.querySelector('#pwa-btn-install');
        const descText = banner.querySelector('#pwa-banner-desc');

        laterBtn.onclick = () => {
            banner.style.transform = 'translateX(-50%) translateY(180%)';
            localStorage.setItem('krishi_pwa_dismissed', Date.now());
        };

        if (isIOS) {
            descText.innerText = "To install: Tap the Share button 📤 in Safari and select 'Add to Home Screen'!";
            installBtn.innerText = "Got It";
            installBtn.onclick = () => {
                laterBtn.click();
            };
            
            setTimeout(() => {
                banner.style.transform = 'translateX(-50%) translateY(0)';
            }, 4000);
        } else {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredPrompt = e;
                
                setTimeout(() => {
                    banner.style.transform = 'translateX(-50%) translateY(0)';
                }, 3000);
            });

            installBtn.onclick = () => {
                if (!deferredPrompt) {
                    showToast('📱 Tap your browser menu (3 dots) and click "Install App" or "Add to Home Screen"!');
                    return;
                }
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('[PWA] User accepted install');
                    }
                    deferredPrompt = null;
                    laterBtn.click();
                });
            };
        }
    }

function newfeat_showNotification(message, type) {
        const container = document.getElementById('newfeat_toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `newfeat_toast newfeat_toast-${type || 'info'}`;
        
        const iconSymbol = type === 'success' ? '✅' : 'ℹ️';
        
        toast.innerHTML = `
            <span style="font-size: 16px; display: inline-flex; align-items: center; justify-content: center; shrink-to-fit: 0;">${iconSymbol}</span>
            <div style="flex: 1; line-height: 1.4; word-break: break-word; text-align: left;">${message}</div>
            <button onclick="this.parentElement.classList.remove('newfeat_show'); this.parentElement.classList.add('newfeat_hide'); setTimeout(() => { this.parentElement.remove(); }, 350);" style="background: none; border: none; font-size: 18px; cursor: pointer; opacity: 0.6; color: inherit; padding: 0 4px; line-height: 1; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">✕</button>
        `;

        container.appendChild(toast);

        // Force browser repaint
        toast.offsetHeight;

        // Slide element into view
        toast.classList.add('newfeat_show');

        // Dismiss sequence (4000ms delay)
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.remove('newfeat_show');
                toast.classList.add('newfeat_hide');
                
                toast.addEventListener('transitionend', () => {
                    toast.remove();
                }, { once: true });
            }
        }, 4000);
    }

/**
 * Pure, testable merge logic used by the incremental delta question sync.
 * Dedupe key: question id, falling back to question text when id is absent.
 */
class KrishiDeltaMerge {
    /**
     * Mutates and returns the target pool (same semantics as the original inline loop).
     * @param {Array} pool - existing questions array (mutated in place)
     * @param {Array} addedQuestions - incoming delta items
     * @returns {{pool: Array, inserted: Array}}
     */
    static mergeInto(pool, addedQuestions) {
        const target = Array.isArray(pool) ? pool : [];
        const seen = new Set(target.map(q => q && (q.id || q.q)));
        const inserted = [];
        const incoming = Array.isArray(addedQuestions) ? addedQuestions : [];
        incoming.forEach(newQ => {
            const key = newQ && (newQ.id || newQ.q);
            if (!seen.has(key)) {
                target.push(newQ);
                inserted.push(newQ);
                seen.add(key);
            }
        });
        return { pool: target, inserted };
    }
}

async function checkAndSyncDeltaQuestions() {
    try {
        const deltaUrl = './delta_questions.json?t=' + Date.now();
        const res = await fetch(deltaUrl, { cache: 'no-store' });
        if (!res.ok) return;

        const data = await res.json();
        if (!data || !data.added_questions || !Array.isArray(data.added_questions) || data.added_questions.length === 0) return;

        const lastSyncedTime = parseInt(localStorage.getItem('krishi_last_delta_sync_time') || '0', 10);
        if (data.timestamp && data.timestamp <= lastSyncedTime) {
            console.log('[DeltaSync] No new delta questions available. Current timestamp:', lastSyncedTime);
            return;
        }

        if (typeof showUpdateProgressHUD === 'function') {
            showUpdateProgressHUD(`⚡ पृष्ठभूमिमा ${data.added_questions.length} वटा नयाँ कृषि प्रश्नहरू सिङ्क हुँदैछन्...`, 'syncing', 0);
        }

        if (typeof window.getAllQuestions === 'function') {
            window.allQuestions = window.getAllQuestions();
        } else if (!Array.isArray(window.allQuestions)) {
            window.allQuestions = [];
        }

        const mergeResult = KrishiDeltaMerge.mergeInto(window.allQuestions, data.added_questions);
        window.allQuestions = mergeResult.pool;
        const newItemsToInsert = mergeResult.inserted;

        if (data.timestamp) {
            localStorage.setItem('krishi_last_delta_sync_time', String(data.timestamp));
        }

        if (newItemsToInsert.length > 0) {
            console.log(`[DeltaSync] Successfully merged ${newItemsToInsert.length} new questions into active memory.`);

            // Priority Tier 1: Immediate High-Speed Text Persistence into SQLite / LocalStorage
            if (window.KrishiPreCachePriorityManager) {
                await window.KrishiPreCachePriorityManager.processHighPriorityTextSync(newItemsToInsert);
            } else if (window.KrishiSQLite && typeof window.KrishiSQLite.saveQuestions === 'function') {
                try { await window.KrishiSQLite.saveQuestions(newItemsToInsert); } catch(e) { window.krishiLogSilent && krishiLogSilent('delta.sqlite_save', e); }
            }

            // Priority Tier 2: Defer Non-Essential Media & Diagram Pre-Caching to Network Idle
            const deferredMediaUrls = [];
            newItemsToInsert.forEach(q => {
                if (q.image || q.img) deferredMediaUrls.push(q.image || q.img);
                if (q.diagram) deferredMediaUrls.push(q.diagram);
            });
            if (deferredMediaUrls.length > 0 && window.KrishiPreCachePriorityManager) {
                window.KrishiPreCachePriorityManager.scheduleDeferredMediaCache(deferredMediaUrls);
            }

            const successMsg = `✅ ${newItemsToInsert.length} वटा नयाँ प्रश्नहरू स्वतः जोडिए! (जम्मा: ${window.allQuestions.length})`;

            if (typeof showUpdateProgressHUD === 'function') {
                showUpdateProgressHUD(successMsg, 'success', 4000);
            } else if (typeof showToast === 'function') {
                showToast(successMsg, 4500);
            }

            window.dispatchEvent(new CustomEvent('krishi-delta-questions-synced', {
                detail: { addedCount: newItemsToInsert.length, totalCount: window.allQuestions.length }
            }));
        }
    } catch(err) {
        console.warn('[DeltaSync] Sync bypass:', err);
    }
}

let _hudDismissTimer = null;

function showUpdateProgressHUD(message, type = 'syncing', duration = 3500) {
    let hud = document.getElementById('krishi-update-progress-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'krishi-update-progress-hud';
        hud.setAttribute('style', `
            position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(180%);
            z-index: 99999; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            background: rgba(15, 23, 42, 0.88); color: #ffffff; padding: 10px 20px;
            border-radius: 50px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(16, 185, 129, 0.4); display: flex; align-items: center; gap: 10px;
            font-size: 12px; font-weight: 600; font-family: system-ui, -apple-system, sans-serif;
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
            pointer-events: auto; max-width: 90vw; text-align: center;
        `);
        document.body.appendChild(hud);
    }

    if (_hudDismissTimer) {
        clearTimeout(_hudDismissTimer);
        _hudDismissTimer = null;
    }

    let iconHtml = '⚡';
    if (type === 'syncing') {
        iconHtml = '<span class="w-2 h-2 rounded-full bg-emerald-400 inline-block mr-1 animate-pulse"></span>⚡';
        hud.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    } else if (type === 'success') {
        iconHtml = '✅';
        hud.style.borderColor = 'rgba(16, 185, 129, 0.8)';
    } else if (type === 'error') {
        iconHtml = '⚠️';
        hud.style.borderColor = 'rgba(239, 68, 68, 0.6)';
    }

    hud.innerHTML = `<span style="font-size:14px; display:inline-flex; align-items:center;">${iconHtml}</span><span>${message}</span>`;

    hud.style.opacity = '1';
    hud.style.transform = 'translateX(-50%) translateY(0)';

    if (duration > 0) {
        _hudDismissTimer = setTimeout(() => {
            hud.style.transform = 'translateX(-50%) translateY(180%)';
            hud.style.opacity = '0';
        }, duration);
    }
}

class KrishiPreCachePriorityManager {
    static getNetworkQuality() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) return 'fast';
        if (conn.saveData) return 'slow';
        const type = conn.effectiveType || '';
        if (type === '2g' || type === 'slow-2g' || type === '3g') return 'slow';
        return 'fast';
    }

    static async processHighPriorityTextSync(questions) {
        if (!Array.isArray(questions) || questions.length === 0) return 0;

        let count = 0;
        if (window.KrishiSQLite && typeof window.KrishiSQLite.saveQuestions === 'function') {
            try {
                await window.KrishiSQLite.saveQuestions(questions);
                count = questions.length;
                console.log(`[PriorityManager] Tier 1 High-Priority Text: Saved ${count} questions to SQLite.`);
            } catch(e) {
                console.warn('[PriorityManager] SQLite save bypass:', e);
            }
        }
        return count;
    }

    static scheduleDeferredMediaCache(mediaUrls) {
        if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return;

        const scheduleTask = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));

        scheduleTask(() => {
            mediaUrls.forEach(url => {
                if (!url) return;
                fetch(url, { mode: 'no-cors', priority: 'low' }).catch(() => {});
            });
            console.log(`[PriorityManager] Tier 2 Deferred Media: ${mediaUrls.length} assets background fetched.`);
        });
    }
}

window.KrishiPreCachePriorityManager = KrishiPreCachePriorityManager;

class KrishiSM2Engine {
    static STORAGE_KEY = 'krishi_sm2';
    static DAILY_LOG_KEY = 'krishi_sm2_daily_log';

    // KrishiStorage.init() copies every krishi_* key out of native localStorage into its own
    // IndexedDB store and then DELETES the localStorage copy (krishi_idb.js:88-96). This
    // engine read and wrote localStorage directly, so on every boot after an answer its
    // entire store disappeared from where it looks. Verified live: KrishiStorage held 2
    // scheduling records while _getData() returned 0.
    //
    // The consequences were not limited to sync. getDueQuestions()/getStats() saw an empty
    // schedule, recordAnswer() rebuilt each record from reviews:0 (losing difficulty,
    // stability and lapses), and collectAllAppData() pushed `sm2: {}` up. Nothing was
    // destroyed in the cloud — the merge unions by question id — but the spacing only ever
    // came back because applyAllAppData() writes the cloud copy back down, so a signed-out
    // or offline student lost their review schedule on every single launch.
    //
    // One store from here on. localStorage stays as a fallback for the window before
    // KrishiStorage has loaded, and _getData() folds any leftover localStorage blob in
    // rather than picking one copy over the other.
    static _store() {
        return window.KrishiStorage || localStorage;
    }

    static _getData() {
        let data = {};
        let dataMigrated = false;
        try {
            const raw = this._store().getItem(this.STORAGE_KEY);
            data = raw ? JSON.parse(raw) : {};

            // A blob may still be sitting in native localStorage: written by this engine
            // before the update, or written this session before KrishiStorage came up.
            // UNION the two per record instead of choosing a side — the KrishiStorage copy
            // is the older pre-boot snapshot and the localStorage one is whatever was
            // answered after init deleted it, so either alone drops real reviews. Newest
            // lastAnswered wins, the same rule the cloud merge uses.
            const strays = this._drainStrayLocalStorage(this.STORAGE_KEY);
            if (strays) {
                Object.entries(strays).forEach(([id, rec]) => {
                    if (!rec) return;
                    const held = data[id];
                    if (!held || (rec.lastAnswered || 0) > (held.lastAnswered || 0)) {
                        data[id] = rec;
                    }
                });
                dataMigrated = true;
            }

            Object.values(data).forEach(item => {
                if (item.nextReviewDate && !item.nextReview) {
                    item.nextReview = new Date(item.nextReviewDate).getTime();
                    dataMigrated = true;
                }
                if (item.repetitions !== undefined && item.reviews === undefined) {
                    item.reviews = item.repetitions;
                    dataMigrated = true;
                }
            });
        if (dataMigrated) this._saveData(data);
    } catch(e) { window.krishiLogSilent && krishiLogSilent('sm2.migrate', e); }

        // Backward compatibility migration from legacy krishi_review
        try {
            let legacyRaw = this._store().getItem('krishi_review');
            if (legacyRaw) {
                let legacyData = JSON.parse(legacyRaw);
                if (legacyData && typeof legacyData === 'object' && !Array.isArray(legacyData)) {
                    let migrated = false;
                    Object.entries(legacyData).forEach(([qid, date]) => {
                        let id = String(qid);
                        if (!data[id]) {
                            data[id] = { 
                                reviews: 0, interval: 1, easeFactor: 2.5, lapses: 0, status: 'due',
                                difficulty: 5, stability: 0.5, retrievability: 0,
                                nextReview: new Date(date).getTime()
                            };
                            migrated = true;
                        } else if (!data[id].nextReview) {
                            data[id].nextReview = new Date(date).getTime();
                            migrated = true;
                        }
                    });
                    if (migrated) {
                        this._saveData(data);
                    }
                }
                this._store().removeItem('krishi_review');
                if (window.KrishiStorage) { try { localStorage.removeItem('krishi_review'); } catch(e){} }
            }
        } catch(e) {
            this._store().removeItem('krishi_review');
        }
        return data;
    }

    /**
     * Reads and clears a stray native-localStorage copy of a key this engine owns.
     * Returns the parsed object, or null when there was nothing there.
     *
     * Only ever called when KrishiStorage is present: without it localStorage IS the store
     * and draining it would delete the live data.
     */
    static _drainStrayLocalStorage(key) {
        if (!window.KrishiStorage) return null;
        let parsed = null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = null;
        } catch(e) { parsed = null; }
        // Removed either way: an unparseable blob is not recoverable and leaving it behind
        // means re-reading the same garbage on every _getData() call.
        try { localStorage.removeItem(key); } catch(e) {}
        return parsed;
    }

    static _saveData(data) {
        try {
            this._store().setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch(e) { window.krishiLogSilent && krishiLogSilent('sm2.save', e); }
    }

    // opts.maxGrade caps how much credit an answer can earn. A self-rated flashcard swipe is
    // weaker evidence than a graded answer - the student said "I know this" without ever picking
    // an option - so the swiper passes maxGrade:2 and a 2-second swipe can no longer buy the full
    // Easy grade (stability 5.8 => a 6 day first interval) that a real answer earns.
    static recordAnswer(questionId, isCorrect, timeSpentSec = 10, opts = null) {
        if (!questionId) return;
        const data = this._getData();
        const now = Date.now();
        const existing = data[questionId] || { reviews: 0, interval: 0, easeFactor: 2.5, lapses: 0, status: 'new' };

        // --- FSRS Migration ---
        if (typeof existing.difficulty === 'undefined') {
            let d = 11 - ((existing.easeFactor || 2.5) - 1.3) * 5.29;
            existing.difficulty = Math.max(1, Math.min(10, Math.round(d * 10) / 10));
        }
        if (typeof existing.stability === 'undefined') {
            existing.stability = existing.interval || (existing.reviews > 0 ? 1 : 0.5);
        }
        if (typeof existing.lapses === 'undefined') existing.lapses = 0;

        let grade = 0; // 0=Fail, 1=Hard, 2=Good, 3=Easy
        let feedback = "";
        let status = 'scheduled';
        let suspendUntil = null;

        if (!isCorrect) {
            grade = 0;
            existing.lapses += 1;
            if (existing.lapses >= 4) {
                status = 'suspended';
                suspendUntil = now + (3 * 24 * 3600 * 1000); // 3 days penalty
                feedback = "❌ Leech (Suspended)";
            } else {
                status = 'due';
                feedback = "❌ Hard (Fail)";
            }
        } else {
            existing.lapses = 0;
            if (timeSpentSec <= 5) { grade = 3; feedback = "🚀 Easy"; }
            else if (timeSpentSec <= 15) { grade = 2; feedback = "✅ Good"; }
            else { grade = 1; feedback = "⏳ Hard"; }
        }

        // A wrong answer is already grade 0, so this only ever trims a passing grade.
        let capGrade = (opts && typeof opts.maxGrade === 'number') ? opts.maxGrade : null;
        if (capGrade !== null && grade > capGrade) {
            grade = Math.max(0, capGrade);
            feedback = (grade === 3) ? "🚀 Easy" : (grade === 2) ? "✅ Good" : (grade === 1) ? "⏳ Hard" : feedback;
        }

        // --- FSRS DSR Math ---
        let elapsedDays = existing.lastAnswered ? (now - existing.lastAnswered) / (24 * 3600 * 1000) : 0;
        elapsedDays = Math.max(0, elapsedDays);
        let R = Math.pow(0.9, elapsedDays / Math.max(0.1, existing.stability));

        // Difficulty Update
        let D = existing.difficulty - (grade - 2); // Easy (-1), Good (0), Hard (+1), Fail (+2)
        D = Math.max(1, Math.min(10, D));

        // Stability Update
        let S = existing.stability;
        if (existing.reviews === 0) {
            // FIX: Initialize stability for new questions. 
            // Previously, R=1 caused the multiplier to be exactly 1, freezing S at 0.5 (Interval 1 day) for all passing grades.
            if (grade === 0) S = 0.4;
            else if (grade === 1) S = 0.6;
            else if (grade === 2) S = 2.4;
            else if (grade === 3) S = 5.8;
        } else if (grade === 0) {
            S = Math.max(0.1, S * 0.2); // Fail drops stability
        } else {
            let factor = (grade === 3) ? 1.5 : (grade === 2) ? 1.0 : 0.5;
            let multiplier = Math.max(1, 1 + factor * (11 - D) * (1 - R));
            S = Math.max(1, S * multiplier); 
        }

        let nextInterval = Math.max(1, Math.round(S));
        let reviews = existing.reviews + 1;

        if (nextInterval >= 21 && reviews >= 4 && status === 'scheduled') {
            status = 'mastered';
            feedback = "🎓 Mastered!";
        }

        data[questionId] = {
            reviews: reviews,
            interval: nextInterval, // Legacy support
            difficulty: parseFloat(D.toFixed(2)),
            stability: parseFloat(S.toFixed(2)),
            retrievability: parseFloat(R.toFixed(3)),
            easeFactor: existing.easeFactor,
            lapses: existing.lapses,
            lastAnswered: now,
            nextReview: status === 'suspended' ? suspendUntil : now + (nextInterval * 24 * 3600 * 1000),
            status: status === 'suspended' ? 'suspended' : (reviews >= 4 && nextInterval >= 21 ? 'mastered' : status)
        };

        this._saveData(data);
        this.updateHUDStats();
        if (typeof this.recordDailyReview === 'function') {
            this.recordDailyReview(isCorrect);
        }

        console.log(`[FSRS] Q:${questionId} D:${D.toFixed(1)} S:${S.toFixed(1)} R:${(R*100).toFixed(1)}% Int:${nextInterval}d Grade:${feedback}`);
        return feedback;
    }

    static getDueQuestions(allQuestions) {
        if (!Array.isArray(allQuestions) || allQuestions.length === 0) return [];
        const data = this._getData();
        const qIdSet = new Set(allQuestions.map(q => String(q.id || q.q)));
        let cleaned = false;
        Object.keys(data).forEach(id => {
            if (!qIdSet.has(String(id))) {
                delete data[id];
                cleaned = true;
            }
        });
        if (cleaned) this._saveData(data);

        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const now = todayEnd.getTime();

        const mistakeSet = (typeof window.getMistakeIdSet === 'function') ? window.getMistakeIdSet() : null;
        return allQuestions.filter(q => {
            const qId = q.id || q.q;
            const rec = data[qId];
            if (!rec) return false;
            if (rec.status === 'mastered' || rec.status === 'suspended') return false;
            // Unresolved mistakes surface in Review Mistakes only, never Spaced Review.
            if (mistakeSet && mistakeSet.has(String(qId))) return false;
            // Due strictly by schedule — a just-failed question (nextReview = tomorrow)
            // is no longer force-shown today via a sticky status==='due' flag.
            return rec.nextReview && rec.nextReview <= now;
        });
    }

    // The mirror of getDueQuestions: cards that have never been graded at all. getDueQuestions
    // drops exactly these (`if (!rec) return false`), so before this existed a freshly imported
    // bank was invisible to the scheduler - it could only enter the rotation by luck, when a
    // random quiz happened to serve it. This is the first-exposure queue the swiper draws from.
    static getNewQuestions(allQuestions) {
        if (!Array.isArray(allQuestions) || allQuestions.length === 0) return [];
        const data = this._getData();
        return allQuestions.filter(q => q && !data[q.id || q.q]);
    }

    static getStats() {
        const data = this._getData();
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const now = todayEnd.getTime();
        let dueCount = 0;
        let masteredCount = 0;
        let leechedCount = 0;
        let totalTracked = Object.keys(data).length;
        const mistakeSet = (typeof window.getMistakeIdSet === 'function') ? window.getMistakeIdSet() : null;

        Object.entries(data).forEach(([id, rec]) => {
            if (rec.status === 'mastered') { masteredCount++; return; }
            if (rec.status === 'suspended') { leechedCount++; return; }
            // Keep the due count in lockstep with getDueQuestions: exclude
            // unresolved mistakes and count strictly by schedule (nextReview).
            if (mistakeSet && mistakeSet.has(String(id))) return;
            if (rec.nextReview && rec.nextReview <= now) dueCount++;
        });

        return { dueCount, masteredCount, leechedCount, totalTracked };
    }

    static updateHUDStats() {
        const stats = this.getStats();
        const badgeEl = document.getElementById('sm2-due-badge-count');
        const masteredEl = document.getElementById('sm2-mastered-badge-count');
        if (badgeEl) badgeEl.textContent = stats.dueCount;
        if (masteredEl) masteredEl.textContent = stats.masteredCount;
    }

    static recordDailyReview(isCorrect = null) {
        let log = {};
        try {
        log = JSON.parse(this._store().getItem(this.DAILY_LOG_KEY) || '{}');
        // Same store split as the schedule itself: this log lived in localStorage, which
        // KrishiStorage.init() empties, so getRetentionRate() read 0% after every boot.
        const strays = this._drainStrayLocalStorage(this.DAILY_LOG_KEY);
        if (strays) {
            Object.entries(strays).forEach(([day, rec]) => {
                if (!rec) return;
                const held = log[day];
                // Per-day counters, so the larger tally is the more complete one rather
                // than one side overwriting the other.
                if (!held || (rec.total || 0) > (held.total || 0)) log[day] = rec;
            });
        }
    } catch(e) { window.krishiLogSilent && krishiLogSilent('sm2.daily_read', e); }

        const dateStr = new Date().toISOString().split('T')[0];
        if (!log[dateStr]) log[dateStr] = { total: 0, correct: 0 };

        // If we are just recording a review attempt
        if (isCorrect !== null) {
            log[dateStr].total += 1;
            if (isCorrect) log[dateStr].correct += 1;
        }

        try {
            this._store().setItem(this.DAILY_LOG_KEY, JSON.stringify(log));
        } catch(e) { window.krishiLogSilent && krishiLogSilent('sm2.daily_write', e); }
    }

    static getRetentionRate() {
        try {
            let log = JSON.parse(this._store().getItem(this.DAILY_LOG_KEY) || '{}');
            const dateStr = new Date().toISOString().split('T')[0];
            let today = log[dateStr];
            if (!today || today.total === 0) return 0;
            return Math.round((today.correct / today.total) * 100);
        } catch(e) {
            return 0;
        }
    }
}

window.KrishiSM2Engine = KrishiSM2Engine;
window.KrishiDeltaMerge = KrishiDeltaMerge;

function generatePairingPin() {
    if (typeof window.generatePairingPin === 'function' && window.generatePairingPin !== generatePairingPin) {
        return window.generatePairingPin();
    }
}

function pairWithPin(pinInput) {
    if (typeof window.pairWithPin === 'function' && window.pairWithPin !== pairWithPin) {
        return window.pairWithPin(pinInput);
    }
}

window.showUpdateProgressHUD = showUpdateProgressHUD;
window.checkAndSyncDeltaQuestions = checkAndSyncDeltaQuestions;