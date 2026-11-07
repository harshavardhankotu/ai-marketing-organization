import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { app } from '../../src/index.js';

describe('V5.8.1 — Production Hotfix: D1 Schema, Quota Ledger, True Cuelinks & Parity', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    AutonomousDealDiscoveryEngine.resetInstance();
    try {
      const db = getDb();
      db.prepare("DELETE FROM public_deals WHERE id LIKE 'deal_hotfix_%'").run();
      db.prepare("DELETE FROM site_audits WHERE domain LIKE 'test-hotfix-%'").run();
      db.prepare("DELETE FROM provider_quota_ledger WHERE provider LIKE 'test_%'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    AutonomousDealDiscoveryEngine.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. P0 Blocker 1: provider_quota_ledger Table & Atomic Reservation', () => {
    it('creates provider_quota_ledger and executes atomic quota reservation without SQLITE_ERROR', async () => {
      const quotaService = UnifiedQuotaService.getInstance();
      const db = getDb();

      // Verify table exists
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_quota_ledger'").get();
      expect(tableCheck).toBeDefined();

      // Reserve quota for google_suggest and google_pagespeed
      const suggestReservation = await quotaService.reserveProviderQuota('google_suggest', 1);
      expect(suggestReservation.allowed).toBe(true);

      const pageSpeedReservation = await quotaService.reserveProviderQuota('google_pagespeed', 1);
      expect(pageSpeedReservation.allowed).toBe(true);

      // Verify row state in database
      const row = db.prepare("SELECT * FROM provider_quota_ledger WHERE provider = 'google_suggest'").get() as any;
      expect(row).toBeDefined();
      expect(row.reserved_count).toBeGreaterThanOrEqual(1);
      expect(row.circuit_breaker_state).toBe('CLOSED');
    });
  });

  describe('2. P0 Blocker 2: site_audits Nullable performance_score (No NOT NULL crashes)', () => {
    it('persists audit with null performance_score (UNAVAILABLE PageSpeed) without throwing NOT NULL constraint error', async () => {
      const auditService = SiteAuditService.getInstance();
      const domain = 'test-hotfix-null-perf.com';

      // Mock an audit result where PageSpeed is unavailable (null performanceScore)
      const mockAuditResult = {
        auditId: `test_null_${Date.now()}`,
        url: `https://${domain}`,
        businessName: 'Hotfix Test Practice',
        scorecard: { totalScore: 82, items: [] },
        findings: [],
        preview: {
          title: 'Hotfix Test Practice',
          metaDescription: 'Hotfix Test Practice Description',
          canonicalUrl: `https://${domain}`,
          ogTitle: 'Hotfix Test Practice',
          ogImage: 'https://example.com/logo.png'
        },
        pageSpeed: {
          status: 'UNAVAILABLE' as const,
          reason: 'QUOTA_EXCEEDED',
          performanceScore: null,
          seoScore: 78,
          coreWebVitals: {}
        },
        status: 'COMPLETED' as const
      };

      // Call internal or public persistence path
      await auditService.persistAuditToD1(mockAuditResult as any);

      const db = getDb();
      const row = db.prepare('SELECT * FROM site_audits WHERE domain = ?').get(domain) as any;
      expect(row).toBeDefined();
      expect(row.performance_score).toBeNull();
      expect(row.pagespeed_status).toBe('UNAVAILABLE');
      expect(row.pagespeed_unavailable_reason).toBe('QUOTA_EXCEEDED');
      expect(row.html_scan_status).toBe('COMPLETED');
    });

    it('persists audit with populated performance_score when PageSpeed is successful', async () => {
      const auditService = SiteAuditService.getInstance();
      const domain = 'test-hotfix-success-perf.com';

      const mockAuditResult = {
        auditId: `test_success_${Date.now()}`,
        url: `https://${domain}`,
        businessName: 'Hotfix Success Practice',
        scorecard: { totalScore: 90, items: [] },
        findings: [],
        preview: {
          title: 'Hotfix Success Practice',
          metaDescription: 'Hotfix Success Practice Description',
          canonicalUrl: `https://${domain}`,
          ogTitle: 'Hotfix Success Practice',
          ogImage: 'https://example.com/logo.png'
        },
        pageSpeed: {
          status: 'SUCCESS' as const,
          performanceScore: 95,
          seoScore: 92,
          coreWebVitals: { lcp: '1.2s' }
        },
        status: 'COMPLETED' as const
      };

      await auditService.persistAuditToD1(mockAuditResult as any);

      const db = getDb();
      const row = db.prepare('SELECT * FROM site_audits WHERE domain = ?').get(domain) as any;
      expect(row).toBeDefined();
      expect(row.performance_score).toBe(95);
      expect(row.pagespeed_status).toBe('COMPLETED');
    });
  });

  describe('3. P0 Blocker 3: Zero Synthetic subid1=aro_organic Tracking URLs & True Verification', () => {
    it('sets PRODUCT_ONLY_UNMONETIZED and rejects synthetic subid1=aro_organic URL when Cuelinks is not approved/active', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinksClient = engine.getCuelinksClient();

      // Cuelinks client unconfigured or channel unapproved
      vi.spyOn(cuelinksClient, 'isConfigured').mockReturnValue(false);
      vi.spyOn(CuelinksSyncManager.getInstance(cuelinksClient), 'getApprovedChannel').mockResolvedValue({
        channel: null,
        approved: false
      });

      const unverifiedDealInput = {
        id: 'deal_hotfix_unverified_1',
        title: 'Unverified Merchant Earbuds',
        brand: 'UnknownBrand',
        merchant: 'Unknown Merchant',
        category: 'Electronics',
        productUrl: 'https://unknownmerchant.com/earbuds',
        currentPriceINR: 1999,
        referencePriceINR: 3999,
        claimedDiscountPercent: 50,
        availability: 'IN_STOCK' as const,
        sourceUrl: 'https://unknownmerchant.com/earbuds',
        sourceDomain: 'unknownmerchant.com',
        sourceType: 'RETAILER_BRAND' as const
      };

      const result = await engine.ingestAndVerifyDeal(unverifiedDealInput);
      expect(['CREATED_VERIFIED', 'VERIFIED']).toContain(result.action);
      const deal = result.deal!;

      // Must NOT generate synthetic subid1=aro_organic tracking URL
      expect(deal.trackingUrl).toBeUndefined();
      expect(deal.isMonetizable).toBe(false);
      expect(deal.affiliateVerified).toBe(false);
      expect(deal.productVerified).toBe(true);
      expect(deal.verificationStatus).toBe('PRODUCT_ONLY_UNMONETIZED');
    });

    it('sets AFFILIATE_VERIFIED with valid trackingUrl when active campaign and channel are verified', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinksClient = engine.getCuelinksClient();

      vi.spyOn(cuelinksClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(CuelinksSyncManager.getInstance(cuelinksClient), 'getApprovedChannel').mockResolvedValue({
        channel: { id: 331585, name: 'AI Marketing', status: 'approved' } as any,
        approved: true
      });
      vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fboat-lifestyle.com%2Fp1',
        campaign: { id: 4232, name: 'boAt Lifestyle' }
      } as any);

      const verifiedDealInput = {
        id: 'deal_hotfix_verified_1',
        title: 'boAt Airdopes 141 Gen 2',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://boat-lifestyle.com/p1',
        currentPriceINR: 1299,
        referencePriceINR: 4490,
        claimedDiscountPercent: 71,
        availability: 'IN_STOCK' as const,
        sourceUrl: 'https://boat-lifestyle.com/p1',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND' as const,
        affiliateCampaignId: '4232'
      };

      const result = await engine.ingestAndVerifyDeal(verifiedDealInput);
      const deal = result.deal!;

      expect(deal.isMonetizable).toBe(true);
      expect(deal.affiliateVerified).toBe(true);
      expect(deal.productVerified).toBe(true);
      expect(deal.trackingUrl).toContain('linksredirect.com');
      expect(deal.trackingUrl).not.toContain('subid1=aro_organic');
      expect(['VERIFIED', 'AFFILIATE_VERIFIED']).toContain(deal.verificationStatus);
    });
  });

  describe('4. P1 Blocker 4: Unified Catalog Eligibility & Clean noindex Sitemap', () => {
    it('omits comparison guides from /sitemap.xml when sector has 0 verified in-stock deals', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const db = getDb();

      // Delete all deals to verify empty state
      db.prepare("DELETE FROM public_deals").run();
      (engine as any).dealsMap.clear();

      // Insert only 1 deal in SECTOR_B_ELECTRONICS
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, availability,
          verification_status, is_monetizable, product_verified, affiliate_verified, updated_at
        ) VALUES (
          'deal_hotfix_elec', 'hotfix-elec-deal', 'hotfix-elec-deal', 'Elec Deal',
          'boAt', 'boAt Lifestyle', 'Electronics', 'SECTOR_B_ELECTRONICS',
          'https://boat-lifestyle.com/p1', 'https://linksredirect.com/?url=https%3A%2F%2Fboat-lifestyle.com%2Fp1',
          1499, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, datetime('now')
        )
      `).run();

      const res = await app.request('/sitemap.xml');
      expect(res.status).toBe(200);
      const xml = await res.text();

      // Electronics has 1 active deal -> included in sitemap
      expect(xml).toContain('/compare/electronics-technology');

      // Jewellery has 0 deals -> strictly EXCLUDED from sitemap (no noindex URLs in sitemap)
      expect(xml).not.toContain('/compare/gold-silver-jewellery');
      expect(xml).not.toContain('/compare/travel-flights');
    });

    it('enforces exact 1:1 parity between GET /api/v1/public/deals and /sitemap.xml deal URLs', async () => {
      const dealsRes = await app.request('/api/v1/public/deals');
      expect(dealsRes.status).toBe(200);
      const dealsJson = await dealsRes.json();

      const sitemapRes = await app.request('/sitemap.xml');
      expect(sitemapRes.status).toBe(200);
      const xml = await sitemapRes.text();

      const dealMatches = xml.match(/<loc>[^<]+\/deals\/[^<]+<\/loc>/g) || [];
      expect(dealMatches.length).toBe(dealsJson.data.total);
    });
  });

  describe('5. P0 Blocker 0: Zero trycloudflare.com References in Responses', () => {
    it('confirms zero trycloudflare.com URLs exist in sitemap, deals, or autonomy status', async () => {
      const sitemapRes = await app.request('/sitemap.xml');
      const xml = await sitemapRes.text();
      expect(xml).not.toContain('trycloudflare.com');
      expect(xml).not.toContain('autonomous-deals-free');

      const dealsRes = await app.request('/api/v1/public/deals');
      const dealsText = await dealsRes.text();
      expect(dealsText).not.toContain('trycloudflare.com');

      const statusRes = await app.request('/api/v1/public/autonomy-status');
      const statusText = await statusRes.text();
      expect(statusText).not.toContain('trycloudflare.com');
    });
  });
});
