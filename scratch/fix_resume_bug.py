import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: checkAndPromptResumeSession
old_prompt = """            let total = session.questions ? session.questions.length : 0;
            let current = session.currentIndex || 0;
            let remaining = total - current;
            
            // If already completed or buggy state, discard session
            if (remaining <= 0 || total === 0) {"""

new_prompt = """            let total = session.questions ? session.questions.length : 0;
            let current = session.currentIndex || 0;
            
            // Fix: Account for Anti-Cheat auto-advance so completed sessions are silently discarded
            if (session.sessionResults && session.sessionResults.length > current) {
                current = session.sessionResults.length;
            }
            
            let remaining = total - current;
            
            // If already completed or buggy state, discard session
            if (remaining <= 0 || total === 0) {"""

content = content.replace(old_prompt, new_prompt)

# Fix 2: savePracticeProgress
old_save = """function savePracticeProgress() {
    try {
        if (state && state.questions && state.questions.length > 0) {"""

new_save = """function savePracticeProgress() {
    try {
        // Fix: Prevent saving if the session is already finished or finishing
        let realCurrent = state.currentIndex || 0;
        if (state.sessionResults && state.sessionResults.length > realCurrent) {
            realCurrent = state.sessionResults.length;
        }
        if (state && state.questions && state.questions.length > 0 && realCurrent < state.questions.length && !state.isFinishing) {"""

content = content.replace(old_save, new_save)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
