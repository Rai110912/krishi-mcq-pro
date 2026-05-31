import os
import sys

# Reconfigure stdout to use UTF-8
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

# Let's find where 'async function loadFirebaseSDKs()' is
start_idx = -1
for idx, line in enumerate(lines):
    if 'async function loadFirebaseSDKs()' in line:
        start_idx = idx
        break

if start_idx == -1:
    print("Could not find loadFirebaseSDKs function declaration. Printing lines 820-860 instead:")
    start_idx = 820
else:
    print(f"Found loadFirebaseSDKs at line {start_idx + 1}")

start = max(0, start_idx - 5)
end = min(len(lines), start_idx + 45)

print("Dumping loadFirebaseSDKs function surrounding lines:")
print("--------------------------------------------------------------------------------")
for i in range(start, end):
    print(f"{i+1:5d}: {lines[i]}", end="")
print("--------------------------------------------------------------------------------")
