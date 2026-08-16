import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix startSpacedReview to exclude localData.wrong from random new question pool
pattern = r"            let newQs = allQ\.filter\(q => \{\s*let id = q\.id \|\| q\.q;\s*return !data\[id\] \|\| data\[id\]\.status === 'new';\s*\}\);"

replacement = """            let newQs = allQ.filter(q => {
                let id = String(q.id || q.q);
                let isWrong = localData.wrong && localData.wrong.some(wid => String(wid) === id);
                return (!data[id] || data[id].status === 'new') && !isWrong;
            });"""

content = re.sub(pattern, replacement, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
