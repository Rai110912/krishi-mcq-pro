function drawGrowthChart(){
        if (document.hidden) return;
        let page = document.getElementById('page-analytics');
        if (page && !page.classList.contains('active')) return;
        let growthCanvas = document.getElementById('growth-chart-v2');
        if (!growthCanvas) return;

        // Crisp, low-cost high-DPI support
        const ps = getPerfSettings();
        const dpr = Math.min(window.devicePixelRatio || 1, ps.perfMode === 'battery' ? 1.25 : 2);
        const cssW = Math.max(1, growthCanvas.clientWidth || 300);
        const cssH = Math.max(1, growthCanvas.clientHeight || 150);
        const pxW = Math.round(cssW * dpr);
        const pxH = Math.round(cssH * dpr);
        if (growthCanvas.width !== pxW || growthCanvas.height !== pxH) {
            growthCanvas.width = pxW; growthCanvas.height = pxH;
        }

        let ctx = growthCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        let w = cssW;
        let h = cssH;
        ctx.clearRect(0, 0, w, h);
        
        let data = [];
        let emptyMsg = 'Take multiple Mock tests to render curve';
        if (analyticsUseDemoMode) {
            data = [65, 72, 68, 80, 78, 84, 88];
        } else {
            // mockTestScores may hold legacy bare numbers or {acc, ts} objects.
            // Filter by the active analytics range using each score's ts; entries
            // with a null ts (legacy, undated) are always shown so old data still plots.
            let scores = mockTestScores || [];
            let range = (typeof getAnalyticsRange === 'function') ? getAnalyticsRange() : null;
            let fromTs = range ? range.fromTs : null;
            let toTs = range ? range.toTs : null;
            let isRangedChart = (typeof analyticsFilterRange !== 'undefined') && analyticsFilterRange !== 'all';
            data = scores.filter(s => {
                let ts = (s && typeof s === 'object') ? s.ts : null;
                if (ts == null) return true;
                if (fromTs != null && ts < fromTs) return false;
                if (toTs != null && ts > toTs) return false;
                return true;
            }).map(s => (typeof s === 'number') ? s : ((s && s.acc) || 0));
            // Distinguish "no mocks ever" from "mocks exist but none in this range",
            // so a filtered-empty chart doesn't wrongly imply the user never tested.
            if (data.length === 0 && scores.length > 0 && isRangedChart) {
                emptyMsg = 'No mock tests in this range';
            }
            if (data.length === 0) data = [0, 0, 0];
            if (data.length === 1) data = [0, data[0]];
        }
        
        // ---- Professional line chart: axes, smooth curve, gradient, rise-in animation ----
        let padL = 26, padR = 14, padT = 22, padB = 20;
        let plotW = Math.max(1, w - padL - padR);
        let plotH = Math.max(1, h - padT - padB);
        let baseY = padT + plotH;
        let isDark = document.documentElement.classList.contains('dark');
        let n = data.length;
        let xAt = i => padL + (n > 1 ? (plotW * i / (n - 1)) : plotW / 2);
        let yAt = v => padT + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;

        function smoothPath(pts) {
            ctx.beginPath();
            if (!pts.length) return;
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 0; i < pts.length - 1; i++) {
                let p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
                let c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
                let c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
                ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
            }
        }

        function drawFrame(t) {
            ctx.clearRect(0, 0, w, h);
            ctx.lineWidth = 1; ctx.font = '8px sans-serif';
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            [0, 25, 50, 75, 100].forEach(pct => {
                let gy = yAt(pct);
                ctx.strokeStyle = isDark ? '#1e293b' : '#f1f5f9';
                ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke();
                if (pct % 50 === 0) { ctx.fillStyle = isDark ? '#475569' : '#94a3b8'; ctx.fillText(pct, padL - 4, gy); }
            });
            ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = isDark ? '#334155' : '#cbd5e1';
            ctx.beginPath(); let ty = yAt(50); ctx.moveTo(padL, ty); ctx.lineTo(w - padR, ty); ctx.stroke(); ctx.restore();

            let hasData = data.some(v => v > 0) || analyticsUseDemoMode;
            if (!hasData) {
                ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
                ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(emptyMsg, w / 2, h / 2);
                return;
            }
            let pts = data.map((v, i) => ({ x: xAt(i), y: baseY - (baseY - yAt(v)) * t, v: v }));

            smoothPath(pts);
            ctx.lineTo(pts[pts.length - 1].x, baseY);
            ctx.lineTo(pts[0].x, baseY);
            ctx.closePath();
            let grad = ctx.createLinearGradient(0, padT, 0, baseY);
            grad.addColorStop(0, 'rgba(79,70,229,0.28)');
            grad.addColorStop(1, 'rgba(79,70,229,0.02)');
            ctx.fillStyle = grad; ctx.fill();

            ctx.save();
            ctx.shadowColor = 'rgba(79,70,229,0.35)'; ctx.shadowBlur = 6;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.lineWidth = 2.5; ctx.strokeStyle = '#4f46e5';
            smoothPath(pts); ctx.stroke();
            ctx.restore();

            ctx.fillStyle = isDark ? '#475569' : '#94a3b8';
            ctx.font = '7px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            pts.forEach((pt, i) => { if (n <= 8 || i === 0 || i === n - 1) ctx.fillText(String(i + 1), pt.x, baseY + 4); });
            pts.forEach(pt => { ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#4f46e5'; ctx.fill(); });
            let last = pts[pts.length - 1];
            ctx.beginPath(); ctx.arc(last.x, last.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#4f46e5'; ctx.fill();
            ctx.beginPath(); ctx.arc(last.x, last.y, 5, 0, Math.PI * 2); ctx.strokeStyle = isDark ? '#0f172a' : '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
            if (t >= 1) {
                let label = Math.round(last.v) + '%';
                ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                let tw = ctx.measureText(label).width + 8;
                let bx = Math.min(w - padR - tw / 2, Math.max(padL + tw / 2, last.x)), by = last.y - 8;
                ctx.fillStyle = '#4f46e5';
                if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx - tw / 2, by - 12, tw, 13, 3); ctx.fill(); }
                else { ctx.fillRect(bx - tw / 2, by - 12, tw, 13); }
                ctx.fillStyle = '#ffffff'; ctx.fillText(label, bx, by);
            }
        }

        let reduceMotion = false;
        try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e) {}
        if (growthCanvas.__growthRAF) { cancelAnimationFrame(growthCanvas.__growthRAF); growthCanvas.__growthRAF = null; }
        if (reduceMotion || ps.perfMode === 'battery') {
            drawFrame(1);
        } else {
            let startT = null, DUR = 650;
            let step = (now) => {
                if (startT == null) startT = now;
                let p = Math.min(1, (now - startT) / DUR);
                drawFrame(1 - Math.pow(1 - p, 3));
                if (p < 1) growthCanvas.__growthRAF = requestAnimationFrame(step);
                else growthCanvas.__growthRAF = null;
            };
            growthCanvas.__growthRAF = requestAnimationFrame(step);
        }
    }

function drawRadarChart(){
        if (document.hidden) return;
        let page = document.getElementById('page-analytics');
        if (page && !page.classList.contains('active')) return;
        let radarCanvas = document.getElementById('radar-chart');
        if (!radarCanvas) return;

        const ps = getPerfSettings();
        const dpr = Math.min(window.devicePixelRatio || 1, ps.perfMode === 'battery' ? 1.25 : 2);
        const cssW = Math.max(1, radarCanvas.clientWidth || 300);
        const cssH = Math.max(1, radarCanvas.clientHeight || 150);
        const pxW = Math.round(cssW * dpr);
        const pxH = Math.round(cssH * dpr);
        if (radarCanvas.width !== pxW || radarCanvas.height !== pxH) {
            radarCanvas.width = pxW; radarCanvas.height = pxH;
        }

        let ctx = radarCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        let w = cssW;
        let h = cssH;
        ctx.clearRect(0, 0, w, h);
        
        let subjects = getAllSubjects().slice(0, 5);
        if (subjects.length < 3) {
            subjects = ['Agronomy', 'Soil Science', 'Horticulture', 'Plant Pathology'];
        }
        
        // When a date range is active, recompute per-subject accuracy from the
        // date-stamped timingLog instead of the cumulative all-time subjectStats.
        let rangedSubjectStats = null;
        if (!analyticsUseDemoMode && typeof analyticsFilterRange !== 'undefined' && analyticsFilterRange !== 'all'
            && typeof computeSubjectStatsInRange === 'function' && typeof getAnalyticsRange === 'function') {
            let r = getAnalyticsRange();
            let m = computeSubjectStatsInRange(r.fromDate, r.toDate);
            if (Object.keys(m).length > 0) rangedSubjectStats = m;
        }

        let profs = subjects.map(sub => {
            if (analyticsUseDemoMode) {
                if (sub === 'Agronomy') return 92;
                if (sub === 'Horticulture') return 88;
                if (sub === 'Soil Science') return 48;
                if (sub === 'Plant Pathology') return 42;
                return 60;
            } else {
                let src = rangedSubjectStats || localData.stats.subjectStats;
                let stats = src[sub] || {solved:0, correct:0};
                return stats.solved > 0 ? Math.round((stats.correct/stats.solved)*100) : 0;
            }
        });

        // With no attempts every axis sits at 0, collapsing the polygon to a dot on
        // an otherwise empty spider-web. Detect that so we can show a hint instead of
        // a chart that looks broken (matches the growth chart's empty state).
        let hasRealData = analyticsUseDemoMode || profs.some(p => p > 0);
        
       let cx = w / 2;
let cy = h / 2 - 5;
let maxRadius = Math.min(w, h) / 2 - 25;
let numAxes = subjects.length > 0 ? subjects.length : 4; // Fallback to 4 to avoid division-by-zeroy
        
        let isDark = document.documentElement.classList.contains('dark');
        let gridColor = isDark ? '#334155' : '#e2e8f0';

        function radarFrame(t) {
            ctx.clearRect(0, 0, w, h);
            for (let ring = 4; ring >= 1; ring--) {
                let r = maxRadius * ring / 4;
                ctx.beginPath();
                for (let i = 0; i < numAxes; i++) {
                    let a = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
                    let rx = cx + r * Math.cos(a), ry = cy + r * Math.sin(a);
                    if (i === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
                }
                ctx.closePath();
                ctx.fillStyle = ring % 2 === 0 ? (isDark ? 'rgba(51,65,85,0.18)' : 'rgba(241,245,249,0.6)') : 'transparent';
                ctx.fill();
                ctx.strokeStyle = gridColor; ctx.lineWidth = 1; ctx.stroke();
            }
            ctx.font = '7px sans-serif';
            subjects.forEach((sub, i) => {
                let a = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
                let rx = cx + maxRadius * Math.cos(a), ry = cy + maxRadius * Math.sin(a);
                ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rx, ry); ctx.stroke();
                let ld = maxRadius + 14;
                let lx = cx + ld * Math.cos(a), ly = cy + ld * Math.sin(a);
                ctx.textAlign = 'center';
                if (Math.cos(a) > 0.1) ctx.textAlign = 'left';
                else if (Math.cos(a) < -0.1) ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
                ctx.fillText(sub.substring(0, 10), lx, ly);
            });
            let poly = profs.map((prof, i) => {
                let a = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
                let r = maxRadius * (prof / 100) * t;
                return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
            });
            if (!hasRealData) {
                // Empty state: keep the grid + labels drawn above, add a centered hint.
                let msg = 'Solve more MCQs to map competence';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                let tw = ctx.measureText(msg).width;
                ctx.fillStyle = isDark ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.82)';
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(cx - tw / 2 - 6, cy - 8, tw + 12, 16, 5);
                else ctx.rect(cx - tw / 2 - 6, cy - 8, tw + 12, 16);
                ctx.fill();
                ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
                ctx.fillText(msg, cx, cy);
                return;
            }
            ctx.beginPath();
            poly.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
            ctx.closePath();
            let rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
            rg.addColorStop(0, 'rgba(99,102,241,0.30)');
            rg.addColorStop(1, 'rgba(79,70,229,0.12)');
            ctx.fillStyle = rg; ctx.fill();
            ctx.save();
            ctx.shadowColor = 'rgba(79,70,229,0.4)'; ctx.shadowBlur = 6;
            ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.restore();
            poly.forEach(p => {
                ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#4f46e5'; ctx.fill();
                ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.strokeStyle = isDark ? '#0f172a' : '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            });
        }
        let reduceMotionR = false;
        try { reduceMotionR = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e) {}
        if (radarCanvas.__radarRAF) { cancelAnimationFrame(radarCanvas.__radarRAF); radarCanvas.__radarRAF = null; }
        if (reduceMotionR || ps.perfMode === 'battery' || !hasRealData) {
            radarFrame(1);
        } else {
            let st = null, DUR = 600;
            let step = (now) => {
                if (st == null) st = now;
                let p = Math.min(1, (now - st) / DUR);
                radarFrame(1 - Math.pow(1 - p, 3));
                if (p < 1) radarCanvas.__radarRAF = requestAnimationFrame(step);
                else radarCanvas.__radarRAF = null;
            };
            radarCanvas.__radarRAF = requestAnimationFrame(step);
        }
    }

function drawHeatmapCalendar(){
        if (document.hidden) return;
        let page = document.getElementById('page-analytics');
        if (page && !page.classList.contains('active')) return;
        let container = document.getElementById('heatmap-calendar-container');
        if (!container) return;
        container.innerHTML = '';
        const frag = document.createDocumentFragment();
        // Size the calendar window to the active analytics range (ending at the
        // range's end date); 'all' keeps the default 105-day view.
        let range = (typeof getAnalyticsRange === 'function') ? getAnalyticsRange() : null;
        let windowDays = 105;
        if (range && range.days != null) {
            windowDays = Math.max(7, Math.min(range.days, 366));
        }
        let endDate = (range && range.toDate) ? new Date(range.toDate + 'T00:00:00') : new Date();
        let dateList = [];
        for (let i = windowDays - 1; i >= 0; i--) {
            let d = new Date(endDate.getTime() - i * 24 * 3600 * 1000);
            dateList.push(getLocalDateString(d));
        }
        
        let totalActivitySolved = 0;
        let activeDays = 0;
        
        dateList.forEach(dateStr => {
            let activity = 0;
            if (analyticsUseDemoMode) {
                let dateHash = 0;
                for (let charIdx = 0; charIdx < dateStr.length; charIdx++) {
                    dateHash += dateStr.charCodeAt(charIdx);
                }
                activity = dateHash % 15;
                if (activity < 4) activity = 0;
            } else {
                activity = (localData.streak[dateStr] && localData.streak[dateStr].solved) || 0;
            }
            
            totalActivitySolved += activity;
            if (activity > 0) activeDays++;
            
            let colorClass = 'bg-slate-100 dark:bg-slate-800';
            if (activity > 0 && activity <= 3) colorClass = 'bg-emerald-200 dark:bg-emerald-900';
            else if (activity > 3 && activity <= 7) colorClass = 'bg-emerald-400 dark:bg-emerald-700';
            else if (activity > 7 && activity <= 12) colorClass = 'bg-emerald-500 dark:bg-emerald-500';
            else if (activity > 12) colorClass = 'bg-emerald-600 dark:bg-emerald-400 ring-1 ring-emerald-300/60 dark:ring-emerald-300/40';

            let square = document.createElement('div');
            square.className = `w-2 h-2 rounded-[2px] ${colorClass} transition-transform duration-200 hover:scale-150 hover:ring-2 hover:ring-emerald-400/50 cursor-help`;
            square.title = `${dateStr}: ${activity} questions solved`;
            frag.appendChild(square);
        });
        container.appendChild(frag);
        
        let avgLabel = document.getElementById('avg-heatmap-solve');
        if (avgLabel) {
            let divisor = dateList.length || 1;
            let avg = Math.round((totalActivitySolved / divisor) * 10) / 10;
            avgLabel.textContent = `${avg} daily avg`;
        }
    }

function animateWaterWave(canvas) {
    if (canvas.dataset.waveRunning === 'true') return;
    canvas.dataset.waveRunning = 'true';
    var ctx = canvas.getContext('2d');
    function draw() {
        if (document.hidden || !canvas.parentNode) {
            canvas.dataset.waveRunning = 'false';
            return;
        }
        
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
        var h = canvas.parentElement ? canvas.parentElement.clientHeight : 0;
        
        if (!w || !h) {
            requestAnimationFrame(draw);
            return;
        }
        
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        
        ctx.clearRect(0, 0, w, h);
        
        var total = (typeof state !== 'undefined' && state) ? state.totalQuestions : 10;
        var current = (typeof state !== 'undefined' && state) ? state.currentIndex : 0;
        var progress = total > 0 ? (current / total) : 0;
        
        var fillWidth = w * progress;
        if (fillWidth <= 0) {
            requestAnimationFrame(draw);
            return;
        }
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, fillWidth, h);
        ctx.clip();
        
        ctx.fillStyle = 'rgba(59, 130, 246, 0.85)';
        ctx.beginPath();
        for (var x = 0; x <= fillWidth; x++) {
            var y = h/2 + Math.sin(x * 0.05 + waveOffsets[0]) * 2;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(fillWidth, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        
        ctx.fillStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.beginPath();
        for (var x = 0; x <= fillWidth; x++) {
            var y = h/2 + Math.sin(x * 0.04 + waveOffsets[1]) * 2;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(fillWidth, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        
        ctx.restore();
        
        waveOffsets[0] += 0.08;
        waveOffsets[1] += 0.05;
        
        requestAnimationFrame(draw);
    }
    draw();
}

function drawNeuralMap(canvas) {
        if (canvas.dataset.neuralRunning === 'true') return;
        canvas.dataset.neuralRunning = 'true';
        var ctx = canvas.getContext('2d');
        var nodes = [];
        var subjects = typeof window.getAllSubjects === 'function' ? window.getAllSubjects().slice(0, 4) : ['Agronomy', 'Soil', 'Horti', 'Pathology'];
        
        function init() {
            var w = canvas.parentElement.clientWidth;
            var h = 180;
            canvas.width = w * window.devicePixelRatio;
            canvas.height = h * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
            
            nodes = [];
            // मुख्य केन्द्र नोड (Core)
            nodes.push({ x: w/2, y: h/2, r: 16, label: "ज्ञान केन्द्र", color: '#4f46e5', pulse: 0 });
            
            // शाखाहरू (Subject Nodes)
            subjects.forEach(function(sub, idx) {
                var angle = (idx * 2 * Math.PI) / subjects.length;
                var dist = 55;
                
                // वास्तविक नतिजाको प्रतिशत निकाल्ने
                var stats = (window.localData && window.localData.stats && window.localData.stats.subjectStats && window.localData.stats.subjectStats[sub]) || {solved: 0, correct: 0};
                var acc = stats.solved > 0 ? Math.round((stats.correct / stats.solved) * 100) : 0;
                
                // एनिमेसन डेमों को अवस्थामा राम्रो डेटा राख्ने
                if (window.analyticsUseDemoMode) {
                    acc = [92, 85, 48, 42][idx] || 70;
                }

                var color = acc >= 75 ? '#10b981' : (acc >= 50 ? '#f59e0b' : '#ef4444');
                var radius = 10 + (acc * 0.08); // राम्रो नतिजा हुँदा आकार ठूलो हुने

                nodes.push({
                    x: w/2 + Math.cos(angle) * dist,
                    y: h/2 + Math.sin(angle) * dist,
                    r: radius,
                    label: sub.split(' ')[0],
                    color: color,
                    shake: acc < 50 // कमजोर विषय हल्का हल्लिने
                });
            });
        }

        function render() {
            if (!canvas.parentNode || canvas.dataset.neuralRunning === 'false') {
                canvas.dataset.neuralRunning = 'false';
                return;
            }
            if (document.hidden) {
                setTimeout(function() {
                    requestAnimationFrame(render);
                }, 300);
                return;
            }
            var w = canvas.width / window.devicePixelRatio;
            var h = canvas.height / window.devicePixelRatio;
            ctx.clearRect(0, 0, w, h);

            // रेखाहरू कोर्ने (Connections with pulsing laser signals)
            var core = nodes[0];
            if (core) {
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = document.documentElement.classList.contains('dark') ? '#334155' : '#e2e8f0';
                for (var i = 1; i < nodes.length; i++) {
                    ctx.beginPath();
                    ctx.moveTo(core.x, core.y);
                    ctx.lineTo(nodes[i].x, nodes[i].y);
                    ctx.stroke();
                }

                // Laser pulse signals traveling along lines
                let isElite = localStorage.getItem('krishi_elite_animations') !== 'false';
                if (isElite) {
                    let baseFreq = (window.EliteAnimsConfig && typeof window.EliteAnimsConfig.laserSignalFrequency !== 'undefined') ? window.EliteAnimsConfig.laserSignalFrequency : 1.0;
                    let activeFreq = window.EliteAnimsConfig.throttled ? baseFreq * 0.5 : baseFreq;
                    var pulseTime = Date.now() * 0.002 * activeFreq;
                    for (var i = 1; i < nodes.length; i++) {
                        var target = nodes[i];
                        var t = (pulseTime + i * 0.25) % 1.0;
                        var px = core.x + (target.x - core.x) * t;
                        var py = core.y + (target.y - core.y) * t;
                        
                        ctx.beginPath();
                        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
                        ctx.fillStyle = '#10b981';
                        ctx.shadowBlur = 6;
                        ctx.shadowColor = '#10b981';
                        ctx.fill();
                        ctx.shadowBlur = 0;
                    }
                }
            }

            // नोडहरू कोर्ने (Nodes)
            nodes.forEach(function(node, idx) {
                ctx.save();
                if (node.shake) {
                    // कमजोर विषयमा हल्का कम्पन
                    var ox = Math.sin(Date.now() * 0.04 + idx) * 1.5;
                    ctx.translate(ox, 0);
                }
                
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
                ctx.fillStyle = node.color;
                ctx.fill();
                
                // पल्स इफेक्ट
                if (idx === 0) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, node.r + Math.sin(Date.now() * 0.005) * 4, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(79, 70, 229, 0.25)';
                    ctx.stroke();
                }

                ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#f1f5f9' : '#1e293b';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(node.label, node.x, node.y + node.r + 10);
                ctx.restore();
            });

            requestAnimationFrame(render);
        }

        init();
        render();
        if (!canvas.__krishi_resize_bound__) {
            canvas.__krishi_resize_bound__ = true;
            window.addEventListener('resize', init);
        }
    }