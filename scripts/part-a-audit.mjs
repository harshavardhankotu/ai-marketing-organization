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

async function queryD1(label, sql) {
  console.log(`\n======================================================`);
  console.log(`QUERY: ${label}`);
  console.log(`SQL: ${sql.trim()}`);
  console.log(`------------------------------------------------------`);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: [] })
  });
  const data = await res.json();
  const results = data.result?.[0]?.results || [];
  const sanitized = JSON.stringify(results, (k, v) => {
    if (typeof v === 'string') {
      return v.replace(/tag=[a-zA-Z0-9_-]+/g, 'tag=[MASKED_TAG]');
    }
    return v;
  }, 2);
  console.log(sanitized);
  return results;
}

async function main() {
  await queryD1(
    'demand_signals count vs COUNT(DISTINCT canonical_url)',
    'SELECT COUNT(*) as total_count, COUNT(DISTINCT canonical_url) as distinct_canonical_urls, COUNT(DISTINCT source_url) as distinct_source_urls FROM demand_signals;'
  );

  await queryD1(
    'partner_offers (status, active flag, tag masked)',
    'SELECT * FROM partner_offers;'
  );

  await queryD1(
    'guides by status count',
    'SELECT status, COUNT(*) as count FROM commission_content_assets GROUP BY status;'
  );

  await queryD1(
    'commission_content_assets rows',
    'SELECT id, slug, asset_type, status, primary_offer_id, created_at, updated_at FROM commission_content_assets;'
  );
}

main().catch(console.error);
