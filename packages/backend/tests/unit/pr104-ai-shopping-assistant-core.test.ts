import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app, resetSitemapCacheForTesting } from '../../src/index.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { createHighIntentStarterDeals } from '../../src/commission/starter-deals.js';
import { GeminiProvider } from '../../src/ai/gemini-provider.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { getDb } from '../../src/db/client.js';

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

  it('uses GEMINI_AI mode when GeminiProvider returns valid grounded output, and falls back honestly to RULE_BASED_FALLBACK with Not listed on merchant page', async () => {
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const starterDeals = createHighIntentStarterDeals();
    for (const d of starterDeals) {
      (engine as any).dealsMap.set(d.id, d);
    }

    const targetDeal = starterDeals[0];
    const origFragrance = (targetDeal as any).fragranceProfile;
    (targetDeal as any).fragranceProfile = undefined;

    const keySpy = vi.spyOn(GeminiProvider, 'getCandidateKeys').mockReturnValue(['test_gemini_key']);
    const spy = vi.spyOn(GeminiProvider.prototype, 'generateStructured').mockResolvedValueOnce({
      data: {
        buyerNote: 'Grounded AI comparison note for niacinamide under Rs 800.',
        cards: [
          {
            dealId: targetDeal.id,
            matchReasoning: 'Fits under Rs 800 niacinamide criteria.',
            tradeOffs: 'Fragrance status not listed on merchant page.',
            unverifiedRequirements: ['Fragrance-free status']
          }
        ]
      },
      model: 'gemini-2.5-flash',
      latencyMs: 42
    } as any);

    try {
      const aiRes = await app.request('/api/v1/public/fair-price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryOrUrl: 'niacinamide serum under 800',
          preferences: { maxBudgetINR: 800, activeIngredient: 'niacinamide', fragranceFree: true }
        })
      });
      expect(aiRes.status).toBe(200);
      const aiJson = (await aiRes.json()) as any;
      expect(aiJson.data.analysisMode).toBe('GEMINI_AI');
      expect(aiJson.data.analysisLabel).toBe('Gemini AI Analysis');
      expect(aiJson.data.aiBuyerNote).toBe('Grounded AI comparison note for niacinamide under Rs 800.');

      spy.mockRejectedValueOnce(new Error('GEMINI_DOWN'));
      const fbRes = await app.request('/api/v1/public/fair-price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryOrUrl: 'niacinamide serum under 800',
          preferences: { maxBudgetINR: 800, activeIngredient: 'niacinamide', fragranceFree: true }
        })
      });
      expect(fbRes.status).toBe(200);
      const fbJson = (await fbRes.json()) as any;
      expect(fbJson.data.analysisMode).toBe('RULE_BASED_FALLBACK');
      expect(fbJson.data.analysisLabel).toBe('Rule-Based Match (Deterministic Fallback)');
      const matched = fbJson.data.recommendations.find((r: any) => r.dealId === targetDeal.id);
      if (matched) {
        expect(matched.fragranceProfile).toBe('Not listed on merchant page');
      }
    } finally {
      (targetDeal as any).fragranceProfile = origFragrance;
      spy.mockRestore();
      keySpy.mockRestore();
    }
  });

  it('rejects client affiliate_redirect (403), fails closed with 503 without incrementing on missing partner offer, and records server-side redirect on 302', async () => {
    const db = getDb();
    db.prepare(`DELETE FROM durable_events WHERE event_type IN ('shopping_page_view', 'preference_submitted', 'recommendation_shown', 'recommendation_click', 'affiliate_redirect')`).run();

    const forbiddenRes = await app.request('/api/v1/public/shopping-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'affiliate_redirect', dealId: 'deal_fake' })
    });
    expect(forbiddenRes.status).toBe(403);
    const forbiddenJson = (await forbiddenRes.json()) as any;
    expect(forbiddenJson.error).toBe('FORBIDDEN_CLIENT_EVENT');

    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const deal = createHighIntentStarterDeals()[0];
    const testDealId = deal.id;
    const prevClKey = process.env.CUELINKS_API_KEY;
    const prevClChannel = process.env.CUELINKS_CHANNEL_ID;
    process.env.CUELINKS_API_KEY = 'test_cuelinks_key';
    process.env.CUELINKS_CHANNEL_ID = '331585';
    const chanSpy = vi.spyOn(CuelinksSyncManager.prototype, 'getApprovedChannel').mockResolvedValue({
      approved: true,
      channel: { id: 331585, name: 'Test Channel', approval_status: 'approved' }
    } as any);
    const clSpy = vi.spyOn(CuelinksV3Client.prototype, 'convertLink').mockResolvedValue({
      affiliated: true,
      tracking_url: `https://linksredirect.com/?cid=${encodeURIComponent(deal.affiliateCampaignId || '4098')}&url=${encodeURIComponent(deal.productUrl)}`,
      campaign: { id: deal.affiliateCampaignId || '4098' }
    } as any);
    (engine as any).dealsMap.set(testDealId, {
      ...deal,
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: deal.affiliateCampaignId || '4098'
    });

    try {
      // Missing partner_offers -> 503 and 0 affiliate_redirect rows
      db.prepare(`DELETE FROM partner_offers WHERE id = ? OR offer_slug = ?`).run(testDealId, testDealId);
      const failRes = await app.request(`/api/v1/public/deals/${testDealId}/redirect`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0' }
      });
      expect(failRes.status).toBe(503);
      const countAfterFail = db.prepare(`
        SELECT COUNT(*) AS cnt FROM durable_events
        WHERE event_type = 'affiliate_redirect'
      `).get() as any;
      expect(Number(countAfterFail?.cnt || 0)).toBe(0);

      // Seed authorized partner + active offer -> 302 and increments affiliate_redirect
      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, authorization_status, approval_status, active_status, updated_at)
        VALUES ('part_cuelinks', 'org_owner_primary', 'Cuelinks', 'E-commerce', 'https://cuelinks.com', 'CUELINKS', 'AUTHORIZED', 'APPROVED', 1, datetime('now'))
      `).run();
      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (id, organization_id, partner_id, offer_slug, title, category, target_customer, destination_url, authorized_tracking_url, active, status, created_at, updated_at)
        VALUES (?, 'org_owner_primary', 'part_cuelinks', ?, 'Test Serum Offer', 'SKINCARE', 'Skincare shoppers', ?, ?, 1, 'ACTIVE', datetime('now'), datetime('now'))
      `).run(testDealId, testDealId, deal.productUrl, `https://linksredirect.com/?cid=${deal.affiliateCampaignId || '4098'}`);

      const okRes = await app.request(`/api/v1/public/deals/${testDealId}/redirect?placement=assistant_card`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0' }
      });
      expect(okRes.status).toBe(302);

      // Allow microtask queue for void import(...).then(...)
      await new Promise(r => setTimeout(r, 50));
      const countAfterOk = db.prepare(`
        SELECT COUNT(*) AS cnt FROM durable_events
        WHERE event_type = 'affiliate_redirect'
      `).get() as any;
      expect(Number(countAfterOk?.cnt || 0)).toBe(1);
    } finally {
      chanSpy.mockRestore();
      clSpy.mockRestore();
      if (prevClKey !== undefined) process.env.CUELINKS_API_KEY = prevClKey;
      else delete process.env.CUELINKS_API_KEY;
      if (prevClChannel !== undefined) process.env.CUELINKS_CHANNEL_ID = prevClChannel;
      else delete process.env.CUELINKS_CHANNEL_ID;
    }
  });

  it('exposes accurate 24h and 7d shoppingFunnel counts on GET /api/v1/owner/today excluding test and bot rows', async () => {
    const db = getDb();
    db.prepare(`DELETE FROM durable_events WHERE event_type IN ('shopping_page_view', 'preference_submitted', 'recommendation_shown', 'recommendation_click', 'affiliate_redirect')`).run();

    const insertEvt = db.prepare(`
      INSERT INTO durable_events (id, event_type, business_id, organization_id, payload_json, processed, processed_at, created_at)
      VALUES (?, ?, 'biz_platform_aro', 'org_owner_primary', ?, 1, datetime('now'), ?)
    `);
    const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const threeDaysAgoIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

    insertEvt.run('sf_human_now', 'preference_submitted', JSON.stringify({ event: 'preference_submitted', trafficClass: 'human' }), nowIso);
    insertEvt.run('sf_human_3d', 'affiliate_redirect', JSON.stringify({ event: 'affiliate_redirect', trafficClass: 'human' }), threeDaysAgoIso);
    insertEvt.run('sf_bot_excluded', 'preference_submitted', JSON.stringify({ event: 'preference_submitted', trafficClass: 'known_bot' }), nowIso);
    insertEvt.run('sf_test_excluded', 'affiliate_redirect', JSON.stringify({ event: 'affiliate_redirect', trafficClass: 'test' }), nowIso);

    const res = await app.request('/api/v1/owner/today', {
      headers: { 'x-user-id': 'usr_owner_primary' }
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.shoppingFunnel).toBeDefined();
    expect(json.data.shoppingFunnel.window24h.preference_submitted).toBe(1);
    expect(json.data.shoppingFunnel.window24h.affiliate_redirect).toBe(0);
    expect(json.data.shoppingFunnel.window7d.preference_submitted).toBe(1);
    expect(json.data.shoppingFunnel.window7d.affiliate_redirect).toBe(1);
    expect(json.data.shoppingFunnel.status).toBe('OK');
  });

  it('handles avoidIngredients fragrance, live recalculated pricePerMlINR, merged Gemini+deterministic warnings, coupon fields, and Amazon rail with & without recommendations', async () => {
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const starterDeals = createHighIntentStarterDeals();
    for (const d of starterDeals) {
      (engine as any).dealsMap.set(d.id, { ...d });
    }

    // Inject stale pricePerMlINR on a deal whose live price changed
    const serum = starterDeals[0];
    const modifiedSerum = {
      ...serum,
      currentPriceINR: 300,
      unitVolumeMl: 30,
      pricePerMlINR: 99.99, // stale! live canonical must be 300/30 = 10.00
      couponCode: 'GLOW10',
      couponConditions: 'Min order ₹250',
      evidenceJson: {
        ...(serum.evidenceJson || {}),
        rawSpecs: {
          ...((serum.evidenceJson?.rawSpecs || {}) as Record<string, string>),
          'Fragrance Profile': '' // unverified fragrance
        }
      }
    };
    (engine as any).dealsMap.set(serum.id, modifiedSerum);

    const keySpy = vi.spyOn(GeminiProvider, 'getCandidateKeys').mockReturnValue(['test_gemini_key']);
    const aiSpy = vi.spyOn(GeminiProvider.prototype, 'generateStructured').mockResolvedValueOnce({
      data: {
        buyerNote: 'Merged warnings check.',
        cards: [
          {
            dealId: modifiedSerum.id,
            matchReasoning: 'Good fit.',
            tradeOffs: 'Check bottle size.',
            unverifiedRequirements: ['Creator patch-test not verified.']
          }
        ]
      },
      model: 'gemini-2.5-flash',
      latencyMs: 12
    } as any);

    const prevAmzTag = process.env.AMAZON_AFFILIATE_TAG;
    process.env.AMAZON_AFFILIATE_TAG = 'testtag-21';

    try {
      const res = await app.request('/api/v1/public/fair-price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryOrUrl: 'niacinamide serum',
          preferences: {
            maxBudgetINR: 800,
            activeIngredient: 'niacinamide',
            avoidIngredients: ['Fragrance']
          }
        })
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      const card = json.data.recommendations.find((r: any) => r.dealId === modifiedSerum.id);
      expect(card).toBeDefined();
      // Live recalculated 300 / 30 = 10 (never stale 99.99)
      expect(card.pricePerMlINR).toBe(10);
      // Coupon fields propagated
      expect(card.couponCode).toBe('GLOW10');
      expect(card.couponConditions).toBe('Min order ₹250');
      // Both deterministic fragrance-free warning AND Gemini warning preserved
      expect(card.unverifiedRequirements.some((w: string) => /fragrance/i.test(w))).toBe(true);
      expect(card.unverifiedRequirements).toContain('Creator patch-test not verified.');
      // Amazon rail present when recommendations exist
      expect(json.data.crossStoreOptions.some((o: any) => o.isAmazonSearchRail && o.trackingRedirectUrl)).toBe(true);

      // Empty recommendations still include Amazon rail when AMAZON_AFFILIATE_TAG is configured
      const emptyRes = await app.request('/api/v1/public/fair-price-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryOrUrl: 'zzznonexistent_skincare_xyz_999',
          skipAiSynthesis: true
        })
      });
      expect(emptyRes.status).toBe(200);
      const emptyJson = (await emptyRes.json()) as any;
      expect(emptyJson.data.recommendations.length).toBe(0);
      expect(emptyJson.data.crossStoreOptions.some((o: any) => o.isAmazonSearchRail && o.trackingRedirectUrl)).toBe(true);

      // Verify / and /deals HTML include coupon + crossStoreOptions rail rendering helpers
      const dealsHtml = await (await app.request('/deals')).text();
      expect(dealsHtml).toContain('crossStoreOptions');
      expect(dealsHtml).toContain('r.couponCode');
    } finally {
      aiSpy.mockRestore();
      keySpy.mockRestore();
      if (prevAmzTag !== undefined) process.env.AMAZON_AFFILIATE_TAG = prevAmzTag;
      else delete process.env.AMAZON_AFFILIATE_TAG;
    }
  });

  it('excludes x-test-mode and x-internal-admin traffic, returns UNAVAILABLE on D1 read error, rate-limits /public/shopping-event, fixes /offer links, and returns generic IG DM when no social-allowed deal exists', async () => {
    const { recordShoppingFunnelEvent, getShoppingFunnelSummaryAsync } = await import('../../src/commission/shopping-funnel-tracker.js');
    const { D1RevenueRepository } = await import('../../src/db/d1-revenue-repository.js');
    const { InstagramBusinessAdapter } = await import('../../src/integrations/instagram-business-adapter.js');

    // 1. x-test-mode and x-internal-admin excluded
    const testModeRes = await recordShoppingFunnelEvent({
      event: 'shopping_page_view',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
      clientIp: '203.0.113.10',
      headers: { 'x-test-mode': '1' }
    });
    expect(testModeRes.recorded).toBe(false);
    expect(testModeRes.reason).toBe('SKIPPED_test');

    const internalAdminRes = await recordShoppingFunnelEvent({
      event: 'shopping_page_view',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
      clientIp: '203.0.113.10',
      headers: { 'x-internal-admin': 'true' }
    });
    expect(internalAdminRes.recorded).toBe(false);
    expect(internalAdminRes.reason).toBe('SKIPPED_internal');

    // 2. D1 read failure returns status UNAVAILABLE (distinct from genuine 0)
    const d1Repo = D1RevenueRepository.getInstance();
    const cfgSpy = vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
    const querySpy = vi.spyOn(d1Repo, 'query').mockRejectedValueOnce(new Error('D1_READ_TIMEOUT'));
    try {
      const errSummary = await getShoppingFunnelSummaryAsync();
      expect(errSummary.status).toBe('UNAVAILABLE');
      expect(errSummary.error).toContain('D1_READ_TIMEOUT');
    } finally {
      cfgSpy.mockRestore();
      querySpy.mockRestore();
    }

    // 3. /public/shopping-event rate limit (30/min per IP -> 31st returns 429)
    const uniqueIp = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
    let hit429 = false;
    for (let i = 0; i < 32; i++) {
      const r = await app.request('/api/v1/public/shopping-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': uniqueIp,
          'x-test-mode': '1'
        },
        body: JSON.stringify({ event: 'shopping_page_view', path: '/' })
      });
      if (r.status === 429) {
        hit429 = true;
        expect(r.headers.get('Retry-After')).toBeTruthy();
        break;
      }
    }
    expect(hit429).toBe(true);

    // 4. Legacy /offer page has zero broken /#pilot-enquiry links
    const offerHtml = await (await app.request('/offer')).text();
    expect(offerHtml).not.toContain('/#pilot-enquiry');
    expect(offerHtml).toContain('href="/contact"');

    // 5. Instagram DM trigger never falls back to unapproved deals[0]
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const dealsSpy = vi.spyOn(engine, 'getEligiblePublicDeals').mockResolvedValueOnce({
      deals: [
        {
          id: 'deal_unapproved_ig',
          title: 'Unapproved Secret Serum',
          currentPriceINR: 599,
          socialMediaPublishersAllowed: 'UNKNOWN'
        } as any
      ],
      total: 1
    } as any);
    try {
      const igAdapter = InstagramBusinessAdapter.getInstance();
      const dmReply = await igAdapter.buildCommentOrDmReply('DEAL');
      expect(dmReply.triggered).toBe(true);
      expect(dmReply.replyText).not.toContain('Unapproved Secret Serum');
      expect(dmReply.replyText).not.toContain('/redirect');
      expect(dmReply.replyText).toContain('/deals');
    } finally {
      dealsSpy.mockRestore();
    }
  });
});
