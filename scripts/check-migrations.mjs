import fs from 'fs';

let envContent = '';
for (const envFile of ['.env.deploy_secrets', '.env.local', '.env']) {
  if (fs.existsSync(envFile)) {
    envContent = fs.readFileSync(envFile, 'utf8');
    break;
  }
}
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
  if (!data.success) {
    console.error('Cloudflare D1 query error:', JSON.stringify(data.errors));
  }
  return data.result?.[0]?.results || [];
}

async function main() {
  const migrations = await queryD1('SELECT id, migration_name, applied_at FROM _d1_migrations ORDER BY id ASC;');
  console.log(`Total applied migrations in D1: ${migrations.length}`);
  migrations.forEach(m => console.log(`  ID ${m.id}: ${m.migration_name} (${m.applied_at})`));

  // Check if automation_jobs table exists in D1
  const jobTable = await queryD1("SELECT sql FROM sqlite_master WHERE type='table' AND name='automation_jobs';");
  console.log('automation_jobs table in D1:', jobTable);
}

main().catch(console.error);
