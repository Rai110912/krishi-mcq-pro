import re

with open('js/pwa_helpers.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix in getDueQuestions
fix_get_due = """    static getDueQuestions(allQuestions) {
        if (!Array.isArray(allQuestions) || allQuestions.length === 0) return [];
        const data = this._getData();
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const now = todayEnd.getTime();"""
content = re.sub(r"    static getDueQuestions\(allQuestions\)\s*\{[\s\S]*?const now = Date\.now\(\);", fix_get_due, content)

# Fix in getStats
fix_get_stats = """    static getStats() {
        const data = this._getData();
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const now = todayEnd.getTime();"""
content = re.sub(r"    static getStats\(\)\s*\{[\s\S]*?const now = Date\.now\(\);", fix_get_stats, content)

with open('js/pwa_helpers.js', 'w', encoding='utf-8') as f:
    f.write(content)
