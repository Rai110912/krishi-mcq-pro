import re

with open('js/pwa_helpers.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Reset lapses on correct answer
old_correct = """        } else {
            if (timeSpentSec <= 5) {"""

new_correct = """        } else {
            existing.lapses = 0; // Reset consecutive lapses on correct answer
            if (timeSpentSec <= 5) {"""

content = content.replace(old_correct, new_correct)

# Fix 2: Require reviews >= 4 for mastered
old_master = """        // Mark as mastered if interval > 21 days
        if (nextInterval >= 21 && status === 'scheduled') {"""

new_master = """        // Mark as mastered if interval >= 21 days and reviews >= 4
        if (nextInterval >= 21 && reviews >= 4 && status === 'scheduled') {"""

content = content.replace(old_master, new_master)

with open('js/pwa_helpers.js', 'w', encoding='utf-8') as f:
    f.write(content)
