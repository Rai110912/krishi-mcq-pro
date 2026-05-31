import re
import os

def analyze_app_js():
    js_path = r"d:\Downloads\test file of Mcq pro\js\app.js"
    if not os.path.exists(js_path):
        print(f"Error: {js_path} does not exist")
        return

    with open(js_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    print(f"Total lines: {len(lines)}")
    
    # Check for empty catch blocks
    empty_catches = []
    for i, line in enumerate(lines):
        if re.search(r'catch\s*\(\s*[a-zA-Z0-9_]*\s*\)\s*\{\s*\}', line):
            empty_catches.append(i + 1)
            
    print(f"Empty catch blocks found: {len(empty_catches)}")
    print(f"Lines: {empty_catches[:20]}...")

    # Let's count duplicate function definitions
    func_defs = {}
    func_regex = r'(?:function\s+([a-zA-Z0-9_]+)|(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\([^)]*\)\s*=>))'
    for i, line in enumerate(lines):
        match = re.search(func_regex, line)
        if match:
            name = match.group(1) or match.group(2)
            if name:
                if name not in func_defs:
                    func_defs[name] = []
                func_defs[name].append(i + 1)

    duplicates = {k: v for k, v in func_defs.items() if len(v) > 1}
    print(f"\nDuplicate function definitions found: {len(duplicates)}")
    for name, line_nums in duplicates.items():
        print(f"- {name}: defined at lines {line_nums}")

    # Let's search for potential null/undefined accessors
    # E.g. document.getElementById('some-id').addEventListener or .style or .innerHTML without check
    null_risks = []
    for i, line in enumerate(lines):
        if 'document.getElementById(' in line:
            # check if it does unsafe property access on the same line
            # e.g., document.getElementById('...').style or .innerHTML or .value or .classList
            if re.search(r'document\.getElementById\([^)]+\)\.(?:style|innerHTML|value|classList|addEventListener|innerText|textContent|onclick|disabled)', line):
                null_risks.append((i + 1, line.strip()))

    print(f"\nPotential Unsafe DOM Element property access on same line: {len(null_risks)}")
    for line_num, content in null_risks[:15]:
        print(f"Line {line_num}: {content}")

if __name__ == '__main__':
    analyze_app_js()
