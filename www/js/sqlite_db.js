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

            _ready = true;
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
            return result.values.map(row => ({
                id: row.id,
                sub: row.subject,
                q: row.question,
                opts: JSON.parse(row.options),
                ans: row.answer,
                difficulty: row.difficulty,
                exp: row.explanation,
                tags: row.tags ? JSON.parse(row.tags) : []
            }));
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

    // Public API
    window.KrishiSQLite = {
        init,
        isAvailable: () => _ready,
        getQuestions,
        saveQuestions,
        getCount
    };

    // Auto-initialize on native platform
    document.addEventListener('DOMContentLoaded', function() {
        window.KrishiSQLite.init().then(function(available) {
            if (available) {
                console.log('[SQLite] Auto-initialized on native platform.');
            }
        });
    });

})();
