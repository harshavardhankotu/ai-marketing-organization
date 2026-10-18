import fs from 'fs';
import path from 'path';

// Load env
for (const envFile of ['.env.local', '.env.deploy_secrets', '.env']) {
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  }
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';
const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

async function queryD1(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    throw new Error(`D1 HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  return json?.result?.[0]?.results || [];
}

async function main() {
  const queries = [
    { label: '1. Genuine Non-Quarantined Demand Signals', sql: `SELECT COUNT(*) as count FROM demand_signals WHERE status NOT IN ('QUARANTINED', 'SEEDED', 'SEEDED_MIGRATION_0026', 'UNSOURCED', 'DUPLICATE', 'UNSUPPORTED', 'UNSUPPORTED_BY_DEMAND', 'PAUSED_SEEDED_DEMAND') AND source_url LIKE 'http%' AND source_url NOT LIKE '%search.community%' AND source_url NOT LIKE '%localhost%' AND source_url NOT LIKE '%example.com%' AND source_url NOT LIKE '%test.local%'` },
    { label: '2. Genuine Buyer Questions (is_test=0, is_junk=0)', sql: `SELECT COUNT(*) as count FROM demand_signals WHERE signal_type = 'BUYER_QUESTION' AND status NOT IN ('QUARANTINED', 'SEEDED', 'SEEDED_MIGRATION_0026', 'UNSOURCED', 'DUPLICATE', 'UNSUPPORTED', 'UNSUPPORTED_BY_DEMAND', 'PAUSED_SEEDED_DEMAND') AND source_url LIKE 'http%' AND source_url NOT LIKE '%search.community%' AND source_url NOT LIKE '%localhost%' AND source_url NOT LIKE '%example.com%' AND source_url NOT LIKE '%test.local%'` },
    { label: '3. Real Platform Prospects (is_test=0, is_junk=0)', sql: `SELECT COUNT(*) as count FROM platform_prospects WHERE is_test = 0 AND is_junk = 0` },
    { label: '4. Active Partner Offers', sql: `SELECT COUNT(*) as count FROM partner_offers WHERE status = 'ACTIVE' AND active = 1` },
    { label: '5. Content Assets Drafted/Publish-Ready/Published', sql: `SELECT COUNT(*) as count FROM commission_content_assets WHERE status IN ('DRAFT', 'PUBLISH_READY', 'PUBLISHED')` },
    { label: '6. Content Assets Published', sql: `SELECT COUNT(*) as count FROM commission_content_assets WHERE status = 'PUBLISHED'` },
    { label: '7. Real Proposals (is_test=0, status!=TEST_QUARANTINED)', sql: `SELECT COUNT(*) as count FROM proposals WHERE is_test = 0 AND status != 'TEST_QUARANTINED'` },
    { label: '8. Real Sales Pipeline (is_test=0, is_junk=0)', sql: `SELECT COUNT(*) as count FROM sales_pipeline WHERE is_test = 0 AND is_junk = 0` },
    { label: '9. Real Opportunities (is_test=0, is_junk=0)', sql: `SELECT COUNT(*) as count FROM opportunities WHERE is_test = 0 AND is_junk = 0` },
    { label: '10. Real Payment Requests (is_test=0)', sql: `SELECT COUNT(*) as count FROM payment_requests WHERE is_test = 0` },
    { label: '11. Real Captured Transactions (classification=REAL, status=SUCCESS)', sql: `SELECT COUNT(*) as count, COALESCE(SUM(amount_inr), 0) as total_inr FROM transactions WHERE classification = 'REAL' AND status = 'SUCCESS'` },
    { label: '12. Real Manual UPI Claims (is_test=0)', sql: `SELECT COUNT(*) as count FROM manual_upi_claims WHERE is_test = 0 AND status != 'TEST_QUARANTINED'` },
    { label: '13. Real Customer Journeys (stage=CUSTOMER, classification=REAL)', sql: `SELECT COUNT(*) as count FROM customer_journeys WHERE stage = 'CUSTOMER' AND classification = 'REAL'` },
    { label: '14. Commission Records (Attributed Orders & Commissions)', sql: `SELECT COUNT(*) as count, COALESCE(SUM(expected_commission_inr), 0) as expected_inr, COALESCE(SUM(verified_commission_inr), 0) as verified_inr FROM commission_records WHERE status IN ('CONVERSION_REPORTED', 'COMMISSION_PENDING', 'COMMISSION_APPROVED', 'COMMISSION_PAID')` }
  ];

  console.log('=== D1 PRODUCTION RAW COUNTS ===\n');
  for (const q of queries) {
    console.log(`Query: ${q.label}`);
    console.log(`SQL:   ${q.sql}`);
    const res = await queryD1(q.sql);
    console.log(`Output: ${JSON.stringify(res)}\n`);
  }
}

main().catch(console.error);
