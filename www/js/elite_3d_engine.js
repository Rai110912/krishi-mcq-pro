(function() {
    // 🌾 central Premium 3D Projection Mathematics Engine
    window.Elite3D = {
        rotateX: function(p, a) {
            let c = Math.cos(a), s = Math.sin(a);
            return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
        },
        rotateY: function(p, a) {
            let c = Math.cos(a), s = Math.sin(a);
            return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
        },
        rotateZ: function(p, a) {
            let c = Math.cos(a), s = Math.sin(a);
            return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
        },
        project: function(p, cx, cy, rVal, viewportDist) {
            let d = viewportDist || 150;
            let scale = d / (d + p.z);
            return {
                x: cx + p.x * rVal * scale,
                y: cy - p.y * rVal * scale,
                z: p.z,
                scale: scale
            };
        }
    };

    // 1. 🌱 Premium 3D Interactive Crop Growth Sandbox
    window.init3DCropGrowthSandbox = function(canvas, percent) {
        if (!canvas) return;
        let ctx = canvas.getContext('2d');
        let thetaX = -0.15;
        let thetaY = 0.5;
        let isDragging = false;
        let prevMouse = { x: 0, y: 0 };
        let autoSpin = true;
        let animationFrameId = null;

        // Interaction Listeners
        function onDown(e) {
            isDragging = true;
            autoSpin = false;
            let clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let clientY = e.touches ? e.touches[0].clientY : e.clientY;
            prevMouse = { x: clientX, y: clientY };
        }
        function onMove(e) {
            if (!isDragging) return;
            let clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let clientY = e.touches ? e.touches[0].clientY : e.clientY;
            let dx = clientX - prevMouse.x;
            let dy = clientY - prevMouse.y;
            thetaY += dx * 0.008;
            thetaX += dy * 0.008;
            prevMouse = { x: clientX, y: clientY };
        }
        function onUp() {
            isDragging = false;
            // Resume slow spin after 3 seconds of inactivity
            setTimeout(() => { if (!isDragging) autoSpin = true; }, 3000);
        }

        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        canvas.addEventListener('touchstart', onDown, {passive: true});
        canvas.addEventListener('touchmove', onMove, {passive: true});
        window.addEventListener('touchend', onUp);

        function generateCrop3DVertices(p) {
            let nodes = [];
            let connections = [];
            
            // Stem height grows with progress
            let height = 0.4 + (p * 0.007); // Height scale factor
            
            // Base Stem points (Segmented for 3D curvature)
            let stemSegments = 5;
            for (let i = 0; i <= stemSegments; i++) {
                let t = i / stemSegments;
                // Add minor curving sine-wave offset
                let sx = Math.sin(t * Math.PI) * 0.08;
                nodes.push({
                    x: sx,
                    y: t * height - 0.45,
                    z: 0,
                    type: 'stem',
                    val: t
                });
                if (i > 0) connections.push([i - 1, i, '#10b981', 3.5]);
            }

            // Leaves - branch dynamically at progressive heights
            if (p >= 15) {
                // Left Leaf branch
                let l1_base = 2; // base node index
                let l1_base_pt = nodes[l1_base];
                let l1_tip_idx = nodes.length;
                nodes.push({ x: l1_base_pt.x - 0.28, y: l1_base_pt.y + 0.15, z: 0.15, type: 'leaf' });
                connections.push([l1_base, l1_tip_idx, '#34d399', 2.0]);
                
                if (p >= 40) {
                    // Right Leaf branch
                    let l2_base = 3;
                    let l2_base_pt = nodes[l2_base];
                    let l2_tip_idx = nodes.length;
                    nodes.push({ x: l2_base_pt.x + 0.32, y: l2_base_pt.y + 0.2, z: -0.15, type: 'leaf' });
                    connections.push([l2_base, l2_tip_idx, '#34d399', 2.0]);
                }
            }

            // Flower blossom bud at 100%
            if (p >= 100) {
                let topIdx = stemSegments;
                let topPt = nodes[topIdx];
                // Generate a beautiful rotating 3D flower sphere at the top tip
                let flowerNodesStart = nodes.length;
                let r = 0.08;
                for (let alpha = 0; alpha < Math.PI * 2; alpha += Math.PI / 3) {
                    nodes.push({
                        x: topPt.x + Math.cos(alpha) * r,
                        y: topPt.y + Math.sin(alpha) * r,
                        z: Math.sin(alpha * 2) * 0.05,
                        type: 'flower'
                    });
                    connections.push([topIdx, nodes.length - 1, '#f59e0b', 2.0]);
                }
                // Center bud
                nodes.push({ x: topPt.x, y: topPt.y, z: 0, type: 'flower-center' });
            }

            return { nodes, connections };
        }

        function draw() {
            if (!canvas.parentNode) {
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
                cancelAnimationFrame(animationFrameId);
                return;
            }
            let isElite = localStorage.getItem('krishi_elite_animations') !== 'false';
            if (!isElite || document.hidden) {
                setTimeout(function() {
                    animationFrameId = requestAnimationFrame(draw);
                }, 300);
                return;
            }

            let dpr = window.devicePixelRatio || 1;
            let w = canvas.parentElement.clientWidth || 100;
            let h = canvas.parentElement.clientHeight || 100;
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr; canvas.height = h * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            ctx.clearRect(0, 0, w, h);
            
            // Draw soil pot shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
            ctx.beginPath();
            ctx.ellipse(w/2, h - 16, 28, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            
            // Generate crop model dynamically
            let model = generateCrop3DVertices(percent);
            let projected = [];
            let cx = w / 2;
            let cy = h * 0.72; // Pot/base center
            let R = h * 0.7;    // Render scale

            // Project all 3D nodes
            model.nodes.forEach(node => {
                let p = node;
                p = window.Elite3D.rotateY(p, thetaY);
                p = window.Elite3D.rotateX(p, thetaX);
                let screenPt = window.Elite3D.project(p, cx, cy, R, 150);
                screenPt.type = node.type;
                projected.push(screenPt);
            });

            // Draw connections (Z-sorted for high-fidelity layering)
            model.connections.forEach(conn => {
                let p1 = projected[conn[0]];
                let p2 = projected[conn[1]];
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = conn[2];
                ctx.lineWidth = conn[3];
                ctx.lineCap = 'round';
                ctx.stroke();
            });

            // Draw blossoms and details
            projected.forEach(pt => {
                if (pt.type === 'flower-center') {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 4.5 * pt.scale, 0, Math.PI * 2);
                    ctx.fillStyle = '#f59e0b';
                    ctx.fill();
                } else if (pt.type === 'flower') {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 3 * pt.scale, 0, Math.PI * 2);
                    ctx.fillStyle = '#fbbf24';
                    ctx.fill();
                } else if (pt.type === 'leaf') {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 2.5 * pt.scale, 0, Math.PI * 2);
                    ctx.fillStyle = '#10b981';
                    ctx.fill();
                }
            });

            // Slowly spin if autoSpin active
            if (autoSpin) {
                thetaY += 0.008;
            }

            animationFrameId = requestAnimationFrame(draw);
        }
        draw();
    };

    // 2. 🧠 Premium 3D Holographic Syllabus Mastery Dome
    window.init3DSyllabusDome = function(canvas) {
        if (!canvas) return;
        let ctx = canvas.getContext('2d');
        let thetaX = -0.15;
        let thetaY = 0.5;
        let isDragging = false;
        let prevMouse = { x: 0, y: 0 };
        let autoSpin = true;
        let animationFrameId = null;

        function onDown(e) {
            isDragging = true; autoSpin = false;
            let clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let clientY = e.touches ? e.touches[0].clientY : e.clientY;
            prevMouse = { x: clientX, y: clientY };
        }
        function onMove(e) {
            if (!isDragging) return;
            let clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let clientY = e.touches ? e.touches[0].clientY : e.clientY;
            let dx = clientX - prevMouse.x;
            let dy = clientY - prevMouse.y;
            thetaY += dx * 0.006;
            thetaX += dy * 0.006;
            prevMouse = { x: clientX, y: clientY };
        }
        function onUp() {
            isDragging = false;
            setTimeout(() => { if (!isDragging) autoSpin = true; }, 3000);
        }

        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        canvas.addEventListener('touchstart', onDown, {passive: true});
        canvas.addEventListener('touchmove', onMove, {passive: true});
        window.addEventListener('touchend', onUp);

        let subjects = typeof window.getAllSubjects === 'function' ? window.getAllSubjects().slice(0, 5) : ['Agronomy', 'Soil Science', 'Horticulture', 'Plant Path'];
        if (subjects.length < 3) subjects = ['Agronomy', 'Soil Science', 'Horticulture', 'Plant Path'];

        function draw() {
            if (!canvas.parentNode) {
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
                cancelAnimationFrame(animationFrameId);
                return;
            }
            let isElite = localStorage.getItem('krishi_elite_animations') !== 'false';
            if (!isElite || document.hidden) {
                setTimeout(function() {
                    animationFrameId = requestAnimationFrame(draw);
                }, 300);
                return;
            }

            let dpr = window.devicePixelRatio || 1;
            let w = canvas.parentElement.clientWidth || 300;
            let h = 180;
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr; canvas.height = h * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            ctx.clearRect(0, 0, w, h);
            let cx = w / 2;
            let cy = h / 2;
            let R = 50;

            // Generate 3D Dome nodes (Core + Subject spherical layout)
            let nodes = [];
            // Core Center Node
            nodes.push({ x: 0, y: 0, z: 0, label: "Knowledge", color: '#4f46e5', r: 10, isCore: true });

            subjects.forEach((sub, idx) => {
                // spherical distribution angles
                let phi = Math.acos(-1 + (2 * idx) / subjects.length);
                let theta = Math.sqrt(subjects.length * Math.PI) * phi;
                
                let stats = window.localData.stats.subjectStats[sub] || {solved: 0, correct: 0};
                let acc = stats.solved > 0 ? Math.round((stats.correct / stats.solved) * 100) : 0;
                if (window.analyticsUseDemoMode) {
                    acc = [92, 85, 48, 42, 60][idx] || 70;
                }

                let color = acc >= 75 ? '#10b981' : (acc >= 50 ? '#f59e0b' : '#ef4444');
                let rad = 6 + (acc * 0.05);

                nodes.push({
                    x: Math.sin(phi) * Math.cos(theta),
                    y: Math.sin(phi) * Math.sin(theta),
                    z: Math.cos(phi),
                    label: sub.split(' ')[0],
                    color: color,
                    r: rad,
                    shake: acc < 50
                });
            });

            // Project all 3D nodes
            let projected = [];
            nodes.forEach((node, idx) => {
                let p = { x: node.x, y: node.y, z: node.z };
                if (!node.isCore) {
                    p = window.Elite3D.rotateY(p, thetaY);
                    p = window.Elite3D.rotateX(p, thetaX);
                }
                let screenPt = window.Elite3D.project(p, cx, cy, R, 120);
                screenPt.label = node.label;
                screenPt.color = node.color;
                screenPt.r = node.r;
                screenPt.isCore = node.isCore;
                screenPt.shake = node.shake;
                screenPt.origIdx = idx;
                projected.push(screenPt);
            });

            // Z-Sort nodes to render connection lines correctly
            let core = projected[0];
            
            // Draw connection lines with pulsing lasers
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = document.documentElement.classList.contains('dark') ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.6)';
            
            for (let i = 1; i < projected.length; i++) {
                let target = projected[i];
                ctx.beginPath();
                ctx.moveTo(core.x, core.y);
                ctx.lineTo(target.x, target.y);
                ctx.stroke();
            }

            // Glowing synaptic lasers traveling along connection lines
            let baseFreq = (window.EliteAnimsConfig && typeof window.EliteAnimsConfig.laserSignalFrequency !== 'undefined') ? window.EliteAnimsConfig.laserSignalFrequency : 1.0;
            let activeFreq = window.EliteAnimsConfig.throttled ? baseFreq * 0.5 : baseFreq;
            let tPulse = (Date.now() * 0.002 * activeFreq) % 1.0;
            
            for (let i = 1; i < projected.length; i++) {
                let target = projected[i];
                let px = core.x + (target.x - core.x) * tPulse;
                let py = core.y + (target.y - core.y) * tPulse;
                
                ctx.beginPath();
                ctx.arc(px, py, 2.0, 0, Math.PI * 2);
                ctx.fillStyle = '#10b981';
                ctx.shadowBlur = 4;
                ctx.shadowColor = '#10b981';
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            // Draw sphere nodes (Z-sorted: draw background nodes first)
            let sortedDraw = projected.slice().sort((a, b) => b.z - a.z);
            sortedDraw.forEach(node => {
                ctx.save();
                
                // Shake weak nodes slightly
                if (node.shake) {
                    let shakeOffset = Math.sin(Date.now() * 0.04 + node.origIdx) * 1.0;
                    ctx.translate(shakeOffset, 0);
                }

                // Node bubble
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.r * node.scale, 0, Math.PI * 2);
                ctx.fillStyle = node.color;
                ctx.fill();

                // Core outline pulse glow
                if (node.isCore) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, (node.r + Math.sin(Date.now() * 0.005) * 2.5) * node.scale, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(79, 70, 229, 0.25)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }

                // Floating label
                ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#f1f5f9' : '#1e293b';
                ctx.font = node.isCore ? 'bold 8px sans-serif' : 'bold 7.5px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(node.label, node.x, node.y + (node.r * node.scale) + 9);
                ctx.restore();
            });

            if (autoSpin) {
                thetaY += 0.005;
            }

            animationFrameId = requestAnimationFrame(draw);
        }
        draw();
    };

    // 3. 📅 Premium 3D Cylindrical Crop Wheel Carousel
    window.init3DSeasonalCarousel = function(canvas) {
        if (!canvas) return;
        let ctx = canvas.getContext('2d');
        let activeIdx = 0;
        let targetAngle = 0;
        let currentAngle = 0;
        let animationFrameId = null;

        const seasons = [
            { name: "वर्षा (Kharif)", crops: "धान, मकै, कोदो, भटमास", color: '#10b981', tip: "यो मौसममा सिंचाइ र ढुसीजन्य रोगको बढी सम्भावना हुन्छ।", baseAngle: 0 },
            { name: "शरद (Autumn)", crops: "तोरी, आलु, सागपात, मुसुरो", color: '#fbbf24', tip: "यो माटोमा मल र नाइट्रोजन मिलाउने मुख्य समय हो।", baseAngle: 120 },
            { name: "वसन्त (Winter)", crops: "गहुँ, प्याज, गोलभेडा, चना", color: '#3b82f6', tip: "कीट नियन्त्रण (IPM) र सिंचाइ प्रश्नहरूमा बढी ध्यान दिनुहोस्।", baseAngle: 240 }
        ];

        // Attach globally available rotator function
        window.rotateSeasonal3DCarousel = function() {
            if (typeof window.triggerHaptic === 'function') {
                window.triggerHaptic('click');
            }
            activeIdx = (activeIdx + 1) % seasons.length;
            targetAngle = activeIdx * 120; // Rotate cylindrical carousel
            
            // Sync with global ambient crop season logic
            if (typeof window.updateActiveSeasonIndex === 'function') {
                window.updateActiveSeasonIndex(activeIdx);
            }
            
            updateCarouselTextUI();
        };

        function updateCarouselTextUI() {
            let current = seasons[activeIdx];
            let cropsEl = document.getElementById('carousel-3d-crops');
            let tipEl = document.getElementById('carousel-3d-tip');
            if (cropsEl) cropsEl.textContent = current.crops;
            if (tipEl) tipEl.textContent = current.tip;
        }

        function draw() {
            if (!canvas.parentNode) {
                cancelAnimationFrame(animationFrameId);
                return;
            }
            let isElite = localStorage.getItem('krishi_elite_animations') !== 'false';
            if (!isElite || document.hidden) {
                setTimeout(function() {
                    animationFrameId = requestAnimationFrame(draw);
                }, 300);
                return;
            }

            let dpr = window.devicePixelRatio || 1;
            let w = canvas.parentElement.clientWidth || 280;
            let h = 100; // Cylindrical height
            if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
                canvas.width = w * dpr; canvas.height = h * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            ctx.clearRect(0, 0, w, h);
            let cx = w / 2;
            let cy = h / 2;
            let R = w * 0.28; // Cylinder radius

            // Linear interpolation for smooth springy spin rotation
            currentAngle += (targetAngle - currentAngle) * 0.08;

            let projected = [];
            seasons.forEach((s, idx) => {
                // Angular offset on cylinder
                let angle = ((s.baseAngle - currentAngle) * Math.PI) / 180;
                
                // 3D Cylinder coordinates
                let p = {
                    x: Math.sin(angle),
                    y: 0,
                    z: Math.cos(angle)
                };
                
                let screenPt = window.Elite3D.project(p, cx, cy, R, 130);
                screenPt.name = s.name;
                screenPt.color = s.color;
                screenPt.isActive = idx === activeIdx;
                projected.push(screenPt);
            });

            // Z-Sort (Draw back cards first)
            let sorted = projected.slice().sort((a, b) => b.z - a.z);

            sorted.forEach(node => {
                ctx.save();
                
                // Card sizing based on 3D depth scale
                let cardW = 75 * node.scale;
                let cardH = 32 * node.scale;
                
                ctx.translate(node.x, node.y);
                
                // Draw rounded glassmorphic card base
                ctx.beginPath();
                ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 8 * node.scale);
                
                let isDark = document.documentElement.classList.contains('dark');
                if (node.isActive) {
                    ctx.fillStyle = node.color + '1a'; // High transparency glow
                    ctx.strokeStyle = node.color;
                    ctx.lineWidth = 2 * node.scale;
                } else {
                    ctx.fillStyle = isDark ? 'rgba(30, 41, 59, 0.35)' : 'rgba(241, 245, 249, 0.45)';
                    ctx.strokeStyle = isDark ? 'rgba(51, 65, 85, 0.25)' : 'rgba(226, 232, 240, 0.35)';
                    ctx.lineWidth = 1 * node.scale;
                }
                ctx.fill();
                ctx.stroke();

                // Draw Text
                ctx.fillStyle = node.isActive ? (isDark ? '#f1f5f9' : '#1e293b') : 'rgba(100, 116, 139, 0.6)';
                ctx.font = node.isActive ? `bold ${9 * node.scale}px sans-serif` : `${8 * node.scale}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(node.name, 0, 0);
                
                ctx.restore();
            });

            animationFrameId = requestAnimationFrame(draw);
        }
        
        // Initial setup trigger
        updateCarouselTextUI();
        draw();
    };
})();
