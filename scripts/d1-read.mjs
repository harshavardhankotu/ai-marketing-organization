import fs from 'fs';
import path from 'path';

// Load env
const candidatePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), 'packages/backend/.env'),
  path.resolve(process.cwd(), 'packages/backend/.env.local')
];

for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    try {
      const text = fs.readFileSync(p, 'utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.substring(0, eqIdx).trim();
          let val = trimmed.substring(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';
const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

if (!apiToken) {
  console.error('[d1-read] Error: CLOUDFLARE_D1_API_TOKEN not found.');
  process.exit(1);
}

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) {
  console.error('[d1-read] Error: No SQL query provided. Usage: node scripts/d1-read.mjs "SELECT ..."');
  process.exit(1);
}

// Ensure read-only query
if (!/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)) {
  console.error('[d1-read] Error: Only read-only queries (SELECT, PRAGMA, EXPLAIN) are permitted.');
  process.exit(1);
}

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

try {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params: [] }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[d1-read] HTTP ${response.status}: ${errText}`);
    process.exit(1);
  }

  const json = await response.json();
  const result = json?.result?.[0];
  const results = result?.results || [];
  console.log(JSON.stringify(results, null, 2));
} catch (err) {
  console.error(`[d1-read] Request failed: ${err.message}`);
  process.exit(1);
}
