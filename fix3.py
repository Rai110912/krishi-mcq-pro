import codecs
import re

with codecs.open('js/app.js', 'r', 'utf-8') as f:
    content = f.read()

# For the empty state
old_empty = '''            if (historyList.length === 0) {
                historyContainer.innerHTML = `
                    <div class="col-span-full py-6 text-center text-slate-400 dark:text-slate-600 italic text-[10px] font-mono select-none">
                        No recent practice runs yet. Start your first session!
                    </div>
                `;
            }'''

new_empty = '''            let newHtml = '';
            if (historyList.length === 0) {
                newHtml = `
                    <div class="col-span-full py-6 text-center text-slate-400 dark:text-slate-600 italic text-[10px] font-mono select-none">
                        No recent practice runs yet. Start your first session!
                    </div>
                `;
            }'''

content = content.replace(old_empty, new_empty)

# For the else state
old_else = '''} else {
                historyContainer.innerHTML = historyList.slice(0, 5).map(item => `'''

new_else = '''} else {
                newHtml = historyList.slice(0, 5).map(item => `'''

content = content.replace(old_else, new_else)

# For the end of the else block
old_end = '''                `).join('');
            }
        }
    
        if (typeof translateAppLabels === 'function') {'''

new_end = '''                `).join('');
            }
            if (historyContainer.innerHTML !== newHtml) {
                historyContainer.innerHTML = newHtml;
            }
        }
    
        if (typeof translateAppLabels === 'function') {'''

content = content.replace(old_end, new_end)

with codecs.open('js/app.js', 'w', 'utf-8') as f:
    f.write(content)

print('Success')
