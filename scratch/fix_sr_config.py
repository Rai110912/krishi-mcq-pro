import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

clean_func = """    function startSpacedReview() {
        let pool = [];
        if (window.KrishiSM2Engine) {
            pool = window.KrishiSM2Engine.getDueQuestions(getAllQuestions());
        }
        if(pool.length === 0){ showToast('🎉 No spaced review items pending!'); return; }
        
        // Isolating Spaced Review config to prevent leakage from other practice modes
        state.activeConfig = {
            subject: 'all', topic: 'all', difficulty: 'all', count: 'all',
            timer: 'off', timerMin: 0, perQTimer: 'off', perQSec: 0,
            negativeMarking: 'off', feedback: 'immediate', shuffleQs: true, shuffleOpts: true
        };
        
        setupMCQSession(pool, false, 0);
    }"""
    
content = re.sub(r"    function startSpacedReview\(\)\s*\{[\s\S]*?setupMCQSession\(pool,\s*false,\s*0\);\s*\}", clean_func, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
