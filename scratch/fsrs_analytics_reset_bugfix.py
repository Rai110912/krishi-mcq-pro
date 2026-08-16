import re

with open('js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# I will replace the end of renderSM2Heatmap to include reset logic for Mastery Breakdown

new_logic = """                        stM.textContent = mastered;
                        stL.textContent = learning;
                        stLe.textContent = leeched;
                    }

                } else {
                    retentionEl.textContent = '0%';
                    resetMasteryBreakdown();
                }
            } else {
                retentionEl.textContent = '0%';
                resetMasteryBreakdown();
            }
        }
        
        function resetMasteryBreakdown() {
            let elTot = document.getElementById('analytics-mastery-total');
            if (elTot) {
                elTot.textContent = '0 Cards';
                document.getElementById('pb-mastered').style.width = '0%';
                document.getElementById('pb-learning').style.width = '0%';
                document.getElementById('pb-leeched').style.width = '0%';
                document.getElementById('stat-mastered').textContent = '0';
                document.getElementById('stat-learning').textContent = '0';
                document.getElementById('stat-leeched').textContent = '0';
            }
        }
    }"""

pattern = r"                        stM\.textContent = mastered;\s*stL\.textContent = learning;\s*stLe\.textContent = leeched;\s*\}\s*\} else \{\s*retentionEl\.textContent = '0%';\s*\}\s*\}\s*\}"
content = re.sub(pattern, new_logic, content)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
