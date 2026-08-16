import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_finish = """    function finishSession(){
       clearPracticeProgress();
        if (state.perQuestionTimerInterval) {"""

new_finish = """    function finishSession(){
       state.isFinishing = true;
       clearPracticeProgress();
        if (state.perQuestionTimerInterval) {"""

content = content.replace(old_finish, new_finish)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
