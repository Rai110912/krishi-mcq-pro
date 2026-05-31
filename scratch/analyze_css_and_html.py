import re
import os
import sys

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

def analyze_css():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    css_path = os.path.join(project_dir, 'index.css')
    html_path = os.path.join(project_dir, 'index.html')
    
    print("==================================================")
    # Replaced unicode check with ASCII text to avoid cp1252 print errors
    print("       Deep CSS and Layout Auditing Report       ")
    print("==================================================")
    
    if not os.path.exists(css_path):
        print("index.css not found.")
        return
        
    with open(css_path, 'r', encoding='utf-8') as f:
        css = f.read()
        
    # Check for media queries
    media_queries = re.findall(r'@media[^{]+{', css)
    print(f"Total media queries found in index.css: {len(media_queries)}")
    for mq in media_queries[:10]:
        print(f"- {mq.strip()}")
        
    # Check for high z-index declarations in CSS
    z_indices = re.findall(r'z-index\s*:\s*([0-9\-]+)', css)
    high_z = [int(z) for z in z_indices if int(z) > 100]
    print(f"\nTotal high z-index (>100) occurrences in index.css: {len(high_z)}")
    for z in sorted(list(set(high_z))):
        print(f"- z-index: {z}")
        
    # Find any style overrides left for QR / Install banners that are now commented out
    qr_banner_styles = re.findall(r'#mobile-qr-btn|#pwa-install-banner', css)
    print(f"\nReferences to QR/PWA buttons in index.css: {len(qr_banner_styles)}")
    
    # Check for text-shadow properties that could cause performance degradation in Budget WebViews
    text_shadows = re.findall(r'text-shadow\s*:', css)
    print(f"\nText-shadow properties (performance impact in Android WebViews): {len(text_shadows)} occurrences")

if __name__ == '__main__':
    analyze_css()
