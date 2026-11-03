import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import {
  COMMERCIAL_SECTOR_TAXONOMY,
  COMMERCIAL_SECTORS_LIST,
  resolveSectorFromCategory,
  SectorCode
} from '@ai-marketing/shared';
import app from '../../src/index.js';

describe('V4.2 Multi-Sector Commerce Engine Recovery Suite', () => {
  beforeEach(async () => {
    resetDbForTesting();
    seedDatabase();
  });

  describe('1. 8-Sector Commercial Taxonomy & Priority A Precious Metals', () => {
    it('defines exactly 8 distinct commercial sectors with Sector A as highest value', () => {
      expect(COMMERCIAL_SECTORS_LIST.length).toBe(8);
      const sectorA = COMMERCIAL_SECTOR_TAXONOMY.SECTOR_A_PRECIOUS_METALS;
      expect(sectorA).toBeDefined();
      expect(sectorA.name).toContain('Gold, Silver, Bullion');
      expect(sectorA.id).toBe('gold-silver-jewellery');
      expect(sectorA.monetizationModels).toContain('AFFILIATE_COMMISSION');
    });

    it('accurately resolves sector from diverse category representations', () => {
      expect(resolveSectorFromCategory('Gold & Diamond Jewellery')?.code).toBe('SECTOR_A_PRECIOUS_METALS');
      expect(resolveSectorFromCategory('Silver Bullion Coins')?.code).toBe('SECTOR_A_PRECIOUS_METALS');
      expect(resolveSectorFromCategory('Audio & Wearables')?.code).toBe('SECTOR_B_ELECTRONICS');
      expect(resolveSectorFromCategory('Kitchen Appliances')?.code).toBe('SECTOR_C_HOME_APPLIANCES');
      expect(resolveSectorFromCategory('Flights & Hotels')?.code).toBe('SECTOR_D_TRAVEL');
      expect(resolveSectorFromCategory('Cloud Accounting SaaS')?.code).toBe('SECTOR_E_SOFTWARE');
      expect(resolveSectorFromCategory('Thermal Label Printers')?.code).toBe('SECTOR_F_OFFICE_INDUSTRIAL');
      expect(resolveSectorFromCategory('Apparel & Fashion Footwear')?.code).toBe('SECTOR_G_LIFESTYLE');
      expect(resolveSectorFromCategory('Dental Practice Care')?.code).toBe('SECTOR_H_LOCAL_SERVICES_B2B');
    });

    it('registers Indian bullion and jewellery sources in DealDiscoveryEngine', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.resetSources();
      const sources = engine.getSources();

      const ibja = sources.find(s => s.id === 'src_ibja_rates');
      expect(ibja).toBeDefined();
      expect(ibja!.domain).toBe('ibjarates.com');

      const tanishq = sources.find(s => s.id === 'src_tanishq_in');
      expect(tanishq).toBeDefined();
      expect(tanishq!.domain).toBe('tanishq.co.in');

      const caratlane = sources.find(s => s.id === 'src_caratlane_in');
      expect(caratlane).toBeDefined();
      expect(caratlane!.domain).toBe('caratlane.com');

      const bluestone = sources.find(s => s.id === 'src_bluestone_in');
      expect(bluestone).toBeDefined();
      expect(bluestone!.domain).toBe('bluestone.com');
    });
  });

  describe('2. Server-Side Deal Redirect & Immutable Click Attribution', () => {
    it('executes HTTP 302 redirect, attaches subids, and records immutable click event', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.clearInjectedDealsForTesting();

      // Seed a verified Cuelinks deal
      const testDealId = 'deal_test_tanishq_gold_pendant';
      engine.injectCandidateDealForTesting({
        id: testDealId,
        title: 'Tanishq 22 Karat Gold Pendant with Certificate',
        brand: 'Tanishq',
        merchant: 'Tanishq India',
        category: 'Gold & Diamond Jewellery',
        currentPriceINR: 18500,
        referencePriceINR: 19500,
        currency: 'INR',
        productUrl: 'https://www.tanishq.co.in/product/pendant-22k',
        trackingUrl: 'https://c.cuelinks.com?id=123&url=https%3A%2F%2Fwww.tanishq.co.in%2Fproduct%2Fpendant-22k',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '123',
        verificationStatus: 'VERIFIED',
        buyerValueScore: 92,
        scannedAt: new Date().toISOString()
      });

      // Mock approved channel & dynamic conversion for Stage 4 compliance
      const { CuelinksSyncManager } = await import('../../src/commission/cuelinks-sync-manager.js');
      const { CuelinksV3Client } = await import('../../src/commission/cuelinks-v3-client.js');
      const syncMgr = CuelinksSyncManager.getInstance();
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        channel: { id: 123, status: 'approved', name: 'ARO Deals' },
        approved: true
      });
      const cuelinksClient = CuelinksV3Client.getInstance();
      vi.spyOn(cuelinksClient, 'convertLink').mockImplementation(async (opts: any) => ({
        url: opts.url,
        tracking_url: `https://linksredirect.com/?id=123&subid=${opts.subid}&subid2=${opts.subid2}&subid4=${opts.subid4}&url=${encodeURIComponent(opts.url)}`,
        affiliated: true
      }));

      // Call redirect route
      const res = await app.request(`/api/v1/public/deals/${testDealId}/redirect`, {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
          'referer': 'https://ai-marketing-organization.onrender.com/deals'
        }
      });

      // Verify HTTP 302 redirect
      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(location).toBeDefined();
      expect(location).toContain('linksredirect.com');
      expect(location).toContain('subid=clk_');
      expect(location).toContain('subid2=SECTOR_A_PRECIOUS_METALS');
      expect(location).toContain(`subid4=${testDealId}`);

      // Verify immutable click record written to referral_click_events in database
      const db = getDb();
      const clickEvent = db.prepare('SELECT * FROM referral_click_events WHERE offer_id = ?').get(testDealId) as any;
      expect(clickEvent).toBeDefined();
      expect(clickEvent.placement).toBe('deal_redirect');
      expect(clickEvent.source).toBe('SECTOR_A_PRECIOUS_METALS');
      expect(clickEvent.destination_url).toContain('linksredirect.com');
    });

    it('returns 404 for nonexistent deal redirect', async () => {
      const res = await app.request('/api/v1/public/deals/deal_fake_does_not_exist/redirect', {
        method: 'GET'
      });
      expect(res.status).toBe(404);
    });
  });

  describe('3. Owner Deals Control Centre & 16-Metric Sector Breakdown', () => {
    it('returns 16 metrics per sector via GET /api/v1/owner/deals/summary', async () => {
      const res = await app.request('/api/v1/owner/deals/summary', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.totalSectors).toBe(8);
      expect(json.data.sectors.length).toBe(8);

      const sectorA = json.data.sectors.find((s: any) => s.sectorCode === 'SECTOR_A_PRECIOUS_METALS');
      expect(sectorA).toBeDefined();
      expect(sectorA.sectorName).toBe('Gold, Silver, Bullion & Jewellery');
      expect(sectorA.activeSourcesCount).toBeGreaterThanOrEqual(4);
      expect(typeof sectorA.discoveredDealsCount).toBe('number');
      expect(typeof sectorA.verifiedDealsCount).toBe('number');
      expect(typeof sectorA.activeDealsCount).toBe('number');
      expect(typeof sectorA.monetizableDealsCount).toBe('number');
      expect(typeof sectorA.directStoreDealsCount).toBe('number');
      expect(typeof sectorA.couponDealsCount).toBe('number');
      expect(typeof sectorA.averageDiscountPercent).toBe('number');
      expect(typeof sectorA.totalClicks).toBe('number');
      expect(typeof sectorA.monetizableClicks).toBe('number');
      expect(typeof sectorA.reportedConversions).toBe('number');
      expect(typeof sectorA.pendingCommissionINR).toBe('number');
      expect(typeof sectorA.validatedCommissionINR).toBe('number');
      expect(sectorA.status).toBeDefined();
    });

    it('renders HTML Sector Control Centre via GET /owner/deals', async () => {
      const res = await app.request('/owner/deals', {
        method: 'GET',
        headers: {
          'accept': 'text/html'
        }
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Sector Control Centre');
      expect(text).toContain('8-Sector Commercial Taxonomy Breakdown');
      expect(text).toContain('SECTOR_A_PRECIOUS_METALS');
      expect(text).toContain('Gold, Silver, Bullion & Jewellery');
      expect(text).toContain('Bank-confirmed cash remains strictly ₹0.00 until bank statement credit verification');
    });
  });

  describe('4. Zero-Fabrication Honest Empty State Invariants', () => {
    it('renders exact honest empty state string and omits ItemList schema when activeDeals is empty', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const html = ssg.renderDealsHtml([], {
        siteName: 'AI Marketing Organization',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      });

      // Must NOT contain fabricated deals
      expect(html).not.toContain('boAt Airdopes 141');
      expect(html).not.toContain('Lenovo IdeaPad');
      expect(html).not.toContain('Noise ColorFit');

      // Must contain exact required empty state string
      expect(html).toContain('No currently verified offers are available in this category. Check back later.');

      // Must NOT render empty ItemList schema
      expect(html).not.toContain('"@type": "ItemList"');
    });

    it('reports INSUFFICIENT_EVIDENCE when organic visitor sample size is below threshold (< 30)', () => {
      const engine = new RealEconomicsEngine();
      const economics = engine.calculate('biz_platform_aro');

      // With 0 visitors, organicConversionRatePercent must be UNKNOWN or INSUFFICIENT_EVIDENCE, never 0.00%
      expect(economics.organicConversionRatePercent).toBe('UNKNOWN');

      // Seed 10 visitors (below 30 threshold)
      const db = getDb();
      for (let i = 1; i <= 10; i++) {
        db.prepare(`
          INSERT INTO customer_journeys (
            id, visitor_id, business_id, organization_id, classification, stage, first_touch_channel, created_at, updated_at
          ) VALUES (?, ?, 'biz_platform_aro', 'org_owner_primary', 'REAL', 'DISCOVERED', 'ORGANIC_SEARCH', datetime('now'), datetime('now'))
        `).run(`j_test_${i}`, `v_test_${i}`);
      }

      const postSeedEconomics = engine.calculate('biz_platform_aro');
      expect(postSeedEconomics.organicConversionRatePercent).toBe('INSUFFICIENT_EVIDENCE');
    });
  });
});
