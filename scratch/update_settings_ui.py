import os

html_path = r"d:\Downloads\test file of Mcq pro\index.html"
with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Locate the target block
start_marker = '            <div id="settings-group-general" class="space-y-4">'
end_marker = '            </div><!-- Close settings-group-general -->'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    end_idx += len(end_marker)
    target_block = content[start_idx:end_idx]
    print("Found target block of length:", len(target_block))
    
    # Define our replacement HTML
    replacement = """            <div id="settings-group-general" class="space-y-3.5">
                
                <!-- ACCORDION 1: GEMINI AI INTEGRATION -->
                <div class="rounded-2xl border bg-white dark:bg-slate-800 overflow-hidden transition-all duration-300 shadow-sm hover:shadow-md" style="border-color:var(--border);">
                    <!-- Accordion Trigger Header -->
                    <button onclick="toggleSettingsAccordion('gemini'); playSound('click');" class="w-full p-4 flex justify-between items-center text-left bg-slate-50/50 dark:bg-slate-900/50 cursor-pointer border-none outline-none select-none">
                        <div class="flex items-center gap-3">
                            <span class="text-xl p-2 bg-indigo-500/10 rounded-xl text-indigo-500 flex items-center justify-center">🤖</span>
                            <div>
                                <h3 class="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">Gemini AI Integration</h3>
                                <p class="text-[8px] text-slate-400 mt-0.5">Automated agricultural MCQ generator configurations</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span id="gemini-status-badge" class="text-[8px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">Empty ⚪</span>
                            <span id="accordion-chevron-gemini" class="text-[9px] text-slate-400 transition-transform duration-350 select-none">▼</span>
                        </div>
                    </button>
                    
                    <!-- Accordion Body Content -->
                    <div id="accordion-body-gemini" class="hidden p-4 border-t space-y-3.5" style="border-color:var(--border);">
                        <div class="space-y-1">
                            <label class="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Gemini API Key</label>
                            <div class="relative flex items-center">
                                <input id="gemini-api-key" type="password" class="w-full p-2.5 pr-10 border rounded-xl text-xs font-mono" placeholder="Paste your Gemini API Key here..." style="border-color:var(--border); color:var(--text); background:var(--card);">
                                <button onclick="toggleKeyVisibility()" class="absolute right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                                    <span id="eye-icon">👁️</span>
                                </button>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-[9px] font-black uppercase text-slate-400 tracking-wider block">AI Model</label>
                                <select id="gemini-model-select" onchange="saveGeminiSettings()" class="w-full p-2 border rounded-xl text-xs bg-slate-50 dark:bg-slate-900" style="border-color:var(--border); color:var(--text);">
                                    <option value="gemini-1.5-flash" selected>Gemini 1.5 Flash (Fast & Free)</option>
                                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Analysis)</option>
                                    <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp (Next-Gen)</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Generation Temperature</label>
                                <select id="gemini-temp-select" onchange="saveGeminiSettings()" class="w-full p-2 border rounded-xl text-xs bg-slate-50 dark:bg-slate-900" style="border-color:var(--border); color:var(--text);">
                                    <option value="0.3">0.3 (Strict & Fact-Driven)</option>
                                    <option value="0.7" selected>0.7 (Balanced & Creative)</option>
                                    <option value="1.0">1.0 (Highly Diverse Questions)</option>
                                </select>
                            </div>
                        </div>

                        <!-- Segmented Pill Button controls -->
                        <div class="flex gap-2 pt-1">
                            <button onclick="validateAndSaveApiKey()" id="btn-save-key" class="flex-1 bg-emerald-650 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer flex justify-center items-center gap-1.5 transition active:scale-95">
                                <span id="key-spinner" class="hidden animate-spin">⏳</span> Verify & Save
                            </button>
                            <button onclick="clearApiKey()" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-955 px-4 py-2.5 rounded-xl font-bold text-xs cursor-pointer transition active:scale-95" style="border: 1px solid var(--border); color:var(--text);">Clear</button>
                        </div>
                    </div>
                </div>
                
                <!-- ACCORDION 2: CLOUD SYNC & LINKED PRESENCE -->
                <div class="rounded-2xl border bg-white dark:bg-slate-800 overflow-hidden transition-all duration-300 shadow-sm hover:shadow-md" style="border-color:var(--border);">
                    <!-- Accordion Trigger Header -->
                    <button onclick="toggleSettingsAccordion('sync'); playSound('click');" class="w-full p-4 flex justify-between items-center text-left bg-slate-50/50 dark:bg-slate-900/50 cursor-pointer border-none outline-none select-none">
                        <div class="flex items-center gap-3">
                            <span class="text-xl p-2 bg-indigo-500/10 rounded-xl text-indigo-500 flex items-center justify-center">☁️</span>
                            <div>
                                <h3 class="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">Cloud Sync & Device Link</h3>
                                <p class="text-[8px] text-slate-400 mt-0.5">Sync study database and link multiple devices</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span id="sync-status-badge" class="text-[8px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">Not logged in ⚪</span>
                            <span id="accordion-chevron-sync" class="text-[9px] text-slate-400 transition-transform duration-350 select-none">▼</span>
                        </div>
                    </button>
                    
                    <!-- Accordion Body Content -->
                    <div id="accordion-body-sync" class="hidden p-4 border-t space-y-3.5" style="border-color:var(--border);">
                        <!-- Connection Summary bar -->
                        <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/60 border text-[10px] font-bold text-center flex justify-between items-center" style="border-color:var(--border);">
                            <span class="text-slate-400 block uppercase tracking-wider text-[8px] text-left">Active Session Status</span>
                            <span id="auth-user-email-display" class="font-bold text-[10px]" style="color:var(--text);">No active session</span>
                        </div>

                        <!-- Firebase Credentials setup toggle link -->
                        <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/60 border flex justify-between items-center" style="border-color:var(--border);">
                            <div>
                                <span class="text-[10px] font-black block" style="color:var(--text);">🔑 Firebase API Config</span>
                                <p class="text-[8px] text-slate-400 dark:text-slate-500">Input custom database config keys</p>
                            </div>
                            <button onclick="openCloudConfigModal()" class="px-3 py-1 bg-indigo-500 hover:bg-indigo-650 text-white rounded-lg text-[9px] font-black cursor-pointer transition active:scale-95">Configure</button>
                        </div>

                        <!-- Authentication Form (Shown when logged out) -->
                        <div id="auth-login-form" class="space-y-2.5 text-xs">
                            <div class="space-y-1">
                                <label class="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Email Address</label>
                                <input id="firebase-auth-email" type="email" class="w-full p-2 border rounded-xl text-xs" placeholder="student@krishi.com" style="border-color:var(--border); color:var(--text); background:var(--card);">
                            </div>
                            <div class="space-y-1">
                                <label class="text-[9px] font-black uppercase text-slate-400 tracking-wider block">Password</label>
                                <input id="firebase-auth-password" type="password" class="w-full p-2 border rounded-xl text-xs" placeholder="••••••••" style="border-color:var(--border); color:var(--text); background:var(--card);">
                            </div>
                            <div class="grid grid-cols-2 gap-2.5 pt-1">
                                <button onclick="handleFirebaseLogin(); playSound('click');" class="bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer transition active:scale-95">Sign In 🔐</button>
                                <button onclick="handleFirebaseSignup(); playSound('click');" class="bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer transition active:scale-95">Sign Up 🚀</button>
                            </div>
                        </div>

                        <!-- Logged In Content Group (Shown when logged in) -->
                        <div id="auth-loggedin-controls" class="hidden space-y-3.5">
                            <!-- Setup Link Panel (Sync inactive) -->
                            <div id="sync-setup-panel" class="space-y-3 border-t border-dashed pt-3" style="border-color:var(--border);">
                                <p class="text-[9px] text-slate-400 leading-normal">Enter a shared cloud key, scan one, or generate a new one to pair devices.</p>
                                <div class="flex gap-2">
                                    <input id="cloud-sync-key-input" type="text" class="flex-1 p-2 border rounded-xl text-xs font-mono" placeholder="Enter Sync Key (KRISHI-SYNC-...)" style="border-color:var(--border); color:var(--text); background:var(--card);">
                                    <button onclick="openQRScanner(); playSound('click');" class="bg-indigo-650 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl font-bold text-xs cursor-pointer transition flex items-center gap-1 active:scale-95">📷 Scan</button>
                                    <button onclick="generateNewSyncKey()" class="bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-950 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-xl border font-bold text-xs cursor-pointer transition active:scale-95" style="border-color:var(--border);">Generate</button>
                                </div>
                                <button onclick="enableCloudSync()" class="w-full bg-emerald-650 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer transition active:scale-95">Enable Auto-Sync</button>
                            </div>
                            
                            <!-- Active Connected Sync Panel (Sync active) -->
                            <div id="sync-active-panel" class="hidden space-y-3.5 border-t border-dashed pt-3 text-xs" style="border-color:var(--border);">
                                
                                <!-- Premium 2x2 Stats Grid Card Dashboard (Upgrade 2) -->
                                <div class="space-y-2">
                                    <div class="flex justify-between items-center text-[10px]">
                                        <span class="text-slate-400 font-bold uppercase tracking-wider">📊 Sync Statistics</span>
                                        <span id="sync-badge-status" class="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-emerald-500/10 text-emerald-500">Synced</span>
                                    </div>
                                    <div class="grid grid-cols-2 gap-2 text-xs">
                                        <!-- Bookmarks card -->
                                        <div class="p-3 rounded-xl border flex flex-col justify-between bg-indigo-500/5 hover:bg-indigo-500/10 transition duration-150" style="border-color:var(--border);">
                                            <div class="flex justify-between items-center text-[8px] font-bold text-indigo-500 uppercase tracking-wider">
                                                <span>Bookmarks</span>
                                                <span>🔖</span>
                                            </div>
                                            <span id="sync-stat-bookmarks" class="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">0</span>
                                        </div>
                                        <!-- Errors card -->
                                        <div class="p-3 rounded-xl border flex flex-col justify-between bg-rose-500/5 hover:bg-rose-500/10 transition duration-150" style="border-color:var(--border);">
                                            <div class="flex justify-between items-center text-[8px] font-bold text-rose-500 uppercase tracking-wider">
                                                <span>Errors</span>
                                                <span>🔴</span>
                                            </div>
                                            <span id="sync-stat-mistakes" class="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">0</span>
                                        </div>
                                        <!-- Streak card -->
                                        <div class="p-3 rounded-xl border flex flex-col justify-between bg-amber-500/5 hover:bg-amber-500/10 transition duration-150" style="border-color:var(--border);">
                                            <div class="flex justify-between items-center text-[8px] font-bold text-amber-500 uppercase tracking-wider">
                                                <span>Streak</span>
                                                <span>🔥</span>
                                            </div>
                                            <span id="sync-stat-streak" class="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">0 days</span>
                                        </div>
                                        <!-- Logs card -->
                                        <div class="p-3 rounded-xl border flex flex-col justify-between bg-emerald-500/5 hover:bg-emerald-500/10 transition duration-150" style="border-color:var(--border);">
                                            <div class="flex justify-between items-center text-[8px] font-bold text-emerald-500 uppercase tracking-wider">
                                                <span>Study Logs</span>
                                                <span>📅</span>
                                            </div>
                                            <span id="sync-stat-logs" class="text-sm font-black text-slate-800 dark:text-slate-100 mt-1">0 entries</span>
                                        </div>
                                    </div>
                                </div>

                                <!-- Credentials key sharing Card -->
                                <div class="p-3 rounded-xl bg-white dark:bg-slate-800 border flex flex-col items-center gap-3 text-center" style="border-color:var(--border);">
                                    <div id="sync-key-lock-overlay" class="w-full py-4 flex flex-col items-center justify-center gap-2">
                                        <span class="text-2xl animate-bounce">🔒</span>
                                        <p class="text-[9px] text-slate-400">Exposing Sync credentials requires authentication</p>
                                        <button onclick="authenticateForSyncCredentials()" class="mt-1 bg-indigo-650 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-[10px] cursor-pointer transition active:scale-95">🔓 Authorize Credentials</button>
                                    </div>
                                    
                                    <div id="sync-key-credentials-card" class="hidden w-full flex flex-col items-center gap-3">
                                        <div class="w-full flex justify-between items-center text-[9px]">
                                            <span class="text-slate-400 font-bold uppercase text-left">Scan to Link Device</span>
                                            <button onclick="copyActiveSyncKey()" class="text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer">Copy Key 📋</button>
                                        </div>
                                        <div class="p-2.5 bg-white rounded-xl border flex items-center justify-center">
                                            <div id="sync-qrcode-container" class="flex justify-center items-center w-[120px] h-[120px]"></div>
                                        </div>
                                        <span id="active-sync-key-display" class="font-mono text-xs font-bold tracking-wider py-1.5 px-4 bg-slate-50 dark:bg-slate-900 rounded-xl border w-full text-center" style="border-color:var(--border); color:var(--text);">KRISHI-ABCD-1234</span>
                                    </div>
                                </div>

                                <!-- Linked devices presence list (Upgrade 5: Pulse glows) -->
                                <div class="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/70 border space-y-2.5" style="border-color:var(--border);">
                                    <div class="flex justify-between items-center text-[9px]">
                                        <span class="text-slate-400 font-bold uppercase tracking-wider">📱 Connected Devices Presence</span>
                                        <span class="flex h-2.5 w-2.5 relative">
                                            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                        </span>
                                    </div>
                                    <div id="sync-connected-devices-list" class="space-y-1.5 max-h-[100px] overflow-y-auto pr-1 text-[9px] text-slate-500 dark:text-slate-400">
                                        <div class="text-center py-2 text-slate-400">Loading active sync peers...</div>
                                    </div>
                                </div>

                                <!-- Operations pill group -->
                                <div class="flex gap-2">
                                    <button onclick="syncCloudNow()" id="btn-sync-now" class="flex-1 bg-emerald-650 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer flex justify-center items-center gap-1.5 transition active:scale-95 shadow-sm">
                                        <span id="sync-spinner" class="hidden animate-spin">⏳</span> Sync Now
                                    </button>
                                    <button onclick="disableCloudSync()" class="flex-1 bg-rose-650 hover:bg-rose-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer transition active:scale-95 shadow-sm">Disable Sync</button>
                                </div>
                                <p id="sync-time-txt" class="text-[8px] text-center text-slate-400">Last Synced: Never</p>
                            </div>

                            <button onclick="handleFirebaseLogout(); playSound('click');" class="w-full border hover:bg-slate-50 dark:hover:bg-slate-900 py-2.5 rounded-xl font-bold text-xs cursor-pointer transition text-rose-500 active:scale-95" style="border-color:var(--border);">Sign Out & Disconnect 🚪</button>
                        </div>
                    </div>
                </div>

                <!-- ACCORDION 3: OFFLINE BACKUP & PERFORMANCE DIAGNOSTICS -->
                <div class="rounded-2xl border bg-white dark:bg-slate-800 overflow-hidden transition-all duration-300 shadow-sm hover:shadow-md" style="border-color:var(--border);">
                    <!-- Accordion Trigger Header -->
                    <button onclick="toggleSettingsAccordion('backup'); playSound('click');" class="w-full p-4 flex justify-between items-center text-left bg-slate-50/50 dark:bg-slate-900/50 cursor-pointer border-none outline-none select-none">
                        <div class="flex items-center gap-3">
                            <span class="text-xl p-2 bg-indigo-500/10 rounded-xl text-indigo-500 flex items-center justify-center">💾</span>
                            <div>
                                <h3 class="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">Backup & Performance</h3>
                                <p class="text-[8px] text-slate-400 mt-0.5">Export backup progress and toggle diagnostic performance gauges</p>
                            </div>
                        </div>
                        <span id="accordion-chevron-backup" class="text-[9px] text-slate-400 transition-transform duration-350 select-none">▼</span>
                    </button>
                    
                    <!-- Accordion Body Content -->
                    <div id="accordion-body-backup" class="hidden p-4 border-t space-y-3.5" style="border-color:var(--border);">
                        <!-- Export/Import backup pill button group -->
                        <div class="grid grid-cols-2 gap-2 text-xs">
                            <button onclick="exportLocalProgress(); playSound('click');" class="bg-indigo-650 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer transition flex justify-center items-center gap-1.5 shadow-sm active:scale-95">
                                📥 Export Progress
                            </button>
                            <button onclick="document.getElementById('import-progress-file-input').click(); playSound('click');" class="bg-emerald-650 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-xs cursor-pointer transition flex justify-center items-center gap-1.5 shadow-sm active:scale-95">
                                📤 Import Progress
                            </button>
                            <input id="import-progress-file-input" type="file" accept=".json" class="hidden" onchange="importLocalProgress(this)">
                        </div>

                        <!-- FPS overlay switch (Upgrade 3: iOS custom toggle switch) -->
                        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50/70 dark:bg-slate-900/60 border text-xs" style="border-color:var(--border);">
                            <div class="flex flex-col gap-0.5">
                                <span class="font-bold text-[10px]" style="color:var(--text);">Rendering Diagnostics Overlay</span>
                                <span class="text-[8px] text-slate-400 leading-tight">Display real-time frames per second (FPS) performance monitor.</span>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer select-none">
                                <input id="toggle-fps-monitor" type="checkbox" onchange="toggleFPSMonitorOverlay(this.checked)" class="sr-only peer">
                                <div class="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-350 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                            </label>
                        </div>
                    </div>
                </div>

            </div><!-- Close settings-group-general -->"""

    new_content = content[:start_idx] + replacement + content[end_idx:]
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Successfully updated index.html!")
else:
    print("Markers not found!")
