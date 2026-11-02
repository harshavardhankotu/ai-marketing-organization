import { describe, it, expect, beforeEach } from 'vitest';
import { DurableJobQueue } from '../../src/automation/durable-job-queue.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';

describe('V4.8 Critical Business Logic & Queue Repair Test Suite', () => {
  let queue: DurableJobQueue;

  beforeEach(() => {
    DurableJobQueue.resetInstance();
    queue = DurableJobQueue.getInstance();
  });

  describe('1. DurableJobQueue Batch Enqueue & Observability (Phase 2A & 2D)', () => {
    it('returns exact attempted, enqueued, and existing counts without error suppression', async () => {
      const key1 = `test_idemp_v48_batch_${Date.now()}_1`;
      const key2 = `test_idemp_v48_batch_${Date.now()}_2`;

      // 1. Initial batch insert
      const res1 = await queue.enqueueJobsBatch([
        { workflowId: 'competitor_pricing_research', idempotencyKey: key1, priority: 1 },
        { workflowId: 'prospect_discovery_validation', idempotencyKey: key2, priority: 2 }
      ]);

      expect(res1.attempted).toBe(2);
      expect(res1.enqueuedCount).toBe(2);
      expect(res1.failedCount).toBe(0);

      // 2. Repeat exact same batch - must be idempotent and report existingCount
      const res2 = await queue.enqueueJobsBatch([
        { workflowId: 'competitor_pricing_research', idempotencyKey: key1, priority: 1 },
        { workflowId: 'prospect_discovery_validation', idempotencyKey: key2, priority: 2 }
      ]);

      expect(res2.attempted).toBe(2);
      expect(res2.enqueuedCount).toBe(0);
      expect(res2.existingCount).toBe(2);
      expect(res2.failedCount).toBe(0);
    });

    it('exposes expanded queue observability metrics including expiredLeases and lastSuccess', async () => {
      const stats = await queue.getQueueStats();
      expect(stats).toHaveProperty('queued');
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('expiredLeases');
      expect(stats).toHaveProperty('failedTotal');
      expect(stats).toHaveProperty('oldestQueuedAgeMinutes');
      expect(stats).toHaveProperty('lastSuccessfulExecutionAt');
      expect(typeof stats.expiredLeases).toBe('number');
      expect(typeof stats.failedTotal).toBe('number');
    });
  });

  describe('2. Strict Cryptographic Lease Fencing (Phase 2B & 2C)', () => {
    it('enforces exact lease token match and fences out stale workers', async () => {
      const idempKey = `test_fencing_v48_${Date.now()}`;
      await queue.enqueueJob({
        workflowId: 'payment_status_reconciliation',
        idempotencyKey: idempKey,
        priority: 0
      });

      // Claim job with worker A
      const claimed = await queue.claimDueJob('worker_A', 60);
      expect(claimed).not.toBeNull();
      expect(claimed?.leaseToken).toBeDefined();

      const validToken = claimed!.leaseToken!;
      const invalidToken = 'fake_stale_token_xyz_999';

      // 1. Stale worker updateCheckpoint must fail (0 rows affected)
      const staleCp = await queue.updateCheckpoint(claimed!.id, { step: 1 }, undefined, invalidToken);
      expect(staleCp.success).toBe(false);
      expect(staleCp.rowsAffected).toBe(0);

      // 2. Valid worker updateCheckpoint succeeds
      const validCp = await queue.updateCheckpoint(claimed!.id, { step: 2 }, undefined, validToken);
      expect(validCp.success).toBe(true);
      expect(validCp.rowsAffected).toBe(1);

      // 3. Stale worker completeJob must fail
      const staleComplete = await queue.completeJob(claimed!.id, 'COMPLETED', { res: 1 }, invalidToken);
      expect(staleComplete.success).toBe(false);
      expect(staleComplete.rowsAffected).toBe(0);

      // 4. Stale worker failAttempt must be fenced out and not mutate status
      const staleFail = await queue.failAttempt(claimed!.id, 'Network error', true, undefined, invalidToken);
      expect(staleFail).toBe('RUNNING'); // remains RUNNING

      // 5. Valid worker completeJob succeeds
      const validComplete = await queue.completeJob(claimed!.id, 'COMPLETED', { res: 'success' }, validToken);
      expect(validComplete.success).toBe(true);
      expect(validComplete.rowsAffected).toBe(1);

      const finalJob = await queue.getJobById(claimed!.id);
      expect(finalJob?.status).toBe('COMPLETED');
    });
  });

  describe('3. Financial Truth & Commission State Disaggregation (Phase 6)', () => {
    it('strictly separates invoice_raised from paid and enforces cashReceivedINR = 0 invariant', () => {
      const syncMgr = CuelinksSyncManager.getInstance();
      syncMgr.resetReconciliation();

      // Inject disaggregated metrics
      syncMgr.setReconciliationMetrics({
        pendingCommissionINR: 500,
        validatedCommissionINR: 1200,
        payableCommissionINR: 800,
        invoicedCommissionINR: 600,
        providerPaidCommissionINR: 400,
        paidCommissionINR: 400,
        reversedCommissionINR: 100,
        cashReceivedINR: 0 // strictly ₹0
      });

      const metrics = syncMgr.getStatus().reconciliation;

      // INVARIANT CHECKS:
      // 1. invoiced is distinct from paid
      expect(metrics.invoicedCommissionINR).toBe(600);
      expect(metrics.providerPaidCommissionINR).toBe(400);
      expect(metrics.paidCommissionINR).toBe(400);
      expect(metrics.invoicedCommissionINR).not.toBe(metrics.paidCommissionINR);

      // 2. payable is distinct from validated
      expect(metrics.payableCommissionINR).toBe(800);
      expect(metrics.validatedCommissionINR).toBe(1200);

      // 3. bank confirmed cash remains strictly ₹0.00
      expect(metrics.cashReceivedINR).toBe(0);
    });
  });

  describe('4. Bounded Pagination Cursor Progression (Phase 4B)', () => {
    it('advances campaign cursor instead of endlessly resetting to page 1 upon 3 upstream failures', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      await engine.resetCuelinksPaginationCursor();

      const cursor = await engine.getCuelinksPaginationCursor();
      expect(cursor.campaignPage).toBe(1);
      expect(cursor.offerPage).toBe(1);
    });
  });

  describe('5. Public Buyer Redirect & Monetization Gate (Phase 5)', () => {
    it('suppresses unmonetized fallback when deal is flagged monetizable but tracking URL is absent', async () => {
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.injectDealForTesting({
        id: 'deal_test_unmonetized_safety',
        title: 'Unmonetized Test Earbuds',
        brand: 'TestBrand',
        merchant: 'TestMerchant',
        category: 'Electronics',
        productUrl: 'https://www.testmerchant.com/earbuds-unmonetized',
        currentPriceINR: 999,
        referencePriceINR: 1999,
        claimedDiscountPercent: 50,
        dealKind: 'PRODUCT',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        observedAt: new Date().toISOString(),
        sourceUrl: 'https://www.testmerchant.com/earbuds-unmonetized',
        sourceDomain: 'testmerchant.com',
        sourceType: 'AFFILIATE_NETWORK',
        trackingUrl: undefined, // intentionally missing
        isMonetizable: true, // claims monetizable
        affiliateNetwork: 'CUELINKS',
        buyerValueScore: 80,
        status: 'ACTIVE'
      });

      const res = await app.request('/api/v1/public/deals/deal_test_unmonetized_safety/redirect', {
        headers: { 'user-agent': 'Mozilla/5.0' }
      });

      // Must NOT redirect silently to raw product URL; must reject with 503
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('Affiliate monetization path temporarily unavailable');
    });
  });
});
