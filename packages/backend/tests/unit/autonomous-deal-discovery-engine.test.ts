import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { DealSsrfGuard } from '../../src/commission/deal-ssrf-guard.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Autonomous Deal Discovery Engine V1.1 (Spec §§ 1–15)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    vi.restoreAllMocks();
    AutonomousDealDiscoveryEngine.getInstance().setCuelinksClient(null);
    const db = getDb();
    try {
      db.prepare(`DELETE FROM workflows WHERE workflow_type = 'PUBLIC_DEAL'`).run();
    } catch {}
  });

  afterEach(() => {
    vi.restoreAllMocks();
    AutonomousDealDiscoveryEngine.getInstance().setCuelinksClient(null);
  });

  describe('1. SSRF & Network Security Gate (Spec § 3 & § 13)', () => {
    it('blocks loopback, private IPv4, cloud metadata, and internal hostnames', () => {
      const maliciousUrls = [
        'http://127.0.0.1/admin',
        'http://127.0.0.2:8080/secrets',
        'http://localhost:3000/api',
        'http://localhost.localdomain/internal',
        'http://10.0.0.1/metadata',
        'http://172.16.0.1/private',
        'http://192.168.1.1/router',
        'http://169.254.169.254/latest/meta-data/',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://2130706433/', // Decimal for 127.0.0.1
        'http://0x7f000001/', // Hex for 127.0.0.1
        'http://internal-service.local/status',
        'http://company.corp/vault'
      ];

      for (const url of maliciousUrls) {
        const check = DealSsrfGuard.isSafePublicUrl(url);
        expect(check.safe).toBe(false);
        expect(check.reason).toBeDefined();
      }
    });

    it('rejects forbidden schemes like file, ftp, gopher, and javascript', () => {
      const forbiddenSchemes = [
        'file:///etc/passwd',
        'ftp://ftp.example.com/file.txt',
        'gopher://gopher.example.com/',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>'
      ];

      for (const url of forbiddenSchemes) {
        const check = DealSsrfGuard.isSafePublicUrl(url);
        expect(check.safe).toBe(false);
        expect(check.reason).toContain('FORBIDDEN_PROTOCOL');
      }
    });

    it('allows valid public HTTPS and HTTP domains', () => {
      const validUrls = [
        'https://www.croma.com/p/12345',
        'https://www.boat-lifestyle.com/products/earbuds',
        'https://www.reliancedigital.in/item',
        'https://www.lenovo.com/in/en/p/82RK0085IN',
        'https://www.desidime.com/deals/123'
      ];

      for (const url of validUrls) {
        const check = DealSsrfGuard.isSafePublicUrl(url);
        expect(check.safe).toBe(true);
        expect(check.normalizedUrl).toBeDefined();
      }
    });

    it('normalizes product URLs by stripping tracking query parameters', () => {
      const tracked = 'https://www.croma.com/product/123?utm_source=google&utm_medium=cpc&ref=affiliate_id&model=x';
      const normalized = DealSsrfGuard.normalizeProductUrl(tracked);
      expect(normalized).toBe('https://www.croma.com/product/123?model=x');
      expect(normalized).not.toContain('utm_source');
      expect(normalized).not.toContain('ref');
    });
  });

  describe('2. Deal Ingestion, Price Cross-Checking & Fake Discount Detection (Spec § 4 & § 5)', () => {
    it('ingests and verifies valid Indian retailer deal with genuine discount', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = await engine.ingestAndVerifyDeal({
        title: 'boAt Airdopes 141 ANC Bluetooth Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-anc',
        currentPriceINR: 1499,
        referencePriceINR: 5990,
        claimedDiscountPercent: 75,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        sourceUrl: 'https://www.boat-lifestyle.com/deals',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'AIRDOPES-141-ANC'
      }, orgId, bizId);

      expect(result.action).toBe('CREATED_VERIFIED');
      expect(result.deal).toBeDefined();
      expect(result.deal?.verificationStatus).toBe('VERIFIED');
      expect(result.deal?.currentPriceINR).toBe(1499);
      expect(result.deal?.verifiedDiscountPercent).toBe(75);
      expect(result.deal?.discountVerificationType).toBe('INDEPENDENT_CORROBORATED');
      expect(result.deal?.buyerValueScore).toBeGreaterThanOrEqual(70);
    });

    it('detects inverted or fake discounts where current price >= reference price', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = await engine.ingestAndVerifyDeal({
        title: 'Fake Inverted Discount Deal',
        brand: 'TestBrand',
        merchant: 'TestMerchant',
        category: 'Electronics',
        productUrl: 'https://www.testmerchant.in/fake-deal',
        currentPriceINR: 5000,
        referencePriceINR: 4000, // Reference is lower than current!
        claimedDiscountPercent: 50,
        sourceUrl: 'https://www.testmerchant.in/deals',
        sourceDomain: 'testmerchant.in',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(result.action).toBe('CREATED_VERIFIED');
      expect(result.deal?.verifiedDiscountPercent).toBe(0);
      expect(result.deal?.discountVerificationType).toBe('UNCONFIRMED');
    });

    it('rejects invalid or non-positive price inputs', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const resultZero = await engine.ingestAndVerifyDeal({
        title: 'Zero Rupee Bug Product',
        brand: 'BugBrand',
        merchant: 'BugMerchant',
        category: 'Electronics',
        productUrl: 'https://www.croma.com/zero-item',
        currentPriceINR: 0,
        sourceUrl: 'https://www.croma.com',
        sourceDomain: 'croma.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(resultZero.action).toBe('REJECTED');
      expect(resultZero.rejectionReason).toContain('INVALID_PRICE');
    });

    it('flags deals requiring promo code as VERIFIED_WITH_CONDITIONS', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = await engine.ingestAndVerifyDeal({
        title: 'Lenovo Legion Gaming Laptop',
        brand: 'Lenovo',
        merchant: 'Lenovo India',
        category: 'Computers & Laptops',
        productUrl: 'https://www.lenovo.com/in/en/legion-5',
        currentPriceINR: 85990,
        referencePriceINR: 115990,
        couponCode: 'LEGIONEXTRA',
        couponConditions: 'Extra ₹3000 off on checkout with ICICI cards',
        sourceUrl: 'https://www.lenovo.com/in/en/deals',
        sourceDomain: 'lenovo.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(result.action).toBe('CREATED_VERIFIED');
      expect(result.deal?.verificationStatus).toBe('VERIFIED_WITH_CONDITIONS');
      expect(result.deal?.couponCode).toBe('LEGIONEXTRA');
    });
  });

  describe('3. Deterministic Deduplication Pipeline (Spec § 6)', () => {
    it('merges evidence when the same deal is discovered across multiple sources without creating duplicate records', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      // First discovery from merchant direct
      const res1 = await engine.ingestAndVerifyDeal({
        title: 'Logitech MX Master 3S Wireless Performance Mouse',
        brand: 'Logitech',
        merchant: 'Vijay Sales',
        category: 'Electronics & Peripherals',
        productUrl: 'https://www.vijaysales.com/logitech-mx-master-3s/p/9999?utm_source=google',
        currentPriceINR: 8995,
        referencePriceINR: 10995,
        sourceUrl: 'https://www.vijaysales.com/deals',
        sourceDomain: 'vijaysales.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'MX-MASTER-3S'
      }, orgId, bizId);

      expect(res1.action).toBe('CREATED_VERIFIED');
      const initialDealId = res1.deal?.id;

      // Second discovery from deal aggregator feed
      const res2 = await engine.ingestAndVerifyDeal({
        title: 'Logitech MX Master 3S Wireless Performance Mouse',
        brand: 'Logitech',
        merchant: 'Vijay Sales',
        category: 'Electronics & Peripherals',
        productUrl: 'https://www.vijaysales.com/logitech-mx-master-3s/p/9999?ref=desidime_forum',
        currentPriceINR: 8995,
        referencePriceINR: 10995,
        sourceUrl: 'https://www.desidime.com/deals/logitech-mx-master-3s-deal',
        sourceDomain: 'desidime.com',
        sourceType: 'PUBLIC_DEAL_FEED',
        modelOrSku: 'MX-MASTER-3S'
      }, orgId, bizId);

      expect(res2.action).toBe('DEDUPLICATED');
      expect(res2.deal?.id).toBe(initialDealId);
      expect(res2.deal?.evidenceJson.sources.length).toBe(2);
      expect(res2.deal?.discountVerificationType).toBe('INDEPENDENT_CORROBORATED');
    });
  });

  describe('4. Expired Deals & Stock Cleanup (Spec § 5 Level 4)', () => {
    it('deactivates deals whose validity period has elapsed and removes them from active ranking', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      // Ingest deal with past expiry date
      const res = await engine.ingestAndVerifyDeal({
        title: 'Flash Sale Limited Time Power Bank',
        brand: 'Croma',
        merchant: 'Croma India',
        category: 'Electronics & Peripherals',
        productUrl: 'https://www.croma.com/p/expired-deal',
        currentPriceINR: 499,
        referencePriceINR: 1299,
        expiryDate: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
        sourceUrl: 'https://www.croma.com/flash-sale',
        sourceDomain: 'croma.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(res.deal?.verificationStatus).toBe('EXPIRED');

      // Query active deals — expired deal must NOT appear
      const queryRes = engine.queryPublicDeals();
      const found = queryRes.deals.find(d => d.id === res.deal?.id);
      expect(found).toBeUndefined();
    });
  });

  describe('5. Buyer-Value Ranking Engine (Spec § 7)', () => {
    it('ranks deals based on verified buyer value, ensuring affiliate monetization does NOT bias ranking', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const dealA: any = {
        title: 'Deal A: Strongly Verified 50% Off (Non-Affiliate)',
        verificationStatus: 'VERIFIED',
        confidenceScore: 95,
        verifiedDiscountPercent: 50,
        claimedDiscountPercent: 50,
        availability: 'IN_STOCK',
        lastCheckedAt: new Date().toISOString(),
        sourceDomain: 'boat-lifestyle.com',
        isMonetizable: false
      };

      const dealB: any = {
        title: 'Deal B: Claimed 60% Off (Affiliate Monetizable, Unconfirmed Baseline)',
        verificationStatus: 'UNCONFIRMED',
        confidenceScore: 70,
        verifiedDiscountPercent: 0,
        claimedDiscountPercent: 60,
        availability: 'IN_STOCK',
        lastCheckedAt: new Date().toISOString(),
        sourceDomain: 'unknown.com',
        isMonetizable: true, // Has affiliate link
        affiliateNetwork: 'CUELINKS'
      };

      const scoreA = engine.calculateBuyerValueScore(dealA);
      const scoreB = engine.calculateBuyerValueScore(dealB);

      expect(scoreA).toBeGreaterThan(scoreB);
    });
  });

  describe('6. Public Deals HTTP API Endpoints (Spec § 9)', () => {
    it('serves active deals with pagination, search, category filters, and sorting via GET /api/v1/public/deals', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      await engine.runDiscoveryCycle(orgId, bizId);

      const res = await app.request('/api/v1/public/deals?page=1&limit=10');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.deals).toBeDefined();
      expect(Array.isArray(json.data.deals)).toBe(true);
      expect(json.data.deals.length).toBeGreaterThanOrEqual(1);
      expect(json.data.total).toBeGreaterThanOrEqual(1);
      expect(json.data.categories.length).toBeGreaterThanOrEqual(1);
      expect(json.data.merchants.length).toBeGreaterThanOrEqual(1);

      // Verify deal card fields
      const firstDeal = json.data.deals[0];
      expect(firstDeal.title).toBeDefined();
      expect(firstDeal.currentPriceINR).toBeGreaterThan(0);
      expect(firstDeal.currency).toBe('INR');
      expect(firstDeal.productUrl).toBeDefined();
      expect(['VERIFIED', 'VERIFIED_WITH_CONDITIONS', 'UNCONFIRMED']).toContain(firstDeal.verificationStatus);
    });

    it('returns single deal by ID via GET /api/v1/public/deals/:id', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const allDeals = engine.queryPublicDeals();
      expect(allDeals.deals.length).toBeGreaterThan(0);

      const targetId = allDeals.deals[0].id;
      const res = await app.request(`/api/v1/public/deals/${targetId}`);
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(targetId);
      expect(json.data.title).toBe(allDeals.deals[0].title);
    });

    it('returns 404 for non-existent deal ID', async () => {
      const res = await app.request('/api/v1/public/deals/deal_nonexistent_xyz');
      expect(res.status).toBe(404);
    });

    it('allows anonymous access to GET /api/v1/public/deals in production mode without requiring credentials', async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const res = await app.request('/api/v1/public/deals');
        expect(res.status).toBe(200);
        const json = await res.json() as any;
        expect(json.success).toBe(true);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('7. Owner Operational Observability API (Spec § 12)', () => {
    it('enforces owner authentication and rejects anonymous access with 401', async () => {
      const res = await app.request('/api/v1/owner/deal-engine/status');
      expect(res.status).toBe(401);

      const resWake = await app.request('/api/v1/owner/deal-engine/wake', { method: 'POST' });
      expect(resWake.status).toBe(401);
    });

    it('serves accurate deal discovery metrics via GET /api/v1/owner/deal-engine/status', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/deal-engine/status', {
        headers: { Authorization: `Bearer ${session.token}`, 'x-organization-id': orgId }
      });
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.sources.totalDiscovered).toBeGreaterThanOrEqual(10);
      expect(json.data.sources.allowed).toBeGreaterThanOrEqual(5);
      expect(json.data.offers.verified).toBeGreaterThanOrEqual(1);
      expect(json.data.execution.status).toBeDefined();
    });

    it('triggers manual on-demand deal discovery cycle via POST /api/v1/owner/deal-engine/wake', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/deal-engine/wake', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}`, 'x-organization-id': orgId }
      });
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.cycleId).toBeDefined();
      expect(json.data.offersVerified + json.data.offersDeduplicated).toBeGreaterThanOrEqual(1);
      expect(json.data.activeDealsTotal).toBeGreaterThanOrEqual(1);
    });
  });

  describe('8. Cuelinks Monetization Conversion & Merchant Link Preservation (Spec §§ 5 & 8)', () => {
    it('seamlessly converts candidate deals with affiliated: true into monetizable tracking URLs (boAt, Noise, Lenovo, Croma, Vijay Sales)', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'convertLink').mockImplementation(async (req) => {
        const u = req.url;
        if (u.includes('boat-lifestyle.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/boat4232', campaign: { id: 4232, name: 'Boat' } };
        }
        if (u.includes('gonoise.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/noise3278', campaign: { id: 3278, name: 'Gonoise' } };
        }
        if (u.includes('lenovo.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/lenovo823', campaign: { id: 823, name: 'Lenovo India' } };
        }
        if (u.includes('croma.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/croma201', campaign: { id: 201, name: 'Croma Retail' } };
        }
        if (u.includes('vijaysales.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/vijay4164', campaign: { id: 4164, name: 'Vijay Sales' } };
        }
        return { affiliated: false, tracking_url: req.url };
      });

      engine.setCuelinksClient(mockClient);

      // Ingest boAt candidate deal
      const boatRes = await engine.ingestAndVerifyDeal({
        title: 'boAt Airdopes 141 Bluetooth Truly Wireless in Ear Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
        currentPriceINR: 1299,
        referencePriceINR: 4490,
        claimedDiscountPercent: 71,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        sourceUrl: 'https://www.boat-lifestyle.com/deals',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'AIRDOPES-141-BLK'
      }, orgId, bizId);

      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(boatRes.action);
      expect(boatRes.deal?.isMonetizable).toBe(true);
      expect(boatRes.deal?.trackingUrl).toBe('https://clnk.in/boat4232');
      expect(boatRes.deal?.affiliateNetwork).toBe('CUELINKS');
      expect(boatRes.deal?.affiliateCampaignId).toBe('4232');
      // Canonical productUrl is retained
      expect(boatRes.deal?.productUrl).toBe('https://www.boat-lifestyle.com/products/airdopes-141');

      // Ingest Croma candidate deal
      const cromaRes = await engine.ingestAndVerifyDeal({
        title: 'Croma 10000 mAh 22.5W Fast Charging Power Bank',
        brand: 'Croma',
        merchant: 'Croma India',
        category: 'Electronics & Peripherals',
        productUrl: 'https://www.croma.com/croma-10000mah-22-5w-fast-charging-power-bank/p/264582',
        currentPriceINR: 899,
        referencePriceINR: 1900,
        claimedDiscountPercent: 53,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        sourceUrl: 'https://www.croma.com/deals',
        sourceDomain: 'croma.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'CRSP10K22W'
      }, orgId, bizId);

      expect(cromaRes.deal?.isMonetizable).toBe(true);
      expect(cromaRes.deal?.trackingUrl).toBe('https://clnk.in/croma201');
      expect(cromaRes.deal?.affiliateNetwork).toBe('CUELINKS');
      expect(cromaRes.deal?.affiliateCampaignId).toBe('201');
    });

    it('strictly preserves pure direct merchant URLs for non-affiliated merchants with affiliated: false (Reliance Digital, Zoho)', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'convertLink').mockImplementation(async (req) => {
        // Cuelinks returns affiliated: false for non-affiliated / unapproved campaigns
        return {
          affiliated: false,
          tracking_url: `https://linksredirect.com/?cid=331585&url=${encodeURIComponent(req.url)}`,
          campaign: req.url.includes('reliancedigital.in') ? { id: 3955, name: 'Reliance Digital' } : { id: 73159, name: 'Zoho' }
        };
      });

      engine.setCuelinksClient(mockClient);

      // Ingest Reliance Digital deal
      const rdRes = await engine.ingestAndVerifyDeal({
        title: 'Philips Air Fryer HD9200/90 with Rapid Air Technology (4.1 Liter)',
        brand: 'Philips',
        merchant: 'Reliance Digital',
        category: 'Electronics & Appliances',
        productUrl: 'https://www.reliancedigital.in/philips-hd9200-90-air-fryer/p/492403612',
        currentPriceINR: 6499,
        referencePriceINR: 9995,
        claimedDiscountPercent: 35,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        sourceUrl: 'https://www.reliancedigital.in/kitchen-fest',
        sourceDomain: 'reliancedigital.in',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'HD9200-90'
      }, orgId, bizId);

      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(rdRes.action);
      expect(rdRes.deal?.isMonetizable).toBe(false);
      expect(rdRes.deal?.trackingUrl).toBeUndefined();
      expect(rdRes.deal?.productUrl).toBe('https://www.reliancedigital.in/philips-hd9200-90-air-fryer/p/492403612');
      expect(rdRes.deal?.affiliateNetwork).toBeUndefined();
      expect(rdRes.deal?.affiliateCampaignId).toBeUndefined();

      // Ingest Zoho deal
      const zohoRes = await engine.ingestAndVerifyDeal({
        title: 'Zoho Workplace Standard Suite (Cloud Email, Docs, Sheets, Chat & Storage)',
        brand: 'Zoho',
        merchant: 'Zoho India',
        category: 'SaaS & Business Software',
        productUrl: 'https://www.zoho.com/workplace/pricing.html',
        currentPriceINR: 99,
        referencePriceINR: 149,
        claimedDiscountPercent: 34,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        sourceUrl: 'https://www.zoho.com/workplace/',
        sourceDomain: 'zoho.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: 'ZOHO-WP-STD-IN'
      }, orgId, bizId);

      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(zohoRes.action);
      expect(zohoRes.deal?.isMonetizable).toBe(false);
      expect(zohoRes.deal?.trackingUrl).toBeUndefined();
      expect(zohoRes.deal?.productUrl).toBe('https://www.zoho.com/workplace/pricing.html');
      expect(zohoRes.deal?.affiliateNetwork).toBeUndefined();
    });

    it('evaluates open India campaigns and converts candidate deals in discovery cycle', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'ping').mockResolvedValue({ connected: true, message: 'Connected' });
      vi.spyOn(mockClient, 'getChannels').mockResolvedValue([
        { id: 331585, name: 'AI Marketing Channel', url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }
      ]);
      vi.spyOn(mockClient, 'searchCampaigns').mockResolvedValue({
        campaigns: [
          { id: 4386, name: 'Oppo India', url: 'https://www.oppo.com/in/store', status: 'active', access_status: 'open', epc_7d: '91.87', payout: '2.85%' },
          { id: 6271, name: 'AppSumo', url: 'https://appsumo.com', status: 'active', access_status: 'open', epc_7d: '22.97', payout: '52.5%' },
          { id: 29, name: 'Cleartrip Flight', url: 'https://www.cleartrip.com', status: 'active', access_status: 'open', epc_7d: '12.39', payout: '67.5' },
          { id: 4232, name: 'Boat', url: 'https://www.boat-lifestyle.com', status: 'active', access_status: 'open', epc_7d: '0.66', payout: '6.0%' }
        ],
        total: 4
      });
      vi.spyOn(mockClient, 'getOffers').mockResolvedValue({
        offers: [
          {
            id: 8801,
            campaign_id: 4386,
            campaign_name: 'Oppo India',
            title: 'Oppo Reno 11 5G Super Deal',
            url: 'https://www.oppo.com/in/smartphones/reno-series/reno11-5g/',
            current_price_inr: 29999,
            reference_price_inr: 39999,
            discount: '25% off'
          }
        ],
        total: 1
      });
      vi.spyOn(mockClient, 'convertLink').mockImplementation(async (req) => {
        const u = req.url;
        if (u.includes('boat-lifestyle.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/boat4232', campaign: { id: 4232, name: 'Boat' } };
        }
        if (u.includes('gonoise.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/noise3278', campaign: { id: 3278, name: 'Gonoise' } };
        }
        if (u.includes('lenovo.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/lenovo823', campaign: { id: 823, name: 'Lenovo India' } };
        }
        if (u.includes('croma.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/croma201', campaign: { id: 201, name: 'Croma Retail' } };
        }
        if (u.includes('vijaysales.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/vijay4164', campaign: { id: 4164, name: 'Vijay Sales' } };
        }
        if (u.includes('oppo.com')) {
          return { affiliated: true, tracking_url: 'https://clnk.in/oppo4386', campaign: { id: 4386, name: 'Oppo India' } };
        }
        // Reliance Digital & Zoho: non-affiliated
        return { affiliated: false, tracking_url: req.url };
      });
      vi.spyOn(mockClient, 'getTransactions').mockResolvedValue({ transactions: [], total: 0 });
      vi.spyOn(mockClient, 'getReports').mockResolvedValue({ reports: [], total: 0 });

      engine.setCuelinksClient(mockClient);

      const cycle = await engine.runDiscoveryCycle(orgId, bizId);
      expect(cycle.offersDiscovered).toBeGreaterThanOrEqual(8); // 7 retailer deals + 1 live Cuelinks offer
      expect(cycle.activeDealsTotal).toBeGreaterThanOrEqual(7);

      const metrics = engine.getDealEngineMetrics();
      // boAt, Noise, Lenovo, Croma, Vijay Sales, and Oppo live offer are affiliated = 6
      expect(metrics.monetization.affiliateEligible).toBeGreaterThanOrEqual(5);
      expect(metrics.monetization.withAuthorizedTracking).toBeGreaterThanOrEqual(5);
      // Reliance Digital and Zoho maintain pure direct merchant links = 2
      expect(metrics.monetization.directMerchantLinks).toBeGreaterThanOrEqual(2);

      // Verify boAt deal has tracking URL
      const publicDeals = engine.queryPublicDeals();
      const boatDeal = publicDeals.deals.find(d => d.brand === 'boAt');
      expect(boatDeal?.isMonetizable).toBe(true);
      expect(boatDeal?.trackingUrl).toBe('https://clnk.in/boat4232');
      expect(boatDeal?.affiliateCampaignId).toBe('4232');

      // Verify Reliance Digital deal maintains pure merchant URL and is NOT monetizable
      const rdDeal = publicDeals.deals.find(d => d.merchant === 'Reliance Digital');
      expect(rdDeal?.isMonetizable).toBe(false);
      expect(rdDeal?.trackingUrl).toBeUndefined();
      expect(rdDeal?.productUrl).toContain('reliancedigital.in');
    });

    it('falls back cleanly to direct merchant links when Cuelinks is unconfigured without errors', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const mockClient = new CuelinksV3Client({ apiKey: '' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(false);
      engine.setCuelinksClient(mockClient);

      const deals = await engine.discoverDealsFromAllSources(orgId, bizId);
      expect(deals.length).toBeGreaterThanOrEqual(7);

      for (const d of deals) {
        expect(d.isMonetizable).toBe(false);
        expect(d.trackingUrl).toBeUndefined();
        expect(d.productUrl).toBeDefined();
        expect(d.productUrl.startsWith('https://')).toBe(true);
      }
    });
  });
});
