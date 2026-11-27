import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app, resetSitemapCacheForTesting } from '../../src/index.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { createHighIntentStarterDeals, createVerifiedLiveLaptops } from '../../src/commission/starter-deals.js';
import { StaticSiteGenerator, generateBuyerIntentHubs } from '../../src/commission/static-site-generator.js';
import { InstagramBusinessAdapter } from '../../src/integrations/instagram-business-adapter.js';
import { getDb } from '../../src/db/client.js';

describe('PR #105 — Verified Laptops Under ₹70,000 Catalog', () => {
  beforeEach(() => {
    resetSitemapCacheForTesting();
  });

  it('returns grounded Acer laptop cards for "best laptop under 60000 for coding, 16GB RAM, lightweight" ranked by fit with zero skincare leakage and zero ₹/ml artifacts', async () => {
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    for (const d of createHighIntentStarterDeals()) {
      (engine as any).dealsMap.set(d.id, d);
    }

    const res = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryOrUrl: 'best laptop under 60000 for coding, 16GB RAM, lightweight',
        skipAiSynthesis: true
      })
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    const recs = json.data.recommendations;
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.length).toBeGreaterThanOrEqual(2);

    // Best Match must be a 16GB laptop under 60,000 (not 8GB and not skincare)
    expect(recs[0].title).toMatch(/Acer/i);
    expect(recs[0].title).toMatch(/16GB/i);
    expect(recs[0].currentPriceINR).toBeLessThanOrEqual(60000);

    for (const card of recs) {
      expect(card.title).not.toMatch(/serum|niacinamide|asaya|plum|kama|dot & key/i);
      expect(card.pricePerMlINR).toBeNull();
      expect(card.slotLabel).not.toContain('₹/ml');
      expect(card.matchReasoning).not.toContain('₹/ml');
      expect(card.matchReasoning).not.toContain('Fragrance:');
      expect(card.disclosure).toContain('#Affiliate');
      expect(card.trackingRedirectUrl).toContain(`/api/v1/public/deals/${card.dealId}/redirect`);
    }
    expect(json.data.verdictSummary).not.toContain('₹/ml');
  });

  it('blocks Vijay Sales (4164, socialMediaPublishersAllowed: false) from social adapters while allowing Acer (4360, socialMediaPublishersAllowed: true)', async () => {
    const laptops = createVerifiedLiveLaptops();
    expect(laptops.length).toBe(5);
    for (const l of laptops) {
      expect(l.affiliateCampaignId).toBe('4360');
      expect(l.socialMediaPublishersAllowed).toBe(true);
    }

    const vijaySalesLaptop = {
      ...laptops[0],
      id: 'deal_vijaysales_4164_laptop_test',
      merchant: 'Vijay Sales',
      affiliateCampaignId: '4164',
      productUrl: 'https://www.vijaysales.com/p/256823/dell-15-thin-light-laptop',
      socialMediaPublishersAllowed: false,
      evidenceJson: {
        ...laptops[0].evidenceJson,
        affiliateCampaignId: '4164',
        socialMediaPublishersAllowed: false
      }
    };

    const ssg = StaticSiteGenerator.getInstance();
    const igHtml = ssg.renderInstagramBioStorefrontHtml(
      { siteName: 'AI Marketing Organization', authorName: 'Desk', contactEmail: 'desk@example.com', siteUrl: 'https://ai-marketing-organization.onrender.com' },
      [vijaySalesLaptop as any, laptops[0] as any]
    );
    expect(igHtml).not.toContain('deal_vijaysales_4164_laptop_test');
    expect(igHtml).toContain(laptops[0].title);

    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const spy = vi.spyOn(engine, 'getEligiblePublicDeals').mockResolvedValueOnce({
      deals: [vijaySalesLaptop as any],
      total: 1
    } as any);
    try {
      const dm = await InstagramBusinessAdapter.getInstance().buildCommentOrDmReply('DEAL');
      expect(dm.triggered).toBe(true);
      expect(dm.replyText).not.toContain('deal_vijaysales_4164_laptop_test');
      expect(dm.replyText).not.toContain('/redirect');
    } finally {
      spy.mockRestore();
    }
  });

  it('verifies every laptop has checked date, valid affiliate redirect mapping, /best/laptops-under-60000-india hub, and multi-category homepage prompt', async () => {
    const laptops = createVerifiedLiveLaptops();
    for (const l of laptops) {
      expect(l.lastCheckedAt).toBeTruthy();
      expect(l.lastVerifiedAt).toBeTruthy();
      expect(l.evidenceJson?.priceVerifiedAt).toBeTruthy();
      expect(l.affiliateNetwork).toBe('CUELINKS');
      expect(l.affiliateCampaignId).toBe('4360');
      expect(l.currentPriceINR).toBeGreaterThanOrEqual(35000);
      expect(l.currentPriceINR).toBeLessThanOrEqual(70000);
    }

    const hubs = generateBuyerIntentHubs(laptops, 'https://ai-marketing-organization.onrender.com', 10);
    const laptopHub = hubs.find(h => h.intentSlug === 'laptops-under-60000-india');
    expect(laptopHub).toBeDefined();
    expect(laptopHub!.deals.length).toBeGreaterThanOrEqual(2);

    const ssg = StaticSiteGenerator.getInstance();
    const hubHtml = ssg.renderBuyerGuideHtml(
      laptopHub!,
      hubs,
      [],
      { siteName: 'AI Marketing Organization', authorName: 'Desk', contactEmail: 'desk@example.com', siteUrl: 'https://ai-marketing-organization.onrender.com' }
    );
    expect(hubHtml).toContain('#Ad');
    expect(hubHtml).toContain('rel="sponsored noopener noreferrer"');
    expect(hubHtml).toContain('/api/v1/public/deals/');

    // Seed 1 live laptop in public_deals to verify /sitemap.xml includes /best/laptops-under-60000-india
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const db = getDb();
    for (const l of laptops.slice(0, 2)) {
      (engine as any).dealsMap.set(l.id, l);
      db.prepare(`
        INSERT OR REPLACE INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, reference_price_inr, availability,
          verification_status, is_monetizable, product_verified, affiliate_verified,
          evidence_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, ?, datetime('now'))
      `).run(
        l.id, l.slug, l.canonicalSlug, l.title, l.brand, l.merchant, l.category, l.sectorCode,
        l.productUrl, `https://linksredirect.com/?cid=331585&url=${encodeURIComponent(l.productUrl)}`,
        l.currentPriceINR, l.referencePriceINR, JSON.stringify(l.evidenceJson)
      );
    }
    AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
    resetSitemapCacheForTesting();
    const sitemapXml = await (await app.request('/sitemap.xml')).text();
    expect(sitemapXml).toContain('/best/laptops-under-60000-india');

    const homeHtml = await (await app.request('/')).text();
    expect(homeHtml).toContain('best laptop under 60000');
    expect(homeHtml).toContain('niacinamide serum under 800');
    expect(homeHtml).toContain('max="100000"');

    const dealsHtml = await (await app.request('/deals')).text();
    expect(dealsHtml).toContain('max="100000"');
  });

  it('publishes 5 verified Acer laptops (4360) in production pipeline without fabricating epc7d: 0.31 and excludes non-laptop Electronics from laptop queries', async () => {
    const laptops = createVerifiedLiveLaptops();
    for (const l of laptops) {
      expect(l.epc7d).toBeUndefined();
      expect(l.providerEpc7dINR).toBeNull();
      expect(l.expectedProfitPer100VisitorsINR).toBe(0);
    }

    // Non-laptop Electronics (e.g., earbuds) must never appear in laptop recommendations
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    for (const d of createHighIntentStarterDeals()) {
      (engine as any).dealsMap.set(d.id, d);
    }
    (engine as any).dealsMap.set('deal_earbuds_electronics_test', {
      ...laptops[0],
      id: 'deal_earbuds_electronics_test',
      slug: 'boat-airdopes-electronics-test',
      title: 'boAt Airdopes 141 Wireless Earbuds (Electronics)',
      category: 'Electronics',
      subCategory: 'audio',
      currentPriceINR: 1299
    });

    const laptopRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryOrUrl: 'best laptop under 60000 for coding, 16GB RAM',
        skipAiSynthesis: true
      })
    });
    expect(laptopRes.status).toBe(200);
    const laptopJson = (await laptopRes.json()) as any;
    expect(laptopJson.data.recommendations.some((r: any) => /earbud|airdopes/i.test(r.title))).toBe(false);

    // Production publisher pipeline includes all 6 serums + 5 Acer laptops (11 total)
    const { CuelinksSyncManager } = await import('../../src/commission/cuelinks-sync-manager.js');
    const { CuelinksV3Client } = await import('../../src/commission/cuelinks-v3-client.js');
    const { CommercialOpportunitySelector } = await import('../../src/commission/commercial-opportunity-selector.js');

    const chanSpy = vi.spyOn(CuelinksSyncManager.prototype, 'getApprovedChannel').mockResolvedValue({
      approved: true,
      channel: { id: 331585, name: 'Channel 331585', approval_status: 'approved' }
    } as any);
    const probeSpy = vi.spyOn(CommercialOpportunitySelector.prototype, 'probeMerchantProduct').mockResolvedValue({
      probed: true,
      available: true,
      status: 'IN_STOCK',
      priceINR: 0
    } as any);
    const convSpy = vi.spyOn(CuelinksV3Client.prototype, 'convertLink').mockImplementation(async (params: any) => {
      const u = String(params?.url || '');
      const campId = u.includes('store.acer.com') ? '4360' : (u.includes('worldofasaya') ? '6458' : (u.includes('plumgoodness') ? '4098' : (u.includes('dotandkey') ? '4879' : '4161')));
      return {
        affiliated: true,
        tracking_url: `https://linksredirect.com/?cid=331585&url=${encodeURIComponent(u)}`,
        campaign: { id: campId }
      } as any;
    });
    const persistSpy = vi.spyOn(engine as any, 'persistDealToD1').mockResolvedValue(undefined);
    const offerSpy = vi.spyOn(engine as any, 'provisionMatchingPartnerOffer').mockResolvedValue(undefined);

    try {
      const pubRes = await engine.publishVerifiedSkincareCatalog('org_owner_primary', 'biz_platform_aro');
      expect(pubRes.publishedCount).toBe(11);
      const publishedLaptops = pubRes.deals.filter(d => d.campaignId === '4360');
      expect(publishedLaptops.length).toBe(5);
    } finally {
      chanSpy.mockRestore();
      probeSpy.mockRestore();
      convSpy.mockRestore();
      persistSpy.mockRestore();
      offerSpy.mockRestore();
    }
  });
});
