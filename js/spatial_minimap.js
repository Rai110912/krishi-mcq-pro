(function() {
    // Isolated Spatial Minimap Component for Krishi MCQ Pro
    const SECTIONS = [
        { id: 'practice-sec-overview', label: 'Overview', icon: '🏠' },
        { id: 'practice-sec-custom', label: 'Custom Setup', icon: '⚙️' },
        { id: 'practice-sec-smart', label: 'Smart Engine', icon: '⚡' },
        { id: 'practice-sec-subjects', label: 'Subjects Grid', icon: '📚' },
        { id: 'practice-sec-history', label: 'History Logs', icon: '🕒' }
    ];

    let observer = null;

    function init() {
        createHUD();
        setupObserver();
        
        // Listen to scroll and page navigation changes
        window.addEventListener('scroll', checkPageVisibility, { passive: true });
        
        // Setup a MutationObserver to watch when 'page-practice' class list changes (active/inactive)
        const practicePage = document.getElementById('page-practice');
        if (practicePage) {
            const pageObserver = new MutationObserver(checkPageVisibility);
            pageObserver.observe(practicePage, { attributes: true, attributeFilter: ['class', 'style'] });
        }
        
        checkPageVisibility();
    }

    function createHUD() {
        if (document.getElementById('spatial-minimap-hud')) return;

        const hud = document.createElement('div');
        hud.id = 'spatial-minimap-hud';
        hud.className = 'fixed right-3 top-1/3 z-[49] flex flex-col items-center gap-3 p-2.5 rounded-full border shadow-lg backdrop-blur-md opacity-0 pointer-events-none transition-all duration-300 transform translate-x-4';
        hud.style.background = 'rgba(255, 255, 255, 0.75)';
        hud.style.borderColor = 'var(--border)';

        // Add class support for dark mode matching
        if (document.documentElement.classList.contains('dark')) {
            hud.style.background = 'rgba(15, 23, 42, 0.75)';
        }

        SECTIONS.forEach((sec, idx) => {
            const anchor = document.createElement('button');
            anchor.className = 'w-3 h-3 rounded-full bg-slate-300 dark:bg-slate-700 relative hover:scale-125 transition-all duration-200 cursor-pointer active:scale-90';
            anchor.id = `minimap-dot-${sec.id}`;
            anchor.setAttribute('aria-label', `Scroll to ${sec.label}`);
            
            // Hover Tooltip Container
            const tooltip = document.createElement('span');
            tooltip.className = 'absolute right-6 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg text-[9px] font-black text-white dark:text-slate-200 bg-slate-900/90 dark:bg-slate-950 border border-slate-700/30 whitespace-nowrap opacity-0 pointer-events-none translate-x-2 transition-all duration-200 shadow-md';
            tooltip.innerHTML = `${sec.icon} ${sec.label}`;
            
            anchor.appendChild(tooltip);

            // Show Tooltip on Hover/Touch
            anchor.onmouseenter = () => {
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateY(-50%) translateX(0)';
            };
            anchor.onmouseleave = () => {
                tooltip.style.opacity = '0';
                tooltip.style.transform = 'translateY(-50%) translateX(8px)';
            };
            
            // Click to Warp Scroll
            anchor.onclick = (e) => {
                e.preventDefault();
                const target = document.getElementById(sec.id);
                if (target) {
                    // Smooth warp-scroll to target with top offset for header
                    const headerOffset = 70;
                    const elementPosition = target.getBoundingClientRect().top + window.pageYOffset;
                    const offsetPosition = elementPosition - headerOffset;
                    
                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });
                    
                    if (typeof triggerHaptic === 'function') triggerHaptic('click');
                    if (typeof playSound === 'function') playSound('click');
                }
            };

            hud.appendChild(anchor);
        });

        document.body.appendChild(hud);
    }

    function setupObserver() {
        if (observer) observer.disconnect();

        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const activeId = entry.target.id;
                    highlightDot(activeId);
                }
            });
        }, {
            root: null,
            rootMargin: '-20% 0px -60% 0px', // Precise middle-focused observation
            threshold: 0
        });

        SECTIONS.forEach(sec => {
            const el = document.getElementById(sec.id);
            if (el) observer.observe(el);
        });
    }

    function highlightDot(activeId) {
        SECTIONS.forEach(sec => {
            const dot = document.getElementById(`minimap-dot-${sec.id}`);
            if (dot) {
                if (sec.id === activeId) {
                    dot.style.background = 'var(--primary)';
                    dot.style.transform = 'scale(1.35)';
                    dot.style.boxShadow = '0 0 8px var(--primary)';
                } else {
                    dot.style.background = '';
                    dot.style.transform = '';
                    dot.style.boxShadow = '';
                }
            }
        });
    }

    function checkPageVisibility() {
        const practicePage = document.getElementById('page-practice');
        const hud = document.getElementById('spatial-minimap-hud');
        if (!practicePage || !hud) return;

        // Sync dark mode style dynamically
        if (document.documentElement.classList.contains('dark')) {
            hud.style.background = 'rgba(15, 23, 42, 0.75)';
        } else {
            hud.style.background = 'rgba(255, 255, 255, 0.75)';
        }

        const isVisible = window.getComputedStyle(practicePage).display !== 'none';
        if (isVisible) {
            hud.classList.remove('opacity-0', 'pointer-events-none', 'translate-x-4');
            hud.classList.add('opacity-100', 'translate-x-0');
        } else {
            hud.classList.add('opacity-0', 'pointer-events-none', 'translate-x-4');
            hud.classList.remove('opacity-100', 'translate-x-0');
        }
    }

    // Mount on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
