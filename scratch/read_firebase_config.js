const fs = require('fs');
const path = require('path');
const https = require('https');

const homeDir = process.env.USERPROFILE || process.env.HOME || '';
const configPath = path.join(homeDir, '.config', 'configstore', 'firebase-tools.json');

try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const token = config.tokens?.access_token;
    
    if (!token) {
        console.error('No token found in config.');
        process.exit(1);
    }
    
    console.log('Token successfully loaded. Fetching Firestore document...');
    
    const syncKey = 'KRISHI-SYNC-J2CA-V1ZT-BGM2-ZZJK';
    const url = `https://firestore.googleapis.com/v1/projects/krishi-mcq-pro/databases/(default)/documents/sync_keys/${syncKey}`;
    
    const options = {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    };
    
    https.get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                console.log('--- Firestore Document Data ---');
                if (json.fields) {
                    console.log('Keys in document:', Object.keys(json.fields));
                    if (json.fields.customQuestions) {
                        console.log('customQuestions is present in Firestore.');
                        const custVal = json.fields.customQuestions;
                        if (custVal.arrayValue && custVal.arrayValue.values) {
                            console.log(`Number of custom questions in the cloud: ${custVal.arrayValue.values.length}`);
                        } else {
                            console.log('customQuestions is present but arrayValue/values is missing or empty:', JSON.stringify(custVal, null, 2));
                        }
                    } else {
                        console.log('customQuestions is NOT present in the cloud document.');
                    }
                    if (json.fields.updatedAt) {
                        console.log('updatedAt in cloud:', JSON.stringify(json.fields.updatedAt));
                    }
                } else {
                    console.log('No fields found. Full response:', JSON.stringify(json, null, 2));
                }
            } catch (e) {
                console.error('Failed to parse response:', e);
                console.log('Raw response:', data);
            }
        });
    }).on('error', (err) => {
        console.error('HTTP Error:', err.message);
    });
} catch (e) {
    console.error('Failed:', e);
}
