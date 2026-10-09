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
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`D1 Query Error: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result?.[0]?.results || [];
}

async function run() {
  console.log('=== QUERY 1: owner_intake ===');
  try {
    const q1 = await queryD1('SELECT id, status, written_by, created_at FROM owner_intake');
    console.log(JSON.stringify(q1, null, 2));
  } catch (e) {
    console.log('Query 1 error:', e.message);
  }

  console.log('\n=== QUERY 2: product_proposals ===');
  try {
    const q2 = await queryD1('SELECT id, status, provenance, approved_at FROM product_proposals');
    console.log(JSON.stringify(q2, null, 2));
  } catch (e) {
    console.log('Query 2 error (checking with product_checked_at if approved_at fails):', e.message);
    try {
      const q2b = await queryD1('SELECT id, status, provenance, product_checked_at FROM product_proposals');
      console.log('Query 2 (fallback with product_checked_at):', JSON.stringify(q2b, null, 2));
    } catch (e2) {
      console.log('Query 2b error:', e2.message);
    }
  }

  console.log('\n=== QUERY 3: partner_offers ===');
  try {
    const q3 = await queryD1('SELECT COUNT(*) as count FROM partner_offers');
    console.log(JSON.stringify(q3, null, 2));
  } catch (e) {
    console.log('Query 3 error:', e.message);
  }

  console.log('\n=== QUERY 4: commission_content_assets ===');
  try {
    const q4 = await queryD1('SELECT status, COUNT(*) as count FROM commission_content_assets GROUP BY status');
    console.log(JSON.stringify(q4, null, 2));
  } catch (e) {
    console.log('Query 4 error:', e.message);
  }
}

run().catch(console.error);
