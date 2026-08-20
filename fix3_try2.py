import codecs

with codecs.open('js/app.js', 'r', 'utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'historyContainer.innerHTML = `' in line and 'if (historyList.length === 0) {' in lines[i-1]:
        lines[i] = '                let newHtml = `\n'
    elif 'historyContainer.innerHTML = historyList.slice' in line and '} else {' in lines[i-1]:
        lines[i] = line.replace('historyContainer.innerHTML =', 'newHtml =')
    elif '}).join(\'\');' in line and '}' in lines[i+1] and 'if (typeof translateAppLabels === \'function\')' in lines[i+4]:
        # we found the end of the historyContainer else block!
        pass

# wait, I can just do string replace but normalize line endings first.
content = "".join(lines)

# we know the lines where `historyContainer.innerHTML =` are used.
content = content.replace("historyContainer.innerHTML = historyList.slice(0, 5).map(item => `", "let newHtml2 = historyList.slice(0, 5).map(item => `")
content = content.replace("historyContainer.innerHTML = `", "let newHtml1 = `")

# Now we need to actually apply it... this is getting messy.
