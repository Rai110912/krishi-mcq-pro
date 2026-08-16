import re

with open('js/pwa_helpers.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_status = """        if (q < 3) {
            reviews = 0;
            nextInterval = 1;
        } else {
            reviews += 1;
            if (reviews === 1) nextInterval = 1;
            else if (reviews === 2) nextInterval = 6;
            else nextInterval = Math.round((existing.interval === 0 ? 1 : existing.interval) * newEF);
        }

        data[questionId] = {"""

new_status = """        if (q < 3) {
            reviews = 0;
            nextInterval = 1;
        } else {
            reviews += 1;
            if (reviews === 1) nextInterval = 1;
            else if (reviews === 2) nextInterval = 6;
            else nextInterval = Math.max(1, Math.round((existing.interval === 0 ? 1 : existing.interval) * newEF));
        }
        
        // Mark as mastered if interval > 21 days
        if (nextInterval >= 21 && status === 'scheduled') {
            status = 'mastered';
            feedback = "🏆 Mastered!";
        }

        data[questionId] = {"""

content = content.replace(old_status, new_status)

with open('js/pwa_helpers.js', 'w', encoding='utf-8') as f:
    f.write(content)
