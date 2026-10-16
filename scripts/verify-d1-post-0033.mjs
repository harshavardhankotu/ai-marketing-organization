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

async function queryD1(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result?.[0]?.results || [];
}

async function run() {
  const offer = await queryD1(`SELECT id, title, status, active FROM partner_offers WHERE id = 'poff_6fd7d0d3-7';`);
  console.log('OFFER poff_6fd7d0d3-7:');
  console.log(JSON.stringify(offer, null, 2));

  const asset = await queryD1(`SELECT id, slug, title, status FROM commission_content_assets WHERE id = 'cnt_d5cdad0f-9';`);
  console.log('\nASSET cnt_d5cdad0f-9:');
  console.log(JSON.stringify(asset, null, 2));

  const demandCounts = await queryD1(`
    SELECT status, signal_type, COUNT(*) as cnt
    FROM demand_signals
    GROUP BY status, signal_type
    ORDER BY cnt DESC;
  `);
  console.log('\nDEMAND SIGNALS STATUS BREAKDOWN:');
  console.log(JSON.stringify(demandCounts, null, 2));

  const totalSummary = await queryD1(`
    SELECT
      COUNT(*) as total_rows,
      SUM(CASE WHEN status = 'DUPLICATE' THEN 1 ELSE 0 END) as duplicate_rows,
      SUM(CASE WHEN status = 'SEEDED' THEN 1 ELSE 0 END) as seeded_rows,
      SUM(CASE WHEN status = 'DISCOVERED' THEN 1 ELSE 0 END) as canonical_discovered_rows,
      SUM(CASE WHEN status = 'DISCOVERED' AND signal_type = 'BUYER_QUESTION' THEN 1 ELSE 0 END) as canonical_buyer_questions,
      SUM(CASE WHEN status = 'DISCOVERED' AND signal_type = 'PUBLISHER_ARTICLE' THEN 1 ELSE 0 END) as canonical_publisher_articles
    FROM demand_signals;
  `);
  console.log('\nTOTAL DEMAND SUMMARY:');
  console.log(JSON.stringify(totalSummary, null, 2));
}

run().catch(console.error);
