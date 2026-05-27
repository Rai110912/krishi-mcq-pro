function adaptiveSpacedRepetition(qid, quality) {
        if (!sm2Data[qid]) {
            sm2Data[qid] = { easeFactor: 2.5, interval: 1, repetitions: 0 };
        }
        let entry = sm2Data[qid];
        if (quality >= 3) {
            if (entry.repetitions === 0) entry.interval = 1;
            else if (entry.repetitions === 1) entry.interval = 6;
            else entry.interval = Math.round(entry.interval * entry.easeFactor);
            entry.repetitions++;
        } else {
            entry.repetitions = 0; entry.interval = 1;
        }
        let next = new Date(); next.setDate(next.getDate() + entry.interval);
        entry.nextReviewDate = getLocalDateString(next);
        saveSM2();
    }

function loadSM2(){
        sm2Data = Storage.getJSON('krishi_sm2', {});
        
        // Backward compatibility migration from legacy krishi_review to sm2Data
        try {
            let legacyRaw = localStorage.getItem('krishi_review');
            if (legacyRaw) {
                let legacyData = JSON.parse(legacyRaw);
                if (legacyData && typeof legacyData === 'object' && !Array.isArray(legacyData)) {
                    let migrated = false;
                    Object.entries(legacyData).forEach(([qid, date]) => {
                        let id = parseInt(qid);
                        if (!isNaN(id)) {
                            if (!sm2Data[id]) {
                                sm2Data[id] = { 
                                    easeFactor: 2.5, 
                                    interval: 1, 
                                    repetitions: 0,
                                    nextReviewDate: date
                                };
                                migrated = true;
                            } else if (!sm2Data[id].nextReviewDate) {
                                sm2Data[id].nextReviewDate = date;
                                migrated = true;
                            }
                        }
                    });
                    if (migrated) {
                        console.log('[PWA Safety] Successfully migrated legacy spaced repetition data to sm2Data.');
                        saveSM2();
                    }
                }
                localStorage.removeItem('krishi_review');
            }
        } catch(e) {
            console.warn('[PWA Safety] Failed to migrate legacy review data:', e);
            localStorage.removeItem('krishi_review');
        }
    }

function saveSM2(){ 
        Storage.setJSON('krishi_sm2', sm2Data); 
        // थपिएको: स्पेस रिपिटिसनको डाटा पनि तत्कालै मोबाइल मेमोरीमा लेख्न लगाउने
        try { Storage.flush(); } catch(e) {}
        triggerBackgroundSync();
    }

function getAdaptiveDueQuestions() {
        let today = getLocalDateString();
        let due = [];
        for(let id in sm2Data){
            if(sm2Data[id].nextReviewDate <= today) due.push(parseInt(id));
        }
        return due;
    }