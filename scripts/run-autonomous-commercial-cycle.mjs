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

// Redact secret helper
function redact(str) {
  if (!str) return 'false';
  return str.length > 0 ? 'true (redacted)' : 'false';
}

async function runCommercialCycleAudit() {
  console.log('======================================================');
  console.log('       AUTONOMOUS COMMERCIAL AUDIT & VERIFICATION     ');
  console.log('======================================================');
  console.log(`Target Backend:      ${backendUrl}`);
  console.log(`Trigger Time:        ${new Date().toISOString()}`);
  console.log(`Auth Configured:     OWNER_API_KEY=${redact(ownerApiKey)}, CRON_PING_SECRET=${redact(cronPingSecret)}`);

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'ai-marketing-commercial-verifier/1.0'
  };

  if (ownerApiKey) {
    headers['x-api-key'] = ownerApiKey;
  }
  if (cronPingSecret) {
    headers['x-cron-secret'] = cronPingSecret;
  }

  // 1. Fast Enqueue / Wake Verification (10-15s timeout)
  console.log('\n[1/3] Triggering fast cron enqueue (/api/v1/cron/ping)...');
  let pingAccepted = false;
  let correlationId = 'UNKNOWN';
  let enqueuedCount = 0;

  try {
    const pingRes = await fetch(`${backendUrl}/api/v1/cron/ping`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        triggerSource: 'GITHUB_ACTIONS_VERIFIER',
        timestamp: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!pingRes.ok) {
      const text = await pingRes.text();
      console.error(`[FATAL] /cron/ping returned HTTP ${pingRes.status}: ${text.substring(0, 300)}`);
      process.exit(1);
    }

    const pingJson = await pingRes.json();
    pingAccepted = Boolean(pingJson.accepted || pingJson.success);
    correlationId = pingJson.correlationId || 'NONE';
    enqueuedCount = pingJson.enqueuedCount || 0;

    console.log(`Ping Accepted:       ${pingAccepted}`);
    console.log(`Correlation ID:      ${correlationId}`);
    console.log(`Enqueued Count:      ${enqueuedCount}`);
  } catch (err) {
    console.error(`[FATAL] Network error triggering /cron/ping: ${err.message}`);
    process.exit(1);
  }

  // 2. Poll /cron/status for truthful operational health
  console.log('\n[2/3] Polling /api/v1/cron/status for durable queue & workflow states...');
  let cronStatus = 'UNKNOWN';
  let queueStatus = {};
  let businessOutcome = {};
  let metrics = {};

  try {
    const statusRes = await fetch(`${backendUrl}/api/v1/cron/status`, {
      headers,
      signal: AbortSignal.timeout(15000)
    });

    if (!statusRes.ok) {
      console.error(`[FATAL] /cron/status returned HTTP ${statusRes.status}`);
      process.exit(1);
    }

    const statusJson = await statusRes.json();
    const data = statusJson.data || {};
    cronStatus = data.status || 'UNKNOWN';
    queueStatus = data.queueStatus || {};
    businessOutcome = data.businessOutcome || {};
    metrics = data.metrics || {};

    console.log(`Global Status:       ${cronStatus}`);
    console.log(`Heartbeat Age:       ${data.heartbeatAgeMinutes !== null ? `${data.heartbeatAgeMinutes}m` : 'Never'}`);
    console.log(`Queue Status:        Queued=${queueStatus.queued ?? 0}, Running=${queueStatus.running ?? 0}, Completed=${queueStatus.completed ?? 0}, Blocked=${queueStatus.blocked ?? 0}, Overdue=${queueStatus.overdueCount ?? 0}`);
    console.log(`Business Outcomes:   Workflows=${businessOutcome.totalWorkflows ?? 0}, HasBlocked=${businessOutcome.hasBlocked ?? false}, HasPartial=${businessOutcome.hasPartial ?? false}`);
    console.log(`Cash Invariant:      VerifiedBankCash=₹${metrics.verifiedRevenueINR ?? 0}, AdSpend=₹${metrics.paidAcquisitionSpendINR ?? 0}`);
  } catch (err) {
    console.error(`[FATAL] Error polling /cron/status: ${err.message}`);
    process.exit(1);
  }

  // 3. Evaluate exit code with strict truthfulness
  console.log('\n[3/3] Evaluating business SLAs and failure gates...');
  if (cronStatus === 'ERROR' || queueStatus.failedPermanently > 0) {
    console.error('\n[GATE FAILED] Cron status is ERROR or has permanently failed jobs.');
    process.exit(1);
  }

  if (cronStatus === 'BLOCKED' || queueStatus.blocked > 0) {
    console.error('\n[GATE BLOCKED] Background workflow or queue job is BLOCKED requiring owner intervention.');
    process.exit(1);
  }

  if (cronStatus === 'PARTIAL' || (queueStatus.overdueCount && queueStatus.overdueCount > 0)) {
    console.error('\n[GATE PARTIAL] Workflows are in PARTIAL or jobs are overdue past SLA.');
    process.exit(1);
  }

  if (cronStatus === 'STALE') {
    console.error('\n[GATE STALE] Heartbeat is stale (>75m) without observed cron wake.');
    process.exit(1);
  }

  console.log('\n[SUCCESS] Commercial operations verified cleanly (Status: ' + cronStatus + ').');
  process.exit(0);
}

runCommercialCycleAudit().catch(err => {
  console.error('[FATAL ERROR]', err.message);
  process.exit(1);
});
