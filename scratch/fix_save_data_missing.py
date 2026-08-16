import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add missing saveData() in submitMCQAnswer
pattern = r"(localData\.wrongLog\[targetId\] = \{ action: 'remove', timestamp: Date\.now\(\), _rev: rev \+ 1 \};\s*\n\s*)(\})"
replacement = r"\1    saveData();\n\2"

new_content = re.sub(pattern, replacement, content, count=1)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
