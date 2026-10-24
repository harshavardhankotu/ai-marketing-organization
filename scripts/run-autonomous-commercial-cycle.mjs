import fs from 'fs';

// Safely load local env files if present (non-production local execution)
for (const envFile of ['.env.local', '.env.deploy_secrets']) {
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

const backendUrl = (process.env.BACKEND_URL || 'https://ai-marketing-organization.onrender.com').replace(/\/$/, '');
const ownerApiKey = process.env.OWNER_API_KEY || process.env.API_KEY || '';
const cronPingSecret = process.env.CRON_PING_SECRET || '';

async function runCommercialCycle() {
  console.log('======================================================');
  console.log('       AUTONOMOUS COMMERCIAL REVENUE CYCLE            ');
  console.log('======================================================');
  console.log(`Target Backend: ${backendUrl}`);
  console.log(`Trigger Time:   ${new Date().toISOString()}`);

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'ai-marketing-commercial-cycle/1.0'
  };

  if (ownerApiKey) {
    headers['x-api-key'] = ownerApiKey;
  }
  if (cronPingSecret) {
    headers['x-cron-secret'] = cronPingSecret;
  }

  // 1. Wake the Autonomous Commercial Engine on production backend
  try {
    console.log('\n[1/2] Invoking /api/v1/owner/autonomous-engine/wake...');
    const wakeRes = await fetch(`${backendUrl}/api/v1/owner/autonomous-engine/wake`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(90000)
    });

    if (!wakeRes.ok) {
      const text = await wakeRes.text();
      console.warn(`Wake returned HTTP ${wakeRes.status}: ${text.substring(0, 200)}`);
    } else {
      const wakeJson = await wakeRes.json();
      console.log('Wake Result:', JSON.stringify(wakeJson, null, 2));
    }
  } catch (err) {
    console.warn(`Wake invocation notice: ${err.message}`);
  }

  // 2. Fetch full operational observability status
  try {
    console.log('\n[2/2] Fetching engine observability status...');
    const statusRes = await fetch(`${backendUrl}/api/v1/owner/autonomous-engine/status`, {
      headers,
      signal: AbortSignal.timeout(30000)
    });

    if (!statusRes.ok) {
      const text = await statusRes.text();
      console.warn(`Status endpoint returned HTTP ${statusRes.status}: ${text.substring(0, 200)}`);
    } else {
      const statusJson = await statusRes.json();
      console.log('Operational Status:', JSON.stringify(statusJson, null, 2));
    }
  } catch (err) {
    console.warn(`Status fetch notice: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log('             COMMERCIAL CYCLE COMPLETE                ');
  console.log('======================================================');
}

runCommercialCycle().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
