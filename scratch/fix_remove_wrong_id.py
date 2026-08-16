import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace removeWrongId(${q.id}) with removeWrongId('${q.id || q.q}')
pattern = r"removeWrongId\(\$\{q\.id\}\)"
replacement = r"removeWrongId('${q.id || q.q}')"
content = re.sub(pattern, replacement, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
