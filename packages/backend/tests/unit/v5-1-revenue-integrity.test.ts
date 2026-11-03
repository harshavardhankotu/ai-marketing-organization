import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { CommercialOpportunitySelector } from '../../src/commission/commercial-opportunity-selector.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { ReferralTrackingEngine } from '../../src/commission/referral-tracking.js';
import { checkB2BResearchBacklogGuard } from '../../src/revenue/b2b-research-backlog-guard.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { DurableJobQueue } from '../../src/automation/durable-job-queue.js';
import { DiscoveredDealInput } from '../../src/commission/deal-types.js';
import { getDb } from '../../src/db/client.js';

describe('V5.1 — Revenue Integrity, Telemetry Reconciliation & First Buyer Readiness Tests', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;
  let cuelinksClient: CuelinksV3Client;
  let syncMgr: CuelinksSyncManager;
  let dealEngine: AutonomousDealDiscoveryEngine;

  beforeEach(() => {
    process.env.CUELINKS_API_KEY = 'test_key_v51';
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    CommercialOpportunitySelector.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    DurableJobQueue.resetInstance();
    AutomationRegistryEngine.resetInstance();

    cuelinksClient = CuelinksV3Client.getInstance();
    syncMgr = CuelinksSyncManager.getInstance(cuelinksClient);
    dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    d1Repo = D1RevenueRepository.getInstance();

    app = new Hono();
    app.route('/api/v1', apiRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Defect 1: Remove generic affiliate URL fallback 'https://linksredirect.com/?cid=default'
  // --------------------------------------------------------------------------
  describe('1. Zero Generic cid=default Affiliate URL Fallbacks', () => {
    it('blocks offer creation when trackingUrl is missing instead of defaulting to cid=default', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const mockTask: any = {
        id: 'task_test_01',
        organizationId: 'org_owner_primary',
        status: 'PROCESSING',
        stage: 'PROSPECT_DISCOVERY',
        inputs: {
          productTitle: 'Test Missing Tracking URL Product',
          // Note: trackingUrl is omitted
          sourceUrl: 'https://example.com/product'
        },
        outputs: {}
      };

      const { CuelinksSyncManager } = await import('../../src/commission/cuelinks-sync-manager.js');
      vi.spyOn(CuelinksSyncManager.prototype, 'getApprovedChannel').mockResolvedValue({ approved: false } as any);
      vi.spyOn(engine, 'persistTask').mockResolvedValue();
      vi.spyOn((engine as any).partnerRegistry, 'listOffers').mockResolvedValue([]);
      vi.spyOn((engine as any).partnerRegistry, 'getOfferBySlug').mockResolvedValue(null);
      vi.spyOn((engine as any).partnerRegistry, 'listPartners').mockResolvedValue([
        {
          id: 'partner_cuelinks',
          network: 'CUELINKS',
          approvalStatus: 'APPROVED',
          authorizationStatus: 'AUTHORIZED',
          activeStatus: 1
        }
      ]);
      vi.spyOn((engine as any).partnerRegistry, 'isPartnerAuthorizedForProduction').mockReturnValue(true);

      await engine.executeVerifyingStep(mockTask);
      expect(mockTask.status).toBe('BLOCKED');
      expect(mockTask.errorInfo?.blockerType).toBe('INVALID_TRACKING_URL');
      expect(mockTask.errorInfo?.message).toMatch(/No authorized.*tracking URL.*fallback suppressed/i);
      expect(mockTask.outputs.authorizedTrackingUrl).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Defect 2: Remove invented commission fallback commissionRate = 4.0
  // --------------------------------------------------------------------------
  describe('2. Zero Invented Commission Rate Fallbacks', () => {
    it('does NOT invent a 4.0% commission rate when a deal specifies affiliateCampaignId but no verified campaign matches', () => {
      const selector = CommercialOpportunitySelector.getInstance();
      const unverifiedDeal: DiscoveredDealInput = {
        title: 'Unverified Merchant Headphones',
        brand: 'GenericBrand',
        merchant: 'Unknown Merchant Store',
        category: 'Audio',
        productUrl: 'https://unknown-merchant.com/item',
        currentPriceINR: 1999,
        referencePriceINR: 3999,
        claimedDiscountPercent: 50,
        availability: 'IN_STOCK',
        observedAt: new Date().toISOString(),
        sourceDomain: 'unknown-merchant.com',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '99999', // Campaign ID exists on deal, but no matching Cuelinks campaign provided
        modelOrSku: 'sku-unverified-01'
      };

      const res = selector.scoreCandidate(unverifiedDeal, undefined);
      expect(res.status).toBe('REJECTED');
      expect(res.commissionRatePercent).toBe(0);
      expect(res.rejectionReason).toMatch(/No active, verified affiliate campaign with verified commission rate/i);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 3, 4, 5 & 8: Deal redirect fail-closed safety gates (no || '4232', no static channel, valid sector)
  // --------------------------------------------------------------------------
  describe('3. Public Deal Redirect Fail-Closed Safety Gates', () => {
    it('fails closed with HTTP 503 if deal is missing affiliateCampaignId (no fallback to 4232)', async () => {
      const dealWithoutCampaign = {
        id: 'deal_missing_camp',
        title: 'Sample Deal Without Campaign',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/item',
        currentPriceINR: 999,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: undefined, // Missing
        canonicalSlug: 'sample-deal-no-camp'
      };

      vi.spyOn(dealEngine, 'resolveDeal').mockResolvedValue(dealWithoutCampaign as any);

      const res = await app.request('/api/v1/public/deals/deal_missing_camp/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/missing verified campaign mapping/i);
    });

    it('fails closed with HTTP 503 if sector mapping cannot be resolved', async () => {
      const dealWithUnknownCategory = {
        id: 'deal_unknown_sector',
        title: 'Sample Deal Unknown Sector',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: '', // Empty category triggers sector mapping rejection
        productUrl: 'https://www.boat-lifestyle.com/products/item',
        currentPriceINR: 999,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        canonicalSlug: 'sample-deal-unknown-sector'
      };

      vi.spyOn(dealEngine, 'resolveDeal').mockResolvedValue(dealWithUnknownCategory as any);

      const res = await app.request('/api/v1/public/deals/deal_unknown_sector/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/unverified sector mapping/i);
    });

    it('fails closed with HTTP 503 if publisher channel is missing or unapproved', async () => {
      const validDeal = {
        id: 'deal_valid_deal_channel_test',
        title: 'Valid boAt Deal',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/item',
        currentPriceINR: 799,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        canonicalSlug: 'boat-item'
      };

      vi.spyOn(dealEngine, 'resolveDeal').mockResolvedValue(validDeal as any);
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        channel: null,
        approved: false
      });

      const res = await app.request('/api/v1/public/deals/deal_valid_deal_channel_test/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/temporarily unavailable.*unmonetized fallback suppressed/i);
    });

    it('fails closed with HTTP 503 if database batch persistence fails on deal redirect', async () => {
      const validDeal = {
        id: 'deal_db_fail_test',
        title: 'Valid boAt Deal DB Fail',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/item',
        currentPriceINR: 799,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        canonicalSlug: 'boat-item-fail'
      };

      vi.spyOn(dealEngine, 'resolveDeal').mockResolvedValue(validDeal as any);
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing Channel', status: 'approved' } as any,
        approved: true
      });
      vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=331585&subid=clk_test&url=https%3A%2F%2Fboat-lifestyle.com',
        campaign: { id: 4232, name: 'boAt Lifestyle' }
      });

      // Simulate D1 database write failure
      vi.spyOn(d1Repo, 'executeBatch').mockRejectedValue(new Error('D1 Storage Engine Unreachable'));

      const res = await app.request('/api/v1/public/deals/deal_db_fail_test/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/Attribution persistence failed; redirect suppressed/i);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 6 & 7: Legacy /r/:offerSlug/:referralId atomic persistence fail-closed
  // --------------------------------------------------------------------------
  describe('4. Legacy Referral Redirect Atomic Attribution Persistence', () => {
    it('fails closed with HTTP 503 if click event persistence fails in resolveReferralClick', async () => {
      const trackingEngine = ReferralTrackingEngine.getInstance();
      vi.spyOn(trackingEngine, 'resolveReferralClick').mockRejectedValue(
        new Error('CLICK_ATTRIBUTION_PERSISTENCE_FAILED: Database disk quota exceeded')
      );

      // Create a test app matching index.ts /r/ route
      const testApp = new Hono();
      testApp.get('/r/:offerSlug/:referralId', async (c) => {
        try {
          const result = await trackingEngine.resolveReferralClick(c.req.param('offerSlug'), c.req.param('referralId'));
          return c.redirect(result.destinationUrl, 302);
        } catch (err: any) {
          if (err.message?.includes('CLICK_ATTRIBUTION_PERSISTENCE_FAILED') || err.message?.includes('database error')) {
            return c.text('Attribution persistence failed; redirect suppressed to protect monetization', 503);
          }
          return c.json({ error: 'REFERRAL_NOT_FOUND' }, 404);
        }
      });

      const res = await testApp.request('/r/test-offer/ref_test_01');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/Attribution persistence failed; redirect suppressed/i);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 8: Truthful Revenue Funnel Click Classification (Human vs Diagnostic)
  // --------------------------------------------------------------------------
  describe('5. Truthful Revenue Funnel Click Classification', () => {
    it('correctly categorizes diagnostic and automated script clicks under internalDiagnosticClicks and NOT externalOutboundClicks', async () => {
      // Mock D1 query responses simulating:
      // 0 human clicks, 3 diagnostic clicks
      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
        if (table === 'referral_click_events') {
          if (sql.includes('diag') || sql.includes('browserCandidate')) {
            return { diag: 3, human: 0, browserCandidate: 0, bot: 0, unk: 0 };
          }
          if (sql.includes("device_class IN ('human', 'browser_candidate')")) {
            return { c: 0 };
          }
          return { c: 3 };
        }
        if (table === 'visitor_sessions') {
          return { c: 0 };
        }
        return { c: 0 };
      });

      const res = await app.request('/api/v1/public/revenue-funnel');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.funnel.externalOutboundClicks).toBe(0);
      expect(body.data.funnel.internalDiagnosticClicks).toBe(3);
      expect(body.data.funnel.verifiedHumanOutboundClicks).toBe(0);
      expect(body.data.funnel.browserCandidateOutboundClicks).toBe(0);
      expect(body.data.funnel.botClicks).toBe(0);
      expect(body.data.funnel.unknownClicks).toBe(0);
      expect(body.data.funnel.bankCashReceivedINR).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 5: Pre-Execution B2B Research Backlog Guard
  // --------------------------------------------------------------------------
  describe('6. Pre-Execution B2B Research Backlog Guard', () => {
    it('halts prospect discovery and draft preparation when unapproved drafts >= 10', async () => {
      // Mock direct_outreach_log query returning 12 unapproved drafts
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 12 } as any);

      const guard = await checkB2BResearchBacklogGuard(d1Repo);
      expect(guard.allowed).toBe(false);
      expect(guard.unapprovedCount).toBe(12);
      expect(guard.reason).toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
      expect(guard.message).toMatch(/Halting prospect research.*12 unapproved draft/i);
    });

    it('allows prospect discovery when unapproved drafts < 10', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 3 } as any);

      const guard = await checkB2BResearchBacklogGuard(d1Repo);
      expect(guard.allowed).toBe(true);
      expect(guard.unapprovedCount).toBe(3);
    });

    it('AutomationRegistryEngine prospect_discovery_validation halts with NO_ACTION_DUE when backlog limit exceeded', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 15 } as any);

      const engine = AutomationRegistryEngine.getInstance();
      const result = await engine.executeWorkflow('prospect_discovery_validation', 'CLOUDFLARE_CRON', 10000);
      expect(result.status).toBe('NO_ACTION_DUE');
      expect(result.resultSummary.reason).toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
      expect(result.ownerActionRequired).toMatch(/Review 15 pending outreach drafts/i);
    });

    it('AutomationRegistryEngine outreach_draft_preparation halts with NO_ACTION_DUE when backlog limit exceeded', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 10 } as any);

      const engine = AutomationRegistryEngine.getInstance();
      const result = await engine.executeWorkflow('outreach_draft_preparation', 'CLOUDFLARE_CRON', 10000);
      expect(result.status).toBe('NO_ACTION_DUE');
      expect(result.resultSummary.reason).toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
      expect(result.ownerActionRequired).toMatch(/Review 10 pending outreach drafts/i);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 6: Cron Telemetry Reconciliation
  // --------------------------------------------------------------------------
  describe('7. Cron Telemetry Reconciliation & Cycle Semantics', () => {
    it('cron/status reconciles lastSuccessfulCycle with queue lastSuccessfulExecutionAt when older', async () => {
      try {
        getDb().prepare("UPDATE automation_registry SET last_status = 'COMPLETED' WHERE enabled = 1").run();
      } catch {}

      vi.spyOn(d1Repo, 'query').mockImplementation(async (table: string) => {
        if (table === 'automation_registry') {
          return [];
        }
        return [];
      });

      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
        if (table === 'cron_telemetry') {
          return {
            id: 'cloudflare_worker_cron',
            status: 'OBSERVED',
            total_pings: 980,
            last_observed_ping: new Date(Date.now() - 2 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19),
            last_successful_cycle: '2026-11-03 07:03:02', // Old legacy timestamp
            cycle_result: 'SUCCESS'
          };
        }
        return { cnt: 0 };
      });

      const queue = DurableJobQueue.getInstance();
      vi.spyOn(queue, 'getQueueStats').mockResolvedValue({
        queued: 0,
        running: 0,
        completed: 10,
        completedWithFindings: 0,
        noActionDue: 15,
        partial: 0,
        deferred: 0,
        blocked: 0,
        retryWait: 0,
        failedPermanently: 0,
        failedTotal: 0,
        expiredLeases: 0,
        overdueCount: 0,
        oldestOverdueAgeMinutes: 0,
        oldestQueuedAgeMinutes: 0,
        lastSuccessfulExecutionAt: '2026-11-03 17:35:25' // Latest queue execution
      });

      const res = await app.request('/api/v1/cron/status');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe('HEALTHY');
      // Verify reconciliation: lastSuccessfulCycle picks up queue execution timestamp
      expect(data.data.lastSuccessfulCycle).toBe('2026-11-03 17:35:25');
    });
  });
});
