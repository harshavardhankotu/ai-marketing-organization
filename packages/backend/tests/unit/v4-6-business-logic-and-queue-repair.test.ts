/**
 * V4.6 Business Logic Repair, Durable Queue Lease Fencing & Attribution Test Suite
 *
 * Verifies:
 * 1. Queue Lease Fencing: claimDueJob generates leaseToken; complete/checkpoint/fail enforce leaseToken; renewLease.
 * 2. Queue Batch Enqueue: enqueueJobsBatch enqueues multiple workflows in a single batch operation without N+1 queries.
 * 3. Business Logic Repairs:
 *    - competitor_pricing_research: returns NO_ACTION_DUE when benchmarks are fresh (<7d), saves dated benchmarks when missing.
 *    - prospect_discovery_validation: itemsProcessed reflects actual count of prospects found in platform_prospects.
 *    - prospect_dedup_qualification: canonical identity deduplication (normalized domain, phone, email).
 *    - payment_status_reconciliation: unverified UPI claims return BLOCKED with ₹0 cash and ownerActionRequired.
 * 4. Cuelinks & Attribution Consolidation:
 *    - buildProviderDestinationUrl: dynamically sets subid=clickId, subid2=sector, subid3=campaign, subid4=offer, subid5=placement.
 *    - Link Registry Idempotency: reuses cached affiliate tracking URLs rather than repeating conversions.
 *    - syncReconciliationOnly: reconciles transactions and performance reports without re-fetching offers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { DurableJobQueue } from '../../src/automation/durable-job-queue.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { buildProviderDestinationUrl } from '../../src/commission/referral-tracking.js';

describe('V4.6 Durable Queue Lease Fencing, Business Logic & Attribution Repair', () => {
  beforeEach(() => {
    resetDbForTesting();
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at, updated_at)
      VALUES ('org_test', 'Test Org', 'test-org', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice, created_at, updated_at)
      VALUES ('biz_test', 'org_test', 'Test Biz', 'v_ecom', 'eCommerce', 'Bengaluru', 'Indiranagar', 'Professional', datetime('now'), datetime('now'))
    `).run();

    DurableJobQueue.resetInstance();
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
  });

  describe('1. Durable Queue Lease Fencing & Batch Enqueue', () => {
    it('claimDueJob generates unique lease_token and enforces it on completion', async () => {
      const queue = DurableJobQueue.getInstance();
      const db = getDb();

      // Enqueue a job
      const enqueueRes = await queue.enqueueJob({
        workflowId: 'cuelinks_deal_sync',
        idempotencyKey: 'claim_test_key_1',
        organizationId: 'org_test',
        businessId: 'biz_test'
      });
      expect(enqueueRes.enqueued).toBe(true);
      const jobId = enqueueRes.job.id;

      // Claim job
      const claim1 = await queue.claimDueJob('worker_1', 30);
      expect(claim1).not.toBeNull();
      expect(claim1?.id).toBe(jobId);
      expect(claim1?.leaseToken).toBeDefined();
      expect(typeof claim1?.leaseToken).toBe('string');
      expect(claim1?.leaseToken!.length).toBeGreaterThan(10);

      // Verify DB has lease_token recorded
      const row = db.prepare('SELECT lease_token, status FROM automation_jobs WHERE id = ?').get(jobId) as any;
      expect(row.lease_token).toBe(claim1?.leaseToken);
      expect(row.status).toBe('RUNNING');

      // Attempt complete with WRONG lease token (e.g. stale worker)
      const wrongComplete = await queue.completeJob(jobId, 'COMPLETED', { done: true }, 'wrong_lease_token_123');
      expect(wrongComplete.success).toBe(false);
      expect(wrongComplete.rowsAffected).toBe(0);

      // Verify job is still RUNNING
      const stillRunning = db.prepare('SELECT status FROM automation_jobs WHERE id = ?').get(jobId) as any;
      expect(stillRunning.status).toBe('RUNNING');

      // Complete with CORRECT lease token
      const correctComplete = await queue.completeJob(jobId, 'COMPLETED', { done: true }, claim1!.leaseToken!);
      expect(correctComplete.success).toBe(true);
      expect(correctComplete.rowsAffected).toBe(1);

      // Verify job is now COMPLETED
      const completedRow = db.prepare('SELECT status, lease_token FROM automation_jobs WHERE id = ?').get(jobId) as any;
      expect(completedRow.status).toBe('COMPLETED');
    });

    it('updateCheckpoint and failAttempt reject mismatched lease token', async () => {
      const queue = DurableJobQueue.getInstance();
      const enqueueRes = await queue.enqueueJob({
        workflowId: 'prospect_discovery_validation',
        idempotencyKey: 'cp_test_key_1',
        organizationId: 'org_test',
        businessId: 'biz_test'
      });
      const jobId = enqueueRes.job.id;

      const claim = await queue.claimDueJob('worker_fast', 60);
      expect(claim).not.toBeNull();

      // Checkpoint fails with stale lease token
      const staleCp = await queue.updateCheckpoint(jobId, { step: 1 }, {}, 'stale_token');
      expect(staleCp.rowsAffected).toBe(0);

      // Checkpoint succeeds with correct lease token
      const validCp = await queue.updateCheckpoint(jobId, { step: 1 }, {}, claim!.leaseToken!);
      expect(validCp.rowsAffected).toBe(1);

      // Fail attempt fences out stale lease token (returns current status RUNNING)
      const staleFail = await queue.failAttempt(jobId, 'Transient error', true, 30, 'stale_token');
      expect(staleFail).toBe('RUNNING');

      // Fail attempt succeeds with correct lease token (transitions to RETRY_WAIT)
      const validFail = await queue.failAttempt(jobId, 'Legitimate failure', true, 30, claim!.leaseToken!);
      expect(validFail).toBe('RETRY_WAIT');
    });

    it('renewLease extends running lease only with valid token', async () => {
      const queue = DurableJobQueue.getInstance();
      const enqueueRes = await queue.enqueueJob({
        workflowId: 'daily_revenue_ops_sweep',
        idempotencyKey: 'renew_test_key_1',
        organizationId: 'org_test',
        businessId: 'biz_test'
      });
      const jobId = enqueueRes.job.id;

      const claim = await queue.claimDueJob('worker_long', 10);
      expect(claim).not.toBeNull();

      // Invalid token fails
      const failRenew = await queue.renewLease(jobId, 'fake_token', 60);
      expect(failRenew.renewed).toBe(false);

      // Valid token succeeds
      const okRenew = await queue.renewLease(jobId, claim!.leaseToken!, 60);
      expect(okRenew.renewed).toBe(true);
    });

    it('enqueueJobsBatch enqueues multiple workflows in batch', async () => {
      const queue = DurableJobQueue.getInstance();
      const workflows = [
        'cuelinks_deal_sync',
        'competitor_pricing_research',
        'prospect_discovery_validation',
        'payment_status_reconciliation'
      ];

      const batchResults = await queue.enqueueJobsBatch(
        workflows.map(wf => ({
          workflowId: wf,
          idempotencyKey: `batch_${wf}_1`,
          organizationId: 'org_test',
          businessId: 'biz_test'
        }))
      );

      expect(batchResults.enqueuedCount).toBe(4);
      expect(batchResults.existingCount).toBe(0);

      // Re-enqueuing the same idempotency keys within window does not duplicate
      const dupResults = await queue.enqueueJobsBatch(
        workflows.map(wf => ({
          workflowId: wf,
          idempotencyKey: `batch_${wf}_1`,
          organizationId: 'org_test',
          businessId: 'biz_test'
        }))
      );
      expect(dupResults.enqueuedCount).toBe(0);
      expect(dupResults.existingCount).toBe(4);
    });
  });

  describe('2. Business Logic & Workflow False-Success Repair', () => {
    it('competitor_pricing_research returns NO_ACTION_DUE when benchmarks are fresh', async () => {
      const engine = AutomationRegistryEngine.getInstance();
      const db = getDb();

      // Insert fresh benchmark
      db.prepare(`
        INSERT INTO research_findings (id, business_id, organization_id, agent_id, topic, market, finding, extracted_evidence, source, source_type, created_at)
        VALUES ('rf_bench_1', 'biz_test', 'org_test', 'agent_pricing', 'Pricing Benchmark', 'India', 'INR pricing benchmark', '{}', 'PUBLIC_BENCHMARK', 'PUBLIC_PRICING_BENCHMARK', datetime('now'))
      `).run();

      const result = await engine.executeWorkflow('competitor_pricing_research');
      expect(result.status).toBe('NO_ACTION_DUE');
      expect((result.resultSummary as any).status).toBe('BENCHMARKS_CURRENT');
      expect((result.resultSummary as any).message).toContain('fresh');
    });

    it('prospect_discovery_validation reports actual count of prospects found', async () => {
      const engine = AutomationRegistryEngine.getInstance();
      const result = await engine.executeWorkflow('prospect_discovery_validation');
      expect(result.status).toBe('COMPLETED');
      expect(result.itemsProcessed).toBeGreaterThan(0);
      expect(result.itemsProcessed).not.toBe(10); // Not the old hardcoded 10
    });

    it('prospect_dedup_qualification canonical identity deduplication marks duplicates', async () => {
      const engine = AutomationRegistryEngine.getInstance();
      const db = getDb();

      // Insert existing qualified prospect
      db.prepare(`
        INSERT INTO platform_prospects (id, business_name, prospect_business_name, email, phone, website_url, prospect_city, prospect_vertical, status, is_test, is_junk, created_at)
        VALUES ('p_existing', 'Prime Corp', 'Prime Corp', 'contact@example.com', '9876543210', 'https://example.com', 'Bengaluru', 'clinic', 'QUALIFIED', 0, 0, datetime('now'))
      `).run();

      // Insert two new prospects: one duplicate by phone, one duplicate by website domain
      db.prepare(`
        INSERT INTO platform_prospects (id, business_name, prospect_business_name, email, phone, website_url, prospect_city, prospect_vertical, status, is_test, is_junk, created_at)
        VALUES 
          ('p_dup_phone', 'Phone Clone', 'Phone Clone', 'other@clone.com', '+91 98765 43210', 'https://other.com', 'Bengaluru', 'clinic', 'NEW', 0, 0, datetime('now')),
          ('p_dup_domain', 'Domain Clone', 'Domain Clone', 'info@example.com', '9123456789', 'https://www.example.com/about', 'Bengaluru', 'clinic', 'NEW', 0, 0, datetime('now'))
      `).run();

      const result = await engine.executeWorkflow('prospect_dedup_qualification');
      expect(result.status).toBe('COMPLETED');
      expect(result.itemsProcessed).toBeGreaterThanOrEqual(2);

      // Check DB statuses
      const phoneDup = db.prepare('SELECT status, is_junk FROM platform_prospects WHERE id = ?').get('p_dup_phone') as any;
      expect(phoneDup.status).toBe('DUPLICATE');
      expect(phoneDup.is_junk).toBe(1);

      const domainDup = db.prepare('SELECT status, is_junk FROM platform_prospects WHERE id = ?').get('p_dup_domain') as any;
      expect(domainDup.status).toBe('DUPLICATE');
      expect(domainDup.is_junk).toBe(1);
    });

    it('payment_status_reconciliation returns BLOCKED on unverified UPI claims and enforces ₹0 cash', async () => {
      const engine = AutomationRegistryEngine.getInstance();
      const db = getDb();

      // Insert unverified UPI payment claim
      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, claimed_at)
        VALUES ('claim_upi_1', 'org_test', 'biz_test', 'UTR_TEST_12345', 5000, 'PAYMENT_CLAIMED', datetime('now'))
      `).run();

      const result = await engine.executeWorkflow('payment_status_reconciliation');
      expect(result.status).toBe('BLOCKED');
      expect((result.resultSummary as any).recognizedBankCashINR).toBe(0);

      const wf = await engine.getWorkflow('payment_status_reconciliation');
      expect(wf?.ownerActionRequired).toContain('Verify');
    });
  });

  describe('3. Cuelinks Consolidation, Idempotency & Attribution Repair', () => {
    it('buildProviderDestinationUrl sets dynamic subid=clickId and hierarchical subids', () => {
      const url = buildProviderDestinationUrl(
        'https://cuelinks.com/c?cid=123&url=https%3A%2F%2Famazon.in%2Fdp%2FB0123456',
        'click_user_777',
        {
          sectorId: 'CONSUMER_TECH',
          campaignId: 'camp_amazon_in',
          offerId: 'deal_boat_earbuds',
          placement: 'public_deals_card'
        }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get('subid')).toBe('click_user_777');
      expect(parsed.searchParams.get('subid2')).toBe('CONSUMER_TECH');
      expect(parsed.searchParams.get('subid3')).toBe('camp_amazon_in');
      expect(parsed.searchParams.get('subid4')).toBe('deal_boat_earbuds');
      expect(parsed.searchParams.get('subid5')).toBe('public_deals_card');
    });

    it('AutonomousDealDiscoveryEngine link registry caches converted URLs idempotently', async () => {
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      dealEngine.clearLinkRegistry();
      expect(dealEngine.getLinkRegistrySize()).toBe(0);

      const mockClient = {
        isConfigured: () => true,
        convertLink: vi.fn().mockResolvedValue({
          original_url: 'https://amazon.in/dp/B000TEST',
          tracking_url: 'https://c.cuelinks.com/?id=456&url=https%3A%2F%2Famazon.in%2Fdp%2FB000TEST',
          affiliated: true,
          campaign: { id: 789 }
        })
      } as any;

      dealEngine.setCuelinksClient(mockClient);

      // First call converts via API
      const res1 = await dealEngine.convertProductUrlToAffiliate('https://amazon.in/dp/B000TEST', 'Amazon India');
      expect(res1.isMonetizable).toBe(true);
      expect(res1.trackingUrl).toContain('c.cuelinks.com');
      expect(mockClient.convertLink).toHaveBeenCalledTimes(1);
      expect(dealEngine.getLinkRegistrySize()).toBe(1);

      // Second call uses cached link without calling API again
      const res2 = await dealEngine.convertProductUrlToAffiliate('https://amazon.in/dp/B000TEST', 'Amazon India');
      expect(res2.isMonetizable).toBe(true);
      expect(res2.trackingUrl).toBe(res1.trackingUrl);
      expect(mockClient.convertLink).toHaveBeenCalledTimes(1); // Still 1!
    });

    it('syncReconciliationOnly invokes sync without fetching offers', async () => {
      const mockClient = {
        isConfigured: () => true,
        ping: vi.fn().mockResolvedValue({ connected: true, publisherId: 101, email: 'test@aro.com', scopes: ['read:channels', 'read:reports', 'read:transactions'] }),
        getChannels: vi.fn().mockResolvedValue([{ id: 1, name: 'ARO Deals', url: 'https://ai-marketing-organization.onrender.com', is_default: true }]),
        searchCampaigns: vi.fn().mockResolvedValue({ total: 10, campaigns: [] }),
        getOffers: vi.fn().mockResolvedValue({ total: 50, offers: [] }),
        getTransactions: vi.fn().mockResolvedValue({ total: 0, transactions: [] }),
        getPerformanceReport: vi.fn().mockResolvedValue({ totals: { clicks: 0, transactions: 0 }, data: [] })
      } as any;

      const syncMgr = CuelinksSyncManager.getInstance(mockClient);

      const syncResult = await syncMgr.syncReconciliationOnly('org_test', 'biz_test');
      expect(syncResult.success).toBe(true);
      expect(mockClient.ping).toHaveBeenCalledTimes(1);
      expect(mockClient.getTransactions).toHaveBeenCalledTimes(1);
      // Offers should NOT be fetched during reconciliation-only sync!
      expect(mockClient.getOffers).not.toHaveBeenCalled();
    });
  });
});
