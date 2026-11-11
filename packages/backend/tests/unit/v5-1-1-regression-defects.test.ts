import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { checkB2BResearchBacklogGuard, getValidatedBacklogLimit } from '../../src/revenue/b2b-research-backlog-guard.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';

describe('V5.1.1 — 10 Regression Defect Repairs Verification', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    d1Repo = D1RevenueRepository.getInstance();
    app = new Hono();
    app.route('/api/v1', apiRouter);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Defect 1: Backlog Guard Fail-Closed & Limit Validation
  // --------------------------------------------------------------------------
  describe('Defect 1: Backlog Guard Limit Validation & Strict Fail-Closed', () => {
    it('safely validates environment backlog limits and rejects invalid thresholds', () => {
      delete process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS;
      expect(getValidatedBacklogLimit()).toBe(10);

      process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS = 'abc';
      expect(getValidatedBacklogLimit()).toBe(10);

      process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS = '-5';
      expect(getValidatedBacklogLimit()).toBe(10);

      process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS = '0';
      expect(getValidatedBacklogLimit()).toBe(10);

      process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS = 'Infinity';
      expect(getValidatedBacklogLimit()).toBe(10);

      process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS = '15';
      expect(getValidatedBacklogLimit()).toBe(15);
    });

    it('strictly fails closed when D1 query throws an error or fails', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockRejectedValue(new Error('D1 Connection Timeout'));

      const res = await checkB2BResearchBacklogGuard(d1Repo);
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('BACKLOG_COUNT_UNAVAILABLE');
      expect(res.unapprovedCount).toBe(-1);
    });

    it('strictly fails closed when D1 query returns null or malformed response', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue(null as any);

      const res = await checkB2BResearchBacklogGuard(d1Repo);
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('BACKLOG_COUNT_UNAVAILABLE');
      expect(res.unapprovedCount).toBe(-1);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 2: Workflow Backlog Protection & Zero Synthetic Pricing Rows
  // --------------------------------------------------------------------------
  describe('Defect 2: Workflow Guard Protection & Zero Synthetic Benchmarks', () => {
    it('daily_market_demand_research is NOT deadlocked by unapproved draft backlog (Stage I P2)', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 20 } as any);

      const engine = AutomationRegistryEngine.getInstance();
      const res = await engine.executeWorkflow('daily_market_demand_research');
      expect(res.resultSummary?.reason).not.toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
      expect(res.status).not.toBe('FAILED');
    });

    it('competitor_pricing_research is NOT deadlocked by unapproved draft backlog (Stage I P2)', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 15 } as any);

      const engine = AutomationRegistryEngine.getInstance();
      const res = await engine.executeWorkflow('competitor_pricing_research');
      expect(res.resultSummary?.reason).not.toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
      expect(res.status).not.toBe('FAILED');
    });

    it('competitor_pricing_research returns NO_VERIFIED_EVIDENCE and DOES NOT insert synthetic benchmark rows when fresh evidence is 0', async () => {
      // Backlog guard returns allowed (unapproved count = 2)
      // Then research_findings count returns 0
      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
        if (table === 'direct_outreach_log') return { cnt: 2 };
        if (table === 'research_findings') return { c: 0 };
        return { c: 0 };
      });
      const writeSpy = vi.spyOn(d1Repo, 'executeWrite');

      const engine = AutomationRegistryEngine.getInstance();
      const res = await engine.executeWorkflow('competitor_pricing_research');
      expect(res.status).toBe('NO_ACTION_DUE');
      expect(res.resultSummary?.status).toBe('NO_VERIFIED_EVIDENCE');
      expect(res.resultSummary?.message).toMatch(/synthetic fixture generation strictly prohibited/i);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('prospect_dedup_qualification is NOT deadlocked by unapproved draft backlog, while outreach_draft_preparation still halts with NO_ACTION_DUE', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 11 } as any);

      const engine = AutomationRegistryEngine.getInstance();
      const dedupRes = await engine.executeWorkflow('prospect_dedup_qualification');
      expect(dedupRes.resultSummary?.reason).not.toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
      expect(dedupRes.status).not.toBe('FAILED');

      const draftRes = await engine.executeWorkflow('outreach_draft_preparation');
      expect(draftRes.status).toBe('NO_ACTION_DUE');
      expect(draftRes.resultSummary?.reason).toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');
    });
  });

  // --------------------------------------------------------------------------
  // Defect 4: 5-Bucket Funnel Click Classification
  // --------------------------------------------------------------------------
  describe('Defect 4: 5-Bucket Funnel Click Classification', () => {
    it('returns all 5 separate click classification buckets on /api/v1/public/revenue-funnel', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
        if (table === 'referral_click_events') {
          return {
            diag: 4,
            human: 2,
            browserCandidate: 1,
            bot: 5,
            unk: 3
          };
        }
        return { c: 0 };
      });

      const res = await app.request('/api/v1/public/revenue-funnel');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      const f = json.data.funnel;

      expect(f.internalDiagnosticClicks).toBe(4);
      expect(f.verifiedHumanOutboundClicks).toBe(2);
      expect(f.browserCandidateOutboundClicks).toBe(1);
      expect(f.botClicks).toBe(5);
      expect(f.unknownClicks).toBe(3);
      expect(f.externalOutboundClicks).toBe(2); // V5.1.2 Mandate: externalOutboundClicks equals verifiedHumanOutboundClicks ONLY
      expect(f.bankCashReceivedINR).toBe(0.00);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 5: No GET Partner Auto-Approval & No partner_offers Mutation
  // --------------------------------------------------------------------------
  describe('Defect 5: Zero Partner Auto-Approval & Zero partner_offers Mutation on GET Redirect', () => {
    it('fails closed with HTTP 503 if partner is not authorized in DB', async () => {
      const mockDeal = {
        id: 'deal_test_unauth_partner',
        title: 'Deal with Unauthorized Partner',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-161',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        availability: 'IN_STOCK'
      };

      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);
      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing Channel', status: 'approved' } as any,
        approved: true
      });
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        campaign: { id: 4232 },
        tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-161'
      });

      // Mock D1 queryOne for partners returning null (unauthorized partner)
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue(null as any);

      const res = await app.request('/api/v1/public/deals/deal_test_unauth_partner/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/partner not authorized; redirect suppressed/i);
    });

    it('persists referral and click events atomically WITHOUT mutating partner_offers or partners tables', async () => {
      const mockDeal = {
        id: 'deal_test_no_mutation',
        title: 'boAt Airdopes 161',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-161',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        availability: 'IN_STOCK'
      };

      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);
      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing Channel', status: 'approved' } as any,
        approved: true
      });
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        campaign: { id: 4232 },
        tracking_url: 'https://linksredirect.com/?cid=331585&subid=clk_abc&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-161'
      });
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ id: 'part_cuelinks', authorization_status: 'AUTHORIZED' } as any);

      let batchTables: string[] = [];
      vi.spyOn(d1Repo, 'executeBatch').mockImplementation(async (stmts: any[]) => {
        batchTables = stmts.map(s => s.table);
        return { rowsAffected: stmts.length, source: 'D1_REMOTE' } as any;
      });

      const res = await app.request('/api/v1/public/deals/deal_test_no_mutation/redirect?utm_source=twitter&utm_medium=social&utm_campaign=diwali_sale');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toContain('https://linksredirect.com/?cid=331585');

      // Verify strictly NO mutations to partners or partner_offers
      expect(batchTables).not.toContain('partners');
      expect(batchTables).not.toContain('partner_offers');
      expect(batchTables).toEqual(['referrals', 'referral_click_events']);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 6: Cuelinks Campaign ID Mismatch & Embedded URL Verification
  // --------------------------------------------------------------------------
  describe('Defect 6: Cuelinks Campaign ID Match & Embedded Handle Verification', () => {
    it('fails closed with HTTP 503 if returned campaign ID does not match deal affiliateCampaignId', async () => {
      const mockDeal = {
        id: 'deal_camp_mismatch',
        title: 'boAt Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-161',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        availability: 'IN_STOCK'
      };

      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);
      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing Channel', status: 'approved' } as any,
        approved: true
      });
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        campaign: { id: 99999 }, // Mismatch!
        tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-161'
      });

      const res = await app.request('/api/v1/public/deals/deal_camp_mismatch/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/campaign ID mismatch/i);
    });

    it('fails closed with HTTP 503 if embedded URL points to dead legacy handle (airdopes-141-anc)', async () => {
      const mockDeal = {
        id: 'deal_dead_handle',
        title: 'boAt Earbuds Dead Handle',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-gen2-wireless-earbuds',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        availability: 'IN_STOCK'
      };

      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);
      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing Channel', status: 'approved' } as any,
        approved: true
      });
      // Mock returning the dead 404 handle
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        campaign: { id: 4232 },
        tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141-anc-true-wireless-earbuds'
      });

      const res = await app.request('/api/v1/public/deals/deal_dead_handle/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/deprecated dead merchant handle/i);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 7: Incoming Marketing UTM Preservation
  // --------------------------------------------------------------------------
  describe('Defect 7: Marketing UTM Attribution Preservation', () => {
    it('preserves utm_source, utm_medium, utm_campaign, utm_term on referral_click_events', async () => {
      const mockDeal = {
        id: 'deal_test_utm',
        title: 'boAt Airdopes 161',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-161',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        availability: 'IN_STOCK'
      };

      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);
      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing Channel', status: 'approved' } as any,
        approved: true
      });
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        campaign: { id: 4232 },
        tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-161'
      });
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ id: 'part_cuelinks', authorization_status: 'AUTHORIZED' } as any);

      let clickEventParams: any[] = [];
      vi.spyOn(d1Repo, 'executeBatch').mockImplementation(async (stmts: any[]) => {
        const clickStmt = stmts.find(s => s.table === 'referral_click_events');
        if (clickStmt) clickEventParams = clickStmt.params;
        return { rowsAffected: stmts.length, source: 'D1_REMOTE' } as any;
      });

      const res = await app.request('/api/v1/public/deals/deal_test_utm/redirect?utm_source=telegram_channel&utm_medium=community&utm_campaign=diwali2026&utm_term=earbuds');
      expect(res.status).toBe(302);

      // clickParams: [id, referralId, clickId, orgId, dealId, partnerId, placement, source, medium, campaign, term, referrer, deviceClass, targetUrl]
      expect(clickEventParams[7]).toBe('telegram_channel'); // source preserved, NOT overwritten with SECTOR_B_ELECTRONICS
      expect(clickEventParams[8]).toBe('community');        // medium preserved, NOT overwritten with cpc_affiliate
      expect(clickEventParams[9]).toBe('diwali2026');       // campaign preserved, NOT overwritten with 4232
      expect(clickEventParams[10]).toBe('earbuds');         // term preserved
    });
  });

  // --------------------------------------------------------------------------
  // Defect 8: Stock Quarantine & Out-Of-Stock Truth
  // --------------------------------------------------------------------------
  describe('Defect 8: Generic Out-of-Stock Quarantine Integrity', () => {
    it('quarantines out-of-stock deals by excluding them from public query results', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const parsedDeal = engine.parseDealFromWorkflowRow({
        id: 'deal_generic_oos_test',
        status: 'VERIFIED',
        inputs_json: JSON.stringify({
          title: 'Synthetic Wireless Earbuds OOS',
          brand: 'AudioBrand',
          merchant: 'AudioMerchant',
          category: 'Electronics',
          productUrl: 'https://audiomerchant.example.com/products/earbuds-oos',
          currentPriceINR: 799,
          referencePriceINR: 3990,
          verifiedDiscountPercent: 80,
          availability: 'OUT_OF_STOCK',
          observedAt: new Date().toISOString(),
          slug: 'synthetic-wireless-earbuds-oos'
        }),
        outputs_json: JSON.stringify({ evidence: { verificationLogs: ['checked'] } }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      expect(parsedDeal).not.toBeNull();
      expect(parsedDeal?.availability).toBe('OUT_OF_STOCK'); // Quarantined
      expect(parsedDeal?.verificationStatus).toBe('OUT_OF_STOCK');

      engine.injectDealForTesting(parsedDeal!);
      const publicDeals = engine.queryPublicDeals();
      expect(publicDeals.deals.find(d => d.id === 'deal_generic_oos_test')).toBeUndefined();
    });

    it('fails closed with HTTP 503 on redirect when deal is marked OUT_OF_STOCK', async () => {
      const mockOutOfStockDeal = {
        id: 'deal_oos_test',
        title: 'Out of Stock boAt Deal',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-gen2-wireless-earbuds',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        availability: 'OUT_OF_STOCK'
      };

      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockOutOfStockDeal as any);

      const res = await app.request('/api/v1/public/deals/deal_oos_test/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toMatch(/product is currently out of stock or restocking; redirect suppressed/i);
    });
  });

  // --------------------------------------------------------------------------
  // Defect 9: Proposal Pricing Provenance Gate
  // --------------------------------------------------------------------------
  describe('Defect 9: Proposal Pricing Provenance Gate', () => {
    it('/owner/proposal strictly does NOT claim owner/BIO.md is the source of ₹15,000 / ₹8,000 pricing', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('# Harsha Vardhan Kotu\nBio content');
      vi.spyOn(DirectCommercialOfferPage, 'isDirectOfferAttested').mockReturnValue(false);

      const res = await app.request('/api/v1/owner/proposal', {
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isAttested).toBe(false);
      expect(json.isPayable).toBe(false);
      expect(json.data.source).not.toBe('owner/BIO.md');
      expect(json.data.source).toContain('PROVISIONAL_ESTIMATE');
      expect(json.message).toMatch(/Commercial terms not yet attested via owner\/OWN_OFFER\.md/i);
    });

    it('/owner/proposal sources pricing from owner/OWN_OFFER.md only when isDirectOfferAttested() is true', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('# Harsha Vardhan Kotu\nBio content');
      vi.spyOn(DirectCommercialOfferPage, 'isDirectOfferAttested').mockReturnValue(true);

      const res = await app.request('/api/v1/owner/proposal', {
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isAttested).toBe(true);
      expect(json.isPayable).toBe(true);
      expect(json.data.source).toBe('owner/OWN_OFFER.md');
    });
  });

  // --------------------------------------------------------------------------
  // Defect 10: Disaggregated Dual Funnels (Affiliate Commerce vs B2B Service)
  // --------------------------------------------------------------------------
  describe('Defect 10: Disaggregated Dual Funnels', () => {
    it('/api/v1/public/revenue-funnel exposes both affiliateFunnel and b2bFunnel with zero commingling', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
        if (table === 'referral_click_events') {
          return { diag: 4, human: 1, browserCandidate: 0, bot: 2, unk: 1 };
        }
        if (table === 'platform_prospects') return { c: 30 };
        if (table === 'direct_outreach_log') {
          if (sql.includes('human_approved = 0')) return { c: 30 };
          if (sql.includes('human_approved = 1')) return { c: 0 };
          if (sql.includes('dispatched = 1')) return { c: 0 };
        }
        return { c: 0 };
      });

      const res = await app.request('/api/v1/public/revenue-funnel');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Affiliate Funnel
      const aff = json.data.affiliateFunnel;
      expect(aff).toBeDefined();
      expect(aff.externalOutboundClicks).toBe(1);
      expect(aff.internalDiagnosticClicks).toBe(4);
      expect(aff.bankCashReceivedINR).toBe(0.00);

      // B2B Funnel
      const b2b = json.data.b2bFunnel;
      expect(b2b).toBeDefined();
      expect(b2b.prospectsResearched).toBe(30);
      expect(b2b.outreachDraftsPrepared).toBe(30);
      expect(b2b.ownerApprovedDrafts).toBe(0);
      expect(b2b.messagesDispatched).toBe(0);
      expect(b2b.verifiedClientPaymentsINR).toBe(0.00);
    });
  });
});
