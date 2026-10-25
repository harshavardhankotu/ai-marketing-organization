import fs from 'fs';

// Safely load local env files if present (never exposing secret values)
for (const envFile of ['.env', '.env.local', '.env.deploy_secrets', '.env.render.production', '.env.production']) {
  if (fs.existsSync(envFile)) {
    try {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].trim();
        }
      }
    } catch {}
  }
}

const backendUrl = (process.env.BACKEND_URL || 'https://ai-marketing-organization.onrender.com').replace(/\/$/, '');
const ownerApiKey = process.env.OWNER_API_KEY || process.env.API_KEY || '';
const cronPingSecret = process.env.CRON_PING_SECRET || '';

async function runCommercialCycle() {
  console.log('======================================================');
  console.log('       AUTONOMOUS COMMERCIAL REVENUE CYCLE            ');
  console.log('======================================================');
  console.log(`Target Backend:      ${backendUrl}`);
  console.log(`Trigger Time:        ${new Date().toISOString()}`);
  console.log(`Auth Configured:     OWNER_API_KEY=${Boolean(ownerApiKey)}, CRON_PING_SECRET=${Boolean(cronPingSecret)}`);

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

  let wakeStatus = 'UNKNOWN';
  let tasksProcessed = 0;
  let tasksCompleted = 0;
  let activeBlockers = 0;
  let cycleId = 'UNKNOWN';
  let fatalError = false;

  // 1. Wake the Autonomous Commercial Engine on target backend
  console.log('\n[1/4] Invoking /api/v1/owner/autonomous-engine/wake...');
  try {
    const wakeRes = await fetch(`${backendUrl}/api/v1/owner/autonomous-engine/wake`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(90000)
    });

    if (!wakeRes.ok) {
      const text = await wakeRes.text();
      console.error(`[FATAL] Wake returned HTTP ${wakeRes.status}: ${text.substring(0, 300)}`);
      if (wakeRes.status === 401 || wakeRes.status === 403) {
        console.error('[AUTH ERROR] Authentication failed. Check OWNER_API_KEY or CRON_PING_SECRET.');
      }
      process.exit(1);
    }

    const wakeJson = await wakeRes.json();
    console.log('Wake Result Status:', wakeJson.success ? 'SUCCESS' : 'FAILED');
    const cycleData = wakeJson.data || {};
    wakeStatus = cycleData.status || 'UNKNOWN';
    cycleId = cycleData.cycleId || 'NONE';
    tasksProcessed = cycleData.tasksProcessed ?? 0;
    tasksCompleted = cycleData.tasksCompleted ?? 0;
    activeBlockers = cycleData.activeBlockers ?? 0;

    console.log(`Cycle ID:        ${cycleId}`);
    console.log(`Cycle Status:    ${wakeStatus}`);
    console.log(`Tasks Processed: ${tasksProcessed}`);
    console.log(`Tasks Completed: ${tasksCompleted}`);
    console.log(`Active Blockers: ${activeBlockers}`);
    if (cycleData.details) {
      console.log(`Cycle Details:   ${cycleData.details}`);
    }

    if (wakeStatus === 'ERROR') {
      fatalError = true;
    }
  } catch (err) {
    console.error(`[FATAL] Network error connecting to backend: ${err.message}`);
    process.exit(1);
  }

  // 2. Fetch Deal Engine Status & Sample Active Deals
  console.log('\n[2/4] Verifying deal engine status & active deals...');
  try {
    const dealStatusRes = await fetch(`${backendUrl}/api/v1/owner/deal-engine/status`, {
      headers,
      signal: AbortSignal.timeout(30000)
    });
    if (dealStatusRes.ok) {
      const dealStatusJson = await dealStatusRes.json();
      const sources = dealStatusJson.data?.sources || {};
      const offers = dealStatusJson.data?.offers || {};
      console.log(`Deal Engine Sources: ${sources.allowed ?? 0} allowed, ${sources.conditional ?? 0} conditional`);
      console.log(`Deal Engine Offers:  ${offers.rawCollected ?? 0} collected, ${offers.verified ?? 0} verified`);
    } else {
      console.warn(`[WARN] Deal engine status returned HTTP ${dealStatusRes.status}`);
    }

    const publicDealsRes = await fetch(`${backendUrl}/api/v1/public/deals?limit=3`, {
      signal: AbortSignal.timeout(30000)
    });
    if (publicDealsRes.ok) {
      const publicDealsJson = await publicDealsRes.json();
      const deals = publicDealsJson.data?.deals || [];
      console.log(`Public Deals Verified: ${deals.length} sample deals available publicly.`);
    }
  } catch (err) {
    console.warn(`[WARN] Deal verification notice: ${err.message}`);
  }

  // 3. Fetch Cuelinks Observability Status
  console.log('\n[3/4] Verifying Cuelinks synchronization status...');
  try {
    const cuelinksStatusRes = await fetch(`${backendUrl}/api/v1/owner/cuelinks/status`, {
      headers,
      signal: AbortSignal.timeout(30000)
    });
    if (cuelinksStatusRes.ok) {
      const cuelinksStatusJson = await cuelinksStatusRes.json();
      const cStatus = cuelinksStatusJson.data || {};
      console.log(`Cuelinks Configured: ${Boolean(cStatus.configured)}`);
      console.log(`Cuelinks Connected:  ${Boolean(cStatus.connected)}`);
      console.log(`Campaigns Discovered:${cStatus.campaignsDiscovered ?? 0}`);
      console.log(`Offers Retrieved:    ${cStatus.offersRetrieved ?? 0}`);
      console.log(`Links Converted:     ${cStatus.linksConverted ?? 0}`);
      if (cStatus.ownerActionRequired) {
        console.log(`Owner Action Needed: ${cStatus.ownerActionRequired}`);
      }
    } else {
      console.warn(`[WARN] Cuelinks status returned HTTP ${cuelinksStatusRes.status}`);
    }
  } catch (err) {
    console.warn(`[WARN] Cuelinks status notice: ${err.message}`);
  }

  // 4. Fetch Full Autonomous Commercial Engine Observability Status
  console.log('\n[4/4] Fetching full commercial engine operational status...');
  let ownerActionRequired = '';
  try {
    const statusRes = await fetch(`${backendUrl}/api/v1/owner/autonomous-engine/status`, {
      headers,
      signal: AbortSignal.timeout(30000)
    });

    if (statusRes.ok) {
      const statusJson = await statusRes.json();
      const statusData = statusJson.data || {};
      console.log(`Next Recommended Action: ${statusData.nextRecommendedAction || 'Standing by for scheduled run.'}`);
      const recentTasks = statusData.recentTasks || [];
      if (recentTasks.length > 0) {
        console.log(`Recent Commercial Tasks: ${recentTasks.length}`);
        for (const t of recentTasks.slice(0, 3)) {
          console.log(`  - [${t.status}] ${t.id} (${t.workflowType || 'COMMERCIAL'}) step: ${t.currentStep || 'N/A'}`);
          if (t.errorInfo?.ownerActionRequired) {
            ownerActionRequired = t.errorInfo.ownerActionRequired;
            console.log(`    Owner Action: ${ownerActionRequired}`);
          }
        }
      }
      const funnel = statusData.commercialFunnel || {};
      console.log(`Commercial Funnel: Clicks=${funnel.clicksRecorded ?? 0}, ProviderClicks=${funnel.providerAttributedClicks ?? 0}, Pending=₹${funnel.pendingCommissionsINR ?? 0}, Verified=₹${funnel.verifiedCommissionsINR ?? 0}, Cash=₹${funnel.cashReceivedINR ?? 0}`);
    } else {
      console.warn(`[WARN] Operational status endpoint returned HTTP ${statusRes.status}`);
    }
  } catch (err) {
    console.warn(`[WARN] Operational status notice: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log('             CYCLE EXECUTION SUMMARY                  ');
  console.log('======================================================');
  console.log(`Outcome Category:    ${wakeStatus}`);
  console.log(`Tasks Completed:     ${tasksCompleted}`);
  console.log(`Tasks Processed:     ${tasksProcessed}`);
  console.log(`Active Blockers:     ${activeBlockers}`);

  if (fatalError) {
    console.error('\n[EXECUTION FAILED] Commercial cycle experienced a technical failure.');
    process.exit(1);
  } else if (wakeStatus === 'BLOCKED') {
    console.log('\n[NOTICE] Cycle is blocked awaiting human owner action.');
    if (ownerActionRequired) {
      console.log(`Required Action: ${ownerActionRequired}`);
    }
    process.exit(0);
  } else if (wakeStatus === 'NO_ACTION_DUE') {
    console.log('\n[HEALTHY] Cycle evaluated cleanly; no eligible tasks due or cooling down.');
    process.exit(0);
  } else {
    console.log('\n[SUCCESS] Commercial cycle executed successfully.');
    process.exit(0);
  }
}

runCommercialCycle().catch(err => {
  console.error('[FATAL ERROR]', err.message);
  process.exit(1);
});
