import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace updateSpacedRepetition to isolate SM-2 logic again
pattern = r"function updateSpacedRepetition\(qid, isCorrect, timeSpentSec = 10\) \{\s*if \(\!window\.KrishiSM2Engine\) return;\s*// Update SM-2 engine across all practice modes so the algorithm can track long-term memory\s*let feedback = window\.KrishiSM2Engine\.recordAnswer\(qid, isCorrect, timeSpentSec\);\s*if \(state\.activeConfig && state\.activeConfig\.isSpacedReview\) \{\s*if \(feedback && window\.showToast\) \{\s*// showToast\(`SM-2: \$\{feedback\}`\);\s*\}\s*\}\s*\}"

replacement = """function updateSpacedRepetition(qid, isCorrect, timeSpentSec = 10) {
        if (!state.activeConfig || !state.activeConfig.isSpacedReview) return;
        if (!window.KrishiSM2Engine) return;
        
        let feedback = window.KrishiSM2Engine.recordAnswer(qid, isCorrect, timeSpentSec);
        if (feedback && window.showToast) {
            // showToast(`SM-2: ${feedback}`);
        }
    }"""

if re.search(pattern, content):
    new_content = re.sub(pattern, replacement, content)
    with open('js/app.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
else:
    print("Pattern not found! Check your regex.")
