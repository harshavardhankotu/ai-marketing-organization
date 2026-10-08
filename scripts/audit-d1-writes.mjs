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
  console.log('=== VERIFYING QUARANTINE IN D1 ===');
  const call = await queryD1("SELECT id, provider, flag FROM provider_call_logs WHERE id = 'call_1791393061443_spec01'");
  console.log('Quarantined call:', JSON.stringify(call, null, 2));

  const propCols = await queryD1('PRAGMA table_info(product_proposals)');
  console.log('product_proposals columns:', propCols.map(c => c.name));
}

run().catch(console.error);
