import re
import os

def extract_js_bindings():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    js_dir = os.path.join(project_dir, 'js')
    
    defined_funcs = set()
    
    # Let's list all JS files in the js folder
    for file in os.listdir(js_dir):
        if file.endswith('.js'):
            filepath = os.path.join(js_dir, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Pattern 1: standard function declaration
            for f_name in re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', content):
                defined_funcs.add(f_name)
                
            # Pattern 2: var/let/const declaration
            for f_name in re.findall(r'(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\()', content):
                defined_funcs.add(f_name)
                
            # Pattern 3: window.name = function or window['name'] = function
            for f_name in re.findall(r'window\.([a-zA-Z0-9_]+)\s*=\s*(?:function|\()', content):
                defined_funcs.add(f_name)
            for f_name in re.findall(r"window\['([a-zA-Z0-9_]+)'\]\s*=\s*(?:function|\()", content):
                defined_funcs.add(f_name)
            for f_name in re.findall(r'window\."([a-zA-Z0-9_]+)"\s*=\s*(?:function|\()', content):
                defined_funcs.add(f_name)
                
    # Also find function bindings inside <script> tags in index.html
    html_path = os.path.join(project_dir, 'index.html')
    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()
        
    script_blocks = re.findall(r'<script.*?>((?:(?!</script>).)*)</script>', html_content, re.DOTALL)
    for block in script_blocks:
        for f_name in re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', block):
            defined_funcs.add(f_name)
        for f_name in re.findall(r'(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\()', block):
            defined_funcs.add(f_name)
        for f_name in re.findall(r'window\.([a-zA-Z0-9_]+)\s*=\s*(?:function|\()', block):
            defined_funcs.add(f_name)
            
    # Now find all inline handlers in index.html
    # Handlers can look like onchange="funcName(this.checked)" or onclick="funcName()"
    # Let's extract any word followed by '(' or ';' or space inside on[a-z]+="..."
    inline_calls = []
    # Match onXXX="..."
    for match in re.finditer(r'\bon[a-z]+=["\']([^"\']+)["\']', html_content):
        handler_code = match.group(1)
        # Find potential function calls (words followed by optional spaces and parentheses)
        for func_call in re.findall(r'\b([a-zA-Z0-9_]+)\s*\(', handler_code):
            inline_calls.append(func_call)
            
    # Check which calls are not in defined_funcs
    missing = []
    ignored = ['console', 'alert', 'event', 'preventDefault', 'stopPropagation', 'confirm', 'this', 'true', 'false', 'document', 'window', 'Number', 'parseInt', 'parseFloat', 'String', 'Boolean']
    for c in set(inline_calls):
        if c in ignored:
            continue
        if c not in defined_funcs:
            missing.append(c)
            
    print(f"Total defined functions in JS: {len(defined_funcs)}")
    print(f"Total inline event handler functions used: {len(set(inline_calls))}")
    print("\nMissing or Undefined Event Handlers:")
    if missing:
        for m in sorted(missing):
            print(f"- {m} is called inline but NOT defined in any JS files.")
    else:
        print("✓ All inline event handler functions are fully defined and bound!")

if __name__ == '__main__':
    extract_js_bindings()
