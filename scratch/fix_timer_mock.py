import re
with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("if (isMock) { \n            showTimer();", "if (state.timerSec > 0) { \n            showTimer();")

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
