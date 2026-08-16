import re

with open('js/pwa_helpers.js', 'r', encoding='utf-8') as f:
    content = f.read()

# We want to replace the body of KrishiSM2Engine.recordAnswer
# From `if (!questionId) return;` down to `return feedback;`

new_body = """        if (!questionId) return;
        const data = this._getData();
        const now = Date.now();
        const existing = data[questionId] || { reviews: 0, interval: 0, easeFactor: 2.5, lapses: 0, status: 'new' };

        // --- FSRS Migration ---
        if (typeof existing.difficulty === 'undefined') {
            // Map SM-2 EF (1.3 to 3.0) to FSRS Difficulty (10 down to 1)
            let d = 11 - ((existing.easeFactor || 2.5) - 1.3) * 5.29;
            existing.difficulty = Math.max(1, Math.min(10, Math.round(d * 10) / 10));
        }
        if (typeof existing.stability === 'undefined') {
            existing.stability = existing.interval || (existing.reviews > 0 ? 1 : 0.5);
        }
        if (typeof existing.lapses === 'undefined') existing.lapses = 0;

        let grade = 0; // 0=Fail, 1=Hard, 2=Good, 3=Easy
        let feedback = "";
        let status = 'scheduled';
        let suspendUntil = null;

        if (!isCorrect) {
            grade = 0;
            existing.lapses += 1;
            if (existing.lapses >= 4) {
                status = 'suspended';
                suspendUntil = now + (3 * 24 * 3600 * 1000); // 3 days penalty
                feedback = "🔴 Leech (Suspended)";
            } else {
                status = 'due';
                feedback = "🔴 Hard (Fail)";
            }
        } else {
            existing.lapses = 0;
            if (timeSpentSec <= 5) { grade = 3; feedback = "⚡ Easy"; }
            else if (timeSpentSec <= 15) { grade = 2; feedback = "👍 Good"; }
            else { grade = 1; feedback = "🤔 Hard"; }
        }

        // --- FSRS DSR Math ---
        let elapsedDays = existing.lastAnswered ? (now - existing.lastAnswered) / (24 * 3600 * 1000) : 0;
        elapsedDays = Math.max(0, elapsedDays);
        let R = Math.pow(0.9, elapsedDays / Math.max(0.1, existing.stability));

        // Difficulty Update
        let D = existing.difficulty - (grade - 2.5); // good/easy drops difficulty, hard/fail increases it
        D = Math.max(1, Math.min(10, D));

        // Stability Update
        let S = existing.stability;
        if (grade === 0) {
            S = Math.max(0.1, S * 0.2); // Fail drops stability
        } else {
            // Multiplier based on D and R
            let factor = (grade === 3) ? 1.5 : (grade === 2) ? 1.0 : 0.5;
            let multiplier = Math.max(1, 1 + factor * (11 - D) * (1 - R));
            S = Math.max(1, S * multiplier); 
        }

        let nextInterval = Math.max(1, Math.round(S));
        let reviews = existing.reviews + 1;

        if (nextInterval >= 21 && reviews >= 4 && status === 'scheduled') {
            status = 'mastered';
            feedback = "🏆 Mastered!";
        }

        data[questionId] = {
            reviews: reviews,
            interval: nextInterval, // For backwards compatibility
            difficulty: parseFloat(D.toFixed(2)),
            stability: parseFloat(S.toFixed(2)),
            retrievability: parseFloat(R.toFixed(3)),
            easeFactor: existing.easeFactor, // Legacy
            lapses: existing.lapses,
            lastAnswered: now,
            nextReview: status === 'suspended' ? suspendUntil : now + (nextInterval * 24 * 3600 * 1000),
            status: status === 'suspended' ? 'suspended' : (reviews >= 4 && nextInterval >= 21 ? 'mastered' : status)
        };

        this._saveData(data);
        this.updateHUDStats();
        this.recordDailyReview();

        console.log(`[FSRS] Q:${questionId} D:${D.toFixed(1)} S:${S.toFixed(1)} R:${(R*100).toFixed(1)}% Int:${nextInterval}d Grade:${feedback}`);
        return feedback;"""

pattern = r"        if \(\!questionId\) return;\s*const data = this\._getData\(\);\s*const now = Date\.now\(\);.*?return feedback;\s*"

new_content = re.sub(pattern, new_body + "\n", content, flags=re.DOTALL)

with open('js/pwa_helpers.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
