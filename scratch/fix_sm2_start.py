import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

old_sm2 = """            pool = shuffle(pool).slice(0, 15);
            config.count = pool.length;
            showToast(`🧠 SM-2 Memory Refresh: ${pool.length} वटा प्रश्नहरू अभ्यासका लागि तयार भए!`);
        }"""

new_sm2 = """            pool = shuffle(pool).slice(0, 15);
            config.count = pool.length;
            config.isSpacedReview = true;
            showToast(`🧠 SM-2 Memory Refresh: ${pool.length} वटा प्रश्नहरू अभ्यासका लागि तयार भए!`);
        }"""

content = content.replace(old_sm2, new_sm2)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
