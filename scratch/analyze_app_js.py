import re
import os

def analyze_app_code():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    app_js_path = os.path.join(project_dir, 'js', 'app.js')
    
    if not os.path.exists(app_js_path):
        print(f"Error: {app_js_path} does not exist.")
        return
        
    with open(app_js_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    js_content = "".join(lines)
    
    print("==================================================")
    print("         Deep js/app.js Code Analysis             ")
    print("==================================================")
    
    # 1. Look for comments indicating incomplete, disabled, or debug code
    comments = []
    for idx, line in enumerate(lines):
        clean = line.strip()
        if clean.startswith('//'):
            comments.append((idx + 1, clean))
            
    # Search for patterns indicating disabled flows, WIP, placeholders
    alert_keywords = ['disable', 'bypass', 'mock', 'placeholder', 'dummy', 'todo', 'wip', 'temp', 'comment out', 'remove for production', 'debug']
    found_alerts = []
    for line_num, comment in comments:
        comment_lower = comment.lower()
        matched_keys = [kw for kw in alert_keywords if kw in comment_lower]
        if matched_keys:
            found_alerts.append((line_num, comment, matched_keys))
            
    print(f"\n[Audit 1: Flagged Comments in js/app.js ({len(found_alerts)} found)]")
    for line_num, comment, keys in found_alerts[:30]:  # Limit output
        print(f"Line {line_num:5d} | {comment}  (Keywords: {keys})")
    if len(found_alerts) > 30:
        print(f"... and {len(found_alerts) - 30} more flagged comments.")
        
    # 2. Check for firebase initialization and loading flows
    print("\n[Audit 2: Firebase and Integration Loaders]")
    firebase_mentions = []
    for idx, line in enumerate(lines):
        if 'firebase' in line.lower() or 'firestore' in line.lower():
            if 'init' in line.lower() or 'load' in line.lower() or 'configure' in line.lower() or 'config' in line.lower():
                firebase_mentions.append((idx + 1, line.strip()))
                
    for line_num, text in firebase_mentions[:15]:
        print(f"Line {line_num:5d} | {text}")
        
    # 3. Search for functions that might be commented out or inactive
    # (e.g. function calls inside comments, or disabled functions)
    print("\n[Audit 3: Inactive/Bypassed features]")
    inactive_patterns = [
        r'//\s*[a-zA-Z0-9_]+\s*\(',
        r'/\*\s*[a-zA-Z0-9_]+\s*\(',
        r'console\.log\(.*debug'
    ]
    for pattern in inactive_patterns:
        matches = re.findall(pattern, js_content)
        print(f"- Pattern '{pattern}': found {len(matches)} occurrences")
        
    # 4. Check for double/multiple declarations of variables/functions or duplicate functions
    # Let's count standard function declarations
    func_decls = re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', js_content)
    func_counts = {}
    for f in func_decls:
        func_counts[f] = func_counts.get(f, 0) + 1
        
    duplicates = {k: v for k, v in func_counts.items() if v > 1}
    print("\n[Audit 4: Duplicate Function Declarations]")
    if duplicates:
        for f, count in duplicates.items():
            print(f"- Function '{f}' is declared {count} times in js/app.js!")
    else:
        print("✓ No duplicate standard function declarations in js/app.js.")

if __name__ == '__main__':
    analyze_app_code()
