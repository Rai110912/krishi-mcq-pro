const fs = require('fs');
const path = require('path');

console.log('🔍 Starting JSON Database QA Scan...');

const filesToTest = ['questions.json', 'delta_questions.json'];
let hasError = false;

function validateQuestion(q, index, filename) {
    if (!q) return `Item at index ${index} is null or undefined.`;
    if (!q.id && !q.q) return `Item at index ${index} is missing 'id' or 'q'.`;
    if (!q.opts || !Array.isArray(q.opts)) return `Question ID ${q.id} is missing an options array ('opts').`;
    if (typeof q.ans === 'undefined' || q.ans < 0 || q.ans >= q.opts.length) {
        return `Question ID ${q.id} has an invalid answer index ('ans': ${q.ans}).`;
    }
    return null;
}

filesToTest.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️ Warning: ${file} not found. Skipping.`);
        return;
    }

    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let data = JSON.parse(fileContent);

        if (data.added_questions && Array.isArray(data.added_questions)) {
            data = data.added_questions;
        }

        if (!Array.isArray(data)) {
            console.error(`❌ ERROR in ${file}: Root element must be an array!`);
            hasError = true;
            return;
        }

        let errorsFound = 0;
        data.forEach((q, index) => {
            const err = validateQuestion(q, index, file);
            if (err) {
                console.error(`❌ Data Integrity Error in ${file} -> ${err}`);
                hasError = true;
                errorsFound++;
            }
        });

        if (errorsFound === 0) {
            console.log(`✅ ${file} passed QA testing (${data.length} questions validated).`);
        } else {
            console.error(`❌ ${file} FAILED QA with ${errorsFound} errors.`);
        }

    } catch (e) {
        console.error(`❌ FATAL SYNTAX ERROR in ${file}: Cannot parse JSON!`);
        console.error(e.message);
        hasError = true;
    }
});

if (hasError) {
    console.error('\n🚫 QA SCAN FAILED! Deployment aborted to prevent app crash.');
    process.exit(1);
} else {
    console.log('\n🎉 All JSON databases passed QA scan! Ready for deployment.');
    process.exit(0);
}
