import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Make sure q-timer-display and per-q-timer-display are shown robustly
content = content.replace("function showTimer(){", "function showTimer(){\n        console.log('Showing global timer');\n        let el = document.getElementById('q-timer-display');\n        if(el) {\n            el.classList.remove('hidden');\n            el.style.display = 'inline-block';\n        }")

# Fix perQIndicator hidden
content = content.replace("perQIndicator.classList.remove('hidden');", "perQIndicator.classList.remove('hidden');\n            perQIndicator.style.display = 'inline-block';")

# Replace hideTimer to be robust
content = re.sub(
    r"function hideTimer\(\)\{.*?\}",
    "function hideTimer(){\n        console.log('Hiding global timer');\n        let el = document.getElementById('q-timer-display');\n        if(el) {\n            el.classList.add('hidden');\n            el.style.display = 'none';\n        }\n        let fb = document.getElementById('finish-btn');\n        if(fb) fb.classList.add('hidden');\n    }",
    content,
    flags=re.DOTALL
)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
