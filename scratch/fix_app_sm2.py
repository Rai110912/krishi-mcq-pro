import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Revert the updateSpacedRepetition isolation so that all questions (mock tests etc) flow into SM-2 as intended.
old_update = """    function updateSpacedRepetition(qid, isCorrect, timeSpentSec = 10) {
        if (!window.KrishiSM2Engine) return;
        
        // ONLY update SM-2 engine if we are actively practicing inside a Spaced Review session!
        // This prevents standard mock test mistakes from being automatically sucked into the SM-2 engine,
        // which was causing user confusion ("why are my mistakes in Spaced Review?").
        if (state.activeConfig && state.activeConfig.isSpacedReview) {
            let feedback = window.KrishiSM2Engine.recordAnswer(qid, isCorrect, timeSpentSec);
            if (feedback && window.showToast) {
                // showToast(`SM-2: ${feedback}`);
            }
        }
    }"""

new_update = """    function updateSpacedRepetition(qid, isCorrect, timeSpentSec = 10) {
        if (!window.KrishiSM2Engine) return;
        
        // Update SM-2 engine across all practice modes so the algorithm can track long-term memory
        let feedback = window.KrishiSM2Engine.recordAnswer(qid, isCorrect, timeSpentSec);
        if (state.activeConfig && state.activeConfig.isSpacedReview) {
            if (feedback && window.showToast) {
                // showToast(`SM-2: ${feedback}`);
            }
        }
    }"""

content = content.replace(old_update, new_update)


# 2. Remove the crazy filters that subtract SM-2 due questions from localData.wrong!
# They appear in multiple places. Let's use Regex to replace all occurrences.
# The pattern is: .filter(id => !(window.KrishiSM2Engine ? new Set(window.KrishiSM2Engine.getDueQuestions(getAllQuestions()).map(q => String(q.id || q.q))) : new Set()).has(String(id)))

pattern = r'\.filter\(id => !\(window\.KrishiSM2Engine \? new Set\(window\.KrishiSM2Engine\.getDueQuestions\(getAllQuestions\(\)\)\.map\(q => String\(q\.id \|\| q\.q\)\)\) : new Set\(\)\)\.has\(String\(id\)\)\)'
content = re.sub(pattern, '', content)

# 3. There is another variation with `allQ` instead of `getAllQuestions()` in some places?
# Wait, let's check if there are others. I'll just use a simpler regex that matches the whole filter block.
pattern2 = r'\.filter\(id => !\(window\.KrishiSM2Engine \?[^\)]+\)\)\.has\(String\(id\)\)\)'
content = re.sub(pattern2, '', content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
