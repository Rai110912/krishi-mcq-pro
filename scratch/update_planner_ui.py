import os

html_path = r"d:\Downloads\test file of Mcq pro\index.html"
with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Locate the target block
start_marker = '        <!-- PLANNER PAGE -->'
end_marker = '        <!-- MANUAL MCQ CREATOR PAGE -->'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    target_block = content[start_idx:end_idx]
    print("Found target block of length:", len(target_block))
    
    # Define our replacement HTML
    replacement = """        <!-- PLANNER PAGE -->
        <div id="page-study-planner" class="page p-4 space-y-4">
            
            <!-- HERO WIDGET: welcome, countdown & streak (Upgrade 1) -->
            <div id="planner-hero-card" class="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md p-4 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm transition duration-300 hover:shadow-md animate-slide-up flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h2 class="text-sm font-black text-slate-800 dark:text-slate-150 uppercase tracking-wider flex items-center gap-1.5">📅 Study Planner Pro</h2>
                    <p id="planner-exam-countdown" class="text-[10px] text-emerald-600 font-extrabold mt-0.5 animate-pulse">Countdown: Calculating...</p>
                </div>
                <div class="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                    <span id="planner-streak-count" class="font-black text-amber-500 text-[10px] flex items-center gap-1 bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/20">
                        <span class="animate-bounce text-xs">🔥</span> 0 Days Active
                    </span>
                    <button onclick="togglePlannerSettings(); playSound('click');" id="btn-toggle-planner-settings" class="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-900/50 dark:hover:bg-slate-900 transition-colors text-[10px] font-black uppercase flex items-center gap-1.5 border border-slate-200 dark:border-slate-800 cursor-pointer">
                        ⚙️ Settings
                    </button>
                </div>
            </div>

            <!-- TOAST MESSAGE / EMPTY STATE ALERTS -->
            <div id="planner-empty-state-banner" class="hidden p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2.5 animate-slide-up">
                <div class="flex items-start gap-2.5">
                    <span class="text-sm">💡</span>
                    <div>
                        <span class="text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-wide block">Limited MCQ Practice History</span>
                        <p class="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">Solve at least 20 MCQs to unlock powerful planner recommendations based on your real performance. You can use Demo Mode below to explore what full stats look like!</p>
                    </div>
                </div>
                <button onclick="togglePlannerDemoMode(); playSound('click');" id="btn-planner-demo-mode" class="px-3 py-2 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase cursor-pointer hover:bg-amber-700 transition active:scale-95">
                    Activate Interactive Demo Data
                </button>
            </div>

            <div id="planner-demo-active-banner" class="hidden px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex justify-between items-center animate-slide-up">
                <span class="text-[10px] text-indigo-700 dark:text-indigo-400 font-black">🌟 Active: Developer Demo Data Mode</span>
                <button onclick="togglePlannerDemoMode(); playSound('click');" class="text-[9px] text-indigo-600 underline font-bold">Use Real Practice History</button>
            </div>

            <!-- SMART DAILY PLAN: activity timeline (Upgrade 2) -->
            <div class="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700 shadow-sm space-y-3.5 animate-slide-up" style="animation-delay: 0.1s;">
                <div class="flex flex-col gap-2.5 border-b border-slate-100 dark:border-slate-700 pb-2.5">
                    <span class="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">✨ Today's Smart Daily Plan</span>
                    <div class="flex gap-1 bg-slate-100 dark:bg-slate-900/80 p-1 rounded-xl border w-full text-center" id="plan-mode-tabs" style="border-color:var(--border);">
                        <button onclick="setPlanMode('quick'); playSound('click');" id="pm-tab-quick" class="flex-1 py-1.5 text-[9px] font-black rounded-lg bg-indigo-650 text-white cursor-pointer select-none transition-all active:scale-95 border-none outline-none">Quick</button>
                        <button onclick="setPlanMode('normal'); playSound('click');" id="pm-tab-normal" class="flex-1 py-1.5 text-[9px] font-black rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer select-none transition-all active:scale-95 border-none outline-none">Normal</button>
                        <button onclick="setPlanMode('deep'); playSound('click');" id="pm-tab-deep" class="flex-1 py-1.5 text-[9px] font-black rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer select-none transition-all active:scale-95 border-none outline-none">Deep</button>
                        <button onclick="setPlanMode('full'); playSound('click');" id="pm-tab-full" class="flex-1 py-1.5 text-[9px] font-black rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer select-none transition-all active:scale-95 border-none outline-none">Full</button>
                    </div>
                </div>

                <!-- Custom timeline content with max height to prevent layout shifts -->
                <div id="smart-plan-details" class="space-y-3 max-h-[170px] overflow-y-auto pr-1 text-[11px] leading-relaxed" style="scrollbar-width: thin; -ms-overflow-style: none;">
                    <p class="text-slate-400">Generating optimum route configs...</p>
                </div>

                <div class="grid grid-cols-2 gap-2 pt-1">
                    <button onclick="generateTodaySmartPlan(); playSound('click');" class="w-full py-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-black text-slate-700 dark:text-slate-300 transition active:scale-95 cursor-pointer flex justify-center items-center gap-1.5 select-none">
                        🔄 Refresh Plan
                    </button>
                    <button onclick="startSmartStudyPlanSession(); playSound('click');" class="w-full py-2.5 bg-emerald-650 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition active:scale-95 shadow-sm cursor-pointer flex justify-center items-center gap-1.5 select-none">
                        ⚡ Start Practice
                    </button>
                </div>
            </div>

            <!-- EXAM TARGETS & SPACED REVIEW GRID: 2x2 cards (Upgrade 3) -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 animate-slide-up" style="animation-delay: 0.15s;">
                <!-- Daily Target Tracker Card -->
                <div class="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700 shadow-sm space-y-3.5">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">🎯 Daily MCQ Targets</span>
                        <span id="planner-target-fraction" class="text-xs font-black text-emerald-600">0 / 50 Completed</span>
                    </div>
                    <div class="w-full bg-slate-100 dark:bg-slate-750 h-3.5 rounded-full overflow-hidden relative border border-slate-200/45">
                        <div id="planner-target-progress-bar" class="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-700 rounded-full" style="width: 0%;"></div>
                    </div>
                    <p class="text-[9px] text-slate-400 mt-1 leading-normal">Practice MCQs daily to maintain streak boosts and secure high retention scores.</p>
                </div>

                <!-- Spaced review engine metrics: 2x2 grid dashboard -->
                <div class="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700 shadow-sm space-y-3.5">
                    <span class="text-xs font-black text-slate-800 dark:text-slate-200 block uppercase tracking-wide">🔁 Active Review Planner (SM-2 Spaced)</span>
                    
                    <div class="grid grid-cols-2 gap-2 text-center text-xs">
                        <div class="bg-red-500/5 dark:bg-red-950/10 p-2.5 rounded-xl border flex flex-col justify-between" style="border-color:var(--border);">
                            <div class="flex justify-between items-center text-[8px] font-bold text-red-500 uppercase tracking-wider">
                                <span>Due</span>
                                <span>🔴</span>
                            </div>
                            <span id="lbl-review-due" class="text-sm font-black text-red-650 mt-1">0</span>
                        </div>
                        <div class="bg-rose-500/5 dark:bg-rose-950/10 p-2.5 rounded-xl border flex flex-col justify-between" style="border-color:var(--border);">
                            <div class="flex justify-between items-center text-[8px] font-bold text-rose-500 uppercase tracking-wider">
                                <span>Overdue</span>
                                <span>🛑</span>
                            </div>
                            <span id="lbl-review-overdue" class="text-sm font-black text-rose-600 mt-1">0</span>
                        </div>
                        <div class="bg-indigo-500/5 dark:bg-indigo-950/10 p-2.5 rounded-xl border flex flex-col justify-between" style="border-color:var(--border);">
                            <div class="flex justify-between items-center text-[8px] font-bold text-indigo-500 uppercase tracking-wider">
                                <span>Upcoming</span>
                                <span>🔵</span>
                            </div>
                            <span id="lbl-review-upcoming" class="text-sm font-black text-indigo-500 mt-1">0</span>
                        </div>
                        <div class="bg-emerald-500/5 dark:bg-emerald-950/10 p-2.5 rounded-xl border flex flex-col justify-between" style="border-color:var(--border);">
                            <div class="flex justify-between items-center text-[8px] font-bold text-emerald-500 uppercase tracking-wider">
                                <span>Mastered</span>
                                <span>🟢</span>
                            </div>
                            <span id="lbl-review-mastered" class="text-sm font-black text-emerald-600 mt-1">0</span>
                        </div>
                    </div>

                    <div class="pt-1 select-none flex gap-2 w-full">
                        <button onclick="startAdaptiveReview(); playSound('click');" class="flex-1 py-2 bg-indigo-650 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase cursor-pointer transition active:scale-95 border-none outline-none">
                            Review Due
                        </button>
                        <button onclick="startWrongQuestionCorrection(); playSound('click');" class="flex-1 py-2 bg-rose-650 hover:bg-rose-700 text-white rounded-xl text-[10px] font-black uppercase cursor-pointer transition active:scale-95 border-none outline-none">
                            Fix Mistakes
                        </button>
                    </div>
                </div>
            </div>

            <!-- SYLLABUS PROGRESS: Circular indicator & checklist sheets (Upgrade 4) -->
            <div class="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700 shadow-sm space-y-4 animate-slide-up" style="animation-delay: 0.2s;">
                <div class="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-2.5">
                    <span class="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">📚 Advanced Syllabus Tracker</span>
                    <button onclick="toggleAddSubjectView(); playSound('click');" class="px-2.5 py-1 bg-emerald-650 text-white text-[9px] font-black uppercase rounded-lg hover:bg-emerald-700 cursor-pointer transition active:scale-95 border-none outline-none">
                        ➕ Custom Subject
                    </button>
                </div>

                <!-- Add Subject Form Row -->
                <div id="add-subject-form" class="hidden p-3 bg-slate-50 dark:bg-slate-900 border rounded-xl space-y-2" style="border-color:var(--border);">
                    <span class="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Propose Custom Subject</span>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <input id="new-syllabus-subject" placeholder="Subject Name..." class="p-2 border rounded-xl bg-white dark:bg-slate-800" style="border-color:var(--border); color:var(--text);">
                        <input id="new-syllabus-weight" type="number" placeholder="Weight %" class="p-2 border rounded-xl bg-white dark:bg-slate-800" style="border-color:var(--border); color:var(--text);">
                    </div>
                    <div class="flex justify-end gap-1.5">
                        <button onclick="toggleAddSubjectView(); playSound('click');" class="px-3 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-[9px] font-black uppercase cursor-pointer">Close</button>
                        <button onclick="submitCustomSyllabusSubject(); playSound('click');" class="px-3 py-1 bg-emerald-650 text-white rounded-lg text-[9px] font-black uppercase cursor-pointer">Save</button>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <!-- Circular progress ring with Hardware-Accelerated Glow mitigation -->
                    <div class="flex flex-col items-center justify-center p-3 border border-dashed rounded-xl" style="border-color:var(--border); box-shadow: 0 0 10px rgba(16, 185, 129, 0.05);">
                        <div class="relative w-28 h-28 flex items-center justify-center">
                            <svg class="w-full h-full transform -rotate-90">
                                <circle cx="56" cy="56" r="45" stroke="var(--border)" stroke-width="8" fill="transparent" class="text-slate-100 dark:text-slate-750" />
                                <circle id="syllabus-circle-stroke" cx="56" cy="56" r="45" stroke="#10b981" stroke-width="8" fill="transparent" 
                                        stroke-dasharray="283" stroke-dashoffset="283" class="transition-all duration-700" style="filter: drop-shadow(0 0 3px rgba(16, 185, 129, 0.2));" />
                            </svg>
                            <div class="absolute flex flex-col items-center">
                                <span id="lbl-syllabus-completion-percent" class="text-lg font-black text-slate-800 dark:text-slate-100">0%</span>
                                <span class="text-[8px] text-slate-400 font-black tracking-wider uppercase text-center">Syllabus Complete</span>
                            </div>
                        </div>
                    </div>

                    <!-- High priority pending items checklist -->
                    <div class="md:col-span-2 space-y-2">
                        <span class="text-[9px] font-black text-rose-500 uppercase block tracking-wider">🚀 High-Priority Pending Chapters</span>
                        <div id="high-priority-checklist" class="space-y-1.5">
                            <!-- Populated dynamically -->
                            <p class="text-[10px] text-slate-400 italic">No pending items found.</p>
                        </div>
                    </div>
                </div>

                <!-- Syllabus breakdown subjects accordion grid -->
                <div id="syllabus-accordion-container" class="space-y-2 max-h-[300px] overflow-y-auto pr-1" style="scrollbar-width: thin;">
                    <!-- Populated dynamically -->
                </div>
            </div>

            <!-- SUBJECT PROFICIENCY MATRIX -->
            <div class="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700 shadow-sm space-y-3 animate-slide-up" style="animation-delay: 0.25s;">
                <span class="text-xs font-black text-slate-800 dark:text-slate-200 block border-b border-slate-100 dark:border-slate-700 pb-2 uppercase tracking-wide">🎯 Subject Proficiency Matrix</span>
                <div id="planner-proficiency-list" class="space-y-2">
                    <!-- Dynamic subject rows generated in JS -->
                </div>
                <div class="pt-2 flex justify-between gap-2 w-full">
                    <button onclick="startPracticeWeakestSubject(); playSound('click');" class="flex-1 py-2 bg-rose-650 hover:bg-rose-700 text-white text-[10px] font-black uppercase rounded-xl cursor-pointer transition active:scale-95 border-none outline-none">
                        Practice Weakest
                    </button>
                    <button onclick="startMaintainStrongSubjectPractice(); playSound('click');" class="flex-1 py-2 bg-emerald-650 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-xl cursor-pointer transition active:scale-95 border-none outline-none">
                        Maintain Mastery
                    </button>
                </div>
            </div>

            <!-- CALENDAR HEATMAP: Swipeable horizontal grid (Upgrade 5) -->
            <div class="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-150 dark:border-slate-700 shadow-sm space-y-3.5 pr-3 animate-slide-up" style="animation-delay: 0.3s;">
                <div class="flex justify-between items-center border-b border-slate-100 dark:border-slate-700 pb-2">
                    <span class="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">📅 Heatmap Tracker & Streaks</span>
                    <span class="text-[9px] text-slate-400 font-black uppercase" id="lbl-heatmap-weekly-avg">Daily solve avg: calculating...</span>
                </div>

                <!-- Heatmap grid wrapped in dynamic swipe viewport container -->
                <div class="overflow-x-auto whitespace-nowrap touch-pan-x pb-2" style="scrollbar-width: none; -webkit-overflow-scrolling: touch;">
                    <div id="planner-heatmap-calendar-container" class="flex flex-wrap gap-1 min-w-[420px] max-w-[550px]" style="display: grid; grid-template-columns: repeat(15, minmax(0, 1fr));">
                        <!-- 15 weeks * 7 days populated dynamically -->
                    </div>
                </div>

                <!-- Legend of heatmap values -->
                <div class="flex justify-between items-center text-[7px] text-slate-400 mt-1 uppercase font-black tracking-wider">
                    <span>Missed Day</span>
                    <div class="flex items-center gap-1">
                        <span>Less</span>
                        <span class="w-1.5 h-1.5 rounded-sm bg-slate-100 dark:bg-slate-700"></span>
                        <span class="w-1.5 h-1.5 rounded-sm bg-emerald-250"></span>
                        <span class="w-1.5 h-1.5 rounded-sm bg-emerald-450"></span>
                        <span class="w-1.5 h-1.5 rounded-sm bg-emerald-650"></span>
                        <span class="w-1.5 h-1.5 rounded-sm bg-emerald-850"></span>
                        <span>More Solved</span>
                    </div>
                    <span>Target Met</span>
                </div>

                <!-- Animated Weekly mini chart indicators -->
                <div class="pt-2.5 border-t border-slate-100 dark:border-slate-700">
                    <span class="text-[9px] font-black text-slate-500 uppercase block mb-1.5 tracking-wider">Weekly target completed flags:</span>
                    <div id="planner-weekly-bar-indicators" class="flex gap-2.5">
                        <!-- Populated dynamically -->
                    </div>
                </div>
            </div>

            <!-- COLLAPSIBLE PLANNER SETTINGS PANEL -->
            <div id="planner-settings-panel" class="hidden p-4 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-2xl shadow-sm space-y-3.5 animate-slide-up">
                <span class="text-xs font-black text-slate-800 dark:text-slate-200 block border-b border-slate-100 dark:border-slate-700 pb-2 uppercase tracking-wide">⚙️ Advanced Planner Settings</span>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
                    <div>
                        <label class="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Daily MCQ Target Solves</label>
                        <input id="planner-config-daily-target" type="number" min="5" max="300" class="w-full p-2 border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs" style="color:var(--text);">
                    </div>
                    <div>
                        <label class="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Weekly MCQ Target Solves</label>
                        <input id="planner-config-weekly-target" type="number" min="20" max="2100" class="w-full p-2 border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs" style="color:var(--text);">
                    </div>
                    <div>
                        <label class="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Syllabus Exam Date</label>
                        <input id="planner-config-exam-date" type="date" class="w-full p-2 border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs" style="color:var(--text);">
                    </div>
                    <div>
                        <label class="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Weak Accuracy Threshold %</label>
                        <input id="planner-config-weak-threshold" type="number" min="10" max="95" class="w-full p-2 border rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-xs" style="color:var(--text);">
                    </div>
                </div>

                <!-- Custom time slot checklist configuration -->
                <div class="text-xs space-y-1.5">
                    <span class="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Active Practice Time Slots</span>
                    <div class="flex gap-4 flex-wrap text-slate-700 dark:text-slate-300">
                        <label class="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
                            <input type="checkbox" id="planner-slot-morning" checked> Morning
                        </label>
                        <label class="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
                            <input type="checkbox" id="planner-slot-afternoon" checked> Afternoon
                        </label>
                        <label class="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
                            <input type="checkbox" id="planner-slot-evening" checked> Evening
                        </label>
                    </div>
                </div>

                <div class="pt-2 flex justify-between gap-2 w-full">
                    <button onclick="resetPlannerSettingsToDefaults(); playSound('click');" class="py-2 px-4 bg-rose-100 hover:bg-red-200 text-rose-700 dark:bg-red-950/40 dark:text-red-400 rounded-xl text-xs font-black uppercase transition cursor-pointer border-none outline-none active:scale-95 select-none">
                        Reset Defaults
                    </button>
                    <button onclick="savePlannerSettingsNew(); playSound('click');" class="py-2 px-6 bg-emerald-650 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase transition shadow-sm cursor-pointer ml-auto border-none outline-none active:scale-95 select-none">
                        Save Configurations
                    </button>
                </div>
            </div>
        </div>

        <!-- MANUAL MCQ CREATOR PAGE -->"""

    new_content = content[:start_idx] + replacement + content[end_idx + len(end_marker):]
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully updated Study Planner in index.html!")
else:
    print("Study Planner Markers not found!")
