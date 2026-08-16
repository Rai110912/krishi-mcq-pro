import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Clean up showTimer
clean_func = """    function showTimer(){
        console.log('Showing global timer');
        let el = document.getElementById('q-timer-display');
        if(el) {
            el.classList.remove('hidden');
            el.style.display = 'inline-block';
        }
    }"""
content = re.sub(r"    function showTimer\(\)\{.*?\}", clean_func, content, flags=re.DOTALL)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
