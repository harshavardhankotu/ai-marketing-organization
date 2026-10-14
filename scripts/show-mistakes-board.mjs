import fs from 'fs';
import path from 'path';

function getCfToken() {
  if (process.env.CLOUDFLARE_D1_API_TOKEN) return process.env.CLOUDFLARE_D1_API_TOKEN;
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const envFile of ['.env.local', '.env.deploy_secrets']) {
    const envPath = path.resolve(envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/CLOUDFLARE_API_TOKEN=([^\r\n]+)/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

const cfToken = getCfToken();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function queryD1(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });
  return await res.json();
}

async function main() {
  const sqlPrompt = 'SELECT id, status, severity, guard_type, guard_ref, updated_at FROM mistakes_board ORDER BY updated_at;';
  console.log('=== RUNNING PROMPT QUERY ===');
  console.log('Query:', sqlPrompt);
  try {
    const resPrompt = await queryD1(sqlPrompt);
    console.log('D1 Response:', JSON.stringify(resPrompt, null, 2));
  } catch (err) {
    console.log('D1 Error:', err.message);
  }

  const sqlActual = 'SELECT id, status, severity, guard_type, guard_ref, last_seen FROM mistakes_board ORDER BY id ASC;';
  console.log('\n=== RUNNING ACTUAL SCHEMA QUERY ===');
  console.log('Query:', sqlActual);
  const resActual = await queryD1(sqlActual);
  if (resActual.success && resActual.result?.[0]?.results) {
    console.log(`Total rows: ${resActual.result[0].results.length}`);
    for (const r of resActual.result[0].results) {
      console.log(`- [${r.status}] [${r.severity}] ${r.id} | guard: ${r.guard_type} (${r.guard_ref}) | last_seen: ${r.last_seen}`);
    }
  } else {
    console.log('D1 Response:', JSON.stringify(resActual, null, 2));
  }
}

main().catch(console.error);
