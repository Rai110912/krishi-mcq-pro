import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove inline activeDueSet filters
content = content.replace(r".filter(id => !activeDueSet.has(String(id)))", "")
content = content.replace(r".filter(id => !activeDueSetGlobal.has(String(id)))", "")

# Remove the && !activeDueSet.has(idStr) from line 4413
content = content.replace(r"return wrongs.has(idStr) && !activeDueSet.has(idStr);", "return wrongs.has(idStr);")

# We can also clean up the unused activeDueSet and activeDueSetGlobal declarations to avoid linter warnings/memory usage,
# but replacing them with "let activeDueSet = new Set();" or just deleting them is fine. Let's just delete the declarations.
# Pattern: let activeDueSet... = ...new Set();
pattern_decl = r"let activeDueSet(?:Global)?\s*=\s*(?:window\.KrishiSM2Engine \? [^;]+ : )?new Set\([^;]*\);"
content = re.sub(pattern_decl, "", content)

# There is a multi-line one around 13825:
#    let activeDueSet = (window.KrishiSM2Engine && typeof window.KrishiSM2Engine.getDueQuestions === 'function') 
#        ? new Set(window.KrishiSM2Engine.getDueQuestions(allQ).map(q => String(q.id || q.q))) 
#        : new Set();
# I'll just use a more aggressive regex or leave it (it won't hurt if it's unused).
# Actually, I'll just leave unused declarations as they don't break anything, just to be safe.

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
