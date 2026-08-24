// ─── Krishi Data Safety Pack ──────────────────────────────────────────────
// Cloud snapshots ("Time Machine"), daily local rotation, dashboard glue.
// Kill switch: KrishiStorage 'krishi_data_safety_enabled' === 'false' ⇒ dormant.
// Requires app.js hook object: window.__krishiDataSafetyHooks { collect, apply, pushPending }
(function () {
    'use strict';

    const FLAG_KEY = 'krishi_data_safety_enabled';
    const KEEP_SNAPSHOTS = 10;
    const MIN_SNAPSHOT_INTERVAL = 30 * 60 * 1000; // 30 minutes
    const KEEP_LOCAL_DAYS = 7;

    let ctx = null;              // { firestore, uid } — refreshed by app.js hooks
    let lastSnapshotSig = '';
    let lastSnapshotAt = 0;

    function enabled() {
        try { return (window.KrishiStorage && KrishiStorage.getItem(FLAG_KEY)) !== 'false'; }
        catch (e) { return true; }
    }

    function hooks() { return window.__krishiDataSafetyHooks || null; }

    function summaryOf(p) {
        try {
            const ss = (p.stats && p.stats.subjectStats) || {};
            let solved = 0, correct = 0;
            Object.keys(ss).forEach(k => { solved += (ss[k] && ss[k].solved) || 0; correct += (ss[k] && ss[k].correct) || 0; });
            return {
                solved, correct,
                bookmarks: (p.bookmarked || []).length,
                mistakes: (p.wrong || []).length,
                customQs: Array.isArray(p.customQuestions) ? p.customQuestions.length : 0
            };
        } catch (e) { return {}; }
    }

    function signatureOf(p) {
        // Cheap change detector so identical states never double-snapshot.
        // NOTE: updatedAt is deliberately excluded — collectAllAppData() stamps
        // it with a fresh Date.now() on every call, which would defeat matching.
        try {
            return [(p.bookmarked || []).length,
                (p.wrong || []).length,
                Array.isArray(p.customQuestions) ? p.customQuestions.length : 0,
                JSON.stringify(p.streak || {}).length,
                JSON.stringify(p.sm2 || {}).length,
                JSON.stringify(p.stats || {}).length].join('|');
        } catch (e) { return String(Date.now()); }
    }

    async function pruneSnapshots(colRef) {
        // Newest-first ordering is REQUIRED: default doc-ID order is ascending,
        // which would keep the OLDEST snapshots and delete the freshest ones.
        const snap = await colRef.orderBy('createdAt', 'desc').limit(KEEP_SNAPSHOTS + 30).get();
        const docs = [];
        snap.forEach(d => docs.push(d));
        if (docs.length <= KEEP_SNAPSHOTS) return;
        for (let i = KEEP_SNAPSHOTS; i < docs.length; i += 400) {
            const batch = colRef.firestore.batch();
            docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    }

    async function createSnapshot(reason, force) {
        if (!enabled()) return false;
        if (!ctx || !ctx.firestore || !ctx.uid) return false;
        const now = Date.now();
        if (!force && now - lastSnapshotAt < MIN_SNAPSHOT_INTERVAL) return false;
        const H = hooks();
        if (!H) return false;
        try {
            const payload = H.collect();
            if (!payload) return false;
            const sig = signatureOf(payload);
            if (!force && sig === lastSnapshotSig) return false;

            // Trim bulky history from the stored copy (full history stays in main doc)
            if (Array.isArray(payload.timingLog) && payload.timingLog.length > 500) {
                payload.timingLog = payload.timingLog.slice(0, 500);
            }
            delete payload.ownerUid;

            const json = JSON.stringify(payload);
            if (json.length > 900 * 1024) {
                window.krishiLogSilent && krishiLogSilent('snapshot.too_big', new Error(Math.round(json.length / 1024) + ' KB'));
                return false;
            }

            const d = new Date(now);
            const pad = n => String(n).padStart(2, '0');
            const docId = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

            const colRef = ctx.firestore.collection('users').doc(ctx.uid).collection('snapshots');
            await colRef.doc(docId).set({
                payload: json,
                sizeKB: Math.round(json.length / 1024),
                summary: summaryOf(payload),
                reason: String(reason || 'auto'),
                createdAt: now
            });

            lastSnapshotSig = sig;
            lastSnapshotAt = now;
            await pruneSnapshots(colRef);
            console.log('[DataSafety] Snapshot saved:', docId, '(' + reason + ')');
            renderDashboard();
            return true;
        } catch (e) {
            window.krishiLogSilent && krishiLogSilent('snapshot.error', e);
            return false;
        }
    }

    // ── Daily local rotation (offline insurance) ─────────────────────────────
    function rotateLocalBackups() {
        if (!enabled()) return;
        const H = hooks();
        if (!H) return;
        const today = new Date();
        const dstr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        try {
            if (KrishiStorage.getItem('krishi_lb_last_day') === dstr) return;
            const json = LZString.compressToUTF16(JSON.stringify(H.collect()));
            KrishiStorage.setItem('krishi_lb_' + dstr, json);
            KrishiStorage.setItem('krishi_lb_last_day', dstr);
            // Prune anything older than KEEP_LOCAL_DAYS
            for (let i = KEEP_LOCAL_DAYS + 1; i <= 40; i++) {
                const old = new Date(today.getTime() - i * 86400000);
                const k = 'krishi_lb_' + old.getFullYear() + '-' + String(old.getMonth() + 1).padStart(2, '0') + '-' + String(old.getDate()).padStart(2, '0');
                if (KrishiStorage.getItem(k) !== null && KrishiStorage.getItem(k) !== undefined) {
                    KrishiStorage.removeItem(k);
                }
            }
            console.log('[DataSafety] Local daily backup written:', dstr);
            renderDashboard();
        } catch (e) {
            window.krishiLogSilent && krishiLogSilent('local_backup.error', e);
        }
    }

    function listLocalBackups() {
        const out = [];
        try {
            for (let i = 0; i < KEEP_LOCAL_DAYS; i++) {
                const d = new Date(Date.now() - i * 86400000);
                const k = 'krishi_lb_' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                const v = KrishiStorage.getItem(k);
                if (v) out.push({ date: k, sizeKB: Math.round(v.length / 1024) });
            }
        } catch (e) {}
        return out;
    }

    // ── Restore pipeline ─────────────────────────────────────────────────────
    async function performRestore(kind, id) {
        const H = hooks();
        if (!H) return;
        try {
            let payload = null, label = '';
            if (kind === 'cloud') {
                if (!ctx || !ctx.firestore || !ctx.uid) throw new Error('Not synced yet.');
                const doc = await ctx.firestore.collection('users').doc(ctx.uid)
                    .collection('snapshots').doc(id).get();
                if (!doc.exists) throw new Error('Snapshot missing.');
                label = id;
                payload = JSON.parse(doc.data().payload);
            } else {
                const raw = KrishiStorage.getItem('krishi_lb_' + id);
                if (!raw) throw new Error('Local backup missing.');
                label = id;
                payload = JSON.parse(LZString.decompressFromUTF16(raw) || '{}');
            }
            if (!confirm('Restore ' + kind + ' backup from ' + label + '?\n\nLocal AND cloud progress will be rolled back to this snapshot\'s state.')) return;
            H.apply(payload);
            // Full overwrite (conflict-modal "keep local" pattern): a plain
            // pending merge would lose to newer cloud timestamps under LWW.
            if (!H.fullPush) throw new Error('Restore bridge unavailable.');
            await H.fullPush();
            closeModal();
            showToast('✅ Restored ' + label + ' — local & cloud rolled back!');
        } catch (e) {
            showToast('❌ Restore failed: ' + e.message, 7000);
            window.krishiLogSilent && krishiLogSilent('restore.' + kind, e);
        }
    }

    // ── UI ───────────────────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtSummary(s) {
        if (!s) return '';
        return `solved ${s.solved || 0} · 🔖${s.bookmarks || 0} · ❌${s.mistakes || 0} · 📝${s.customQs || 0}`;
    }

    async function openRestoreModal() {
        const modal = document.getElementById('krishi-restore-modal');
        const listEl = document.getElementById('krishi-restore-list');
        if (!modal || !listEl) return;
        listEl.innerHTML = '<p class="text-center text-xs text-slate-400 italic py-4">Loading…</p>';
        modal.classList.remove('hidden');

        let html = '<div class="text-[9px] font-black uppercase text-slate-400 mb-1">☁️ Cloud Snapshots</div>';
        try {
            if (ctx && ctx.firestore && ctx.uid) {
                const snap = await ctx.firestore.collection('users').doc(ctx.uid)
                    .collection('snapshots').orderBy('createdAt', 'desc').limit(KEEP_SNAPSHOTS).get();
                let count = 0;
                snap.forEach(doc => {
                    const d = doc.data();
                    count++;
                    html += `<button type="button" class="w-full text-left text-xs p-2 mb-1 rounded-lg border hover:bg-emerald-50 dark:hover:bg-slate-700 transition" style="border-color:var(--border)" data-kind="cloud" data-id="${esc(doc.id)}">
                        <b>${esc(doc.id)}</b> <span class="text-[9px] text-slate-400">${d.sizeKB || '?'} KB · ${esc(d.reason || '')}</span>
                        <div class="text-[9px] text-slate-500">${esc(fmtSummary(d.summary))}</div></button>`;
                });
                if (!count) html += '<p class="text-xs text-slate-400 italic mb-2">No cloud snapshots yet.</p>';
            } else {
                html += '<p class="text-xs text-slate-400 italic mb-2">Login & sync first for cloud snapshots.</p>';
            }
        } catch (e) {
            html += '<p class="text-xs text-rose-500 italic mb-2">Could not load cloud snapshots.</p>';
        }

        html += '<div class="text-[9px] font-black uppercase text-slate-400 mt-3 mb-1">📱 Local Backups (offline)</div>';
        const locals = listLocalBackups();
        if (!locals.length) {
            html += '<p class="text-xs text-slate-400 italic">No local backups yet — one is written daily.</p>';
        } else {
            locals.forEach(l => {
                html += `<button type="button" class="w-full text-left text-xs p-2 mb-1 rounded-lg border hover:bg-emerald-50 dark:hover:bg-slate-700 transition" style="border-color:var(--border)" data-kind="local" data-id="${esc(l.date)}">
                    <b>${esc(l.date)}</b> <span class="text-[9px] text-slate-400">~${l.sizeKB} KB</span></button>`;
            });
        }

        listEl.innerHTML = html;
        listEl.querySelectorAll('button[data-kind]').forEach(btn => {
            btn.addEventListener('click', () => performRestore(btn.dataset.kind, btn.dataset.id));
        });
    }

    function closeModal() {
        const m = document.getElementById('krishi-restore-modal');
        if (m) m.classList.add('hidden');
    }

    function renderDashboard() {
        try {
            const el = document.getElementById('krishi-ds-status');
            if (el) {
                const lb = listLocalBackups()[0];
                el.textContent = `🛟 Last local backup: ${lb ? lb.date : 'none yet'}`;
            }
        } catch (e) {}
    }

    // ── Public API ───────────────────────────────────────────────────────────
    window.KrishiDataSafety = {
        // Call after every successful sync — refreshes context, throttled snapshot + daily rotation
        onSyncSuccess(context) {
            ctx = context || ctx;
            rotateLocalBackups();
            createSnapshot('auto', false);
        },
        createManual() { return createSnapshot('manual', true); },
        openRestoreModal,
        renderDashboard,
        setContext(c) { ctx = c || ctx; }
    };

    function boot() {
        renderDashboard();
        rotateLocalBackups();
        setInterval(rotateLocalBackups, 60 * 60 * 1000);
        const rb = document.getElementById('krishi-restore-open');
        if (rb && !rb.__wired) { rb.__wired = true; rb.addEventListener('click', openRestoreModal); }
        const rc = document.getElementById('krishi-restore-close');
        if (rc && !rc.__wired) { rc.__wired = true; rc.addEventListener('click', closeModal); }
        const rm = document.getElementById('krishi-restore-modal');
        if (rm && !rm.__wired) {
            rm.__wired = true;
            rm.addEventListener('click', ev => { if (ev.target === rm) closeModal(); });
        }
        const mk = document.getElementById('krishi-snapshot-manual');
        if (mk && !mk.__wired) {
            mk.__wired = true;
            mk.addEventListener('click', async () => {
                mk.disabled = true;
                const ok = await createManual();
                mk.disabled = false;
                showToast(ok ? '🛟 Restore point created!' : '⚠️ Could not create snapshot (login/sync required?)', 5000);
            });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    console.log('[DataSafety] Pack initialized');
})();
