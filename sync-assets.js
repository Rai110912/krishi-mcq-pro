const fs = require('fs');
const path = require('path');

const FILES_TO_COPY = [
    'index.html',
    'index.css',
    'manifest.json',
    'sw.js',
    'icon.svg',
    'questions.json',
    'ip.json',
    'version.json',
    'delta_questions.json',
    'login-helper.html'
];

const DIRS_TO_COPY = [
    'assets',
    'js'
];

const SRC_DIR = __dirname;
const DEST_DIR = path.join(__dirname, 'www');

// Ensure destination exists
if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
}

function copyFileSync(src, dest) {
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`[Sync] Copied: ${path.basename(src)} -> www/${path.basename(dest)}`);
    } else {
        if (path.basename(src) !== 'ip.json') {
            console.log(`[Sync] Warning: Source file not found: ${path.basename(src)}`);
        }
    }
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('🌾 Krishi MCQ Pro Asset Sync started...');

// Copy Dirs
DIRS_TO_COPY.forEach(dir => {
    const srcPath = path.join(SRC_DIR, dir);
    const destPath = path.join(DEST_DIR, dir);
    copyDirSync(srcPath, destPath);
    console.log(`[Sync] Synced directory: ${dir} -> www/${dir}`);
});

// Copy Files
FILES_TO_COPY.forEach(file => {
    copyFileSync(path.join(SRC_DIR, file), path.join(DEST_DIR, file));
});

console.log('🎉 Krishi MCQ Pro Asset Sync complete!');
