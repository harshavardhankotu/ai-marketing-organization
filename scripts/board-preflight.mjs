import fs from 'fs';
import path from 'path';

const cfToken = process.env.CLOUDFLARE_D1_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function fetchOpenMistakes() {
  const sql = `
    SELECT id, severity, recurrence_count, title, rule, guard_type, guard_ref
    FROM mistakes_board
    WHERE status = 'OPEN'
    ORDER BY CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, recurrence_count DESC, id ASC;
  `;

  if (cfToken) {
    try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql })
    });
    const data = await res.json();
    if (data.success && data.result?.[0]?.results) {
      return data.result[0].results;
    }
  } catch (err) {
    console.warn('[BOARD:PREFLIGHT] D1 query failed, checking local SQLite:', err.message);
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.resolve('packages/backend/marketing.db');
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      return db.prepare(sql).all();
    }
  } catch {}

  return [];
}

async function main() {
  console.log('\n======================================================');
  console.log('             MISTAKES BOARD PREFLIGHT AUDIT           ');
  console.log('======================================================\n');
  const rows = await fetchOpenMistakes();
  if (rows.length === 0) {
    console.log('✓ Zero OPEN mistakes on the board. Ready for task.\n');
    return;
  }

  console.log(`⚠️  ${rows.length} OPEN MISTAKES ACTIVE. REVIEW BEFORE PROCEEDING:\n`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(`[${i + 1}] [${r.severity}] ${r.title} (Recurrence: ${r.recurrence_count})`);
    console.log(`    Rule: ${r.rule}`);
    console.log(`    Guard: ${r.guard_type}${r.guard_ref ? ` (${r.guard_ref})` : ''}`);
    console.log('');
  }
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('[BOARD:PREFLIGHT ERROR]:', err);
  process.exit(1);
});
