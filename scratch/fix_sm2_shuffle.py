import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: startSpacedReview
old_start = """    function startSpacedReview() {
        let pool = [];
        if (window.KrishiSM2Engine) {
            pool = window.KrishiSM2Engine.getDueQuestions(getAllQuestions());
        }
        if(pool.length === 0){ showToast('🎉 No spaced review items pending!'); return; }"""

new_start = """    function startSpacedReview() {
        let pool = [];
        let allQ = getAllQuestions();
        if (window.KrishiSM2Engine) {
            pool = window.KrishiSM2Engine.getDueQuestions(allQ);
        }
        
        if (pool.length === 0) {
            let data = window.KrishiSM2Engine ? window.KrishiSM2Engine._getData() : {};
            let newQs = allQ.filter(q => {
                let id = q.id || q.q;
                return !data[id] || data[id].status === 'new';
            });
            if (newQs.length > 0) {
                pool = typeof shuffle === 'function' ? shuffle(newQs).slice(0, 10) : newQs.slice(0, 10);
                showToast('No due reviews! Starting 10 new questions instead.');
            } else {
                showToast('🎉 No spaced review items pending!'); 
                return;
            }
        } else {
            if (typeof shuffle === 'function') pool = shuffle(pool);
        }"""
content = content.replace(old_start, new_start)

# Fix 2: startSmartPracticeMode('sm2')
old_sm2 = """        else if (mode === 'sm2') {
            if (window.KrishiSM2Engine) {
                pool = window.KrishiSM2Engine.getDueQuestions(allQ);
            }
            if (pool.length === 0) {
                showToast("🎉 सबै प्रश्नहरू कण्ठ छन्! आजका लागि सम्झनुपर्ने प्रश्न छैन।");
                return;
            }
            config.count = 'all'; // Default to all due
        }"""

new_sm2 = """        else if (mode === 'sm2') {
            if (window.KrishiSM2Engine) {
                pool = window.KrishiSM2Engine.getDueQuestions(allQ);
            }
            if (pool.length === 0) {
                let data = window.KrishiSM2Engine ? window.KrishiSM2Engine._getData() : {};
                let newQs = allQ.filter(q => {
                    let id = q.id || q.q;
                    return !data[id] || data[id].status === 'new';
                });
                if (newQs.length > 0) {
                    pool = typeof shuffle === 'function' ? shuffle(newQs).slice(0, 10) : newQs.slice(0, 10);
                    showToast('No due reviews! Starting 10 new questions instead.');
                } else {
                    showToast("🎉 सबै प्रश्नहरू कण्ठ छन्! आजका लागि सम्झनुपर्ने प्रश्न छैन।");
                    return;
                }
            } else {
                if (typeof shuffle === 'function') pool = shuffle(pool);
            }
            config.count = pool.length; // Update count properly
        }"""
content = content.replace(old_sm2, new_sm2)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
