import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Autonomous Commercial Revenue Engine (Spec §§ 1–14)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    const db = getDb();
    // Clean up test workflows and offers
    try {
      db.prepare(`DELETE FROM workflows WHERE workflow_type = 'COMMERCIAL_AFFILIATE_ACTIVATION'`).run();
      db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM partners WHERE organization_id = ? AND network = 'CUELINKS'`).run(orgId);
      db.prepare(`DELETE FROM commission_content_assets WHERE organization_id = ?`).run(orgId);
    } catch {}
  });

  it('1. discovers candidate Cuelinks opportunity and records durable blocker when owner authorization is pending', async () => {
    const engine = AutonomousCommercialEngine.getInstance();
    const result = await engine.runCycle(orgId, bizId);

    expect(result.cycleId).toBeDefined();
    expect(result.status).toBe('BLOCKED');
    expect(result.activeBlockers).toBe(1);

    const tasks = await engine.listCommercialTasks(orgId, bizId);
    expect(tasks.length).toBe(1);

    const task = tasks[0];
    expect(task.workflowType).toBe('COMMERCIAL_AFFILIATE_ACTIVATION');
    expect(task.inputs.network).toBe('CUELINKS');
    expect(task.status).toBe('BLOCKED');
    expect(task.currentStep).toBe('QUALIFY');
    expect(task.errorInfo?.blockerType).toBe('MISSING_OWNER_AUTHORIZATION');
    expect(task.errorInfo?.officialUrl).toBe('https://www.cuelinks.com');
    expect(task.errorInfo?.ownerActionRequired).toContain('cuelinks.com');
  });

  it('2. unblocks task when owner supplies tracking URL and advances through full lifecycle to COMPLETED', async () => {
    const engine = AutonomousCommercialEngine.getInstance();

    // 1. Initial run discovers and blocks
    await engine.runCycle(orgId, bizId);
    const initialTasks = await engine.listCommercialTasks(orgId, bizId);
    const taskId = initialTasks[0].id;

    // 2. Register owner input with valid Cuelinks Campaign Explorer link
    const validTrackingUrl = 'https://linksredirect.com/?cid=12345&url=https%3A%2F%2Fmerchant.in%2Fitem';
    const unblockedTask = await engine.registerOwnerInput(
      taskId,
      {
        trackingUrl: validTrackingUrl,
        merchantName: 'Cuelinks Partner Merchant',
        productTitle: 'Ergonomic Desk Accessories',
        partnerApproved: true
      },
      orgId,
      bizId
    );

    expect(unblockedTask.status).toBe('READY');
    expect(unblockedTask.inputs.trackingUrl).toBe(validTrackingUrl);

    // 3. Next execution cycle runs the unblocked task
    const cycleRes = await engine.runCycle(orgId, bizId);
    expect(cycleRes.tasksCompleted).toBe(1);

    const completedTasks = await engine.listCommercialTasks(orgId, bizId);
    const completed = completedTasks.find(t => t.id === taskId);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.outputs.offerSlug).toBeDefined();
    expect(completed?.outputs.trackingUrl).toContain('/r/');
    expect(completed?.outputs.verifiedAt).toBeDefined();

    // Verify offer registered in partner_offers
    const offers = await PartnerRegistryEngine.getInstance().listOffers(orgId, { activeOnly: true });
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].authorizedTrackingUrl).toBe(validTrackingUrl);
  });

  it('3. rejects open-redirect destination URLs and fails permanently to protect users', async () => {
    const engine = AutonomousCommercialEngine.getInstance();

    await engine.runCycle(orgId, bizId);
    const initialTasks = await engine.listCommercialTasks(orgId, bizId);
    const taskId = initialTasks[0].id;

    // Malicious external link attempting open redirect
    await engine.registerOwnerInput(
      taskId,
      {
        trackingUrl: 'https://evil-phishing-site.com/steal-creds',
        productTitle: 'Dangerous Phishing Link',
        partnerApproved: true
      },
      orgId,
      bizId
    );

    // Next cycle must reject and permanently fail the task
    await engine.runCycle(orgId, bizId);

    const tasks = await engine.listCommercialTasks(orgId, bizId);
    const failedTask = tasks.find(t => t.id === taskId);
    expect(failedTask?.status).toBe('FAILED_PERMANENTLY');
    expect(failedTask?.errorInfo?.blockerType).toBe('QUALITY_GATE_REJECTED');
    expect(failedTask?.errorInfo?.message).toContain('fails strict redirect allowlist');
  });

  it('4. provides comprehensive observability status reporting funnel metrics and blockers', async () => {
    const engine = AutonomousCommercialEngine.getInstance();
    await engine.runCycle(orgId, bizId);

    const status = await engine.getEngineStatus(orgId, bizId);

    expect(status.lastExecution.status).toBeDefined();
    expect(status.cadence.commercialWorkCycle).toBe('0 */6 * * * (Every 6 hours)');
    expect(status.cadence.healthRecoveryCheck).toContain('Hourly');
    expect(status.tasks.total).toBeGreaterThanOrEqual(1);
    expect(status.commercialFunnel).toBeDefined();
    expect(status.commercialFunnel.pendingCommissionsINR).toBe(0);
    expect(status.commercialFunnel.verifiedCommissionsINR).toBe(0);
    expect(status.commercialFunnel.cashReceivedINR).toBe(0);
    expect(status.activeBlockers.length).toBeGreaterThanOrEqual(1);
    expect(status.activeBlockers[0].ownerActionRequired).toContain('cuelinks.com');
  });

  it('5. is idempotent across repeated executions without duplicating tasks or records', async () => {
    const engine = AutonomousCommercialEngine.getInstance();

    // Run cycle twice in succession
    await engine.runCycle(orgId, bizId);
    await engine.runCycle(orgId, bizId);

    const tasks = await engine.listCommercialTasks(orgId, bizId);
    // Must not create multiple Cuelinks workflows
    expect(tasks.length).toBe(1);

    const partners = await PartnerRegistryEngine.getInstance().listPartners(orgId);
    const cuelinksPartners = partners.filter(p => p.network === 'CUELINKS');
    expect(cuelinksPartners.length).toBe(1);
  });

  describe('6. Secured Owner Endpoints & Cron Integration', () => {
    it('serves engine observability via GET /api/v1/owner/autonomous-engine/status', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/autonomous-engine/status', {
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': orgId }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.cadence.commercialWorkCycle).toBe('0 */6 * * * (Every 6 hours)');
      expect(json.data.commercialFunnel).toBeDefined();
    });

    it('triggers commercial cycle via POST /api/v1/owner/autonomous-engine/wake', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/autonomous-engine/wake', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': orgId }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.cycleId).toBeDefined();
    });

    it('includes commercialCycle execution inside POST /api/v1/cron/ping', async () => {
      process.env.CRON_PING_SECRET = 'cron_ping_fixture_dev';

      const res = await app.request('/api/v1/cron/ping', {
        method: 'POST',
        headers: {
          'X-Cron-Secret': 'cron_ping_fixture_dev',
          'User-Agent': 'ai-marketing-cron-worker/1.0'
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.commercialCycle).toBeDefined();
      expect(json.commercialCycle.cycleId).toBeDefined();
    });
  });
});
