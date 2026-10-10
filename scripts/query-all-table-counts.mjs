import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const secrets = {};
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const [k, ...rest] = t.split('=');
  secrets[k.trim()] = rest.join('=').trim();
}
const accountId = secrets.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const databaseId = secrets.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';
const apiToken = secrets.CLOUDFLARE_API_TOKEN;

async function queryD1(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql })
  });
  const data = await res.json();
  return data.result?.[0]?.results || [];
}

async function main() {
  const tables = await queryD1("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;");
  console.log('Total tables in sqlite_master:', tables.length);
  const nonEmpty = [];
  const allCounts = [];

  for (const t of tables) {
    try {
      const cntRes = await queryD1(`SELECT COUNT(*) as c FROM ${t.name};`);
      const count = cntRes[0]?.c ?? 0;
      allCounts.push({ table: t.name, count });
      if (count > 0) {
        nonEmpty.push({ table: t.name, count });
      }
    } catch(err) {
      allCounts.push({ table: t.name, error: err.message });
    }
  }

  console.log('=== RAW COUNTS ON EVERY TABLE ===');
  console.log(JSON.stringify(allCounts, null, 2));

  console.log(`\n=== NON-EMPTY TABLES (${nonEmpty.length}) ===`);
  console.log(JSON.stringify(nonEmpty, null, 2));
}

main().catch(console.error);
