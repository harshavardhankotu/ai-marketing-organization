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
  console.log('=== FULL AUDIT OF PRODUCTION D1 TABLES ===');
  const tableRows = await queryD1("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
  const tables = tableRows.map(r => r.name);
  console.log(`Discovered ${tables.length} tables in D1.\n`);

  const nonEmpty = [];
  for (const table of tables) {
    try {
      const res = await queryD1(`SELECT COUNT(*) as count FROM ${table}`);
      const count = res[0]?.count ?? 0;
      if (count > 0) {
        nonEmpty.push({ table, count });
        console.log(`[TABLE] ${table}: ${count} rows`);
        // Check columns
        const cols = await queryD1(`PRAGMA table_info(${table})`);
        const colNames = cols.map(c => c.name);
        const hasProvenance = colNames.includes('provenance');
        const hasFlag = colNames.includes('flag');
        const hasStatus = colNames.includes('status');
        console.log(`  Columns (${colNames.length}): provenance=${hasProvenance}, flag=${hasFlag}, status=${hasStatus}`);

        // Sample up to 3 rows
        const sample = await queryD1(`SELECT * FROM ${table} LIMIT 3`);
        console.log(`  Sample:`, JSON.stringify(sample, null, 2));
      }
    } catch (e) {
      console.log(`[ERROR] ${table}: ${e.message}`);
    }
  }

  console.log('\n=== SUMMARY OF NON-EMPTY TABLES ===');
  console.table(nonEmpty);
}

run().catch(console.error);
