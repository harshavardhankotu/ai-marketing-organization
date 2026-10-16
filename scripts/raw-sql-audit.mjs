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

async function executeRawD1(label, sql, params = []) {
  console.log(`\n======================================================`);
  console.log(`QUERY: ${label}`);
  console.log(`SQL:\n${sql.trim()}`);
  if (params.length > 0) {
    console.log(`PARAMS: ${JSON.stringify(params)}`);
  }
  console.log(`------------------------------------------------------`);
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
    console.error('ERROR:', JSON.stringify(data.errors || data, null, 2));
    throw new Error(`Query failed: ${label}`);
  }
  const results = data.result?.[0]?.results || [];
  // Mask any affiliate tags in raw results for protection
  const sanitized = JSON.stringify(results, (key, value) => {
    if (typeof value === 'string') {
      return value.replace(/tag=[a-zA-Z0-9_-]+/g, 'tag=[MASKED_TAG]');
    }
    return value;
  }, 2);
  console.log(`RAW OUTPUT (${results.length} rows):`);
  console.log(sanitized);
  return results;
}

async function run() {
  const orgId = 'org_owner_primary';

  // 1. Total count of demand_signals
  await executeRawD1(
    'Total count of demand_signals in production D1',
    `SELECT COUNT(*) as total_rows FROM demand_signals;`
  );

  // 2. Counts grouped by signal_type, status, and origin
  await executeRawD1(
    'Demand signals counts by signal_type and status',
    `SELECT signal_type, status, COUNT(*) as count FROM demand_signals GROUP BY signal_type, status ORDER BY count DESC;`
  );

  // 3. Counts by day and signal_type
  await executeRawD1(
    'Demand signals counts by day and signal_type',
    `SELECT substr(created_at, 1, 10) as day, signal_type, status, COUNT(*) as count FROM demand_signals GROUP BY day, signal_type, status ORDER BY day ASC;`
  );

  // 4. Counts by category and signal_type
  await executeRawD1(
    'Demand signals counts by category and signal_type',
    `SELECT category, signal_type, status, COUNT(*) as count FROM demand_signals GROUP BY category, signal_type, status ORDER BY count DESC;`
  );

  // 5. Valid vs Seeded vs Unsourced counts
  await executeRawD1(
    'Valid non-seeded non-unsourced demand signals',
    `SELECT
      COUNT(*) as total_rows,
      SUM(CASE WHEN status = 'SEEDED' THEN 1 ELSE 0 END) as seeded_count,
      SUM(CASE WHEN status = 'UNSOURCED' THEN 1 ELSE 0 END) as unsourced_count,
      SUM(CASE WHEN status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED') AND source_url LIKE 'http%' AND source_url NOT LIKE '%search.community%' THEN 1 ELSE 0 END) as valid_discovered_count,
      SUM(CASE WHEN status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED') AND source_url LIKE 'http%' AND source_url NOT LIKE '%search.community%' AND signal_type = 'BUYER_QUESTION' THEN 1 ELSE 0 END) as valid_buyer_questions,
      SUM(CASE WHEN status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED') AND source_url LIKE 'http%' AND source_url NOT LIKE '%search.community%' AND signal_type = 'PUBLISHER_ARTICLE' THEN 1 ELSE 0 END) as valid_publisher_articles
    FROM demand_signals;`
  );

  // 6. Distinct URLs vs Total rows
  await executeRawD1(
    'Distinct URLs vs Total Rows (Proving 13 unique publisher URLs)',
    `SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT source_url) as distinct_source_urls,
      SUM(CASE WHEN status = 'SEEDED' THEN 1 ELSE 0 END) as seeded_mock_urls,
      COUNT(DISTINCT CASE WHEN status != 'SEEDED' THEN source_url END) as distinct_real_publisher_urls
    FROM demand_signals;`
  );

  // 7. SELECT * FROM partner_offers (tag masked)
  await executeRawD1(
    'SELECT * FROM partner_offers (Production D1)',
    `SELECT * FROM partner_offers;`
  );

  // 8. SELECT * FROM commission_content_assets WHERE id = 'cnt_d5cdad0f-9'
  await executeRawD1(
    'SELECT * FROM commission_content_assets WHERE id = cnt_d5cdad0f-9 (Production D1)',
    `SELECT * FROM commission_content_assets WHERE id = 'cnt_d5cdad0f-9';`
  );

  // 9. All rows in commission_content_assets
  await executeRawD1(
    'All rows in commission_content_assets (Production D1)',
    `SELECT id, slug, asset_type, title, category, status, primary_offer_id, created_at, updated_at FROM commission_content_assets;`
  );
}

run().catch(console.error);
