import fs from 'fs';

function loadSecrets() {
  const envContent = fs.readFileSync('.env.deploy_secrets', 'utf8');
  const secrets = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    secrets[key.trim()] = rest.join('=').trim();
  }
  return secrets;
}

const secrets = loadSecrets();
const accountId = secrets.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const databaseId = secrets.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';
const apiToken = secrets.CLOUDFLARE_API_TOKEN;

async function queryD1(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  if (!res.ok) {
    throw new Error(`D1 HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.result?.[0]?.results || [];
}

async function run() {
  const sql = `
    SELECT id, severity, status, recurrence_count, title, rule, guard_type, guard_ref, first_seen, last_seen
    FROM mistakes_board
    ORDER BY CASE status WHEN 'OPEN' THEN 1 ELSE 2 END,
             CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
             id ASC;
  `;
  const rows = await queryD1(sql);
  console.log(`\n=== MISTAKES BOARD: ALL ROWS (${rows.length} total) ===\n`);
  for (const r of rows) {
    console.log(`[${r.status}] [${r.severity}] ${r.id} (recurr: ${r.recurrence_count})`);
    console.log(`  Title: ${r.title}`);
    console.log(`  Rule: ${r.rule}`);
    console.log(`  Guard: ${r.guard_type} -> ${r.guard_ref || 'NONE'}`);
    console.log(`  Dates: ${r.first_seen} to ${r.last_seen}`);
    console.log('');
  }
}

run().catch(console.error);
