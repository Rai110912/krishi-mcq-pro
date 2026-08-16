import re

with open('js/pwa_helpers.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix D = existing.difficulty - (grade - 2.5) to (grade - 2)
pattern1 = r"let D = existing\.difficulty - \(grade - 2\.5\);"
replacement1 = r"let D = existing.difficulty - (grade - 2);"
content = re.sub(pattern1, replacement1, content)

with open('js/pwa_helpers.js', 'w', encoding='utf-8') as f:
    f.write(content)


with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix retention calculation for mastered cards
pattern2 = r"if \(x\.retrievability\) \{"
replacement2 = r"""if (x.status === 'mastered') {
                            totalR += 0.95; // Mastered cards assumed highly retained
                        } else if (x.status === 'suspended') {
                            totalR += 0.50; // Leeches are poorly retained
                        } else if (x.retrievability) {"""

content = re.sub(pattern2, replacement2, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
