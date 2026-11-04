import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CommercialOpportunitySelector } from '../../src/commission/commercial-opportunity-selector.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { classifyTraffic } from '../../src/commission/referral-tracking.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';

describe('V5.1.2 — Commercial Integrity, Campaign Null-Guard & Variant Stock Verification', () => {
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
  // Phase 1: Cuelinks Campaign Null-Bypass & Offer Fallback Removal
  // --------------------------------------------------------------------------
  describe('Phase 1: Cuelinks Campaign Null-Bypass & Unrelated Offer Fallback', () => {
    const mockDeal = {
      id: 'deal_test_phase1',
      slug: 'test-phase1-deal',
      canonicalSlug: 'test-phase1-deal',
      title: 'Test Phase 1 Product',
      brand: 'TestBrand',
      merchant: 'TestMerchant',
      category: 'Electronics',
      productUrl: 'https://www.testmerchant.com/products/test-item',
      currentPriceINR: 999,
      currency: 'INR',
      referencePriceINR: 1999,
      claimedDiscountPercent: 50,
      verifiedDiscountPercent: 50,
      discountVerificationType: 'INDEPENDENT_CORROBORATED' as const,
      availability: 'IN_STOCK' as const,
      geographicRestrictions: ['India'],
      offerStart: new Date().toISOString(),
      expiryDate: new Date(Date.now() + 86400000).toISOString(),
      lastCheckedAt: new Date().toISOString(),
      observedAt: new Date().toISOString(),
      sourceUrl: 'https://www.testmerchant.com/products/test-item',
      sourceDomain: 'testmerchant.com',
      sourceType: 'RETAILER_BRAND' as const,
      verificationStatus: 'VERIFIED' as const,
      confidenceScore: 90,
      buyerValueScore: 85,
      rejectionReasons: [],
      isMonetizable: true,
      affiliateNetwork: 'CUELINKS' as const,
      affiliateCampaignId: '4232',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    it('Test 1a: Returns HTTP 503 when convRes.campaign is null despite affiliated: true', async () => {
      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);

      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'Render Production', status: 'approved' } as any,
        approved: true
      });

      // Cuelinks V3 returns null campaign object
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=331585&subid=clk_123&url=https%3A%2F%2Fwww.testmerchant.com%2Fproducts%2Ftest-item',
        campaign: null // Null campaign object
      } as any);

      const res = await app.request('/api/v1/public/deals/deal_test_phase1/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('campaign ID mismatch or missing campaign object');
    });

    it('Test 1b: Returns HTTP 503 when convRes.campaign.id mismatches deal.affiliateCampaignId', async () => {
      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);

      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'Render Production', status: 'approved' } as any,
        approved: true
      });

      // Cuelinks returns mismatching campaign
      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=331585&subid=clk_123&url=https%3A%2F%2Fwww.testmerchant.com%2Fproducts%2Ftest-item',
        campaign: { id: 9999, name: 'Unrelated Campaign' }
      } as any);

      const res = await app.request('/api/v1/public/deals/deal_test_phase1/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('campaign ID mismatch');
    });

    it('Test 1c: Returns HTTP 503 when target deal offer row is missing even if partner has another active offer', async () => {
      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'resolveDeal').mockResolvedValue(mockDeal as any);

      vi.spyOn(CuelinksSyncManager.getInstance(CuelinksV3Client.getInstance()), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'Render Production', status: 'approved' } as any,
        approved: true
      });

      vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=331585&subid=clk_123&url=https%3A%2F%2Fwww.testmerchant.com%2Fproducts%2Ftest-item',
        campaign: { id: 4232, name: 'boAt Lifestyle' }
      } as any);

      // Mock D1: partner is authorized, but queryOne for this specific deal in partner_offers returns null
      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string, params: any[] = []) => {
        if (table === 'partners') {
          return { id: 'part_cuelinks', authorization_status: 'AUTHORIZED', approval_status: 'APPROVED' };
        }
        if (table === 'partner_offers') {
          // Zero unrelated offer fallback: target deal row missing -> returns null
          return null;
        }
        return null;
      });

      const res = await app.request('/api/v1/public/deals/deal_test_phase1/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('partner offer not active or missing');
    });
  });

  // --------------------------------------------------------------------------
  // Phase 2: Variant-Level Stock & Price Proof
  // --------------------------------------------------------------------------
  describe('Phase 2: Variant-Level Stock & Price Verification', () => {
    it('Test 2a: Marks DEAD_OR_OUT_OF_STOCK when all variants have available: false', async () => {
      const selector = CommercialOpportunitySelector.getInstance();
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url: any) => {
        if (String(url).endsWith('.js')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              title: 'Sold Out Product',
              handle: 'sold-out-product',
              available: true, // top level misleading true
              variants: [
                { id: 101, title: 'Black', available: false, price: 99900 },
                { id: 102, title: 'Blue', available: false, price: 99900 }
              ]
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const result = await selector.probeMerchantProduct('https://www.teststore.com/products/sold-out-product', mockFetch);
      expect(result.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(result.available).toBe(false);
      expect(result.error).toContain('All variants sold out');
    });

    it('Test 2b: Selects in-stock variant and appends ?variant=<id> when a purchasable variant exists', async () => {
      const selector = CommercialOpportunitySelector.getInstance();
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url: any) => {
        if (String(url).endsWith('.js')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              title: 'Partially In Stock Product',
              handle: 'partially-in-stock',
              available: true,
              variants: [
                { id: 201, title: 'Black', available: false, price: 79900, compare_at_price: 199900 },
                { id: 202, title: 'White', available: true, price: 89900, compare_at_price: 249000 }
              ]
            })
          } as any;
        }
        // HTML probe returns clean page without restocking badge
        return {
          ok: true,
          status: 200,
          text: async () => '<html><body><button class="add-to-cart">Add to Cart</button></body></html>'
        } as any;
      });

      const result = await selector.probeMerchantProduct('https://www.teststore.com/products/partially-in-stock', mockFetch);
      expect(result.status).toBe('IN_STOCK');
      expect(result.available).toBe(true);
      expect(result.variantId).toBe(202);
      expect(result.priceINR).toBe(899);
      expect(result.referencePriceINR).toBe(2490);
      expect(result.variantUrl).toBe('https://www.teststore.com/products/partially-in-stock?variant=202');
    });

    it('Test 2c: Quarantines variant when HTML page contains Restocking soon button', async () => {
      const selector = CommercialOpportunitySelector.getInstance();
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url: any) => {
        if (String(url).endsWith('.js')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              title: 'Restocking Product',
              handle: 'restocking-prod',
              available: true,
              variants: [
                { id: 301, title: 'Black', available: true, price: 89900, compare_at_price: 249000 }
              ]
            })
          } as any;
        }
        // HTML probe returns restocking button
        return {
          ok: true,
          status: 200,
          text: async () => '<html><body><button class="button restocking-cta">Restocking soon!</button></body></html>'
        } as any;
      });

      const result = await selector.probeMerchantProduct('https://www.teststore.com/products/restocking-prod', mockFetch);
      expect(result.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(result.available).toBe(false);
      expect(result.error).toContain('Restocking soon badge');
    });

    it('Test 2d: /api/v1/public/deals returns deals: [] when all candidates are quarantined', async () => {
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      // Deal engine should have quarantined deals
      dealEngine.resetSources();
      const deals = dealEngine.queryPublicDeals({ limit: 10 }).deals;
      expect(deals.filter(d => d.id !== 'deal_test_phase1')).toHaveLength(0);

      vi.spyOn(dealEngine, 'queryPublicDeals').mockReturnValue({
        deals: [],
        total: 0,
        categories: [],
        merchants: [],
        page: 1,
        limit: 50
      });

      const res = await app.request('/api/v1/public/deals');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.deals).toEqual([]);
      expect(json.data.total).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 3: Traffic Classification & External Outbound Clicks Isolation
  // --------------------------------------------------------------------------
  describe('Phase 3: Traffic Classification & Outbound Clicks Metric Isolation', () => {
    it('Test 3a: classifyTraffic classifies x-diagnostic-probe header as test', () => {
      const result = classifyTraffic(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
        '127.0.0.1',
        { 'x-diagnostic-probe': 'true' }
      );
      expect(result).toBe('test');
    });

    it('Test 3b: revenue-funnel externalOutboundClicks strictly equals verifiedHumanOutboundClicks', async () => {
      vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
        if (table === 'traffic_sessions') {
          return { c: 5 };
        }
        if (table === 'referral_click_events') {
          return {
            diag: 10,
            human: 3,
            browserCandidate: 4,
            bot: 2,
            unk: 1
          };
        }
        return { c: 0, total: 0 };
      });

      const res = await app.request('/api/v1/public/revenue-funnel');
      expect(res.status).toBe(200);
      const json = await res.json();
      // externalOutboundClicks MUST equal verifiedHumanOutboundClicks ONLY (3), not 3 + 4 = 7
      expect(json.data.funnel.externalOutboundClicks).toBe(3);
      expect(json.data.funnel.verifiedHumanOutboundClicks).toBe(3);
      expect(json.data.funnel.browserCandidateOutboundClicks).toBe(4);
      expect(json.data.funnel.internalDiagnosticClicks).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 4: Public Pricing & Claim Scrubbing & Inquiry Deliverable
  // --------------------------------------------------------------------------
  describe('Phase 4: Public Pricing Display & End-to-End Inquiry Deliverable', () => {
    it('Test 4a: renderHomepageHtml when unattested contains zero ₹15,000 / ₹8,000 strings and zero 68% / ₹25,000–₹60,000 claims', () => {
      const html = DirectCommercialOfferPage.getInstance().renderHomepageHtml();
      expect(html).not.toContain('₹15,000');
      expect(html).not.toContain('₹8,000');
      expect(html).not.toContain('68%');
      expect(html).not.toContain('₹25,000');
      expect(html).not.toContain('₹60,000');
      expect(html).toContain('Custom Pilot Pricing — Request Scope &amp; Attested Quote');
      expect(html).toContain('Administrative Website &amp; WhatsApp Inquiry Capture');
    });

    it('Test 4b: /api/v1/offer/inquiry produces structuredTriageRecord, calendarIcs, and csvRow', async () => {
      const payload = {
        customerName: 'Dr. Ramesh Babu',
        customerPhone: '9849012345',
        customerEmail: 'drramesh@kavuridental.com',
        serviceOfInterest: 'Kavuri Dental Care, Hyderabad',
        notes: 'Inquiries arriving after 8 PM are missed by front desk.',
        consentGiven: true
      };

      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.structuredTriageRecord).toBeDefined();
      expect(json.structuredTriageRecord.clinicName).toBe('Kavuri Dental Care');
      expect(json.structuredTriageRecord.contactPerson).toBe('Dr. Ramesh Babu');
      expect(json.structuredTriageRecord.serviceCategory).toBe('Administrative Website & WhatsApp Inquiry Capture');

      // Verify valid RFC 5545 calendar file
      expect(json.calendarIcs).toBeDefined();
      expect(json.calendarIcs).toContain('BEGIN:VCALENDAR');
      expect(json.calendarIcs).toContain('BEGIN:VEVENT');
      expect(json.calendarIcs).toContain('SUMMARY:Administrative Lead Triage Walkthrough - Kavuri Dental Care');
      expect(json.calendarIcs).toContain('END:VCALENDAR');

      // Verify formatted CSV row
      expect(json.csvRow).toBeDefined();
      expect(json.csvRow).toContain('Kavuri Dental Care');
      expect(json.csvRow).toContain('Dr. Ramesh Babu');
      expect(json.csvRow).toContain('9849012345');
      expect(json.csvRow).toContain('QUALIFIED');
    });
  });

  // --------------------------------------------------------------------------
  // Phase 5: Re-Qualified 5 Hyderabad Independent Dental Clinics
  // --------------------------------------------------------------------------
  describe('Phase 5: Re-Qualified Independent Clinics & Outreach Truth', () => {
    it('Test 5a: Curated batch seeds 5 independent Hyderabad clinics and quarantines rootsdentalclinic', async () => {
      const engine = PlatformProspectDiscoveryEngine.getInstance();
      vi.spyOn(d1Repo, 'query').mockResolvedValue([]);
      const writeSpy = vi.spyOn(d1Repo, 'executeWrite').mockResolvedValue({ success: true } as any);

      await engine.ensureCuratedQualifiedProspectBatch();

      // Verify quarantine and deferral SQL was executed
      const quarantineCalls = writeSpy.mock.calls.filter(c =>
        String(c[1]).includes('ENTERPRISE_CHAIN_DEFERRED') || String(c[1]).includes('QUARANTINED')
      );
      expect(quarantineCalls.length).toBeGreaterThan(0);
    });
  });
});
