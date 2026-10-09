import Database from 'better-sqlite3';
const db = new Database('ai_marketing.sqlite');
console.log('Columns:', db.prepare('PRAGMA table_info(commission_content_assets)').all().map(c => c.name));
const row = db.prepare("SELECT * FROM commission_content_assets WHERE id = 'cnt_ef7c2e87-1'").get();
console.log('Guide Row:', JSON.stringify(row, null, 2));
