import re
import sys
from collections import Counter

# Reconfigure stdout to use UTF-8 to prevent cp1252 print errors on Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

def run_qa_audit():
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(script_dir, 'index.html')
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()

    print("==================================================")
    print("         Senior Frontend QA Audit Report          ")
    print("==================================================")

    # 1. Extract all defined JS functions (HTML inline + external split files)
    script_blocks = re.findall(r'<script.*?>((?:(?!</script>).)*)</script>', content, re.DOTALL)
    
    # Read modular split files from js/ directory, ignoring compatibility libraries
    external_js = []
    js_folder = os.path.join(script_dir, 'js')
    if os.path.exists(js_folder):
        for file in os.listdir(js_folder):
            if file.endswith('.js') and not file.startswith('firebase-'):
                try:
                    with open(os.path.join(js_folder, file), 'r', encoding='utf-8') as js_f:
                        external_js.append(js_f.read())
                except Exception as e:
                    print(f"Warning: Failed to read external js file {file}: {e}")
                    
    js_content = "\n".join(script_blocks + external_js)
    
    defined_funcs = set()
    # Standard: function name(
    for f in re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', js_content):
        defined_funcs.add(f)
    # Const/let: const name = ( or const name = function(
    for f in re.findall(r'(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\()', js_content):
        defined_funcs.add(f)
        
    print(f"Total JavaScript functions defined: {len(defined_funcs)}")

    # 2. Extract all inline event handlers (onclick, onchange, etc.)
    # Catch onclick="funcName(..." or onclick='funcName(...' or onclick="funcName"
    handlers = re.findall(r'\bon[a-z]+=["\']\s*([a-zA-Z0-9_]+)\s*(?:\(|;|\b)', content)
    
    # Let's check for broken buttons/handlers
    broken_handlers = []
    for h in set(handlers):
        # Ignore basic JS keywords/statements inside handlers (like console, alert, event, playSound, setPlanMode)
        if h in ['console', 'alert', 'event', 'preventDefault', 'stopPropagation', 'confirm', 'this', 'true', 'false', 'document', 'window']:
            continue
        if h not in defined_funcs:
            broken_handlers.append(h)

    print("\n[Audit 1: Broken Handlers / Missing Functions]")
    if broken_handlers:
        print(f"Potential missing or broken functions called by inline event handlers:")
        for h in broken_handlers:
            print(f"- Handler references '{h}', but it is not defined in global JS scope.")
    else:
        print("✓ All inline event handlers map to defined JavaScript functions!")

    # 3. Check HTML structural tags (unclosed divs)
    # Let's count open/close tags for main structural elements
    print("\n[Audit 2: Structural Tag Counts]")
    tags_to_check = ['div', 'section', 'main', 'header', 'footer', 'span', 'button', 'ul', 'ol', 'li']
    for tag in tags_to_check:
        open_count = len(re.findall(rf'<{tag}\b', content))
        close_count = len(re.findall(rf'</{tag}>', content))
        diff = open_count - close_count
        status = "✓ Clean" if diff == 0 else f"⚠️ Mismatch! ({diff} unclosed or extra)"
        print(f"- <{tag}>: Open={open_count}, Close={close_count} | {status}")

    # 4. Check CSS Fixed/Sticky and High Z-Index elements
    print("\n[Audit 3: Sticky, Fixed, and High z-index CSS Audit]")
    style_blocks = re.findall(r'<style.*?>(.*?)</style>', content, re.DOTALL)
    css_content = "\n".join(style_blocks)
    
    # Let's find z-index properties
    z_indices = re.findall(r'z-index\s*:\s*([0-9\-]+)', css_content)
    high_z = [int(z) for z in z_indices if int(z) > 10]
    if high_z:
        print(f"- Found {len(high_z)} instances of high z-index values (> 10) in styles: {sorted(list(set(high_z)))}")
        print("  (Note: Make sure these do not block mobile overlay backdrops or click events).")
    else:
        print("✓ No excessively high z-indices found in inline CSS styles.")

    # Find position properties
    positions = re.findall(r'position\s*:\s*(fixed|sticky)', css_content)
    if positions:
        print(f"- Found position layout rules in custom CSS styles: {Counter(positions)}")
    else:
        print("✓ No raw position: fixed/sticky layout rules in custom styles (mostly handled by Tailwind CSS classes).")

    # 5. Check localStorage key counts
    ls_keys = re.findall(r'localStorage\.(?:getItem|setItem|removeItem)\([\'"]([^\'"]+)[\'"]', content)
    print("\n[Audit 4: LocalStorage Keys Used]")
    print(f"- Total localStorage keys referenced: {len(set(ls_keys))}")
    print(f"- Key names: {sorted(list(set(ls_keys)))}")

if __name__ == '__main__':
    run_qa_audit()
