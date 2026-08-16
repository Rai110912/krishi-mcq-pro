import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_count = "let wrongCount = localData.wrong ? localData.wrong.length : 0;"
new_count = """let activeDueSetGlobal = window.KrishiSM2Engine ? new Set(window.KrishiSM2Engine.getDueQuestions(getAllQuestions()).map(q => String(q.id || q.q))) : new Set();
        let wrongCount = (localData.wrong || []).filter(id => !activeDueSetGlobal.has(String(id))).length;"""

content = content.replace(old_count, new_count)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
