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

async function run() {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: `
        PRAGMA table_info(source_rules);
        PRAGMA table_info(product_proposals);
        PRAGMA table_info(learning_records);
        SELECT name FROM sqlite_master WHERE name='stored_reports';
      `
    })
  });
  const data = await res.json();
  console.log('source_rules cols:', data.result?.[0]?.results?.map(c => c.name));
  console.log('product_proposals cols:', data.result?.[1]?.results?.map(c => c.name));
  console.log('learning_records cols:', data.result?.[2]?.results?.map(c => c.name));
  console.log('stored_reports table:', data.result?.[3]?.results);
}

run().catch(console.error);
