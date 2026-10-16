import fs from 'fs';

function getSecret(key) {
  for (const candidate of ['.env.deploy_secrets', '.env.local', '.env.admin_secret']) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8');
      const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return null;
}

const cfToken = getSecret('CLOUDFLARE_API_TOKEN');
const accountId = '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function queryD1(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result?.[0]?.results || [];
}

async function run() {
  const rows = await queryD1(`
    SELECT id, category, topic, signal_type, status 
    FROM demand_signals 
    WHERE id LIKE 'dem_bq_%';
  `);
  console.table(rows);
}

run().catch(console.error);
