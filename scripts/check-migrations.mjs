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
  const migrations = await queryD1('SELECT name, applied_at FROM d1_migrations ORDER BY applied_at ASC;');
  console.log('Applied migrations in D1:');
  console.log(JSON.stringify(migrations, null, 2));
}

main().catch(console.error);
