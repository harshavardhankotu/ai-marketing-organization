import Database from 'better-sqlite3';
const db = new Database('ai_marketing.sqlite');
console.log('Columns in quota_records:', db.prepare("PRAGMA table_info(quota_records)").all().map(c => c.name));
console.log('Recent quota_records:', db.prepare("SELECT * FROM quota_records ORDER BY rowid DESC LIMIT 10").all());
