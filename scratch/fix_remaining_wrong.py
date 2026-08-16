import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Define the helper function logic string
filter_logic = "(localData.wrong || []).filter(id => !(window.KrishiSM2Engine ? new Set(window.KrishiSM2Engine.getDueQuestions(getAllQuestions()).map(q => String(q.id || q.q))) : new Set()).has(String(id))).length"

# Line 1802
content = content.replace(
    "if (statMistakes) statMistakes.innerText = localData.wrong ? localData.wrong.length : 0;",
    f"if (statMistakes) statMistakes.innerText = {filter_logic};"
)

# Line 10135
content = content.replace(
    "let incorrects = localData.wrong ? localData.wrong.length : 0;",
    f"let incorrects = {filter_logic};"
)

# Line 11905
content = content.replace(
    "let wrongCount = Math.min(15, localData.wrong.length);",
    f"let wrongCount = Math.min(15, {filter_logic});"
)

# Line 12979 & 12980
old_rep = """                    if (localData.wrong.length > 0) {
                        repMistakeEl.textContent = `You currently have ${localData.wrong.length} pending incorrect questions requiring correction.`;"""
new_rep = f"""                    let _filteredWr = {filter_logic};
                    if (_filteredWr > 0) {{
                        repMistakeEl.textContent = `You currently have ${{_filteredWr}} pending incorrect questions requiring correction.`;"""
content = content.replace(old_rep, new_rep)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
