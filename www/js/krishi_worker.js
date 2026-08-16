// krishi_worker.js
// Dedicated Web Worker for Non-Blocking IndexedDB Storage

const DB_NAME = 'KrishiAppDB';
const DB_VERSION = 1;
const STORE_NAME = 'krishi_keyvalue';

let db = null;
let initPromise = null;

function initDB() {
    if (db) return Promise.resolve(db);
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                db = event.target.result;
                initPromise = null;
                resolve(db);
            };

            request.onerror = (event) => {
                initPromise = null;
                reject(event.target.error);
            };
        } catch (e) {
            initPromise = null;
            reject(e);
        }
    });
    return initPromise;
}

async function getAllData() {
    await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const result = {};
            request.result.forEach(item => {
                result[item.key] = item.value;
            });
            resolve(result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function setItem(key, value) {
    await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function removeItem(key) {
    await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function clearAll() {
    await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Listen to main thread messages
self.addEventListener('message', async (event) => {
    const { id, type, key, value } = event.data;

    try {
        switch (type) {
            case 'init':
                const data = await getAllData();
                self.postMessage({ id, status: 'success', data });
                break;
            case 'set':
                await setItem(key, value);
                break;
            case 'remove':
                await removeItem(key);
                break;
            case 'clear':
                await clearAll();
                self.postMessage({ id, status: 'success' });
                break;
            default:
                throw new Error('Unknown action type: ' + type);
        }
    } catch (error) {
        console.error('[IDB Worker Error]', error);
        if (id) {
            self.postMessage({ id, status: 'error', error: error.message });
        }
    }
});
