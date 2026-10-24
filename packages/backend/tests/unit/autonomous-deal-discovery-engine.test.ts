import { describe, it, expect, beforeEach } from 'vitest';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { DealSsrfGuard } from '../../src/commission/deal-ssrf-guard.js';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Autonomous Deal Discovery Engine V1.1 (Spec §§ 1–15)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM workflows WHERE workflow_type = 'PUBLIC_DEAL'`).run();
    } catch {}
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
});
