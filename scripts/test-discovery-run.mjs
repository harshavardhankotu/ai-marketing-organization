import fs from 'fs';
import path from 'path';

// Load env vars from .env.local and .env.deploy_secrets
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

const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function queryD1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result?.[0]?.results || [];
}

async function run() {
  console.log('=== STEP 7 & 8: TAVILY DISCOVERY RUN AUDIT ===\n');

  // 1. Tavily usage BEFORE
  const usageBefore = await queryD1(`SELECT * FROM provider_quota_state WHERE provider = 'TAVILY';`);
  console.log('--- TAVILY USAGE BEFORE ---');
  console.log(JSON.stringify(usageBefore[0], null, 2));

  // 2. Import DemandDiscoveryEngine and run discovery
  const { DemandDiscoveryEngine } = await import('../packages/backend/src/commission/demand-discovery.js');
  const engine = DemandDiscoveryEngine.getInstance();

  console.log('\n--- EXECUTING DISCOVERY FOR "best accounting software small business India" ---');
  // First test with accounting software — should trigger 7-day rule and record learning record
  const result1 = await engine.discoverDemand('org_owner_primary', {
    category: 'best accounting software small business India',
    location: 'India',
    limit: 3
  });
  console.log('Accounting discovery result length:', result1.length);

  // Check learning_records to confirm OUTCOME was recorded
  const learningRecords = await queryD1(`
    SELECT id, learning_type, decision, what, outcome, rule, source, created_at
    FROM learning_records
    WHERE source = 'OUTCOME'
    ORDER BY created_at DESC LIMIT 5;
  `);
  console.log('\n--- LEARNING RECORDS (source = OUTCOME) ---');
  console.log(JSON.stringify(learningRecords, null, 2));

  // 3. Tavily usage AFTER
  const usageAfter = await queryD1(`SELECT * FROM provider_quota_state WHERE provider = 'TAVILY';`);
  console.log('\n--- TAVILY USAGE AFTER ---');
  console.log(JSON.stringify(usageAfter[0], null, 2));
}

run().catch(console.error);
