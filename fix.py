import codecs
with codecs.open('js/app.js', 'r', 'utf-8') as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if 'let engineContainer = document.getElementById(\'smart-engine-container\');' in line and i > 14200:
        start_idx = i
        break

end_idx = -1
for i in range(start_idx, len(lines)):
    if '});' in lines[i] and 'container.innerHTML +=' in ''.join(lines[start_idx:i]):
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_code = """    let engineContainer = document.getElementById('smart-engine-container');
    if (engineContainer) {
        let engineHtml = `
            <div class=\"space-y-3\">
                <h3 class=\"font-bold text-xs text-slate-400 uppercase tracking-wider mb-2\">🔥 Priority Training Modes</h3>
                
                <button onclick=\"startSmartPracticeMode('quick'); playSound('click');\" class=\"w-full p-4 rounded-2xl border text-left flex justify-between items-center hover-card-trigger bg-gradient-to-r from-emerald-500/10 to-teal-500/10\" style=\"border-color:var(--border); background:var(--card);\">
                    <div class=\"flex items-center gap-3\">
                        <div class=\"w-10 h-10 bg-emerald-500 text-white rounded-xl flex items-center justify-center text-xl shadow-lg\">⚡️</div>
                        <div>
                            <h4 class=\"font-black text-sm text-slate-800 dark:text-slate-100\">Quick MCQ Drill</h4>
                            <p class=\"text-[10px] text-slate-400\">१० वटा मिक्स्ड प्रश्नहरूको द्रुत अभ्यास</p>
                        </div>
                    </div>
                    <span class=\"text-[10px] font-bold px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-xl\">START</span>
                </button>

                <div class=\"grid grid-cols-2 gap-3\">
                    <button onclick=\"startSmartPracticeMode('spaced'); playSound('click');\" class=\"p-4 rounded-2xl border text-left space-y-3 hover-card-trigger ${dueCount > 0 ? 'pulse-spaced-accent' : ''}\" style=\"border-color:var(--border); background:var(--card);\">
                        <div class=\"flex justify-between items-center\">
                            <span class=\"text-2xl\">🧠</span>
                            <span class=\"text-[9px] font-black px-2 py-1 rounded-full ${dueCount > 0 ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}\">${dueCount} DUE</span>
                        </div>
                        <h4 class=\"font-bold text-xs text-slate-800 dark:text-slate-100\">Spaced Review</h4>
                    </button>

                    <button onclick=\"startSmartPracticeMode('wrong'); playSound('click');\" class=\"p-4 rounded-2xl border text-left space-y-3 hover-card-trigger ${wrongCount > 0 ? 'pulse-wrong-accent' : ''}\" style=\"border-color:var(--border); background:var(--card);\">
                        <div class=\"flex justify-between items-center\">
                            <span class=\"text-2xl\">💔</span>
                            <span class=\"text-[9px] font-black px-2 py-1 rounded-full ${wrongCount > 0 ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'}\">${wrongCount} ERRORS</span>
                        </div>
                        <h4 class=\"font-bold text-xs text-slate-800 dark:text-slate-100\">Review Mistakes</h4>
                    </button>
                </div>

                <button onclick=\"navigate('page-mock-config'); playSound('click');\" class=\"w-full p-4 rounded-2xl border text-left flex justify-between items-center hover-card-trigger bg-gradient-to-r from-indigo-500/10 to-blue-500/10\" style=\"border-color:var(--border); background:var(--card);\">
                    <div class=\"flex items-center gap-3\">
                        <div class=\"w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center text-xl shadow-lg\">🎯</div>
                        <div>
                            <h4 class=\"font-black text-sm text-slate-800 dark:text-slate-100\">Mock Exam Simulator</h4>
                            <p class=\"text-[10px] text-slate-500\">कठिनस्तर छानेर वास्तविक परीक्षाको झल्को</p>
                        </div>
                    </div>
                    <span class=\"text-[10px] font-bold px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-xl\">OPEN</span>
                </button>
            </div>
        `;
        if (engineContainer.innerHTML !== engineHtml) {
            engineContainer.innerHTML = engineHtml;
        }
    }

    let elWrongCount = document.getElementById('smart-wrong-count-lbl');
    if (elWrongCount) elWrongCount.textContent = `${wrongCount} pending wrongs`;

    let elBkCount = document.getElementById('smart-bookmark-count-lbl');
    if (elBkCount) elBkCount.textContent = `${bookmarkedCount} saved items`;

    let elSpacedCount = document.getElementById('smart-spaced-count-lbl');
    if (elSpacedCount) elSpacedCount.textContent = `${dueCount} revision dued`;

    let elDailyCount = document.getElementById('smart-daily-count-lbl');
    if (elDailyCount) {
        let todayStr = getLocalDateString();
        let solved = (localData.streak[todayStr]||{}).solved||0;
        let dailyT = getDailyTarget() || 50;
        elDailyCount.textContent = `${solved} / ${dailyT} solved today`;
    }

    let subStats = (localData && localData.stats && localData.stats.subjectStats) ? localData.stats.subjectStats : {};

    let htmlStr = '';
    subjects.forEach(sub => {
        let count = all.filter(q => (q.sub || "").trim().toLowerCase() === (sub || "").trim().toLowerCase()).length;
        let stats = subStats[sub] || { solved: 0, correct: 0 };
        let accuracyText = stats.solved > 0 ? `${Math.round((stats.correct / stats.solved) * 100)}% accuracy` : 'Not practiced';
        let accuracyColor = stats.solved > 0 ? (stats.correct / stats.solved >= 0.8 ? 'text-emerald-500' : stats.correct / stats.solved >= 0.5 ? 'text-amber-500' : 'text-rose-500') : 'text-slate-400 dark:text-slate-500';

        htmlStr += `
            <button onclick="openPracticeSetupPage('${sub}', 'all')" class="p-3.5 rounded-xl border text-left bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all  group flex flex-col justify-between" style="border-color:var(--border);">
                <div>
                    <p class="font-extrabold text-xs text-slate-800 dark:text-slate-200 group-hover:text-emerald-600">${sub}</p>
                    <span class="text-[9px] text-slate-400 mt-1 block">${count} Questions</span>
                </div>
                <div class="mt-3 flex items-center justify-between w-full">
                    <span class="text-[8px] font-black uppercase tracking-wider ${accuracyColor}">${accuracyText}</span>
                    <span class="text-[9px] font-black text-emerald-500 group-hover:translate-x-0.5 transition-transform">Configure ➔</span>
                </div>
            </button>
        `;
    });
    
    if (container.innerHTML !== htmlStr) {
        container.innerHTML = htmlStr;
    }
"""
    
    lines = lines[:start_idx] + [new_code] + lines[end_idx+1:]
    with codecs.open('js/app.js', 'w', 'utf-8') as f:
        f.writelines(lines)
    print('Success')
else:
    print('Could not find bounds', start_idx, end_idx)
