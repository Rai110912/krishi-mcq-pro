const fs = require('fs');
const path = require('path');

let v = { version: 'v1' };
try {
    v = JSON.parse(fs.readFileSync('version.json'));
} catch (e) {}

let num = parseInt((v.version || 'v1').replace('v', '')) || 1;
num++;

const buildTime = new Date().toISOString();
const hash = Math.random().toString(36).substring(2, 9);
const cacheName = 'krishi-mcq-v' + num + '-' + hash;

const newV = {
    version: 'v' + num,
    gitHash: hash,
    buildTime: buildTime,
    cacheName: cacheName
};

fs.writeFileSync('version.json', JSON.stringify(newV, null, 2));

try {
    let sw = fs.readFileSync('sw.js', 'utf8');
    sw = sw.replace(/const CACHE_NAME = '.*?';?/, `const CACHE_NAME = '${cacheName}';`);
    sw = sw.replace(/\?v=[a-zA-Z0-9_]+/g, `?v=${hash}`);
    fs.writeFileSync('sw.js', sw);
} catch (e) {
    console.error("Warning: Could not update sw.js");
}

try {
    let indexHtml = fs.readFileSync('index.html', 'utf8');
    indexHtml = indexHtml.replace(/\?v=[a-zA-Z0-9_]+/g, `?v=${hash}`);
    // Keep the human-readable App Version card truthful at build time too
    // (the app also refreshes it from version.json at runtime).
    const compactStamp = String(buildTime).replace(/[^0-9]/g, '').slice(0, 12);
    indexHtml = indexHtml.replace(
        /(id="app-version-badge"[^>]*>)[^<]*/,
        `$1App Version: v${num}-${hash} (${compactStamp})`
    );
    fs.writeFileSync('index.html', indexHtml);
} catch (e) {
    console.error("Warning: Could not update index.html");
}

console.log('  => Generated Version: v' + num);
console.log('  => Cache Name: ' + cacheName);
console.log('  => Cache Buster Query: ?v=' + hash);
