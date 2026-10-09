import { AutonomousRevenueOrchestrator } from '../packages/backend/src/revenue/autonomous-revenue-orchestrator.js';
import { UnifiedQuotaService } from '../packages/backend/src/quota/unified-quota-service.js';
import { getDb } from '../packages/backend/src/db/client.js';

async function main() {
  console.log('=== HOURLY CRON DRY RUN: DISCOVER_DEMAND_SIGNALS ===\n');

  const quota = UnifiedQuotaService.getInstance();
  const initialQuota = quota.getStatus().TAVILY;
  console.log(`Tavily Quota Before: ${initialQuota.used} credits used / ${initialQuota.applicationLimit} cap (locked: ${initialQuota.isLocked})`);

  // Ensure organization & business exist in local DB for cron
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Organization', 'owner-primary')`).run();
  db.prepare(`INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name) VALUES ('biz_platform_aro', 'org_owner_primary', 'AI Marketing Platform', 'ecommerce', 'E-commerce')`).run();
  // Production truth: 0 active offers
  db.prepare(`DELETE FROM partner_offers WHERE organization_id = 'org_owner_primary'`).run();
  db.prepare(`DELETE FROM action_cooldowns WHERE action_type = 'DISCOVER_DEMAND_SIGNALS'`).run();

  const aro = AutonomousRevenueOrchestrator.getInstance();
  const startTime = Date.now();
  const cycleResult = await aro.runCycle('org_owner_primary', 'biz_platform_aro', 'CLOUDFLARE_CRON');
  const elapsedMs = Date.now() - startTime;

  const finalQuota = quota.getStatus().TAVILY;
  const creditsUsed = (finalQuota.used || 0) - (initialQuota.used || 0);

  console.log('\n--- Raw Cron Cycle Output ---');
  console.log(JSON.stringify(cycleResult, null, 2));

  console.log('\n--- Tavily Quota Consumption ---');
  console.log(`Tavily Credits Used in this cycle: ${creditsUsed}`);
  console.log(`Tavily Total Used Month: ${finalQuota.used}`);
  console.log(`Elapsed Time: ${elapsedMs}ms`);
}

main().catch(err => {
  console.error('Fatal error running cron cycle:', err);
  process.exit(1);
});
