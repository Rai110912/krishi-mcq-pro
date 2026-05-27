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
        if (analyticsUseDemoMode) {
            data = [65, 72, 68, 80, 78, 84, 88];
        } else {
            data = mockTestScores.length > 0 ? mockTestScores : [0, 0, 0];
            if (data.length === 1) data = [0, data[0]];
        }
        
        // Draw grid lines
        ctx.strokeStyle = '#f1f5f9';
        if (document.documentElement.classList.contains('dark')) {
            ctx.strokeStyle = '#334155';
        }
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            let gy = h * i / 4;
            ctx.beginPath();
            ctx.moveTo(w * 0.05, gy);
            ctx.lineTo(w * 0.95, gy);
            ctx.stroke();
        }
        
        // Draw smooth curve with gradient
        if (data.some(val => val > 0) || analyticsUseDemoMode) {
            let paddingX = 20;
            let paddingY = 20;
            let xStride = (w - paddingX * 2) / (data.length - 1);
            
            ctx.beginPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#4f46e5'; // elegant purple curve
            
            let points = [];
            data.forEach((val, i) => {
                let rx = paddingX + i * xStride;
                let ry = h - paddingY - (val / 100) * (h - paddingY * 2);
                points.push({x: rx, y: ry});
            });
            
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();
            
            // Fill area under curve
            ctx.lineTo(points[points.length - 1].x, h - paddingY);
            ctx.lineTo(points[0].x, h - paddingY);
            ctx.closePath();
            ctx.fillStyle = 'rgba(79, 70, 229, 0.05)';
            ctx.fill();
            
            // Draw dots
            ctx.fillStyle = '#4f46e5';
            points.forEach(pt => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });
        } else {
            ctx.fillStyle = '#64748b';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Take multiple Mock tests to render curve', w/2, h/2);
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
        
        let profs = subjects.map(sub => {
            if (analyticsUseDemoMode) {
                if (sub === 'Agronomy') return 92;
                if (sub === 'Horticulture') return 88;
                if (sub === 'Soil Science') return 48;
                if (sub === 'Plant Pathology') return 42;
                return 60;
            } else {
                let stats = localData.stats.subjectStats[sub] || {solved:0, correct:0};
                return stats.solved > 0 ? Math.round((stats.correct/stats.solved)*100) : 0;
            }
        });
        
       let cx = w / 2;
let cy = h / 2 - 5;
let maxRadius = Math.min(w, h) / 2 - 25;
let numAxes = subjects.length > 0 ? subjects.length : 4; // Fallback to 4 to avoid division-by-zeroy
        
        ctx.strokeStyle = '#e2e8f0';
        if (document.documentElement.classList.contains('dark')) {
            ctx.strokeStyle = '#334155';
        }
        ctx.lineWidth = 1;
        
        for (let ring = 1; ring <= 4; ring++) {
            let r = maxRadius * ring / 4;
            ctx.beginPath();
            for (let i = 0; i < numAxes; i++) {
                let angle = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
                let rx = cx + r * Math.cos(angle);
                let ry = cy + r * Math.sin(angle);
                if (i === 0) ctx.moveTo(rx, ry);
                else ctx.lineTo(rx, ry);
            }
            ctx.closePath();
            ctx.stroke();
        }
        
        ctx.font = '7px sans-serif';
        ctx.fillStyle = '#64748b';
        subjects.forEach((sub, i) => {
            let angle = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
            let rx = cx + maxRadius * Math.cos(angle);
            let ry = cy + maxRadius * Math.sin(angle);
            
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(rx, ry);
            ctx.stroke();
            
            let labelDistance = maxRadius + 14;
            let lx = cx + labelDistance * Math.cos(angle);
            let ly = cy + labelDistance * Math.sin(angle);
            
            ctx.textAlign = 'center';
            if (Math.cos(angle) > 0.1) ctx.textAlign = 'left';
            else if (Math.cos(angle) < -0.1) ctx.textAlign = 'right';
            
            ctx.fillText(sub.substring(0, 10), lx, ly);
        });
        
        ctx.beginPath();
        profs.forEach((prof, i) => {
            let angle = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
            let r = maxRadius * (prof / 100);
            let rx = cx + r * Math.cos(angle);
            let ry = cy + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
        });
        ctx.closePath();
        
        ctx.strokeStyle = '#4f46e5'; 
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(79, 70, 229, 0.12)';
        ctx.fill();
        
        profs.forEach((prof, i) => {
            let angle = (i * 2 * Math.PI / numAxes) - Math.PI / 2;
            let r = maxRadius * (prof / 100);
            let rx = cx + r * Math.cos(angle);
            let ry = cy + r * Math.sin(angle);
            ctx.beginPath();
            ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#4f46e5';
            ctx.fill();
        });
    }

function drawHeatmapCalendar(){
        if (document.hidden) return;
        let page = document.getElementById('page-analytics');
        if (page && !page.classList.contains('active')) return;
        let container = document.getElementById('heatmap-calendar-container');
        if (!container) return;
        container.innerHTML = '';
        const frag = document.createDocumentFragment();
        let dateList = [];
        let now = new Date();
        for (let i = 104; i >= 0; i--) {
            let d = new Date(now.getTime() - i * 24 * 3600 * 1000);
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
            if (activity > 0 && activity <= 3) colorClass = 'bg-emerald-200 dark:bg-emerald-950';    
            else if (activity > 3 && activity <= 7) colorClass = 'bg-emerald-450 dark:bg-emerald-800'; 
            else if (activity > 7 && activity <= 12) colorClass = 'bg-emerald-650 dark:bg-emerald-650'; 
            else if (activity > 12) colorClass = 'bg-emerald-850 dark:bg-emerald-450';               
            
            let square = document.createElement('div');
            square.className = `w-2 h-2 rounded-xs ${colorClass} transition-all duration-300 hover:scale-125 cursor-help`;
            square.title = `${dateStr}: ${activity} questions solved`;
            frag.appendChild(square);
        });
        container.appendChild(frag);
        
        let avgLabel = document.getElementById('avg-heatmap-solve');
        if (avgLabel) {
            let avg = Math.round((totalActivitySolved / 105) * 10) / 10;
            avgLabel.textContent = `${avg} daily avg`;
        }
    }

function animateWaterWave(canvas) {
    if (canvas.dataset.waveRunning === 'true') return;
    canvas.dataset.waveRunning = 'true';
    var ctx = canvas.getContext('2d');
    function draw() {
        if (!isAppVisible || !canvas.parentNode) {
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
                var stats = window.localData.stats.subjectStats[sub] || {solved: 0, correct: 0};
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
            if (!isAppVisible || !canvas.parentNode) return;
            var w = canvas.width / window.devicePixelRatio;
            var h = canvas.height / window.devicePixelRatio;
            ctx.clearRect(0, 0, w, h);

            // रेखाहरू कोर्ने (Connections)
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
        window.addEventListener('resize', init);
    }