import codecs
import re

with codecs.open('js/app.js', 'r', 'utf-8') as f:
    content = f.read()

# We want to replace the cloud sync block inside savePracticeProgress
# The block starts at `// Sync to Firestore if online and authenticated`
# and ends at `});` just before `} else {` for local only HUD update.

old_block_pattern = r"// Sync to Firestore if online and authenticated\s*const uid = [^\n]+\n\s*if \(uid && navigator\.onLine && window\.firebase && firebase\.apps && firebase\.apps\.length\) \{\s*let existingApp = firebase\.apps\.find[^\n]+\n\s*let firebaseApp = existingApp[^\n]+\n\s*if \(firebaseApp\) \{\s*const firestore = firebase\.firestore\(firebaseApp\);\s*firestore\.collection\('users'\)\.doc\(uid\)\.collection\('active_session'\)\.doc\('progress'\)\.set\(\{[^\}]+\}\)\.then\(\(\) => \{.*?\n\s*\}\)\.catch\(err => \{.*?\n\s*\}\);\s*\}\s*\}"

new_block = """// Sync to Firestore if online and authenticated (Debounced)
            const uid = (typeof getCloudUID === 'function') ? getCloudUID() : null;
            if (uid && navigator.onLine && window.firebase && firebase.apps && firebase.apps.length) {
                if (window.cloudSavePracticeTimeout) clearTimeout(window.cloudSavePracticeTimeout);
                window.cloudSavePracticeTimeout = setTimeout(() => {
                    let existingApp = firebase.apps.find(app => app.name === "KrishiApp");
                    let firebaseApp = existingApp || firebase.app("KrishiApp");
                    if (firebaseApp) {
                        const firestore = firebase.firestore(firebaseApp);
                        firestore.collection('users').doc(uid).collection('active_session').doc('progress').set(progressData).then(() => {
                            console.log('[Cloud Sync] Active practice session saved successfully (Debounced).');
                            if (indicator) {
                                let dot = indicator.querySelector('span');
                                let txt = indicator.querySelector('.indicator-text');
                                if (dot && txt) {
                                    dot.className = 'w-1.5 h-1.5 rounded-full transition-colors duration-300';
                                    dot.classList.add('autosave-glow-active');
                                    txt.textContent = 'Autosaved';
                                    txt.style.color = '#10b981';
                                    setTimeout(() => {
                                        if (txt.textContent === 'Autosaved') {
                                            txt.textContent = 'Connected';
                                            txt.style.color = '';
                                        }
                                    }, 2000);
                                }
                            }
                        }).catch(err => {
                            console.warn('[Cloud Sync] Active practice session save failed:', err);
                            if (indicator) {
                                let dot = indicator.querySelector('span');
                                let txt = indicator.querySelector('.indicator-text');
                                if (dot && txt) {
                                    dot.className = 'w-1.5 h-1.5 rounded-full bg-slate-350 dark:bg-slate-600 transition-colors duration-300';
                                    txt.textContent = 'Local Only';
                                    txt.style.color = '';
                                }
                            }
                        });
                    }
                }, 3000);
            }"""

new_content = re.sub(old_block_pattern, new_block, content, flags=re.DOTALL)

if new_content == content:
    print('Failed to replace! Regex might be wrong.')
else:
    with codecs.open('js/app.js', 'w', 'utf-8') as f:
        f.write(new_content)
    print('Success')
