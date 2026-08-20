import codecs
import re

with codecs.open('js/app.js', 'r', 'utf-8') as f:
    content = f.read()

# Replace the first assignment
content = re.sub(
    r'historyContainer\.innerHTML = `(\s*<div[^>]*>\s*No recent practice runs yet[^<]*</div>\s*)`;',
    r'let newHtml = `\1`;\n            if (historyContainer.innerHTML !== newHtml) historyContainer.innerHTML = newHtml;',
    content
)

# Replace the second assignment
# We need to capture from historyList.slice to the .join('')
# It looks like: historyContainer.innerHTML = historyList.slice(0, 5).map(item => `...`).join('');
content = re.sub(
    r'historyContainer\.innerHTML = (historyList\.slice.*?\.join\(\'\'\));',
    r'let newHtml2 = \1;\n                if (historyContainer.innerHTML !== newHtml2) historyContainer.innerHTML = newHtml2;',
    content,
    flags=re.DOTALL
)

with codecs.open('js/app.js', 'w', 'utf-8') as f:
    f.write(content)

print('Success')
