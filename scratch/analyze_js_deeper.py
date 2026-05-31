import re
import os

def analyze_deeper():
    js_path = r"d:\Downloads\test file of Mcq pro\js\app.js"
    with open(js_path, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.splitlines()

    print("==================================================")
    print("      Deeper Architectural Pattern Analysis       ")
    print("==================================================")

    # 1. Check for setInterval and setTimeout
    # Are they cleared? Do we have matching variables?
    intervals = []
    timeouts = []
    for i, line in enumerate(lines):
        if 'setInterval(' in line:
            intervals.append((i + 1, line.strip()))
        if 'setTimeout(' in line:
            timeouts.append((i + 1, line.strip()))

    print(f"\n[Pattern 1: Intervals ({len(intervals)})]")
    for line_num, l_content in intervals:
        print(f"Line {line_num}: {l_content}")

    print(f"\n[Pattern 2: Timeouts ({len(timeouts)})]")
    # Let's show first 10
    for line_num, l_content in timeouts[:15]:
        print(f"Line {line_num}: {l_content}")

    # 2. Check for event listener leaks
    # e.g., document.addEventListener or window.addEventListener or element.addEventListener
    listeners = []
    for i, line in enumerate(lines):
        if '.addEventListener(' in line:
            listeners.append((i + 1, line.strip()))

    print(f"\n[Pattern 3: Event Listeners ({len(listeners)})]")
    for line_num, l_content in listeners[:15]:
        print(f"Line {line_num}: {l_content}")

    # 3. Check for window.onscroll or window.onresize or window.addEventListener('scroll') / resize
    scroll_resize = []
    for i, line in enumerate(lines):
        if 'scroll' in line.lower() or 'resize' in line.lower():
            if 'addEventListener' in line or 'window.on' in line or 'document.on' in line:
                scroll_resize.append((i + 1, line.strip()))

    print(f"\n[Pattern 4: Non-Throttled Scroll/Resize ({len(scroll_resize)})]")
    for line_num, l_content in scroll_resize:
        print(f"Line {line_num}: {l_content}")

    # 4. Check for requestAnimationFrame
    raf_matches = []
    for i, line in enumerate(lines):
        if 'requestAnimationFrame' in line:
            raf_matches.append((i + 1, line.strip()))

    print(f"\n[Pattern 5: requestAnimationFrame loops ({len(raf_matches)})]")
    for line_num, l_content in raf_matches:
        print(f"Line {line_num}: {l_content}")

if __name__ == '__main__':
    analyze_deeper()
