import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { WhatsAppAdapter } from '../../src/integrations/adapter-base.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { D1Client } from '../../src/db/d1-client.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import app from '../../src/index.js';

describe('Autonomy Reality Fix — Strict Action & Quota Truth Audit', () => {
  const orgId = 'org_smilekraft_01';
  const bizId = 'biz_smilekraft_hyd';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  // 1. Adapter truth: WhatsApp returns BLOCKED_AUTHORIZATION when no credentials exist
  it('1. WhatsAppAdapter returns BLOCKED_AUTHORIZATION and connected=false when no live credentials exist', async () => {
    const wa = new WhatsAppAdapter(); // no live credentials injected
    const health = await wa.checkHealth();

    expect(health.connected).toBe(false);
    expect(health.mode).toBe('UNCONFIGURED');

    const pubResult = await wa.publish({
      title: 'Consultation outreach',
      body: 'Hello',
      channel: 'WHATSAPP',
      recipientPhone: '+919876543210'
    });

    expect(pubResult.success).toBe(false);
    expect(pubResult.mode).toBe('UNCONFIGURED');
    expect(pubResult.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(pubResult.verificationStatus).toBe('UNVERIFIED');
    expect(pubResult.externalId).toBeUndefined(); // NO fake wamid!
  });

  // 2. Action Classification: ONBOARD_CUSTOMER is strictly INTERNAL_AUTOMATION
  it('2. ONBOARD_CUSTOMER is classified strictly as INTERNAL_AUTOMATION (never EXTERNAL_ACTION)', async () => {
    const db = getDb();
    db.prepare('DELETE FROM customer_journeys').run();
    db.prepare(`
      INSERT INTO customer_journeys (
        id, business_id, organization_id, visitor_id, stage, customer_name,
        total_lifetime_value_inr, classification
      ) VALUES ('cust_real_01', ?, ?, 'vis_01', 'CUSTOMER', 'Rohan Mehra', 25000, 'REAL')
    `).run(bizId, orgId);

    const aro = AutonomousRevenueOrchestrator.getInstance();
    const result = await aro.runCycle(orgId, bizId, 'MANUAL');

    expect(result.nextBestAction.actionType).toBe('ONBOARD_CUSTOMER');
    expect(result.actionExecutionStatus).toBe('INTERNAL_AUTOMATION');
    expect(result.actionClassification).toBe('INTERNAL_AUTOMATION');

    // Health summary must NOT count internal automation as an external action
    const health = UnifiedQuotaService.getInstance().getHealthSummary(orgId);
    expect(health.totalExternalActions).toBe(0);
  });

  // 3. Quota Reservation Model (Spec § 9): Reserve -> Execute -> Reconcile
  it('3. Quota reservation model grants reservation, decrements on reconcile', () => {
    const quota = UnifiedQuotaService.getInstance();
    const initialStatus = quota.getStatus().GEMINI;

    // Reserve 1 unit
    const reservation = quota.reserve('GEMINI', 'P1', 1, 'sales_test');
    expect(reservation.allowed).toBe(true);
    expect(reservation.reservationId).toBeTruthy();

    // Reconcile 1 unit actual usage
    quota.reconcile(reservation.reservationId, 1, true);

    const postStatus = quota.getStatus().GEMINI;
    expect(postStatus.used).toBe(initialStatus.used + 1);
  });

  // 4. Tavily Calendar Month Reset (Spec § 10): 1st of calendar month, not rolling 30 days
  it('4. Tavily reset follows calendar month (1st of month 00:00:00 UTC)', () => {
    const nextResetStr = UnifiedQuotaService.getNextCalendarMonthReset();
    const nextReset = new Date(nextResetStr);

    expect(nextReset.getUTCDate()).toBe(1);
    expect(nextReset.getUTCHours()).toBe(0);
    expect(nextReset.getUTCMinutes()).toBe(0);

    const currentMonth = UnifiedQuotaService.getCurrentCalendarMonth();
    expect(currentMonth).toMatch(/^\d{4}-\d{2}$/);
  });

  // 5. Gemini limits: providerLimit is UNKNOWN until verified (Spec § 11)
  it('5. Gemini providerLimit is UNKNOWN until verified from provider metadata', () => {
    const quota = UnifiedQuotaService.getInstance();
    const status = quota.getStatus().GEMINI;

    expect(status.providerLimitStatus).toBe('PROVIDER_LIMIT_UNKNOWN');
    expect(status.providerLimit).toBeNull();
    expect(status.applicationLimit).toBe(1200); // 1200 local protective cap

    // Record verified limit
    quota.recordProviderMetadata('GEMINI', 1500, 24 * 3600 * 1000);
    const updatedStatus = quota.getStatus().GEMINI;
    expect(updatedStatus.providerLimitStatus).toBe('PROVIDER_LIMIT_VERIFIED');
    expect(updatedStatus.providerLimit).toBe(1500);
  });

  // 6. Cloudflare Worker cron timeout: at least 90-120 seconds (Spec § 15)
  it('6. Cloudflare Worker fetch timeout is configured >= 90 seconds for Render cold-starts', () => {
    const workerFile = path.resolve(process.cwd(), '../cloudflare-worker/src/worker.ts');
    const content = fs.readFileSync(workerFile, 'utf-8');

    expect(content).toContain('AbortSignal.timeout(100000)');
  });

  // 7. Cron Deployment Verification (Spec § 16): CRON_CONFIGURED -> CRON_OBSERVED
  it('7. Cron verification endpoint transitions from CRON_CONFIGURED to CRON_OBSERVED upon real ping', async () => {
    // 1. Initial status check
    const res1 = await app.request('/api/v1/cron/status');
    const data1 = await res1.json() as any;
    expect(data1.data.status).toBe('CRON_CONFIGURED');
    expect(data1.data.totalPings).toBe(0);

    // 2. Simulate Cloudflare Worker ping with valid secret
    const pingRes = await app.request('/api/v1/cron/ping', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': 'cron_ping_default_dev',
        'User-Agent': 'ai-marketing-cron-worker/1.0'
      }
    });
    expect(pingRes.status).toBe(200);

    // 3. Status check after ping: MUST be CRON_OBSERVED
    const res2 = await app.request('/api/v1/cron/status');
    const data2 = await res2.json() as any;
    expect(data2.data.status).toBe('CRON_OBSERVED');
    expect(data2.data.totalPings).toBe(1);
    expect(data2.data.lastObservedPing).toBeTruthy();
  });

  // 8. D1 Client Free-Tier Protection Guard (Spec § 18)
  it('8. D1 Client enforces daily row limits and protects free-tier budget', async () => {
    const d1 = D1Client.getInstance();
    d1.recordUsage(50, 10);

    const usage = d1.getUsage();
    expect(usage.rowsReadToday).toBeGreaterThanOrEqual(50);
    expect(usage.rowsWrittenToday).toBeGreaterThanOrEqual(10);
    expect(usage.maxReadCap).toBe(4_000_000);
    expect(usage.maxWriteCap).toBe(80_000);
    expect(usage.isReadThrottled).toBe(false);
    expect(usage.isWriteThrottled).toBe(false);
  });

  // 9. Pursue opportunity without live credentials yields BLOCKED_AUTHORIZATION
  it('9. Pursue opportunity without live credentials yields BLOCKED_AUTHORIZATION without state change', async () => {
    const db = getDb();
    db.prepare('DELETE FROM customer_journeys').run();
    db.prepare('DELETE FROM sales_pipeline').run();

    // Insert an opportunity
    const oppId = 'opp_unconfigured_01';
    db.prepare(`
      INSERT INTO opportunities (
        id, business_id, organization_id, source, evidence_json, estimated_value_inr,
        probability, acquisition_cost_inr, time_to_revenue_days, risk_level, status
      ) VALUES (?, ?, ?, 'INBOUND', '[{"type":"INBOUND_LEAD"}]', 20000, 0.4, 0, 7, 'LOW', 'QUALIFIED')
    `).run(oppId, bizId, orgId);

    const aro = AutonomousRevenueOrchestrator.getInstance();
    const result = await aro.runCycle(orgId, bizId, 'MANUAL');

    // Without live WhatsApp/provider credentials, it MUST yield BLOCKED_AUTHORIZATION
    expect(result.actionExecutionStatus).toBe('BLOCKED_AUTHORIZATION');
    expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');

    // Opportunity status must remain QUALIFIED (not advanced to ENGAGING without real dispatch)
    const oppAfter = db.prepare('SELECT status FROM opportunities WHERE id = ?').get(oppId) as any;
    expect(oppAfter.status).toBe('QUALIFIED');
  });
});
