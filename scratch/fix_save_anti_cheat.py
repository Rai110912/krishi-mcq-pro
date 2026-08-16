import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_save = """        // Fix: Prevent saving if the session is already finished or finishing
        let realCurrent = state.currentIndex || 0;
        if (state.sessionResults && state.sessionResults.length > realCurrent) {
            realCurrent = state.sessionResults.length;
        }
        if (state && state.questions && state.questions.length > 0 && realCurrent < state.questions.length && !state.isFinishing) {"""

new_save = """        // Fix: Prevent saving if the session is finishing
        if (state && state.questions && state.questions.length > 0 && !state.isFinishing) {"""

content = content.replace(old_save, new_save)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
