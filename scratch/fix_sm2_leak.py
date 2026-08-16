import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Don't add to Mistake Review if in Spaced Review
pattern_add = r"(if \(\!localData\.wrong\) localData\.wrong = \[\];\s*let targetIdWrong = String\(q\.id \|\| q\.q\);\s*if \(\!localData\.wrong\.some\(id => String\(id\) === targetIdWrong\)\) \{)"
replacement_add = r"if (state.activeConfig && state.activeConfig.isSpacedReview) { /* Do not pollute Mistake Review with Spaced Review errors */ } else \1"

# Same for removing from Mistake Review if answered correctly in Spaced Review?
# Actually, if they answer it correctly anywhere, removing it from Mistake Review is always good. So we leave that alone.

new_content = re.sub(pattern_add, replacement_add, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
