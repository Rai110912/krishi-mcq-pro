import re

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

new_html = """                    <span>More</span>
                </div>
                
                <!-- Mastery Breakdown UI -->
                <div class="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Mastery Breakdown</span>
                        <span id="analytics-mastery-total" class="text-[10px] font-black text-slate-700 dark:text-slate-300">0 Cards</span>
                    </div>
                    <div class="flex h-2.5 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 gap-0.5">
                        <div id="pb-mastered" class="bg-amber-400 transition-all duration-500" style="width: 0%"></div>
                        <div id="pb-learning" class="bg-sky-400 transition-all duration-500" style="width: 0%"></div>
                        <div id="pb-leeched" class="bg-rose-500 transition-all duration-500" style="width: 0%"></div>
                    </div>
                    <div class="flex justify-between mt-3">
                        <div class="text-center">
                            <div class="flex items-center gap-1 text-[10px] text-slate-500"><span class="w-2 h-2 rounded-full bg-amber-400"></span> Mastered</div>
                            <div id="stat-mastered" class="text-xs font-black text-slate-700 dark:text-slate-200 mt-0.5">0</div>
                        </div>
                        <div class="text-center">
                            <div class="flex items-center gap-1 text-[10px] text-slate-500"><span class="w-2 h-2 rounded-full bg-sky-400"></span> Learning</div>
                            <div id="stat-learning" class="text-xs font-black text-slate-700 dark:text-slate-200 mt-0.5">0</div>
                        </div>
                        <div class="text-center">
                            <div class="flex items-center gap-1 text-[10px] text-slate-500"><span class="w-2 h-2 rounded-full bg-rose-500"></span> Leeched</div>
                            <div id="stat-leeched" class="text-xs font-black text-slate-700 dark:text-slate-200 mt-0.5">0</div>
                        </div>
                    </div>
                </div>
            </div>"""

pattern = r"                    <span>More</span>\s*</div>\s*</div>"
content = re.sub(pattern, new_html, content)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)


with open('js/app.js', 'r', encoding='utf-8') as f:
    app_js = f.read()

js_addition = """                    let retention = (totalR / vals.length) * 100;
                    retentionEl.textContent = Math.round(retention) + '%';
                    
                    // Update Mastery Breakdown
                    let mastered = 0, learning = 0, leeched = 0;
                    vals.forEach(x => {
                        if (x.status === 'mastered') mastered++;
                        else if (x.status === 'suspended') leeched++;
                        else learning++;
                    });
                    let totalCards = mastered + learning + leeched;
                    
                    let elTot = document.getElementById('analytics-mastery-total');
                    let pbM = document.getElementById('pb-mastered');
                    let pbL = document.getElementById('pb-learning');
                    let pbLe = document.getElementById('pb-leeched');
                    let stM = document.getElementById('stat-mastered');
                    let stL = document.getElementById('stat-learning');
                    let stLe = document.getElementById('stat-leeched');
                    
                    if(elTot) {
                        elTot.textContent = totalCards + ' Cards';
                        if(totalCards > 0) {
                            pbM.style.width = ((mastered / totalCards) * 100) + '%';
                            pbL.style.width = ((learning / totalCards) * 100) + '%';
                            pbLe.style.width = ((leeched / totalCards) * 100) + '%';
                        }
                        stM.textContent = mastered;
                        stL.textContent = learning;
                        stLe.textContent = leeched;
                    }
"""

js_pattern = r"                    let retention = \(totalR / vals\.length\) \* 100;\s*retentionEl\.textContent = Math\.round\(retention\) \+ '%';"
app_js = re.sub(js_pattern, js_addition, app_js)

with open('js/app.js', 'w', encoding='utf-8') as f:
    f.write(app_js)

