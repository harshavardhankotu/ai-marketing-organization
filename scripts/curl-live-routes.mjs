import fs from 'fs';

// Load keys without printing them
const envFiles = ['.env.local', '.env.deploy_secrets', '.env.admin_secret', '.env'];
for (const envFile of envFiles) {
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }
}

const ownerKey = process.env.OWNER_API_KEY || process.env.ADMIN_API_KEY || process.env.OPERATOR_API_KEY || process.env.API_SECRET_KEY || '';

async function curlGet(name, url, headers = {}) {
  console.log(`\n======================================================`);
  console.log(`CURL -m 30 -i ${name} (${url})`);
  console.log(`------------------------------------------------------`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    clearTimeout(timer);

    console.log(`HTTP/1.1 ${res.status} ${res.statusText}`);
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase() === 'set-cookie' || k.toLowerCase().includes('secret')) continue;
      console.log(`${k}: ${v}`);
    }
    console.log('');
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(text.substring(0, 1000));
    }
  } catch (err) {
    clearTimeout(timer);
    console.error(`ERROR: ${err.message}`);
  }
}

async function main() {
  const base = 'https://ai-marketing-organization.onrender.com';

  // 1. /api/v1/health
  await curlGet('GET /api/v1/health', `${base}/api/v1/health`);

  // 2. /offer
  await curlGet('GET /offer', `${base}/offer`);

  // 3. /api/v1/revenue/funnel (with owner auth from local env)
  await curlGet(
    'GET /api/v1/revenue/funnel (with owner auth)',
    `${base}/api/v1/revenue/funnel`,
    {
      'x-api-key': ownerKey,
      'Authorization': `Bearer ${ownerKey}`,
      'x-organization-id': 'org_owner_primary'
    }
  );

  // 4. /api/v1/owner/facts-status
  await curlGet(
    'GET /api/v1/owner/facts-status (public / owner)',
    `${base}/api/v1/owner/facts-status`,
    {
      'x-api-key': ownerKey,
      'Authorization': `Bearer ${ownerKey}`
    }
  );
}

main().catch(console.error);
