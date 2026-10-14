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

function getTavilyKey() {
  if (process.env.TAVILY_API_KEY) return process.env.TAVILY_API_KEY;
  for (const envFile of ['.env.local', '.env.deploy_secrets']) {
    const envPath = path.resolve(envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/TAVILY_API_KEY=([^\r\n]+)/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

async function main() {
  console.log('=== STEP 8: FREE-TIER AUDIT ===\n');

  // 1. Tavily API Endpoint Usage
  const tvKey = getTavilyKey();
  if (tvKey) {
    try {
      const res = await fetch('https://api.tavily.com/usage', {
        headers: { 'Authorization': 'Bearer ' + tvKey }
      });
      const data = await res.json();
      console.log('Tavily API Endpoint Usage:');
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('Tavily fetch error:', err.message);
    }
  } else {
    console.log('TAVILY_API_KEY: UNSET or not found in local env');
  }

  // 2. D1 provider_call_logs table
  const cfToken = getCfToken();
  const accountId = '9b7511ff69e507dd3a00a7266fec11a3';
  const dbId = '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

  if (cfToken) {
    try {
      const sql = "SELECT provider, COUNT(*) as call_count, SUM(credits_consumed) as total_credits FROM provider_call_logs GROUP BY provider;";
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      });
      const data = await res.json();
      console.log('\nD1 provider_call_logs Summary:');
      console.log(JSON.stringify(data.result?.[0]?.results || [], null, 2));
    } catch (err) {
      console.warn('D1 query error:', err.message);
    }
  }

  // 3. Render Free-Tier Allowance & Cloudflare Cron Rules
  console.log('\n--- Render & Cloudflare Free-Tier Analysis ---');
  console.log('Render Web Service Free Tier:');
  console.log('  - Instance Hours: 750 free hours/month (equivalent to 31.25 full 24h days).');
  console.log('  - Inactivity Spin-Down: Free web services spin down after 15 min of inactivity.');
  console.log('Cloudflare Worker Cron:');
  console.log('  - Schedule: */15 * * * * (96 triggers per day).');
  console.log('  - Free Invocations: 100,000 requests/day included on Cloudflare free tier.');
  console.log('  - Monthly Consumption: ~2,976 invocations/month (<3% of a single daily free allowance).');
  console.log('  - Interaction: Wakes Render service at 15-min intervals, keeping ARO cycles running within free allowance.');
}

main().catch(console.error);
