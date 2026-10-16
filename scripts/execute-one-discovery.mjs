import fs from 'fs';

// Load credentials from local files
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
process.env.NODE_ENV = 'production';

const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function fetchD1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  const data = await res.json();
  return data.result?.[0]?.results || [];
}

async function run() {
  console.log('=== TAVILY DISCOVERY EXECUTION & VERIFICATION ===\n');

  // 1. Tavily usage BEFORE
  const usageBefore = await fetchD1("SELECT provider, provider_limit, application_limit, credits_consumed_month, credits_estimated_remaining, requests_today, last_successful_request, updated_at FROM provider_quota_state WHERE provider = 'TAVILY';");
  console.log('--- 1. TAVILY USAGE BEFORE ---');
  console.log(JSON.stringify(usageBefore[0], null, 2));

  // 2. Execute discovery using updated engine
  const { DemandDiscoveryEngine } = await import('../packages/backend/src/commission/demand-discovery.js');
  const engine = DemandDiscoveryEngine.getInstance();

  const testCategory = 'wireless microphone';
  console.log(`\n--- 2. EXECUTING LIVE DISCOVERY FOR: "${testCategory}" ---`);
  console.log('Query phrasing: "which wireless lapel microphone connects directly to Android USB-C without adapter?"');
  console.log('include_domains: ["reddit.com", "quora.com", "desidime.com", "techenclave.com", "community.intuit.com"]');
  console.log('exclude_domains: ["pcmag.com", "businessnewsdaily.com", "aiaccountant.com", ...]');

  const newSignals = await engine.discoverDemand('org_owner_primary', {
    category: testCategory,
    location: 'India',
    limit: 3
  });

  console.log(`\n--- 3. NEW DISCOVERED ROWS (${newSignals.length}) ---`);
  for (const sig of newSignals) {
    console.log({
      id: sig.id,
      title: sig.topic,
      sourceUrl: sig.sourceUrl,
      snippet: (sig.evidenceSnippet || '').substring(0, 120),
      signalType: sig.signalType || 'BUYER_QUESTION',
      status: sig.status,
      date: sig.createdAt
    });
  }

  // 3. Tavily usage AFTER
  const usageAfter = await fetchD1("SELECT provider, provider_limit, application_limit, credits_consumed_month, credits_estimated_remaining, requests_today, last_successful_request, updated_at FROM provider_quota_state WHERE provider = 'TAVILY';");
  console.log('\n--- 4. TAVILY USAGE AFTER ---');
  console.log(JSON.stringify(usageAfter[0], null, 2));
}

run().catch(console.error);
