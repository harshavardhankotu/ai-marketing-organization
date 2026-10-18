import fs from 'fs';
import path from 'path';

const candidatePaths = [
  path.resolve('.env'),
  path.resolve('.env.local'),
  path.resolve('packages/backend/.env'),
  path.resolve('packages/backend/.env.local')
];

for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    const text = fs.readFileSync(p, 'utf-8');
    for (const l of text.split('\n')) {
      const trimmed = l.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [k, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[k.trim()]) process.env[k.trim()] = val;
    }
  }
}

const apiKey = process.env.RENDER_API_KEY;
if (!apiKey) {
  console.log('RENDER_API_KEY is not configured in local environment.');
  process.exit(0);
}

const serviceId = 'srv-darecoc9v7es73ea8t2g';

try {
  // 1. Fetch env vars (names only!)
  const envRes = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000)
  });
  if (envRes.ok) {
    const envData = await envRes.json();
    console.log('=== RENDER ENV VARS (NAMES ONLY) ===');
    const targetVars = ['DIRECT_OFFER_TERMS_SHA256', 'OWN_OFFER_CONFIRMED'];
    for (const item of envData) {
      const key = item.envVar?.key || item.key;
      if (targetVars.includes(key)) {
        console.log(`Variable: ${key} -> Present in Render service (value omitted for security)`);
      }
    }
    const foundKeys = (envData || []).map(i => i.envVar?.key || i.key);
    for (const t of targetVars) {
      if (!foundKeys.includes(t)) {
        console.log(`Variable: ${t} -> MISSING from Render service`);
      }
    }
  } else {
    console.log(`Render env-vars status: HTTP ${envRes.status}`);
  }

  // 2. Fetch service events
  const evRes = await fetch(`https://api.render.com/v1/services/${serviceId}/events?limit=20`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30000)
  });
  if (evRes.ok) {
    const evData = await evRes.json();
    console.log('\n=== RENDER SERVICE RECENT EVENTS (LAST 10) ===');
    const events = (evData || []).slice(0, 10);
    for (const ev of events) {
      const eventObj = ev.event || ev;
      console.log(`- Time: ${eventObj.timestamp || eventObj.createdAt}, Type: ${eventObj.type}, Actor: ${eventObj.actor?.name || eventObj.actor?.email || 'UNKNOWN'}`);
    }
  } else {
    console.log(`Render events status: HTTP ${evRes.status}`);
  }
} catch (err) {
  console.log(`Error checking Render API: ${err.message}`);
}
