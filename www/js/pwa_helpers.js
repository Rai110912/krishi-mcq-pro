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
                const syncKey = localStorage.getItem('krishi_sync_key');
                const mobileUrl = syncKey ? `http://${ip}:8080/index.html?sync_key=${syncKey}` : `http://${ip}:8080/index.html`;
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