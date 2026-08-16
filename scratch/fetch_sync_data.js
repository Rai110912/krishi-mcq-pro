const https = require('https');

const url = 'https://firestore.googleapis.com/v1/projects/krishi-mcq-pro/databases/(default)/documents/sync_keys/KRISHI-SYNC-J2CA-V1ZT-BGM2-ZZJK';

https.get(url, (res) => {
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
                    // Print length or first item
                    if (custVal.arrayValue && custVal.arrayValue.values) {
                        console.log(`Number of custom questions: ${custVal.arrayValue.values.length}`);
                        console.log('First custom question:', JSON.stringify(custVal.arrayValue.values[0], null, 2));
                    } else {
                        console.log('customQuestions is present but arrayValue/values is missing or empty:', JSON.stringify(custVal, null, 2));
                    }
                } else {
                    console.log('customQuestions is NOT present in the cloud document.');
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
