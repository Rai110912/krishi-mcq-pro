import os
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(script_dir)
app_js_path = os.path.join(project_dir, 'js', 'app.js')

with open(app_js_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print("Dumping lines 12110 to 12345 of js/app.js:")
print("--------------------------------------------------------------------------------")
for i in range(12109, min(12345, len(lines))):
    print(f"{i+1:5d}: {lines[i]}", end="")
print("--------------------------------------------------------------------------------")
