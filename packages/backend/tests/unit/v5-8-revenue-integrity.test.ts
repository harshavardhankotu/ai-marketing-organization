import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { app } from '../../src/index.js';

describe('V5.8 — Revenue Integrity, Deterministic D1 Upserts & Honest Telemetry', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    AutonomousDealDiscoveryEngine.resetInstance();

    try {
      const db = getDb();
      db.prepare("DELETE FROM public_deals WHERE id LIKE 'deal_test_%'").run();
      db.prepare("DELETE FROM site_audits WHERE domain LIKE 'test-%'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    AutonomousDealDiscoveryEngine.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. Cuelinks Campaign Verification & Deterministic Deal IDs (Defect 1 & 2)', () => {
    it('preserves deterministic deal IDs and requires verified Cuelinks active campaign', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const mockMerchant = {
        name: 'boAt Lifestyle',
        brand: 'boAt',
        domain: 'boat-lifestyle.com',
        sectorCode: 'SECTOR_B_ELECTRONICS' as const,
        category: 'Electronics',
        cuelinksCampaignId: '4232'
      };

      const mockShopifyProduct = {
        id: 7654321,
        title: 'boAt Rockerz 450 Bluetooth Headphone',
        handle: 'rockerz-450',
        body_html: 'Supreme bass on-ear headphones',
        images: [{ src: 'https://cdn.shopify.com/boat_rockerz_450.jpg' }],
        variants: [
          {
            id: 9876543,
            title: 'Luscious Black',
            price: '1499.00',
            compare_at_price: '3990.00',
            available: true
          }
        ]
      };

      // Mock fetch to return Shopify feed
      const originalFetch = global.fetch;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/products.json')) {
          return new Response(JSON.stringify({ products: [mockShopifyProduct] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return originalFetch(url);
      });
      global.fetch = mockFetch;
      engine.setFetchFn(mockFetch as any);

      try {
        const harvested = await engine.harvestMerchantShopifyFeed(mockMerchant);
        expect(harvested.length).toBe(1);

        const deal = harvested[0];
        // Defect 2: Deterministic ID format
        expect(deal.id).toBe('deal_boat_7654321_9876543');

        // Defect 1: Verified Cuelinks link and monetizable state generated via active campaign
        expect(deal.trackingUrl).toContain('linksredirect.com');
        expect(deal.isMonetizable).toBe(true);
        expect(['VERIFIED', 'AFFILIATE_VERIFIED']).toContain(deal.verificationStatus);
        expect(deal.productVerified).toBe(true);
        expect(deal.affiliateVerified).toBe(true);

        // Defect 3: Discount verification marked MERCHANT_LISTED_MRP with % OFF MRP badge
        expect(deal.discountVerificationType).toBe('MERCHANT_LISTED_MRP');
        expect(deal.discountBadge).toMatch(/% OFF MRP/);
        expect(deal.referencePriceINR).toBe(3990);
        expect(deal.currentPriceINR).toBe(1499);

        // Defect 7: No invented 30-day expiry date; schedules next_recheck_at in 6 hours
        expect(deal.expiryDate).toBeUndefined();
        expect(deal.nextRecheckAt).toBeDefined();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('2. 1:1 Catalog-to-Sitemap Parity & Cross-Sector Isolation (Defect 2 & 6)', () => {
    it('getEligiblePublicDeals strictly enforces availability, price, and monetization invariants', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const db = getDb();

      // Insert valid deal
      db.prepare(`
        INSERT OR REPLACE INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, reference_price_inr,
          discount_percent, availability, verification_status, is_monetizable,
          product_verified, affiliate_verified, updated_at
        ) VALUES (
          'deal_test_valid', 'test-valid-deal', 'test-valid-deal', 'Valid Test Deal',
          'TestBrand', 'TestMerchant', 'Electronics', 'SECTOR_B_ELECTRONICS',
          'https://testbrand.com/p1', 'https://linksredirect.com/?url=https%3A%2F%2Ftestbrand.com%2Fp1',
          999, 1999, 50, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, datetime('now')
        )
      `).run();

      // Insert out of stock deal
      db.prepare(`
        INSERT OR REPLACE INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, reference_price_inr,
          discount_percent, availability, verification_status, is_monetizable, updated_at
        ) VALUES (
          'deal_test_oos', 'test-oos-deal', 'test-oos-deal', 'OOS Test Deal',
          'TestBrand', 'TestMerchant', 'Electronics', 'SECTOR_B_ELECTRONICS',
          'https://testbrand.com/p2', 'https://linksredirect.com/?url=https%3A%2F%2Ftestbrand.com%2Fp2',
          999, 1999, 50, 'OUT_OF_STOCK', 'AFFILIATE_VERIFIED', 1, datetime('now')
        )
      `).run();

      // Insert unmonetizable deal (is_monetizable = 0)
      db.prepare(`
        INSERT OR REPLACE INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, reference_price_inr,
          discount_percent, availability, verification_status, is_monetizable, updated_at
        ) VALUES (
          'deal_test_unmonetized', 'test-unmonetized-deal', 'test-unmonetized-deal', 'Unmonetized Test Deal',
          'TestBrand', 'TestMerchant', 'Electronics', 'SECTOR_B_ELECTRONICS',
          'https://testbrand.com/p3', null,
          999, 1999, 50, 'IN_STOCK', 'AFFILIATE_VERIFIED', 0, datetime('now')
        )
      `).run();

      const res = await engine.getEligiblePublicDeals();
      const ids = res.deals.map(d => d.id);
      expect(ids).toContain('deal_test_valid');
      expect(ids).not.toContain('deal_test_oos');
      expect(ids).not.toContain('deal_test_unmonetized');
    });

    it('renders empty comparison guide with noindex and empty itemListElement when sector has zero deals', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const sectorDef = {
        id: 'gold-silver-jewellery',
        code: 'SECTOR_A_PRECIOUS_METALS',
        displayName: 'Gold & Silver Jewellery'
      };

      const html = ssg.renderCompareHtml(sectorDef, [], {
        siteName: 'AI Marketing Organization',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      });

      // Defect 2: Must include noindex and zero cross-sector leakage
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain('"itemListElement": []');
      expect(html).toContain('No verified deals currently in stock for Gold &amp; Silver Jewellery');
      expect(html).not.toContain('boAt');
      expect(html).not.toContain('Airdopes');
    });
  });

  describe('3. SiteFix AI Honest Telemetry & Public Authorization Gate (Defect 5)', () => {
    it('persists null performance_score when PageSpeed is unavailable and renders UNAVAILABLE in SSR', async () => {
      const ssg = StaticSiteGenerator.getInstance();
      const auditData = {
        domain: 'test-unauthorized-clinic.com',
        business_name: 'Test Unauthorized Clinic',
        performance_score: null,
        seo_score: 75,
        core_web_vitals_json: '{}',
        checklist_json: '[]',
        is_publicly_authorized: 0
      };

      const html = ssg.renderAuditHtml(auditData, {
        siteName: 'AI Marketing Organization',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      });

      // Defect 5: Unrun PageSpeed must render UNAVAILABLE (not fake 0/100)
      expect(html).toContain('UNAVAILABLE');
      expect(html).toContain('Quota Unreached / Raw HTML Audit');
      expect(html).not.toContain('0<span style="font-size:16px;">/100</span>');

      // Defect 5: Unauthorized domain must include noindex, nofollow
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('rejects unauthenticated GET /audit/:domain probe with 404 without live external scanning', async () => {
      const res = await app.request('/api/v1/audit/never-audited-random-domain-12345.com');
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toContain('Audit report not found');
    });
  });

  describe('4. Disaggregated Funnel Telemetry (Defect 8)', () => {
    it('returns disaggregated lifetime vs pending draft counters in /api/v1/public/revenue-funnel', async () => {
      const res = await app.request('/api/v1/public/revenue-funnel');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const b2b = body.data.b2bFunnel;
      expect(b2b).toHaveProperty('lifetimeDraftsPrepared');
      expect(b2b).toHaveProperty('pendingUnapprovedDrafts');
      expect(b2b).toHaveProperty('ownerApprovedDrafts');
      expect(b2b).toHaveProperty('messagesDispatched');
      expect(b2b.outreachDraftsPrepared).toBe(b2b.pendingUnapprovedDrafts);

      const saas = body.data.selfServeSaaSFunnel;
      expect(saas).toHaveProperty('htmlScanCompleted');
      expect(saas).toHaveProperty('pageSpeedCompleted');
      expect(saas).toHaveProperty('siteAuditsCompleted');
    });
  });

  describe('5. Google Search Console Verification Meta Tag', () => {
    it('verifies presence of Google Search Console meta tag in StaticSiteGenerator when configured', () => {
      process.env.GOOGLE_SITE_VERIFICATION = 'WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I';
      const ssg = StaticSiteGenerator.getInstance();
      const meta = (ssg as any).getGoogleSiteVerificationMeta();
      expect(meta).toContain('name="google-site-verification"');
      expect(meta).toContain('content="WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I"');
    });

    it('verifies presence of Google Search Console meta tag in index.html templates', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const frontendHtml = fs.readFileSync(path.resolve(process.cwd(), '../frontend/index.html'), 'utf-8');
      expect(frontendHtml).toContain('<meta name="google-site-verification" content="WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I" />');
    });
  });
});
