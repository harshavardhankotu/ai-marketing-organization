import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutonomousDealDiscoveryEngine, MAX_OFFER_FRESHNESS_HOURS } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { SAMPLE_DEAL_CANDIDATES_FIXTURE, SAMPLE_COUPON_CANDIDATES_FIXTURE } from '../fixtures/sample-deal-candidates.js';
import { DealSsrfGuard } from '../../src/commission/deal-ssrf-guard.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import type { CuelinksPaginationCursor } from '../../src/commission/deal-types.js';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Autonomous Deal Discovery Engine V1.1 (Spec §§ 1–15)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    vi.restoreAllMocks();
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    engine.setCuelinksClient(null);
    engine.setFetchFn(null);
    engine.injectDiscoveredDealsForTesting(SAMPLE_DEAL_CANDIDATES_FIXTURE);
    const db = getDb();
    try {
      db.prepare(`DELETE FROM workflows WHERE workflow_type IN ('PUBLIC_DEAL', 'CUELINKS_SYNC_CURSOR')`).run();
    } catch {}
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    engine.setCuelinksClient(null);
    engine.setFetchFn(null);
    engine.clearInjectedDealsForTesting();
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
      expect(result.deal?.discountVerificationType).toBe('MERCHANT_CLAIMED');
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
      expect(res1.deal?.discountVerificationType).toBe('MERCHANT_CLAIMED');
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

  describe('4. Expired Deals, Freshness Policy & Observation Integrity (Spec § 5 Level 4)', () => {
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

    it('deactivates stale deals that exceed the 48-hour freshness policy even without explicit expiry date', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const pastObservedIso = new Date(Date.now() - 49 * 3600 * 1000).toISOString(); // 49 hours ago

      const res = await engine.ingestAndVerifyDeal({
        title: 'Stale Unrefreshed Candidate Deal',
        brand: 'VintageBrand',
        merchant: 'Croma India',
        category: 'Electronics & Peripherals',
        productUrl: 'https://www.croma.com/p/stale-deal',
        currentPriceINR: 999,
        referencePriceINR: 1999,
        observedAt: pastObservedIso,
        sourceUrl: 'https://www.croma.com/stale-promo',
        sourceDomain: 'croma.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(res.deal?.verificationStatus).toBe('EXPIRED');
      expect(res.deal?.rejectionReasons.some(r => r.includes('OFFER_STALE'))).toBe(true);

      const publicDeals = engine.queryPublicDeals();
      expect(publicDeals.deals.find(d => d.id === res.deal?.id)).toBeUndefined();
    });

    it('NEVER infers an active coupon or expiry date from execution timestamp if omitted by provider', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const res = await engine.ingestAndVerifyDeal({
        title: 'Evergreen Deal Without Provider Expiry',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        productUrl: 'https://www.boat-lifestyle.com/products/evergreen-item',
        currentPriceINR: 799,
        referencePriceINR: 1999,
        sourceUrl: 'https://www.boat-lifestyle.com/deals',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(res.deal?.expiryDate).toBeUndefined();
      expect(res.deal?.couponCode).toBeUndefined();
      expect(res.deal?.verificationStatus).toBe('VERIFIED');
    });

    it('preserves the original source URL and observation timestamp for evidence audits', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const customObservedAt = '2026-10-25T01:00:00.000Z';
      const exactSourceUrl = 'https://www.boat-lifestyle.com/collections/best-deals?ref=direct_audit';

      const res = await engine.ingestAndVerifyDeal({
        title: 'Auditable Data Truth Deal',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        productUrl: 'https://www.boat-lifestyle.com/products/auditable-item',
        currentPriceINR: 1199,
        referencePriceINR: 2499,
        observedAt: customObservedAt,
        sourceUrl: exactSourceUrl,
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(res.deal?.sourceUrl).toBe(exactSourceUrl);
      expect(res.deal?.observedAt).toBe(customObservedAt);
      expect(res.deal?.evidenceJson.sources).toContain(exactSourceUrl);
      expect(res.deal?.evidenceJson.observedAt).toBe(customObservedAt);
      expect(res.deal?.evidenceJson.priceHistory?.[0].observedAt).toBe(customObservedAt);
    });

    it('keeps deals out of verified public ranking when key claims cannot be verified (UNVERIFIED or REJECTED)', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      // Fake/inverted discount claim (claims 50% discount but current >= reference)
      const unverifiedRes = await engine.ingestAndVerifyDeal({
        title: 'Unverified Inverted Claim Deal',
        brand: 'Generic',
        merchant: 'Unknown Merchant',
        category: 'Electronics',
        productUrl: 'https://www.croma.com/unverified-claim',
        currentPriceINR: 4000,
        referencePriceINR: 3000, // reference price lower than current price!
        claimedDiscountPercent: 50,
        sourceUrl: 'https://www.croma.com/claim',
        sourceDomain: 'croma.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(unverifiedRes.deal?.verificationStatus).toBe('UNVERIFIED');
      expect(engine.calculateBuyerValueScore(unverifiedRes.deal!)).toBe(0);

      const queryRes = engine.queryPublicDeals();
      expect(queryRes.deals.find(d => d.id === unverifiedRes.deal?.id)).toBeUndefined();
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

  describe('9. Hermetic Verification & Ingestion of SAMPLE_DEAL_CANDIDATES_FIXTURE', () => {
    it('ingests all 7 sample deal candidate fixtures hermetically into operational cache', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      expect(SAMPLE_DEAL_CANDIDATES_FIXTURE.length).toBe(7);

      for (const candidate of SAMPLE_DEAL_CANDIDATES_FIXTURE) {
        const res = await engine.ingestAndVerifyDeal(candidate, orgId, bizId);
        expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(res.action);
        expect(res.deal).toBeDefined();
        expect(res.deal?.currentPriceINR).toBeGreaterThan(0);
        expect(res.deal?.currency).toBe('INR');
        expect(res.deal?.productUrl.startsWith('https://')).toBe(true);
        expect(['VERIFIED', 'VERIFIED_WITH_CONDITIONS']).toContain(res.deal?.verificationStatus);
      }
    });

    it('deduplicates sample candidate items deterministically on re-ingestion', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const candidate = SAMPLE_DEAL_CANDIDATES_FIXTURE[0]; // boAt Airdopes 141
      const firstIngest = await engine.ingestAndVerifyDeal(candidate, orgId, bizId);
      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(firstIngest.action);

      const secondIngest = await engine.ingestAndVerifyDeal({
        ...candidate,
        sourceUrl: 'https://another-source.com/deal'
      }, orgId, bizId);

      expect(secondIngest.action).toBe('DEDUPLICATED');
      expect(secondIngest.deal?.id).toBe(firstIngest.deal?.id);
    });

    it('ranks ingested sample candidate deals based on buyer value without affiliate bias', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      for (const candidate of SAMPLE_DEAL_CANDIDATES_FIXTURE) {
        await engine.ingestAndVerifyDeal(candidate, orgId, bizId);
      }

      engine.reRankActiveDeals();
      const publicDeals = engine.queryPublicDeals({ limit: 10 });
      expect(publicDeals.deals.length).toBeGreaterThanOrEqual(5);

      // Verify deals are sorted by buyerValueScore descending
      for (let i = 0; i < publicDeals.deals.length - 1; i++) {
        expect(publicDeals.deals[i].buyerValueScore).toBeGreaterThanOrEqual(publicDeals.deals[i + 1].buyerValueScore);
      }
    });
  });

  describe('10. Coupon-Only Deals & Honest Representation (Workstreams B & E)', () => {
    it('ingests valid coupon-only deals without inventing synthetic current prices or MRPs', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const swiggyCoupon = SAMPLE_COUPON_CANDIDATES_FIXTURE[0]; // Swiggy coupon

      const res = await engine.ingestAndVerifyDeal(swiggyCoupon, orgId, bizId);
      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(res.action);
      expect(res.deal).toBeDefined();

      const deal = res.deal!;
      expect(deal.dealKind).toBe('COUPON');
      expect(deal.couponCode).toBe('FEAST50');
      expect(deal.couponConditions).toBe('Flat 50% off up to ₹150 on min order ₹299');
      // Strictly honest representation: no fake prices or invented MRPs
      expect(deal.currentPriceINR).toBeUndefined();
      expect(deal.referencePriceINR).toBeUndefined();
      expect(deal.currency).toBe('INR');
      expect(deal.verificationStatus).toBe('VERIFIED_WITH_CONDITIONS');
      expect(deal.productUrl).toBe('https://www.swiggy.com/restaurants');

      // Buyer value score calculation works cleanly for coupon-only deals
      expect(deal.buyerValueScore).toBeGreaterThan(0);
      expect(deal.buyerValueScore).toBeLessThanOrEqual(100);
    });

    it('strictly rejects candidate deals lacking BOTH pricing and coupon codes/conditions', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      // Missing both price and coupon code/terms
      const invalidDeal = {
        title: 'Vague Mystery Promotion',
        brand: 'Unknown',
        merchant: 'Mystery Retailer',
        category: 'General',
        productUrl: 'https://example.com/deal/mystery',
        dealKind: 'COUPON' as const,
        sourceUrl: 'https://example.com/deals',
        sourceDomain: 'example.com',
        sourceType: 'COMMUNITY_SUBMISSION' as const
      };

      const res = await engine.ingestAndVerifyDeal(invalidDeal, orgId, bizId);
      expect(res.action).toBe('REJECTED');
      expect(res.deal).toBeUndefined();
      expect(res.rejectionReason).toBeDefined();
    });

    it('rejects product deals with non-positive or missing prices', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const invalidProduct = {
        title: 'Headphones with missing price',
        brand: 'SoundBrand',
        merchant: 'Retailer',
        category: 'Audio',
        productUrl: 'https://example.com/headphones',
        dealKind: 'PRODUCT' as const,
        sourceUrl: 'https://example.com/deals',
        sourceDomain: 'example.com',
        sourceType: 'RETAILER_BRAND' as const
      };

      const res = await engine.ingestAndVerifyDeal(invalidProduct, orgId, bizId);
      expect(res.action).toBe('REJECTED');
      expect(res.rejectionReason).toContain('INVALID_PRICE');
    });

    it('strictly preserves direct merchant URLs when affiliated: false for coupons', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const zohoCoupon = SAMPLE_COUPON_CANDIDATES_FIXTURE[2]; // Zoho Workplace coupon

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'convertLink').mockResolvedValue({
        affiliated: false,
        tracking_url: `https://linksredirect.com/?cid=331585&url=${encodeURIComponent(zohoCoupon.productUrl)}`
      });
      engine.setCuelinksClient(mockClient);

      const res = await engine.ingestAndVerifyDeal(zohoCoupon, orgId, bizId);
      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(res.action);
      expect(res.deal).toBeDefined();

      const deal = res.deal!;
      expect(deal.isMonetizable).toBe(false);
      expect(deal.trackingUrl).toBeUndefined();
      expect(deal.affiliateNetwork).toBeUndefined();
      expect(deal.productUrl).toBe('https://www.zoho.com/workplace/special-offer');
    });

    it('preserves unverified merchant-claimed discounts without fabricating reference prices', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const unverifiedDeal = {
        title: 'Artisan Handcrafted Leather Wallet',
        brand: 'CraftLeather',
        merchant: 'Craft Store',
        category: 'Fashion & Accessories',
        productUrl: 'https://craftstore.in/wallet',
        currentPriceINR: 1299,
        claimedDiscountPercent: 40,
        // No reference price provided by merchant
        sourceUrl: 'https://craftstore.in/deals',
        sourceDomain: 'craftstore.in',
        sourceType: 'RETAILER_BRAND' as const
      };

      const res = await engine.ingestAndVerifyDeal(unverifiedDeal, orgId, bizId);
      expect(['CREATED_VERIFIED', 'DEDUPLICATED']).toContain(res.action);
      expect(res.deal).toBeDefined();

      const deal = res.deal!;
      expect(deal.currentPriceINR).toBe(1299);
      expect(deal.referencePriceINR).toBeUndefined();
      expect(deal.discountVerificationType).toBe('UNCONFIRMED');
      expect(deal.claimedDiscountPercent).toBe(40);
      expect(deal.verifiedDiscountPercent).toBe(0);
      expect(deal.verificationStatus).toBe('UNVERIFIED');
    });
  });

  describe('11. Real Source Discovery & Registry Metrics (Workstream C)', () => {
    it('initializes all default Indian sources with zero offers collected and unattempted state', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.resetSources();
      const sources = engine.getSources();

      expect(sources.length).toBe(19);
      for (const s of sources) {
        expect(s.offersCollected).toBe(0);
        expect(s.lastAttemptAt).toBeUndefined();
      }
    });

    it('only tracks executed source adapters during discovery cycles and avoids false attribution', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.resetSources();
      engine.clearInjectedDealsForTesting();

      // Mock fetchFn for DesiDime RSS & Schema.org to succeed
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('desidime.com')) {
          const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0">
              <channel>
                <title>DesiDime Deals</title>
                <link>https://www.desidime.com</link>
                <item>
                  <title>Redmi Buds 5 Wireless Earbuds</title>
                  <link>https://www.mi.com/in/redmi-buds-5</link>
                  <description>Buy for Rs. 2499 (MRP Rs. 4999) 50% discount</description>
                </item>
              </channel>
            </rss>`;
          return new Response(sampleRss, { status: 200, headers: { 'Content-Type': 'application/xml' } });
        }
        if (url.includes('schema.org')) {
          const sampleHtml = `
            <html>
              <head>
                <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Fire-Boltt Ninja Call Pro Smartwatch",
                  "offers": {
                    "@type": "Offer",
                    "price": "1499",
                    "priceCurrency": "INR",
                    "availability": "https://schema.org/InStock",
                    "url": "https://www.fireboltt.com/products/ninja-call-pro"
                  }
                }
                </script>
              </head>
              <body></body>
            </html>`;
          return new Response(sampleHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
        return new Response('Not Found', { status: 404 });
      });

      engine.setFetchFn(mockFetch as any);

      const cycle = await engine.runDiscoveryCycle(orgId, bizId);
      expect(cycle.sourcesScanned).toBeGreaterThanOrEqual(2);
      expect(cycle.sourcesScanned).toBeLessThanOrEqual(3);

      // Verify un-executed sources (like Flipkart, Amazon, Tata Cliq) are NOT falsely attributed
      const flipkartSrc = engine.getSource('src_flipkart_in');
      expect(flipkartSrc?.lastScanAt).toBeUndefined();
      expect(flipkartSrc?.lastHttpStatus).toBeUndefined();

      const amazonSrc = engine.getSource('src_amazon_in');
      expect(amazonSrc?.lastScanAt).toBeUndefined();
      expect(amazonSrc?.lastHttpStatus).toBeUndefined();

      // Verify executed source registry records have updated metrics
      const desidimeSrc = engine.getSource('src_desidime_public');
      expect(desidimeSrc?.lastAttemptAt).toBeDefined();
      expect(desidimeSrc?.lastSuccessAt).toBeDefined();
      expect(desidimeSrc?.lastHttpStatus).toBe(200);
      expect(desidimeSrc?.offersCollected).toBeGreaterThanOrEqual(1);

      const schemaSrc = engine.getSource('src_schema_org_offers');
      expect(schemaSrc?.lastAttemptAt).toBeDefined();
      expect(schemaSrc?.lastSuccessAt).toBeDefined();
      expect(schemaSrc?.lastHttpStatus).toBe(200);
      expect(schemaSrc?.offersCollected).toBeGreaterThanOrEqual(1);
    });

    it('parses RSS/Atom XML feed with price extraction, MRP, and coupon codes', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Community Deals Feed</title>
            <link>https://www.desidime.com</link>
            <item>
              <title><![CDATA[OnePlus Nord CE 4 (8GB RAM, 128GB Storage)]]></title>
              <link>https://www.oneplus.in/nord-ce-4</link>
              <description><![CDATA[Special launch offer at &#8377; 19,999 (MRP: Rs. 24,999) with flat discount &amp; free shipping]]></description>
            </item>
            <item>
              <title><![CDATA[Domino's Pizza Flat 50% Off]]></title>
              <link>https://www.dominos.co.in/menu</link>
              <description><![CDATA[Get 50% discount up to Rs 100 on all medium pizzas. Use coupon code PIZZA50 on checkout!]]></description>
            </item>
          </channel>
        </rss>`;

      const deals = engine.parseRssFeedXml(rssXml, 'https://www.desidime.com/feed.xml', 'desidime.com');
      expect(deals.length).toBe(2);

      // Deal 1: Product with price and MRP
      const deal1 = deals[0];
      expect(deal1.title).toBe('OnePlus Nord CE 4 (8GB RAM, 128GB Storage)');
      expect(deal1.currentPriceINR).toBe(19999);
      expect(deal1.referencePriceINR).toBe(24999);
      expect(deal1.dealKind).toBe('PRODUCT');
      expect(deal1.productUrl).toBe('https://www.oneplus.in/nord-ce-4');

      // Deal 2: Coupon deal
      const deal2 = deals[1];
      expect(deal2.title).toBe("Domino's Pizza Flat 50% Off");
      expect(deal2.dealKind).toBe('COUPON');
      expect(deal2.couponCode).toBe('PIZZA50');
      expect(deal2.currentPriceINR).toBeUndefined();
      expect(deal2.productUrl).toBe('https://www.dominos.co.in/menu');
    });

    it('parses Schema.org JSON-LD structured data with Product and Offer markup', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Sony WH-1000XM5 Wireless Headphones</title>
            <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Sony WH-1000XM5 Wireless Noise Cancelling Headphones",
              "brand": {
                "@type": "Brand",
                "name": "Sony"
              },
              "offers": {
                "@type": "Offer",
                "price": "26990",
                "priceCurrency": "INR",
                "availability": "https://schema.org/InStock",
                "url": "https://www.sony.co.in/headphones/wh-1000xm5"
              }
            }
            </script>
          </head>
          <body></body>
        </html>`;

      const deals = engine.parseSchemaOrgJsonLd(html, 'https://www.sony.co.in/headphones/wh-1000xm5', 'sony.co.in');
      expect(deals.length).toBe(1);

      const deal = deals[0];
      expect(deal.title).toBe('Sony WH-1000XM5 Wireless Noise Cancelling Headphones');
      expect(deal.brand).toBe('Sony');
      expect(deal.currentPriceINR).toBe(26990);
      expect(deal.availability).toBe('IN_STOCK');
      expect(deal.productUrl).toBe('https://www.sony.co.in/headphones/wh-1000xm5');
    });
  });

  describe('12. Resumable Pagination Continuation Cursor & Checkpointing (Workstream C & D)', () => {
    it('persists and rehydrates Cuelinks pagination cursor in D1 workflows table under wf_cuelinks_sync_cursor', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const testCursor: CuelinksPaginationCursor = {
        campaignPage: 4,
        offerPage: 7,
        lastUpdated: new Date().toISOString()
      };

      await engine.saveCuelinksPaginationCursor(testCursor, orgId, bizId);

      // Rehydrate cursor from engine
      const loadedCursor = await engine.getCuelinksPaginationCursor(orgId);
      expect(loadedCursor.campaignPage).toBe(4);
      expect(loadedCursor.offerPage).toBe(7);

      // Verify row exists in SQLite / D1 workflows table
      const db = getDb();
      const row = db.prepare(`SELECT * FROM workflows WHERE id = 'wf_cuelinks_sync_cursor'`).get() as any;
      expect(row).toBeDefined();
      expect(row.workflow_type).toBe('CUELINKS_SYNC_CURSOR');
      const outputs = JSON.parse(row.outputs_json);
      expect(outputs.campaignPage).toBe(4);
      expect(outputs.offerPage).toBe(7);
    });

    it('advances continuation cursor by 2 offer pages per cycle across multi-cycle executions', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      await engine.resetCuelinksPaginationCursor(orgId, bizId);

      const initialCursor = await engine.getCuelinksPaginationCursor(orgId);
      expect(initialCursor.campaignPage).toBe(1);
      expect(initialCursor.offerPage).toBe(1);

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'ping').mockResolvedValue({ connected: true, message: 'Connected' });
      vi.spyOn(mockClient, 'getChannels').mockResolvedValue([
        { id: 331585, name: 'AI Marketing Channel', url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }
      ]);
      // Return 30 campaigns with total 100 so campaignPage does not wrap around
      vi.spyOn(mockClient, 'searchCampaigns').mockResolvedValue({
        campaigns: Array.from({ length: 30 }, (_, i) => ({
          id: 1000 + i,
          name: `Campaign ${i}`,
          url: `https://brand${i}.com`,
          status: 'active',
          access_status: 'open',
          epc_7d: '5.0'
        })),
        total: 100
      });
      // Return 30 offers per page with total 300 so offerPage does not wrap around
      vi.spyOn(mockClient, 'getOffers').mockImplementation(async (params) => {
        const page = params?.page || 1;
        return {
          offers: Array.from({ length: 30 }, (_, i) => ({
            id: page * 100 + i,
            campaign_id: 1000,
            title: `Offer ${page}-${i}`,
            url: `https://brand0.com/offer-${page}-${i}`,
            current_price_inr: 999,
            discount: '20% off'
          })),
          total: 300
        };
      });
      vi.spyOn(mockClient, 'convertLink').mockImplementation(async (req) => ({
        affiliated: true,
        tracking_url: `https://clnk.in/track_${encodeURIComponent(req.url)}`,
        campaign: { id: 1000, name: 'Campaign 0' }
      }));
      vi.spyOn(mockClient, 'getReports').mockResolvedValue({ reports: [], total: 0 });

      engine.setCuelinksClient(mockClient);

      // Cycle 1: starts at campaignPage=1, offerPage=1
      await engine.runDiscoveryCycle(orgId, bizId);
      const cursorAfterCycle1 = await engine.getCuelinksPaginationCursor(orgId);
      expect(cursorAfterCycle1.campaignPage).toBe(2);
      expect(cursorAfterCycle1.offerPage).toBe(3); // Advanced 2 offer pages

      // Cycle 2: resumes at campaignPage=2, offerPage=3
      await engine.runDiscoveryCycle(orgId, bizId);
      const cursorAfterCycle2 = await engine.getCuelinksPaginationCursor(orgId);
      expect(cursorAfterCycle2.campaignPage).toBe(3);
      expect(cursorAfterCycle2.offerPage).toBe(5); // Advanced another 2 offer pages
    });

    it('wraps around pagination cursor to page 1 when reaching catalog end', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      // Set cursor near end of catalog
      await engine.saveCuelinksPaginationCursor({
        campaignPage: 10,
        offerPage: 20,
        lastUpdated: new Date().toISOString()
      }, orgId, bizId);

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'ping').mockResolvedValue({ connected: true, message: 'Connected' });
      vi.spyOn(mockClient, 'getChannels').mockResolvedValue([
        { id: 331585, name: 'AI Marketing Channel', url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }
      ]);
      // End reached for campaigns: returns fewer than 30
      vi.spyOn(mockClient, 'searchCampaigns').mockResolvedValue({
        campaigns: [{ id: 999, name: 'Final Campaign', url: 'https://finalbrand.com', status: 'active', access_status: 'open', epc_7d: '1.0' }],
        total: 50
      });
      // End reached for offers: empty list
      vi.spyOn(mockClient, 'getOffers').mockResolvedValue({
        offers: [],
        total: 100
      });
      vi.spyOn(mockClient, 'convertLink').mockResolvedValue({ affiliated: false, tracking_url: '' });
      vi.spyOn(mockClient, 'getReports').mockResolvedValue({ reports: [], total: 0 });

      engine.setCuelinksClient(mockClient);

      await engine.runDiscoveryCycle(orgId, bizId);
      const cursorAfterWrap = await engine.getCuelinksPaginationCursor(orgId);
      expect(cursorAfterWrap.campaignPage).toBe(1); // Wrapped around to 1
      expect(cursorAfterWrap.offerPage).toBe(1); // Wrapped around to 1
    });

    it('deduplicates identical offers delivered across paginated batches', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      await engine.resetCuelinksPaginationCursor(orgId, bizId);

      const mockClient = new CuelinksV3Client({ apiKey: 'mock_cuelinks_key' });
      vi.spyOn(mockClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(mockClient, 'ping').mockResolvedValue({ connected: true, message: 'Connected' });
      vi.spyOn(mockClient, 'getChannels').mockResolvedValue([
        { id: 331585, name: 'AI Marketing Channel', url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }
      ]);
      vi.spyOn(mockClient, 'searchCampaigns').mockResolvedValue({
        campaigns: [{ id: 500, name: 'Repeat Merchant', url: 'https://repeat.com', status: 'active', access_status: 'open', epc_7d: '5.0' }],
        total: 1
      });

      // Both pages return the same deal offer
      const sharedOffer = {
        id: 7777,
        campaign_id: 500,
        title: 'Evergreen Repeat Offer',
        url: 'https://repeat.com/item-evergreen',
        current_price_inr: 599,
        discount: '30% off'
      };

      vi.spyOn(mockClient, 'getOffers').mockResolvedValue({
        offers: [sharedOffer],
        total: 1
      });
      vi.spyOn(mockClient, 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://clnk.in/repeat7777',
        campaign: { id: 500, name: 'Repeat Merchant' }
      });
      vi.spyOn(mockClient, 'getReports').mockResolvedValue({ reports: [], total: 0 });

      engine.setCuelinksClient(mockClient);

      const cycle1 = await engine.runDiscoveryCycle(orgId, bizId);
      const cycle2 = await engine.runDiscoveryCycle(orgId, bizId);

      // On cycle 2, the offer should be deduplicated
      expect(cycle2.offersDeduplicated).toBeGreaterThanOrEqual(1);
    });
  });

  describe('13. Source Failure Isolation (Workstream C)', () => {
    it('isolates source network and HTTP failures without crashing the entire discovery cycle', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.resetSources();
      engine.clearInjectedDealsForTesting();

      // Mock fetch: DesiDime RSS returns 500 Server Error; Schema.org returns 200 OK
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('desidime.com')) {
          return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
        }
        if (url.includes('schema.org')) {
          const validHtml = `
            <html><head>
              <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Noise ColorFit Pulse Grand Smartwatch",
                "offers": {
                  "@type": "Offer",
                  "price": "1299",
                  "priceCurrency": "INR",
                  "availability": "https://schema.org/InStock",
                  "url": "https://www.gonoise.com/products/colorfit-pulse-grand"
                }
              }
              </script>
            </head><body></body></html>`;
          return new Response(validHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
        return new Response('Not Found', { status: 404 });
      });

      engine.setFetchFn(mockFetch as any);

      // Discovery cycle MUST NOT throw
      const cycle = await engine.runDiscoveryCycle(orgId, bizId);
      expect(cycle.cycleId).toBeDefined();

      // Failing source metrics
      const desidimeSrc = engine.getSource('src_desidime_public');
      expect(desidimeSrc).toBeDefined();
      expect(desidimeSrc?.lastHttpStatus).toBe(500);
      expect(desidimeSrc?.failureCount).toBeGreaterThanOrEqual(1);
      expect(desidimeSrc?.lastError).toContain('HTTP_500');
      expect(desidimeSrc?.nextRetryAt).toBeDefined();

      // Successful source metrics
      const schemaSrc = engine.getSource('src_schema_org_offers');
      expect(schemaSrc).toBeDefined();
      expect(schemaSrc?.lastHttpStatus).toBe(200);
      expect(schemaSrc?.failureCount).toBe(0);
      expect(schemaSrc?.offersCollected).toBeGreaterThanOrEqual(1);

      // Global engine metrics reflect 1 failing source and valid offers
      const metrics = engine.getDealEngineMetrics();
      expect(metrics.sources.failing).toBeGreaterThanOrEqual(1);
      expect(metrics.sources.failureReasons['HTTP_500: Failed to fetch feed']).toBe(1);
    });

    it('recovers source health when subsequent discovery attempt succeeds', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      // DesiDime was failing previously; now simulate recovery
      const recoveredRss = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>DesiDime Deals</title>
            <item>
              <title>Portronics Toad 23 Wireless Optical Mouse</title>
              <link>https://www.portronics.com/products/toad-23</link>
              <description>Special price Rs. 299 (MRP Rs. 599)</description>
            </item>
          </channel>
        </rss>`;

      // Reset nextRetryAt to allow scan immediately
      const desidimeSrc = engine.getSource('src_desidime_public');
      if (desidimeSrc) {
        desidimeSrc.nextRetryAt = undefined;
      }

      engine.setFetchFn(vi.fn().mockResolvedValue(new Response(recoveredRss, { status: 200 })) as any);

      await engine.runDiscoveryCycle(orgId, bizId);

      const recoveredSrc = engine.getSource('src_desidime_public');
      expect(recoveredSrc?.lastHttpStatus).toBe(200);
      expect(recoveredSrc?.failureCount).toBe(0);
      expect(recoveredSrc?.lastError).toBeUndefined();
      expect(recoveredSrc?.lastSuccessAt).toBeDefined();
    });
  });
});
