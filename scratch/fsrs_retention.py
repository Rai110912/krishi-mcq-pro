import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_logic = """        // Calculate Retention Rate (DSR/FSRS model)
        let retentionEl = document.getElementById('analytics-retention-rate');
        if (retentionEl) {
            let sm2Raw = localStorage.getItem('krishi_sm2_v2');
            if (sm2Raw) {
                let sm2Data = JSON.parse(sm2Raw);
                let vals = Object.values(sm2Data);
                if (vals.length > 0) {
                    let now = Date.now();
                    let totalR = 0;
                    vals.forEach(x => {
                        if (x.retrievability) {
                            // Decay it slightly based on time since last calculation
                            let elapsedDays = x.lastAnswered ? (now - x.lastAnswered) / (24 * 3600 * 1000) : 0;
                            elapsedDays = Math.max(0, elapsedDays);
                            let r = Math.pow(0.9, elapsedDays / Math.max(0.1, (x.stability || 1)));
                            totalR += r;
                        } else {
                            // Fallback for legacy
                            totalR += 0.85;
                        }
                    });
                    let retention = (totalR / vals.length) * 100;
                    retentionEl.textContent = Math.round(retention) + '%';
                } else {
                    retentionEl.textContent = '0%';
                }
            }
        }"""

pattern = r"        // Calculate Retention Rate\s*let retentionEl = document\.getElementById\('analytics-retention-rate'\);\s*if \(retentionEl\) \{\s*let sm2Raw = localStorage\.getItem\('krishi_sm2_v2'\);\s*if \(sm2Raw\) \{\s*let sm2Data = JSON\.parse\(sm2Raw\);\s*let efs = Object\.values\(sm2Data\)\.map\(x => x\.easeFactor \|\| 2\.5\);\s*if \(efs\.length > 0\) \{\s*let avgEF = efs\.reduce\(\(a,b\)=>a\+b, 0\) / efs\.length;\s*let retention = Math\.min\(99, Math\.max\(0, 70 \+ \(\(avgEF - 1\.3\) / 1\.2\) \* 20\)\);\s*retentionEl\.textContent = Math\.round\(retention\) \+ '%';\s*\} else \{\s*retentionEl\.textContent = '0%';\s*\}\s*\}\s*\}"

new_content = re.sub(pattern, new_logic, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(new_content)
