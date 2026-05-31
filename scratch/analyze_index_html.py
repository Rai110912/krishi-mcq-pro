import re
import os
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

def analyze_index():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    html_path = os.path.join(project_dir, 'index.html')
    
    if not os.path.exists(html_path):
        print("index.html not found.")
        return
        
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
        
    print("==================================================")
    print("        Deep HTML Integration Auditing            ")
    print("==================================================")
    
    # 1. Look for <script> tags
    scripts = re.findall(r'<script\b[^>]*src=["\']([^"\']+)["\']', html)
    print("Script Sources in index.html:")
    for s in scripts:
        print(f"- {s}")
        
    # 2. Look for <link> stylesheets
    stylesheets = re.findall(r'<link\b[^>]*href=["\']([^"\']+)["\']', html)
    print("\nStylesheet Link References:")
    for ss in stylesheets:
        print(f"- {ss}")
        
    # 3. Scan for any remaining CDN references in HTML
    cdn_links = re.findall(r'https?://[^\s"\'>]+', html)
    # Filter to CDNs like unpkg, cdnjs, gstatic, tailwindcss
    cdn_filters = ['unpkg.com', 'cdnjs.cloudflare.com', 'gstatic.com', 'tailwindcss.com', 'googleapis.com']
    found_cdns = []
    for link in cdn_links:
        for f in cdn_filters:
            if f in link:
                found_cdns.append(link)
                break
                
    print(f"\nRemaining CDN references inside index.html ({len(set(found_cdns))} unique):")
    for link in sorted(list(set(found_cdns))):
        print(f"- {link}")
        
    # 4. Check for DOM elements that could represent abandoned or inactive modules
    print("\nInactive / Hidden DOM containers in index.html:")
    # Look for id attributes containing 'legacy', 'deprecated', 'old', 'unused', 'hidden', 'test', 'temp'
    all_ids = re.findall(r'id=["\']([a-zA-Z0-9_\-]+)["\']', html)
    inactive_keywords = ['legacy', 'deprecated', 'old', 'unused', 'test', 'temp']
    found_inactive_ids = []
    for identifier in all_ids:
        for kw in inactive_keywords:
            if kw in identifier.lower():
                found_inactive_ids.append(identifier)
                break
    for i in sorted(list(set(found_inactive_ids))):
        print(f"- Element ID: {i}")

if __name__ == '__main__':
    analyze_index()
