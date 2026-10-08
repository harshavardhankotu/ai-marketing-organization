import fs from 'fs';
import path from 'path';

const COMPONENTS = [
  {
    name: 'Cloudflare Worker Cron Trigger',
    package: 'packages/cloudflare-worker',
    state: 'LIVE_VERIFIED',
    automation: 'AUTOMATED',
    description: 'Pings Render backend every 15 minutes to wake container and trigger autonomous cycles.'
  },
  {
    name: 'Render Backend Web Service',
    package: 'packages/backend',
    state: 'LIVE_VERIFIED',
    automation: 'AUTOMATED',
    description: 'Hosts Hono API server, background schedulers, status page, and webhook ingestion.'
  },
  {
    name: 'Cloudflare D1 Database (prod-db)',
    package: 'packages/backend (d1-client)',
    state: 'LIVE_VERIFIED',
    automation: 'AUTOMATED',
    description: 'Authoritative serverless SQLite persistence for quotas, mistakes, and audit ledgers.'
  },
  {
    name: 'Unified Quota Service & Auto Usage Sync',
    package: 'packages/backend/src/quota',
    state: 'LIVE_VERIFIED',
    automation: 'AUTOMATED',
    description: 'Central quota manager with pre-request reservation, daily Tavily API usage sync, and 70% allowance caps.'
  },
  {
    name: 'Mistakes Board & CI Guard Verification',
    package: 'scripts/board-verify.mjs',
    state: 'LIVE_VERIFIED',
    automation: 'AUTOMATED',
    description: 'Tracks empirical operational mistakes and validates resolving automated guards on every CI run.'
  },
  {
    name: 'Scratch / Scripts REST Mutation Blocker',
    package: 'scripts/check-no-scratch-writes.mjs',
    state: 'LIVE_VERIFIED',
    automation: 'AUTOMATED',
    description: 'Enforces zero direct D1 REST mutations from scratch/ or scripts/ via PreToolUse hook and CI check.'
  },
  {
    name: 'Owner Statutory Intake',
    package: 'packages/backend/src/commission/owner-control-center.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Amazon Operating Agreement compliance declaration, listed domain URLs, and site identity metadata must be attested directly by human owner.'
  },
  {
    name: 'Amazon Associates Terms Attestation',
    package: 'packages/backend/src/commission/owner-control-center.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Statutory confirmation that Operating Agreement terms have been read, initiating the 180-day three-sale compliance window.'
  },
  {
    name: 'Product Proposal Verification & Offer Activation',
    package: 'packages/backend/src/commission/owner-control-center.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Owner must physically inspect Amazon.in listing, confirm stock/price, and submit exactly 3 listing facts with product_checked=true.'
  },
  {
    name: 'Buyer Guide Publication Approval Gate',
    package: 'packages/backend/src/commission/owner-control-center.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Final statutory review and publication approval gate reserved for human owner to ensure zero non-compliant claims reach production.'
  },
  {
    name: 'Clean Buyer Guide Distribution (ShareKit)',
    package: 'packages/backend/src/commission/share-kit-service.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Owner manually shares clean buyer guide link to seed first 3 qualifying referral sales; automated mass-messaging is strictly prohibited.'
  },
  {
    name: 'Associates Earnings Report Upload',
    package: 'packages/backend/src/commission/owner-control-center.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Accessing Associates Central portal and downloading weekly TSV/CSV earnings export requires owner credentials.'
  },
  {
    name: 'Demand Discovery Engine',
    package: 'packages/backend/src/commission/demand-discovery.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Discovers commercial purchase queries via Tavily search, gated by 70% free tier safety cap.'
  },
  {
    name: 'Automatic Product Pipeline',
    package: 'packages/backend/src/commission/automatic-product-pipeline.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Batches weekly candidate discovery, extracts manufacturer specifications, and stages proposals for owner verification.'
  },
  {
    name: 'Content Asset & Statutory Lint Engine',
    package: 'packages/backend/src/commission/content-asset-engine.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Drafts buyer guides from approved facts, injects mandatory statutory Amazon disclosures, and blocks prohibited claims.'
  },
  {
    name: 'Static Site Generator & OpenGraph Builder',
    package: 'packages/backend/src/commission/static-site-generator.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Generates static HTML pages, metadata, legal pages, and sitemaps behind owner approval gate.'
  },
  {
    name: 'Commission Ledger & Beacon Tracking',
    package: 'packages/backend/src/commission/commission-ledger.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Records outbound referral clicks, ingests Associates earnings reports, and reconciles payouts.'
  },
  {
    name: 'Firecrawl Manufacturer Extraction Adapter',
    package: 'packages/backend/src/research/firecrawl-adapter.ts',
    state: 'DORMANT',
    automation: 'OWNER_ONLY',
    reason: 'Candidate manufacturer hosts require one-time owner approval; zero live calls executed until FIRECRAWL_API_KEY is configured.'
  },
  {
    name: 'Razorpay Payment Gateway Adapter',
    package: 'packages/backend/src/integrations/razorpay.ts',
    state: 'DORMANT',
    automation: 'OWNER_ONLY',
    reason: 'System scope restricted strictly to Amazon Associates verified commission; direct payment processing is disabled.'
  },
  {
    name: 'Meta WhatsApp Business API Integration',
    package: 'packages/backend/src/revenue/sales-conversation-engine.ts',
    state: 'DORMANT',
    automation: 'OWNER_ONLY',
    reason: 'Outbound messaging on permanent hold; Amazon Operating Agreement prohibits distributing affiliate links via direct messaging.'
  },
  {
    name: 'SendGrid Email API Integration',
    package: 'packages/backend/src/revenue/sales-conversation-engine.ts',
    state: 'DORMANT',
    automation: 'OWNER_ONLY',
    reason: 'Outbound email messaging on permanent hold; affiliate links prohibited in unverified private communications.'
  },
  {
    name: 'Demand-to-Purchase Engine',
    package: 'packages/backend/src/commission/demand-engine.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Full 8-stage state machine (SIGNAL to VERIFIED) with rule qualification, EV ranking, clean drafting, and automated source penalty.'
  },
  {
    name: 'Outreach Review & Manual Posting',
    package: 'packages/backend/src/commission/owner-control-center.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Owner reviews top 5 outreach drafts on TODAY page and posts manually to target communities; system never posts automatically.'
  },
  {
    name: 'Non-Amazon Partner Tracking Link Builder',
    package: 'packages/backend/src/commission/affiliate-adapters.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'AUTOMATED',
    description: 'Tracking link templates and adapters for vCommission, Cuelinks, EarnKaro with fail-closed approval gate.'
  },
  {
    name: 'Non-Amazon Partner Application & Proof',
    package: 'packages/backend/src/commission/partner-registry.ts',
    state: 'BUILT_UNVERIFIED',
    automation: 'OWNER_ONLY',
    reason: 'Owner must apply to Indian affiliate programs (vCommission, Cuelinks, EarnKaro) with PAN KYC and provide proof before activation.'
  }
];

function generateMarkdown() {
  const timestamp = new Date().toISOString();
  let md = `# System Map & Automation Architecture\n\n`;
  md += `> **Auto-Generated by Script (\`scripts/generate-system-map.mjs\`):** Generated at ${timestamp}.\n`;
  md += `> **Single Owner System:** One owner only. Scope: Verified Amazon commission. Zero scraping of amazon.*.\n\n`;
  md += `---\n\n`;

  md += `## Summary Matrix\n\n`;
  const liveCount = COMPONENTS.filter(c => c.state === 'LIVE_VERIFIED').length;
  const builtCount = COMPONENTS.filter(c => c.state === 'BUILT_UNVERIFIED').length;
  const dormantCount = COMPONENTS.filter(c => c.state === 'DORMANT').length;
  const automatedCount = COMPONENTS.filter(c => c.automation === 'AUTOMATED').length;
  const ownerOnlyCount = COMPONENTS.filter(c => c.automation === 'OWNER_ONLY').length;

  md += `| State | Count | Automation Mode | Count |\n`;
  md += `| :--- | :---: | :--- | :---: |\n`;
  md += `| **LIVE_VERIFIED** | ${liveCount} | **AUTOMATED** | ${automatedCount} |\n`;
  md += `| **BUILT_UNVERIFIED** | ${builtCount} | **OWNER_ONLY** | ${ownerOnlyCount} |\n`;
  md += `| **DORMANT** | ${dormantCount} | — | — |\n\n`;

  md += `---\n\n`;
  md += `## Component Catalog\n\n`;
  md += `| Component | State | Automation | Details / Owner-Only Reason |\n`;
  md += `| :--- | :---: | :---: | :--- |\n`;

  for (const c of COMPONENTS) {
    const details = c.automation === 'OWNER_ONLY'
      ? `**OWNER_ONLY REASON:** ${c.reason}`
      : `${c.description}`;
    md += `| **${c.name}**<br>(\`${c.package}\`) | \`${c.state}\` | \`${c.automation}\` | ${details} |\n`;
  }

  md += `\n---\n\n`;
  md += `## Canonical Owner-Only List\n\n`;
  md += `The TODAY dashboard page shows **ONLY** these items, each once, and hides each item when resolved:\n\n`;

  const ownerItems = COMPONENTS.filter(c => c.automation === 'OWNER_ONLY');
  ownerItems.forEach((item, idx) => {
    md += `${idx + 1}. **${item.name}** (\`${item.state}\`): ${item.reason}\n`;
  });

  md += `\n> [!IMPORTANT]\n`;
  md += `> **Operating Invariant:** The system asks the owner for **NOTHING** that is not on this canonical list.\n`;

  return md;
}

function main() {
  console.log('Generating SYSTEM_MAP.md...');
  const md = generateMarkdown();
  fs.writeFileSync('SYSTEM_MAP.md', md, 'utf8');
  console.log('Successfully generated SYSTEM_MAP.md');
}

main();
