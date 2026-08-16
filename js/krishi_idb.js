// krishi_idb.js
// High-Performance Virtual Storage Engine with Web Worker + IndexedDB Backend

const KrishiStorage = (() => {
    let worker = null;
    const cache = new Map();
    let isInitialized = false;
    
    // Tracking modifications during async init gap to prevent race conditions
    const touchedKeys = new Set();
    let isCleared = false;

    // Helper to generate unique message IDs
    let messageId = 0;
    const pendingResolves = new Map();

    function startWorker() {
        if (!window.Worker) {
            console.warn('[KrishiStorage] Web Workers not supported!');
            return;
        }
        try {
            worker = new Worker('./js/krishi_worker.js?v=58');
            worker.onmessage = (e) => {
                const { id, status, data, error } = e.data;
                if (id && pendingResolves.has(id)) {
                    if (status === 'success') {
                        pendingResolves.get(id).resolve(data);
                    } else {
                        pendingResolves.get(id).reject(new Error(error));
                    }
                    pendingResolves.delete(id);
                }
            };
            worker.onerror = (e) => {
                console.error('[KrishiStorage] Worker load/execution error', e);
                // Reject all pending promises to prevent hanging
                for (const [id, promise] of pendingResolves.entries()) {
                    promise.reject(new Error('Worker failed'));
                }
                pendingResolves.clear();
            };
        } catch (e) {
            console.error('[KrishiStorage] Failed to start worker', e);
        }
    }

    function sendToWorker(type, payload = {}) {
        if (!worker) return Promise.reject(new Error('No worker'));
        return new Promise((resolve, reject) => {
            const id = ++messageId;
            pendingResolves.set(id, { resolve, reject });
            worker.postMessage({ id, type, ...payload });
            
            // Critical: Timeout to prevent indefinite hanging if worker stalls
            setTimeout(() => {
                if (pendingResolves.has(id)) {
                    pendingResolves.get(id).reject(new Error('Worker timeout'));
                    pendingResolves.delete(id);
                }
            }, 3000); // 3-second timeout for init/IDB operations
        });
    }

    async function init() {
        if (isInitialized) return;
        startWorker();
        
        console.log('[KrishiStorage] Booting High-Performance Virtual Storage...');
        
        try {
            // Load all data from IndexedDB into memory cache
            const data = await sendToWorker('init') || {};
            
            // Check for Migration from LocalStorage (or Fallback Recovery)
            let needsMigration = false;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('krishi_')) {
                    needsMigration = true;
                    const val = localStorage.getItem(key);
                    if (!touchedKeys.has(key) && !isCleared) cache.set(key, val); // LocalStorage ALWAYS has the newest data if it exists
                    // Send to worker to save in IDB
                    worker.postMessage({ type: 'set', key, value: val });
                }
            }
            
            if (needsMigration) {
                console.log('[KrishiStorage] Migration/Recovery complete. Cleared native localStorage.');
                // Clear old localStorage to free up 5MB limit
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    if (localStorage.key(i).startsWith('krishi_')) keysToRemove.push(localStorage.key(i));
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            }

            // Populate cache with existing IDB data
            if (!isCleared) {
                Object.entries(data).forEach(([k, v]) => {
                    if (!touchedKeys.has(k) && !cache.has(k)) {
                        cache.set(k, v);
                    }
                });
            }

            isInitialized = true;
            console.log('[KrishiStorage] Virtual Engine Online. Cached items:', cache.size);
        } catch (e) {
            console.warn('[KrishiStorage] IndexedDB blocked (Incognito mode?). Falling back to in-memory + localStorage.', e);
            try {
                // Fallback: Populate cache directly from native localStorage
                if (!isCleared) {
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key.startsWith('krishi_') && !touchedKeys.has(key)) {
                            cache.set(key, localStorage.getItem(key));
                        }
                    }
                }
            } catch(e) {
                console.warn('[KrishiStorage] Native localStorage is also totally blocked.');
            }
            isInitialized = true;
            
            // Disable worker so setItem/removeItem falls back to localStorage directly
            worker = null;
        }
    }

    return {
        init,
        getItem(key) {
            // Act exactly like localStorage (synchronous)
            return cache.has(key) ? cache.get(key) : null;
        },
        setItem(key, value) {
            if (!isInitialized) touchedKeys.add(key);
            const valStr = String(value);
            cache.set(key, valStr);
            if (worker) {
                worker.postMessage({ type: 'set', key, value: valStr });
            } else {
                try { localStorage.setItem(key, valStr); } catch(e){} // Fallback
            }
        },
        removeItem(key) {
            if (!isInitialized) touchedKeys.add(key);
            cache.delete(key);
            if (worker) {
                worker.postMessage({ type: 'remove', key });
            } else {
                try { localStorage.removeItem(key); } catch(e){} // Fallback
            }
        },
        clear() {
            if (!isInitialized) isCleared = true;
            cache.clear();
            if (worker) {
                worker.postMessage({ type: 'clear' });
            } else {
                try { localStorage.clear(); } catch(e){} // Fallback
            }
        }
    };
})();

window.KrishiStorage = KrishiStorage;
