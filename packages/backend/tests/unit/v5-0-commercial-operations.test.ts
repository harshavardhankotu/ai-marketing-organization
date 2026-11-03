import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CommercialOpportunitySelector } from '../../src/commission/commercial-opportunity-selector.js';
import { OrganicDistributionEngine } from '../../src/commission/organic-distribution-engine.js';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { D1Client } from '../../src/db/d1-client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { DiscoveredDealInput } from '../../src/commission/deal-types.js';

describe('V5.0 Commercial Operations, Dynamic Attribution & Learning Suite', () => {
  let app: Hono;
  let engine: AutonomousDealDiscoveryEngine;
  let syncMgr: CuelinksSyncManager;
  let selector: CommercialOpportunitySelector;
  let distributor: OrganicDistributionEngine;
  let learningEngine: CommercialLearningEngine;

  beforeEach(() => {
    process.env.CUELINKS_API_KEY = 'test_cuelinks_api_key_v50';
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    CommercialOpportunitySelector.resetInstance();
    OrganicDistributionEngine.resetInstance();
    CommercialLearningEngine.resetInstance();

    engine = AutonomousDealDiscoveryEngine.getInstance();
    syncMgr = CuelinksSyncManager.getInstance();
    selector = CommercialOpportunitySelector.getInstance();
    distributor = OrganicDistributionEngine.getInstance();
    learningEngine = CommercialLearningEngine.getInstance();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  describe('1. D1 Batch Atomic Persistence & SQL Interpolation', () => {
    it('safely formats and interpolates SQL parameter types for Cloudflare D1 batching', () => {
      const sql = 'INSERT INTO test (a, b, c, d, e) VALUES (?, ?, ?, ?, ?)';
      const date = new Date('2026-11-03T12:00:00.000Z');
      const interpolated = D1Client.interpolateSql(sql, [
        123,
        "O'Reilly's Earbuds",
        true,
        null,
        date
      ]);

      expect(interpolated).toBe(
        "INSERT INTO test (a, b, c, d, e) VALUES (123, 'O''Reilly''s Earbuds', 1, NULL, '2026-11-03T12:00:00.000Z')"
      );
    });

    it('executes atomic batch writes across referrals and referral_click_events in local SQLite', async () => {
      const d1Repo = D1RevenueRepository.getInstance();
      const clickId = `clk_test_${Date.now()}`;
      const refId = `ref_${clickId}`;

      const res = await d1Repo.executeBatch([
        {
          table: 'referrals',
          sql: `INSERT INTO referrals (id, click_id, destination_url, organization_id, offer_id, partner_id, ip, user_agent, placement, device_class, created_at)
                VALUES (?, ?, ?, 'org_owner_primary', 'deal_1', 'part_cuelinks', '127.0.0.1', 'Mozilla', 'test', 'human', datetime('now'))`,
          params: [refId, clickId, 'https://linksredirect.com/?test=1']
        },
        {
          table: 'referral_click_events',
          sql: `INSERT INTO referral_click_events (id, referral_id, click_id, organization_id, offer_id, partner_id, placement, source, medium, campaign, referrer, device_class, destination_url, created_at)
                VALUES (?, ?, ?, 'org_owner_primary', 'deal_1', 'part_cuelinks', 'test', 'SECTOR_B', 'cpc', '4232', 'direct', 'human', 'https://linksredirect.com/?test=1', datetime('now'))`,
          params: [`evt_${clickId}`, refId, clickId]
        }
      ]);

      expect(res.rowsAffected).toBeGreaterThanOrEqual(2);

      const db = getDb();
      const savedRef = db.prepare('SELECT * FROM referrals WHERE id = ?').get(refId) as any;
      const savedClick = db.prepare('SELECT * FROM referral_click_events WHERE referral_id = ?').get(refId) as any;

      expect(savedRef).toBeDefined();
      expect(savedRef.click_id).toBe(clickId);
      expect(savedClick).toBeDefined();
      expect(savedClick.click_id).toBe(clickId);
    });
  });

  describe('2. Dynamic Channel Resolution & Fail-Closed Deal Redirect', () => {
    it('dynamically resolves approved publisher channel and redirects with Cuelinks tracking URL', async () => {
      const client = CuelinksV3Client.getInstance();
      vi.spyOn(client, 'getChannels').mockResolvedValue([
        { id: 331585, name: 'AI Marketing Org', status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
      ]);
      vi.spyOn(client, 'convertLink').mockResolvedValue({
        url: 'https://www.boat-lifestyle.com/products/airdopes-141',
        affiliated: true,
        channel_id: 331585,
        tracking_url: 'https://linksredirect.com/?cid=331585&subid=clk_test&url=https%3A%2F%2Fboat-lifestyle.com'
      });

      const { deal } = await engine.registerDeal({
        title: 'boAt Airdopes 141 Truly Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Headphones',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
        currentPriceINR: 999,
        referencePriceINR: 4490,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        sourceUrl: 'https://www.boat-lifestyle.com',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'AIRDOPES-141',
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        isMonetizable: true
      });

      const res = await app.request(`/api/v1/public/deals/${deal.id}/redirect`, {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
          'referer': 'https://google.com'
        }
      });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('https://linksredirect.com/?cid=331585');
    });

    it('fails closed with HTTP 503 if dynamic conversion fails and never forwards unmonetized traffic', async () => {
      const client = CuelinksV3Client.getInstance();
      vi.spyOn(client, 'convertLink').mockResolvedValue({
        url: 'https://www.boat-lifestyle.com/products/airdopes-141',
        affiliated: false,
        channel_id: 331585
      });

      const { deal } = await engine.registerDeal({
        title: 'boAt Airdopes 141 Truly Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Headphones',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
        currentPriceINR: 999,
        referencePriceINR: 4490,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        sourceUrl: 'https://www.boat-lifestyle.com',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'AIRDOPES-141',
        affiliateNetwork: 'CUELINKS',
        isMonetizable: true
      });

      const res = await app.request(`/api/v1/public/deals/${deal.id}/redirect`, {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('Affiliate monetization path temporarily unavailable');
    });
  });

  describe('3. Durable Reconciliation Cursor & Non-INR Currency Isolation', () => {
    it('isolates non-INR transactions and persists durable reconciliation cursor in workflows table', async () => {
      const client = CuelinksV3Client.getInstance();
      const testSubId = `clk_recon_${Date.now()}`;
      const refId = `ref_${testSubId}`;

      // Insert pre-existing referral
      const db = getDb();
      db.prepare(`
        INSERT INTO referrals (id, click_id, destination_url, organization_id, offer_id, partner_id, ip, user_agent, placement, device_class, created_at)
        VALUES (?, ?, 'https://linksredirect.com/?test=1', 'org_owner_primary', 'deal_1', 'part_cuelinks', '127.0.0.1', 'Mozilla', 'guide', 'human', datetime('now'))
      `).run(refId, testSubId);

      vi.spyOn(client, 'getTransactions').mockResolvedValue({
        transactions: [
          {
            id: 9001,
            currency: 'INR',
            commission_amount: 59.94,
            status: 'validated',
            sub_id: testSubId,
            campaign_id: 4232,
            channel_id: 331585,
            order_amount: 999
          },
          {
            id: 9002,
            currency: 'USD', // Non-INR currency
            commission_amount: 25.0,
            status: 'validated',
            sub_id: 'clk_foreign_usd',
            campaign_id: 8888,
            channel_id: 331585,
            order_amount: 100
          }
        ],
        meta: { page: 1, per_page: 100, total: 2, total_pages: 1, next_page: null, prev_page: null }
      });

      const recon = await syncMgr.reconcileTransactionsIncremental();

      // Only INR transaction is summed into validatedCommissionINR
      expect(recon.validatedCommissionINR).toBe(59.94);
      expect(recon.currencyUnclassifiedCount).toBe(1);

      // Verify commission record in DB
      const commRecord = db.prepare("SELECT * FROM commission_records WHERE external_transaction_id = '9001'").get() as any;
      expect(commRecord).toBeDefined();
      expect(commRecord.referral_id).toBe(refId);
      expect(commRecord.verified_commission_inr).toBe(59.94);
      expect(commRecord.status).toBe('COMMISSION_APPROVED');

      // Verify cursor checkpoint in workflows
      const cursorRow = db.prepare("SELECT * FROM workflows WHERE id = 'wf_cuelinks_reconciliation_cursor'").get() as any;
      expect(cursorRow).toBeDefined();
      const meta = JSON.parse(cursorRow.outputs_json);
      expect(meta.lastReconciledSince).toBeDefined();
      expect(meta.transactionsCount).toBe(2);
    });

    it('does NOT advance reconciliation cursor if transaction persistence throws', async () => {
      const client = CuelinksV3Client.getInstance();
      vi.spyOn(client, 'getTransactions').mockResolvedValue({
        transactions: [
          {
            id: 9003,
            currency: 'INR',
            commission_amount: 47.94,
            status: 'validated',
            sub_id: 'clk_error_test'
          }
        ],
        meta: { page: 1, per_page: 100, total: 1, total_pages: 1, next_page: null, prev_page: null }
      });

      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'executeWrite').mockRejectedValueOnce(new Error('Simulated D1 Disk Failure'));

      const db = getDb();
      db.prepare("DELETE FROM workflows WHERE id = 'wf_cuelinks_reconciliation_cursor'").run();

      await syncMgr.reconcileTransactionsIncremental();

      // Cursor must NOT be created/advanced on failed write
      const cursorRow = db.prepare("SELECT * FROM workflows WHERE id = 'wf_cuelinks_reconciliation_cursor'").get();
      expect(cursorRow).toBeUndefined();
    });
  });

  describe('4. Commercial Opportunity Selector & Live SKU Qualification', () => {
    it('disqualifies known 404 dead handle (boAt Airdopes 141 ANC)', () => {
      const deadCandidate: DiscoveredDealInput = {
        title: 'boAt Airdopes 141 ANC True Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Personal Audio',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-anc',
        currentPriceINR: 1399,
        referencePriceINR: 5990,
        modelOrSku: '141-ANC'
      };

      const result = selector.scoreCandidate(deadCandidate);
      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason).toContain('known dead handle');
    });

    it('qualifies active boAt Airdopes 141 Gen 2 (₹799) with score >= 70', () => {
      const liveGen2Candidate: DiscoveredDealInput = {
        title: 'boAt Airdopes 141 Gen 2 Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Headphones',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-gen2-wireless-earbuds',
        currentPriceINR: 799,
        referencePriceINR: 3990,
        modelOrSku: 'AIRDOPES-141-GEN2',
        affiliateCampaignId: '4232'
      };

      const result = selector.scoreCandidate(liveGen2Candidate);
      expect(result.status).toBe('QUALIFIED');
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.commissionRatePercent).toBe(6.0);
      expect(result.projectedCommissionINR).toBe(47.94);
    });

    it('qualifies active boAt Airdopes 141 (₹999) on Campaign 4232', () => {
      const liveStandardCandidate: DiscoveredDealInput = {
        title: 'boAt Airdopes 141 True Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Headphones',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
        currentPriceINR: 999,
        referencePriceINR: 4490,
        modelOrSku: 'AIRDOPES-141',
        affiliateCampaignId: '4232'
      };

      const result = selector.scoreCandidate(liveStandardCandidate);
      expect(result.status).toBe('QUALIFIED');
      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.commissionRatePercent).toBe(6.0);
      expect(result.projectedCommissionINR).toBe(59.94);
    });

    it('returns NO_QUALIFIED_COMMERCIAL_OPPORTUNITY when all candidates fail criteria', () => {
      const badCandidates: DiscoveredDealInput[] = [
        {
          title: 'Empty URL item',
          brand: 'Generic',
          merchant: 'Unknown',
          category: 'Misc',
          productUrl: '',
          currentPriceINR: 0
        },
        {
          title: 'Dead SKU item',
          brand: 'boAt',
          merchant: 'boAt',
          category: 'Audio',
          productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-anc',
          currentPriceINR: 999
        }
      ];

      const selection = selector.selectBestOpportunity(badCandidates);
      expect(selection.status).toBe('NO_QUALIFIED_COMMERCIAL_OPPORTUNITY');
      expect(selection.selectedOpportunity).toBeNull();
      expect(selection.qualifiedCount).toBe(0);
    });
  });

  describe('5. Organic Distribution Engine & Compliance Disclosures', () => {
    it('generates zero-paid organic distribution package with mandatory #Ad disclosures', () => {
      const liveGen2Candidate: DiscoveredDealInput = {
        title: 'boAt Airdopes 141 Gen 2 Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Headphones',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-gen2-wireless-earbuds',
        currentPriceINR: 799,
        referencePriceINR: 3990,
        modelOrSku: 'AIRDOPES-141-GEN2',
        affiliateCampaignId: '4232'
      };

      const opp = selector.scoreCandidate(liveGen2Candidate);
      const pkg = distributor.generateDistributionPackage(opp);

      expect(pkg.sku).toBe('AIRDOPES-141-GEN2');
      expect(pkg.buyingGuideUrl).toContain('/deals/airdopes-141-gen2');
      expect(pkg.shareKit.length).toBeGreaterThanOrEqual(3);

      for (const post of pkg.shareKit) {
        expect(post.disclosureTag).toBeDefined();
        expect(post.canonicalUrl).toContain('/api/v1/public/deals/');
      }

      expect(pkg.replyDeskCopy.complianceNotice).toContain('affiliate commission');
      expect(pkg.replyDeskCopy.productName).toBe(opp.title);
    });
  });

  describe('6. Commercial Learning Loop Closed State Machine', () => {
    it('executes the complete 8-stage state machine from DISCOVER to IMPROVE', async () => {
      const candidates: DiscoveredDealInput[] = [
        {
          title: 'boAt Airdopes 141 Gen 2 Wireless Earbuds',
          brand: 'boAt',
          merchant: 'boAt Lifestyle',
          category: 'Audio & Headphones',
          productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-gen2-wireless-earbuds',
          currentPriceINR: 799,
          referencePriceINR: 3990,
          modelOrSku: 'AIRDOPES-141-GEN2',
          affiliateCampaignId: '4232'
        }
      ];

      const report = await learningEngine.executeCycle({ candidateDeals: candidates });

      expect(report.stagesCompleted).toEqual([
        'DISCOVER',
        'QUALIFY',
        'PUBLISH',
        'DISTRIBUTE',
        'MEASURE',
        'RECONCILE',
        'EVALUATE',
        'IMPROVE'
      ]);

      expect(report.state).toBe('IMPROVE');
      expect(report.candidateDealsDiscovered).toBe(1);
      expect(report.qualifiedOpportunity).toBeDefined();
      expect(report.qualifiedOpportunity?.sku).toBe('AIRDOPES-141-GEN2');
      expect(report.distributionPackage).toBeDefined();
      expect(report.cycleVerdict).toBe('OPPORTUNITY_DISTRIBUTED');
      expect(report.nextCycleRecommendations.length).toBeGreaterThan(0);
      expect(report.cashReceivedINR).toBe(0); // ₹0 bank-confirmed cash until verified
    });
  });
});
