/**
 * Read-Only 48-Hour Skincare Affiliate Revenue & Attribution Tracker
 * Usage: node scripts/check-skincare-48h.mjs
 * Zero LLM/Antigravity quota — queries D1 (read-only SELECT) & Cuelinks v3 Channel 331585 directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadEnvFile(filename) {
  const map = {};
  const fullPath = path.join(rootDir, filename);
  if (!fs.existsSync(fullPath)) return map;
  for (const line of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return map;
}

const envLocal = loadEnvFile('.env.local');
const envDeploy = loadEnvFile('.env.deploy_secrets');

const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || envDeploy.CLOUDFLARE_ACCOUNT_ID || '';
const cfDbId = process.env.CLOUDFLARE_D1_DATABASE_ID || envDeploy.CLOUDFLARE_D1_DATABASE_ID || '';
const cfToken = process.env.CLOUDFLARE_D1_API_TOKEN || envDeploy.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || envDeploy.CLOUDFLARE_API_TOKEN || '';
const cuelinksKey = (process.env.CUELINKS_API_KEY || envLocal.CUELINKS_API_KEY || envDeploy.CUELINKS_API_KEY || '').trim();

const CHANNEL_ID = '331585';
const TARGET_CAMPAIGNS = [
  { id: '6458', name: 'World of Asaya' },
  { id: '4098', name: 'Plum Goodness' }
];

async function queryD1Read(sql) {
  if (!cfAccountId || !cfDbId || !cfToken) {
    return { skipped: true, reason: 'Missing Cloudflare D1 credentials in env/.env.deploy_secrets' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/d1/database/${cfDbId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });
  const json = await res.json();
  if (!res.ok || !json?.success) {
    throw new Error(`D1 HTTP ${res.status}: ${JSON.stringify(json?.errors || json)}`);
  }
  return { skipped: false, results: json?.result?.[0]?.results || [] };
}

async function fetchCuelinksJson(endpoint) {
  if (!cuelinksKey) {
    return { skipped: true, reason: 'Missing CUELINKS_API_KEY in env/.env.local' };
  }
  const res = await fetch(`https://developers.cuelinks.com/pub_api/v3${endpoint}`, {
    headers: {
      'Authorization': `Token ${cuelinksKey}`,
      'Accept': 'application/json'
    }
  });
  const json = await res.json().catch(() => ({}));
  return { skipped: false, status: res.status, data: json };
}

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

async function main() {
  console.log('=== 48-HOUR SKINCARE FUNNEL TRACKER (READ-ONLY) ===');
  console.log(`Window: Last 48h (${isoDateDaysAgo(2)} .. ${isoDateDaysAgo(0)} UTC)\n`);

  // 1. D1 Click Attribution by utm_source (excluding non-human/test traffic)
  console.log('1) D1 Outbound Clicks (Last 48h, real human/browser traffic only):');
  try {
    const clickSql = `
      SELECT
        CASE
          WHEN LOWER(COALESCE(source, '')) IN ('yt_short_1', 'yt_short_2', 'ig_reel_1') THEN LOWER(source)
          ELSE 'other'
        END AS utm_bucket,
        COUNT(*) AS clicks
      FROM referral_click_events
      WHERE created_at >= datetime('now', '-48 hours')
        AND LOWER(COALESCE(device_class, '')) NOT IN ('test', 'diagnostic', 'internal', 'known_bot', 'suspected_bot')
        AND LOWER(COALESCE(click_id, '')) NOT LIKE 'clk_test_%'
        AND LOWER(COALESCE(source, '')) NOT LIKE '%test%'
      GROUP BY utm_bucket
      ORDER BY clicks DESC
    `;
    const d1Res = await queryD1Read(clickSql);
    if (d1Res.skipped) {
      console.log(`   [SKIPPED] ${d1Res.reason}`);
    } else {
      const counts = { yt_short_1: 0, yt_short_2: 0, ig_reel_1: 0, other: 0 };
      for (const r of d1Res.results) {
        const key = String(r.utm_bucket || 'other');
        counts[key] = Number(r.clicks || 0);
      }
      const totalClicks = Object.values(counts).reduce((a, b) => a + b, 0);
      console.table([
        { source: 'yt_short_1', clicks_48h: counts.yt_short_1 },
        { source: 'yt_short_2', clicks_48h: counts.yt_short_2 },
        { source: 'ig_reel_1', clicks_48h: counts.ig_reel_1 },
        { source: 'other', clicks_48h: counts.other },
        { source: 'TOTAL', clicks_48h: totalClicks }
      ]);
    }
  } catch (err) {
    console.log(`   [ERROR] D1 query failed: ${err.message}`);
  }

  // 2. Cuelinks v3 Performance & Transactions (Channel 331585)
  console.log('\n2) Cuelinks v3 Channel 331585 Performance & Commission (6458 World of Asaya, 4098 Plum):');
  if (!cuelinksKey) {
    console.log('   [SKIPPED] CUELINKS_API_KEY not configured locally.');
    return;
  }

  const startDate = isoDateDaysAgo(2);
  const endDate = isoDateDaysAgo(0);
  const rows = [];

  for (const camp of TARGET_CAMPAIGNS) {
    try {
      const perf = await fetchCuelinksJson(
        `/reports/performance?channel_id=${CHANNEL_ID}&campaign_id=${camp.id}&start_date=${startDate}&end_date=${endDate}`
      );
      const tx = await fetchCuelinksJson(
        `/transactions?channel_id=${CHANNEL_ID}&campaign_id=${camp.id}&start_date=${startDate}&end_date=${endDate}&per_page=100`
      );
      const campDetail = await fetchCuelinksJson(`/campaigns/${camp.id}.json`);

      const perfItems = Array.isArray(perf?.data?.data) ? perf.data.data : [];
      const perfClicks = perf?.data?.totals?.clicks ?? perfItems.reduce((s, x) => s + Number(x.clicks || 0), 0);
      const txList = Array.isArray(tx?.data?.data) ? tx.data.data : (Array.isArray(tx?.data?.transactions) ? tx.data.transactions : []);

      let pendingINR = 0;
      let approvedINR = 0;
      for (const t of txList) {
        const comm = Number(t.user_commission || t.commission || t.payout || 0);
        const st = String(t.status || '').toLowerCase();
        if (st === 'approved' || st === 'paid' || st === 'validated') approvedINR += comm;
        else if (st !== 'rejected' && st !== 'cancelled') pendingINR += comm;
      }
      const epc7d = campDetail?.data?.data?.epc_7d ?? campDetail?.data?.campaign?.epc_7d ?? '-';

      rows.push({
        campaign_id: camp.id,
        merchant: camp.name,
        cuelinks_clicks_48h: Number(perfClicks || 0),
        transactions_48h: txList.length,
        pending_comm_inr: Number(pendingINR.toFixed(2)),
        approved_comm_inr: Number(approvedINR.toFixed(2)),
        epc_7d_inr: epc7d
      });
    } catch (err) {
      rows.push({
        campaign_id: camp.id,
        merchant: camp.name,
        cuelinks_clicks_48h: 'ERR',
        transactions_48h: 'ERR',
        pending_comm_inr: err.message,
        approved_comm_inr: '-',
        epc_7d_inr: '-'
      });
    }
  }

  console.table(rows);
}

await main();
