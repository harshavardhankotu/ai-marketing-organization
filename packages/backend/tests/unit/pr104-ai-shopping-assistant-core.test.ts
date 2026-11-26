import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app, resetSitemapCacheForTesting } from '../../src/index.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { createHighIntentStarterDeals } from '../../src/commission/starter-deals.js';

describe('PR #104 — AI Shopping Assistant Core', () => {
  const prevBrevo = process.env.BREVO_API_KEY;
  const prevBrevoMcp = process.env.BREVO_MCP_SERVER_API;

  beforeEach(() => {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_MCP_SERVER_API;
    resetSitemapCacheForTesting();
  });

  afterEach(() => {
    if (prevBrevo !== undefined) process.env.BREVO_API_KEY = prevBrevo;
    else delete process.env.BREVO_API_KEY;
    if (prevBrevoMcp !== undefined) process.env.BREVO_MCP_SERVER_API = prevBrevoMcp;
    else delete process.env.BREVO_MCP_SERVER_API;
  });

  it('returns grounded preference recommendations for niacinamide serum under 800 with <3 price points and ranks by fit rather than commission', async () => {
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const starterDeals = createHighIntentStarterDeals();
    // Seed in-memory catalog with the 6 skincare serums (each has only 1 dated price point)
    for (const d of starterDeals) {
      (engine as any).dealsMap.set(d.id, d);
    }

    const res = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryOrUrl: 'niacinamide serum under 800, lightweight, avoid fragrance',
        preferences: {
          maxBudgetINR: 800,
          activeIngredient: 'niacinamide',
          fragranceFree: true,
          prioritizeLowestPricePerMl: true
        },
        skipAiSynthesis: true
      })
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const data = json.data;

    // Honest copy when < 3 dated points
    expect(data.verdict).toBe('INSUFFICIENT_HISTORY');
    expect(data.verdictSummary).toMatch(/Price checked on .* building price history/i);
    expect(data.verdictSummary).not.toContain('verified fair-price floor');

    // Alerts paused when Brevo is unconfigured
    expect(data.priceAlertsAvailable).toBe(false);

    // Up to 3 recommendation cards grounded in verified serum rows
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations.length).toBe(3);
    expect(data.recommendations[0].slot).toBe('BEST_MATCH');
    expect(data.recommendations[1].slot).toBe('BEST_VALUE');
    expect(data.recommendations[2].slot).toBe('ALTERNATIVE_CHOICE');

    // Ranked by shopper fit (all 3 are niacinamide serums under ₹800, not ₹2,695 Kama Ayurveda)
    for (const rec of data.recommendations) {
      expect(rec.currentPriceINR).toBeLessThanOrEqual(800);
      expect(rec.disclosure).toContain('#Affiliate');
      expect(rec.matchReasoning.length).toBeGreaterThan(10);
      expect(rec.tradeOffs.length).toBeGreaterThan(5);
    }
    // Plum 10% Niacinamide (15% comm, explicitly Fragrance-free) outranks higher-commission Spot Targeting (24% comm) or ties/wins Best Match
    const ids = data.recommendations.map((r: any) => r.dealId);
    expect(ids).toContain('deal_plum_10_niacinamide_rice_water_50ml');
    expect(ids).toContain('deal_asaya_10_niacinamide_serum_30ml');
    expect(ids).not.toContain('deal_kama_kumkumadi_silky_serum_15ml');
  });

  it('defaults missing socialMediaPublishersAllowed to UNKNOWN (never true) and keeps Dot & Key false', async () => {
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const starterDeals = createHighIntentStarterDeals();
    const dotKey = starterDeals.find(d => d.affiliateCampaignId === '4879');
    expect(dotKey?.socialMediaPublishersAllowed).toBe(false);

    // Insert a deal row in public_deals with missing socialMediaPublishersAllowed metadata
    const { getDb } = await import('../../src/db/client.js');
    const db = getDb();
    const unknownDealId = 'deal_unknown_social_perm_test';
    db.prepare(`
      INSERT OR REPLACE INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category,
        product_url, current_price_inr, reference_price_inr,
        availability, verification_status,
        is_monetizable, product_verified, affiliate_verified, last_verified_at,
        evidence_json, sector_code, updated_at
      ) VALUES (
        ?, 'unknown-social-perm-test', 'unknown-social-perm-test',
        'Test Serum Unknown Social Perm', 'TestBrand', 'TestMerchant', 'Health & Beauty',
        'https://example.com/test-serum', 499, 599,
        'IN_STOCK', 'AFFILIATE_VERIFIED',
        1, 1, 1, datetime('now'),
        ?, 'SECTOR_G_LIFESTYLE', datetime('now')
      )
    `).run(unknownDealId, JSON.stringify({ affiliateCampaignId: '999999', affiliateNetwork: 'CUELINKS' }));

    await engine.evolveAndRotateCatalog({
      organizationId: 'org_owner_primary',
      businessId: 'biz_platform_aro'
    });

    const updated = (engine as any).dealsMap.get(unknownDealId);
    expect(updated).toBeDefined();
    expect(updated.socialMediaPublishersAllowed).toBe('UNKNOWN');
    expect(updated.socialMediaPublishersAllowed).not.toBe(true);
  });

  it('serves unified AI Buying Assistant on / and /deals with zero B2B/SiteFix/admissions links, upfront #Affiliate disclosure, and noindex on legacy pages', async () => {
    const homeRes = await app.request('/');
    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain('AI Buying Assistant');
    expect(homeHtml).toContain('#Affiliate');
    expect(homeHtml).not.toContain('/tools/site-audit');
    expect(homeHtml).not.toContain('/demo');
    expect(homeHtml).not.toContain('/offer');
    expect(homeHtml).not.toContain('/revenue');
    expect(homeHtml).not.toContain('Website Enquiry Path Repair');
    expect(homeHtml).not.toContain('admissions');

    const dealsRes = await app.request('/deals');
    expect(dealsRes.status).toBe(200);
    const dealsHtml = await dealsRes.text();
    expect(dealsHtml).toContain('#Affiliate');
    expect(dealsHtml).not.toContain('/tools/site-audit');
    expect(dealsHtml).not.toContain('/revenue');

    const sitemapRes = await app.request('/sitemap.xml');
    expect(sitemapRes.status).toBe(200);
    const sitemapXml = await sitemapRes.text();
    expect(sitemapXml).toContain('/deals');
    expect(sitemapXml).not.toContain('/tools/site-audit');
    expect(sitemapXml).not.toContain('/demo');
    expect(sitemapXml).not.toContain('/offer');
    expect(sitemapXml).not.toContain('/revenue');

    const siteAuditRes = await app.request('/tools/site-audit');
    expect(siteAuditRes.status).toBe(200);
    const siteAuditHtml = await siteAuditRes.text();
    expect(siteAuditHtml).toContain('noindex');

    const revRes = await app.request('/revenue');
    expect(revRes.status).toBe(200);
    const revHtml = await revRes.text();
    expect(revHtml).toContain('noindex');
  });
});
