import re
import os
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

def check_hygiene():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    js_dir = os.path.join(project_dir, 'js')
    
    print("==================================================")
    print("      Javascript Code Hygiene Audit Report        ")
    print("==================================================")
    
    for file in os.listdir(js_dir):
        if file.endswith('.js') and not file.startswith('firebase-') and not 'libs' in file:
            filepath = os.path.join(js_dir, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                
            print(f"\nAnalyzing file: js/{file}")
            
            # 1. Look for empty catch blocks
            empty_catches = re.findall(r'catch\s*\(\s*[a-zA-Z0-9_]*\s*\)\s*\{\s*\}', content)
            print(f"- Empty catch blocks (swallows errors): {len(empty_catches)}")
            
            # 2. Look for unreachable code after return
            # A simple regex pattern to find blocks like return; followed by code before the closing brace
            # This is hard to do precisely with regex, but we can look for return; statement followed by assignments or function calls
            lines = content.split('\n')
            unreachable_count = 0
            for idx in range(len(lines) - 1):
                line = lines[idx].strip()
                next_line = lines[idx + 1].strip()
                if line.startswith('return ') or line == 'return;':
                    # If next line is an assignment, console.log, or function call and doesn't close a brace
                    if next_line and not next_line.startswith('}') and not next_line.startswith('case') and not next_line.startswith('default') and not next_line.startswith('break'):
                        # Check if it is inside a block
                        if '=' in next_line or '(' in next_line:
                            unreachable_count += 1
            print(f"- Potential unreachable lines after return: {unreachable_count}")

            # 3. Look for obsolete or inactive functions
            # Find all functions containing "test" or "demo" or "dummy"
            funcs = re.findall(r'function\s+([a-zA-Z0-9_]*dummy|[a-zA-Z0-9_]*test|[a-zA-Z0-9_]*demo[a-zA-Z0-9_]*)\s*\(', content)
            print(f"- Functions matching test/demo/dummy keywords: {len(funcs)}")
            for fn in funcs:
                print(f"  * {fn}")

if __name__ == '__main__':
    check_hygiene()
