import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add krishi_sm2_v2 and krishi_sm2_heatmap to keysToWipe array
if "'krishi_sm2_v2'" not in content:
    content = content.replace("'krishi_sm2',", "'krishi_sm2',\n                'krishi_sm2_v2',\n                'krishi_sm2_heatmap',")
    with open('js/app.js', 'w', encoding='utf-8') as f:
        f.write(content)
