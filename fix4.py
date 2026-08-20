import codecs

with codecs.open('js/app.js', 'r', 'utf-8') as f:
    content = f.read()

# Replace countdown logic
old_countdown = '''                if (diffDays > 0) {
                    hprofileCountdown.innerHTML = `Y". <span id="anim-countdownVal">${diffDays}</span> days remaining`;
                    animateNumericText(document.getElementById('anim-countdownVal'), diffDays);
                } else {'''

# Since we might have weird unicode, let's just do a regex replace so we don't mess up the emoji
import re
content = re.sub(
    r'if \(diffDays > 0\) \{\s*hprofileCountdown\.innerHTML = `([^`]+)`;\s*animateNumericText\(document\.getElementById\(\'anim-countdownVal\'\), diffDays\);\s*\} else \{',
    r'if (diffDays > 0) {\n                    let newHtml = `\1`;\n                    if (hprofileCountdown.innerHTML !== newHtml) {\n                        hprofileCountdown.innerHTML = newHtml;\n                        animateNumericText(document.getElementById(\'anim-countdownVal\'), diffDays);\n                    }\n                } else {',
    content
)

# Replace target logic
content = re.sub(
    r'let dailyT = sPlanner\.dailyTarget \|\| 50;\s*hprofileTargets\.innerHTML = `([^`]+)`;\s*animateNumericText\(document\.getElementById\(\'anim-dailyTargetVal\'\), dailyT\);',
    r'let dailyT = sPlanner.dailyTarget || 50;\n                let newHtml = `\1`;\n                if (hprofileTargets.innerHTML !== newHtml) {\n                    hprofileTargets.innerHTML = newHtml;\n                    animateNumericText(document.getElementById(\'anim-dailyTargetVal\'), dailyT);\n                }',
    content
)

with codecs.open('js/app.js', 'w', 'utf-8') as f:
    f.write(content)

print('Success')
