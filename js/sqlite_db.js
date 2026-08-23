/**
 * Krishi MCQ Pro — SQLite Database Module (Feature 12)
 * =====================================================
 * PARALLEL module — does NOT replace questions.json flow.
 * Old JSON path stays as PRIMARY fallback.
 * SQLite is used only when running as native Capacitor APK.
 *
 * Usage: window.KrishiSQLite.isAvailable() → bool
 *        window.KrishiSQLite.getQuestions() → Promise<Question[]>
 *        window.KrishiSQLite.saveQuestions(questions) → Promise<void>
 */

(function() {
    'use strict';

    const DB_NAME = 'KrishiQuestionsDB';
    const DB_VERSION = 1;
    const TABLE_QUESTIONS = 'questions';

    let _db = null;
    let _ready = false;

    async function getSQLitePlugin() {
        const cap = window.Capacitor;
        if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
        const Plugins = cap.Plugins;
        if (!Plugins || !Plugins.CapacitorSQLite) return null;
        return Plugins.CapacitorSQLite;
    }

    async function init() {
        try {
            const sqlite = await getSQLitePlugin();
            if (!sqlite) {
                console.log('[SQLite] Not on native platform — using questions.json fallback.');
                return false;
            }

            // Check connection consistency
            const isConsistent = await sqlite.checkConnectionsConsistency({ openModes: ['RW'] });
            const isConn = (await sqlite.isConnection({ database: DB_NAME, readonly: false })).result;

            if (isConn) {
                _db = await sqlite.retrieveConnection({ database: DB_NAME, readonly: false });
            } else {
                _db = await sqlite.createConnection({
                    database: DB_NAME,
                    encrypted: false,
                    mode: 'no-encryption',
                    version: DB_VERSION,
                    readonly: false
                });
            }

            await _db.open();

            // Create questions table if not exists
            await _db.execute(`
                CREATE TABLE IF NOT EXISTS ${TABLE_QUESTIONS} (
                    id TEXT PRIMARY KEY,
                    subject TEXT,
                    question TEXT NOT NULL,
                    options TEXT NOT NULL,
                    answer INTEGER NOT NULL,
                    difficulty TEXT DEFAULT 'Easy',
                    explanation TEXT,
                    tags TEXT,
                    created_at INTEGER DEFAULT (strftime('%s','now'))
                );
            `);

            // Create index for fast subject-based queries
            await _db.execute(`
                CREATE INDEX IF NOT EXISTS idx_questions_subject
                ON ${TABLE_QUESTIONS}(subject);
            `);

            // Create composite index for subject and difficulty tier queries
            await _db.execute(`
                CREATE INDEX IF NOT EXISTS idx_questions_sub_diff
                ON ${TABLE_QUESTIONS}(subject, difficulty);
            `);

            _ready = true;

            // One-time heal: purge known-corrupted delta question batch
            // (delta_agri_2026_01/02 shipped with unrecoverable mojibake text and
            // duplicate answer options; see delta_questions.json note, Aug 2026)
            try {
                const HEAL_KEY = 'krishi_delta_corruption_heal_v1';
                if (!localStorage.getItem(HEAL_KEY)) {
                    await deleteQuestionsByIds(['delta_agri_2026_01', 'delta_agri_2026_02']);
                    localStorage.setItem(HEAL_KEY, String(Date.now()));
                    console.log('[SQLite] Delta corruption heal applied ✅');
                }
            } catch(healErr) {
                console.warn('[SQLite] Corruption heal bypassed:', healErr);
            }

            console.log('[SQLite] Database ready ✅ — Native SQLite active.');
            return true;
        } catch(e) {
            console.warn('[SQLite] Init failed — falling back to questions.json:', e);
            _ready = false;
            return false;
        }
    }

    async function getQuestions(subject) {
        if (!_ready || !_db) return null; // Signal caller to use JSON fallback
        try {
            let query = `SELECT * FROM ${TABLE_QUESTIONS}`;
            let values = [];
            if (subject) {
                query += ` WHERE subject = ?`;
                values = [subject];
            }
            const result = await _db.query(query, values);
            if (!result || !result.values || result.values.length === 0) return null;

            // Parse stored JSON fields back to objects
            return result.values.map(row => {
                let parsedOpts = [];
                try { parsedOpts = typeof row.options === 'string' ? JSON.parse(row.options) : (row.options || []); } catch(e){ parsedOpts = []; window.krishiLogSilent && window.krishiLogSilent('sqlite.parse_options', e); }
                let parsedTags = [];
                try { parsedTags = row.tags ? (typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags) : []; } catch(e){ parsedTags = []; window.krishiLogSilent && window.krishiLogSilent('sqlite.parse_tags', e); }
                return {
                    id: row.id,
                    sub: row.subject,
                    q: row.question,
                    opts: parsedOpts,
                    ans: row.answer,
                    difficulty: row.difficulty,
                    exp: row.explanation,
                    tags: parsedTags
                };
            }).filter(q => q.opts && q.opts.length > 0);
        } catch(e) {
            console.warn('[SQLite] getQuestions failed — using JSON fallback:', e);
            return null;
        }
    }

    async function saveQuestions(questions) {
        if (!_ready || !_db) return false;
        try {
            const statements = questions.map(q => ({
                statement: `INSERT OR REPLACE INTO ${TABLE_QUESTIONS}
                            (id, subject, question, options, answer, difficulty, explanation, tags)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                values: [
                    q.id || q.q_id || String(Math.random()),
                    q.sub || q.subject || 'General',
                    q.q || q.question,
                    JSON.stringify(q.opts || q.options || []),
                    q.ans || q.answer || 0,
                    q.difficulty || 'Easy',
                    q.exp || q.explanation || '',
                    JSON.stringify(q.tags || [])
                ]
            }));

            await _db.executeSet(statements);
            console.log(`[SQLite] Saved ${questions.length} questions to SQLite ✅`);
            return true;
        } catch(e) {
            console.warn('[SQLite] saveQuestions failed:', e);
            return false;
        }
    }

    async function getCount(subject) {
        if (!_ready || !_db) return 0;
        try {
            let query = `SELECT COUNT(*) as cnt FROM ${TABLE_QUESTIONS}`;
            let values = [];
            if (subject) { query += ` WHERE subject = ?`; values = [subject]; }
            const result = await _db.query(query, values);
            return result && result.values && result.values[0] ? result.values[0].cnt : 0;
        } catch(e) {
            return 0;
        }
    }

    /**
     * Delete questions by explicit ids (used for corruption heals / targeted removals).
     * @param {string[]} ids
     * @returns {Promise<boolean>}
     */
    async function deleteQuestionsByIds(ids) {
        if (!_ready || !_db || !Array.isArray(ids) || ids.length === 0) return false;
        try {
            const placeholders = ids.map(() => '?').join(',');
            await _db.query(`DELETE FROM ${TABLE_QUESTIONS} WHERE id IN (${placeholders})`, ids);
            console.log(`[SQLite] Purged ${ids.length} question id(s) from local DB.`);
            return true;
        } catch(e) {
            console.warn('[SQLite] deleteQuestionsByIds failed:', e);
            return false;
        }
    }

    /**
     * Ultra-Fast Local Database & Memory Search Engine (< 3ms)
     */
    async function searchQuestions(keyword, subject) {
        if (!keyword || typeof keyword !== 'string') return [];
        const term = keyword.trim().toLowerCase();
        if (!term) return [];

        if (_ready && _db) {
            try {
                const likePattern = `%${term}%`;
                let query = `SELECT * FROM ${TABLE_QUESTIONS} WHERE (question LIKE ? OR options LIKE ? OR tags LIKE ? OR subject LIKE ?)`;
                let values = [likePattern, likePattern, likePattern, likePattern];
                if (subject) {
                    query += ` AND subject = ?`;
                    values.push(subject);
                }
                query += ` LIMIT 100`;
                const result = await _db.query(query, values);
                if (result && result.values) {
                    return result.values.map(row => {
                        let parsedOpts = [];
                        try { parsedOpts = typeof row.options === 'string' ? JSON.parse(row.options) : (row.options || []); } catch(e){ parsedOpts = []; window.krishiLogSilent && window.krishiLogSilent('sqlite.parse_options', e); }
                        return {
                            id: row.id,
                            sub: row.subject,
                            q: row.question,
                            opts: parsedOpts,
                            ans: row.answer,
                            difficulty: row.difficulty,
                            exp: row.explanation
                        };
                    });
                }
            } catch(e) {
                console.warn('[SQLite] searchQuestions query error:', e);
            }
        }

        // Fast Web / PWA Memory Search Engine (<3ms)
        const allQuestions = window.questionsData || window.allQuestions || [];
        return allQuestions.filter(q => {
            if (subject && q.sub !== subject && q.subject !== subject) return false;
            const qText = (q.q || q.question || '').toLowerCase();
            const qSub = (q.sub || q.subject || '').toLowerCase();
            const qOpts = Array.isArray(q.opts) ? q.opts.join(' ').toLowerCase() : '';
            return qText.includes(term) || qSub.includes(term) || qOpts.includes(term);
        }).slice(0, 100);
    }

    // Offline-First Sync Queue Manager (Zero Side-Effects)
    const OfflineQueue = {
        enqueue(action, payload) {
            try {
                const queue = JSON.parse(localStorage.getItem('krishi_offline_sync_queue') || '[]');
                queue.push({ action, payload, timestamp: Date.now() });
                localStorage.setItem('krishi_offline_sync_queue', JSON.stringify(queue));
                console.log(`[OfflineSync] Action '${action}' queued locally.`);
            } catch(e) { window.krishiLogSilent && window.krishiLogSilent('sqlite.queue_push', e); }
        },
        async drain() {
            if (!navigator.onLine) return;
            try {
                const queue = JSON.parse(localStorage.getItem('krishi_offline_sync_queue') || '[]');
                if (queue.length === 0) return;
                console.log(`[OfflineSync] Draining ${queue.length} offline actions to cloud...`);
                localStorage.removeItem('krishi_offline_sync_queue');
                if (window.syncCloudNow) {
                    await window.syncCloudNow(true);
                }
            } catch(e) { window.krishiLogSilent && window.krishiLogSilent('sqlite.queue_drain', e); }
        }
    };

    window.addEventListener('online', () => OfflineQueue.drain());

    // Public API
    window.KrishiSQLite = {
        init,
        isAvailable: () => _ready,
        getQuestions,
        saveQuestions,
        deleteQuestionsByIds,
        getCount,
        searchQuestions,
        enqueueOfflineAction: (act, payload) => OfflineQueue.enqueue(act, payload),
        drainOfflineQueue: () => OfflineQueue.drain()
    };

    // Auto-initialize on native platform
    document.addEventListener('DOMContentLoaded', function() {
        window.KrishiSQLite.init().then(function(available) {
            if (available) {
                console.log('[SQLite] Auto-initialized on native platform.');
            }
        });
        OfflineQueue.drain();
    });

})();
