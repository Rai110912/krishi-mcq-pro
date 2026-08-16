import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# I need to properly wrap lines 4939 to 4947.
# Right now it looks like:
# if (state.activeConfig && state.activeConfig.isSpacedReview) { /* ... */ } else if (!localData.wrong) localData.wrong = [];
# let targetIdWrong = String(q.id || q.q);
# if (!localData.wrong.some(...)) {
#     localData.wrong.push(...);
#     ...
#     saveData();
# }

# Let's write a targeted replacement
pattern = r"if \(state\.activeConfig && state\.activeConfig\.isSpacedReview\) \{ /\* Do not pollute Mistake Review with Spaced Review errors \*/ \} else if \(\!localData\.wrong\) localData\.wrong = \[\];\s*let targetIdWrong = String\(q\.id \|\| q\.q\);\s*if \(\!localData\.wrong\.some\(id => String\(id\) === targetIdWrong\)\) \{\s*localData\.wrong\.push\(q\.id \|\| q\.q\);\s*if \(\!localData\.wrongLog\) localData\.wrongLog = \{\};\s*let rev = localData\.wrongLog\[targetIdWrong\] \? \(localData\.wrongLog\[targetIdWrong\]\._rev \|\| 0\) : 0;\s*localData\.wrongLog\[targetIdWrong\] = \{ action: 'add', timestamp: Date\.now\(\), _rev: rev \+ 1 \};\s*saveData\(\);\s*\}"

replacement = """if (!(state.activeConfig && state.activeConfig.isSpacedReview)) {
                if (!localData.wrong) localData.wrong = [];
                let targetIdWrong = String(q.id || q.q);
                if (!localData.wrong.some(id => String(id) === targetIdWrong)) {
                    localData.wrong.push(q.id || q.q);
                    if (!localData.wrongLog) localData.wrongLog = {};
                    let rev = localData.wrongLog[targetIdWrong] ? (localData.wrongLog[targetIdWrong]._rev || 0) : 0;
                    localData.wrongLog[targetIdWrong] = { action: 'add', timestamp: Date.now(), _rev: rev + 1 };
                    saveData();
                }
            }"""

if re.search(pattern, content):
    new_content = re.sub(pattern, replacement, content)
    with open('js/app.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Fixed block successfully!")
else:
    print("Pattern not found! Check your regex.")
