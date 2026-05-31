const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;

// Resolve Local IP dynamically
let localIP = '127.0.0.1';
const networkInterfaces = os.networkInterfaces();
for (const devName in networkInterfaces) {
    const iface = networkInterfaces[devName];
    for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
            localIP = alias.address;
            break;
        }
    }
}

// Write dynamic IP configuration for PWA sync QR rendering
try {
    fs.writeFileSync('ip.json', JSON.stringify({ ip: localIP }), 'utf-8');
    console.log(`[Diagnostic] Resolved Local IP: ${localIP}`);
} catch (e) {
    console.warn('[Diagnostic] Failed to write ip.json:', e);
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.xml': 'application/xml',
    '.txt': 'text/plain'
};

const server = http.createServer((req, res) => {
    // Serve index.html as root fallback
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    // Strip URL parameters
    filePath = filePath.split('?')[0];

    // Decode URL character encodings
    filePath = decodeURIComponent(filePath);

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 File Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*' // Enable cross-origin for local testing
            });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`🌾 Krishi MCQ Pro Local Server active at http://localhost:${PORT}/index.html`);
});
