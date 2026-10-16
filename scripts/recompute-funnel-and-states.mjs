import fs from 'fs';

function getSecret(key) {
  for (const candidate of ['.env.deploy_secrets', '.env.local', '.env.admin_secret']) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf8');
      const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (match && match[1].trim()) return match[1].trim();
    }
  }
  return null;
}

const cfToken = getSecret('CLOUDFLARE_API_TOKEN');
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
  const orgId = 'org_owner_primary';

  // Total signals vs Valid signals
  const totalSignals = await queryD1('SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ?', [orgId]);
  const validSignals = await queryD1(`
    SELECT COUNT(*) as cnt FROM demand_signals
    WHERE organization_id = ?
      AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
      AND source_url LIKE 'http%'
      AND source_url NOT LIKE '%search.community%'
  `, [orgId]);

  const buyerQuestions = await queryD1(`
    SELECT COUNT(*) as cnt FROM demand_signals
    WHERE organization_id = ?
      AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
      AND source_url LIKE 'http%'
      AND source_url NOT LIKE '%search.community%'
      AND signal_type = 'BUYER_QUESTION'
  `, [orgId]);

  const publisherArticles = await queryD1(`
    SELECT COUNT(*) as cnt FROM demand_signals
    WHERE organization_id = ?
      AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
      AND source_url LIKE 'http%'
      AND source_url NOT LIKE '%search.community%'
      AND signal_type = 'PUBLISHER_ARTICLE'
  `, [orgId]);

  const seededSignals = await queryD1(`
    SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ? AND status = 'SEEDED'
  `, [orgId]);

  const distinctCategories = await queryD1(`
    SELECT COUNT(DISTINCT category) as cnt FROM demand_signals
    WHERE organization_id = ?
      AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
      AND source_url LIKE 'http%'
      AND source_url NOT LIKE '%search.community%'
  `, [orgId]);

  console.log('RECOMPUTED DEMAND COUNTS:');
  console.log({
    totalRowsInD1: totalSignals[0]?.cnt,
    seededRows: seededSignals[0]?.cnt,
    validSignalsDiscovered: validSignals[0]?.cnt,
    validBuyerQuestions: buyerQuestions[0]?.cnt,
    validPublisherArticles: publisherArticles[0]?.cnt,
    distinctCategoriesFromValidSignals: distinctCategories[0]?.cnt
  });

  // Category breakdown for valid signals
  const catBreakdown = await queryD1(`
    SELECT category, COUNT(*) as total,
           SUM(CASE WHEN signal_type = 'BUYER_QUESTION' THEN 1 ELSE 0 END) as bq_count,
           SUM(CASE WHEN signal_type = 'PUBLISHER_ARTICLE' THEN 1 ELSE 0 END) as pa_count
    FROM demand_signals
    WHERE organization_id = ?
      AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
      AND source_url LIKE 'http%'
      AND source_url NOT LIKE '%search.community%'
    GROUP BY category
  `, [orgId]);

  console.log('\nVALID CATEGORY BREAKDOWN:');
  console.log(catBreakdown);
}

run().catch(console.error);
