import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/index.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { getSiteAuditFixpackPriceINR, getDirectUpiConfig } from '../../src/config/env.js';
import { SalesConversationEngine } from '../../src/revenue/sales-conversation-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import {
  AutonomousDealDiscoveryEngine,
  buildAmazonAffiliateUrl,
  isAuthorizedAmazonTrackingUrl
} from '../../src/commission/autonomous-deal-discovery-engine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import {
  ExperimentEngine,
  STOREFRONT_DEAL_CTA_EXP_ID,
  STOREFRONT_SITEFIX_CTA_EXP_ID
} from '../../src/experiments/experiment-engine.js';
import { MultiAssetOpportunityRadar } from '../../src/intelligence/multi-asset-opportunity-radar.js';
import { renderSiteAuditPage } from '../../src/tools/site-audit/site-audit-page.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';

describe('Stage J: Live Cuelinks /offers.json, 72h Evolutionary Rotation, Storefront A/B CTAs & Multi-Asset Radar', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';
    resetDbForTesting();
    seedDatabase();
    AutonomousDealDiscoveryEngine.resetInstance();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('Task 1: env.ts SiteFix & Direct UPI fallbacks + READY_TO_BUY creates ₹499 OWNED_CHECKOUT_CREATED', async () => {
    // 1. Negative test overrides still fail-closed under Vitest
    expect(getSiteAuditFixpackPriceINR({ SITE_AUDIT_FIXPACK_PRICE_INR: '' })).toBeNull();
    expect(getSiteAuditFixpackPriceINR({ SITE_AUDIT_FIXPACK_PRICE_INR: 'UNSET' })).toBeNull();
    expect(getDirectUpiConfig({})).toEqual({
      configured: false,
      vpa: null,
      payeeName: null
    });

    // 2. Default process.env fallback returns ₹499 + SiteFix AI UPI rail
    delete process.env.SITE_AUDIT_FIXPACK_PRICE_INR;
    delete process.env.DIRECT_UPI_VPA;
    delete process.env.DIRECT_UPI_PAYEE_NAME;
    expect(getSiteAuditFixpackPriceINR()).toBe(499);
    const upi = getDirectUpiConfig();
    expect(upi.configured).toBe(true);
    expect(upi.vpa).toBe('venkatasaiharsh149768.rzp@rxairtel');
    expect(upi.payeeName).toBe('SiteFix AI');

    // 3. SalesConversationEngine READY_TO_BUY on sitefix_core_499 -> OWNED_CHECKOUT_CREATED (₹499)
    const engine = SalesConversationEngine.getInstance();
    const res = await engine.handleInboundMessage({
      organizationId: 'org_owner_primary',
      businessId: 'biz_platform_aro',
      channel: 'WEB_DESK',
      messageText: 'I want to buy SiteFix Core Fix-Pack right now, send checkout link please',
      productSlugOrContext: 'sitefix_core_499',
      sessionId: 'sess_stagej_sitefix_01',
      senderContact: 'founder@clinic.in',
      senderName: 'Dr. Kavita'
    });

    expect(res.intent).toBe('READY_TO_BUY');
    expect(res.conversationState).toBe('CHECKOUT_CREATED');
    expect(res.checkout?.checkoutMode).toBe('OWNED_CHECKOUT_CREATED');
    expect(res.checkout?.amountINR).toBe(499);
    expect(res.checkout?.upiDeepLink).toContain('venkatasaiharsh149768.rzp%40rxairtel');
  });

  it('Task 2: Cuelinks /pub_api/v3/offers.json multi-category ingestion, CPC vs CPS parity, partner_offers & redirect resolution', async () => {
    const db = getDb();

    // Seed authorized Cuelinks partner
    db.prepare(`
      INSERT OR REPLACE INTO partners (
        id, organization_id, name, industry, website, network, authorization_status, approval_status
      ) VALUES ('part_cuelinks', 'org_owner_primary', 'Cuelinks Partner Network', 'Affiliate Marketing', 'https://www.cuelinks.com', 'CUELINKS', 'AUTHORIZED', 'APPROVED')
    `).run();

    // Seed multi-category campaigns in cuelinks_campaigns (Electronics CPS, Travel CPS, Grooming CPS, Finance CPC)
    const insertCamp = db.prepare(`
      INSERT OR REPLACE INTO cuelinks_campaigns (
        campaign_id, name, merchant_domain, category, payout_model, payout_rate, cookie_days, status
      ) VALUES (?, ?, ?, ?, ?, ?, 30, 'ACTIVE')
    `);
    insertCamp.run('501', 'boAt Lifestyle', 'boat-lifestyle.com', 'Electronics', 'CPS', '6.5% per order');
    insertCamp.run('502', 'MakeMyTrip', 'makemytrip.com', 'Travel', 'CPS', '2.5% per booking');
    insertCamp.run('503', 'Bombay Shaving Co', 'bombayshavingcompany.com', 'Grooming', 'CPS', '10% per order');
    insertCamp.run('504', 'Upstox Finance', 'upstox.com', 'Finance', 'CPC', '₹12 per click');

    const mockFetch = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/channels')) {
        return new Response(JSON.stringify({
          data: [{ id: 331585, name: 'AI Marketing Org Main', source_url: 'https://ai-marketing-organization.onrender.com', status: 'active' }]
        }), { status: 200 });
      }
      if (url.includes('/offers.json')) {
        expect(url).toContain('channel_id=331585');
        return new Response(JSON.stringify({
          offers: [
            {
              id: 9001,
              title: 'boAt Rockerz 450 Pro Wireless Deal ₹1499 (MRP ₹3990)',
              description: 'Flat 62% off on boAt wireless headphones',
              discount_price: 1499,
              original_price: 3990,
              url: 'https://www.boat-lifestyle.com/products/rockerz-450-pro',
              merchant_name: 'boAt Lifestyle',
              categories: ['Electronics & Audio'],
              campaign_id: 501,
              status: 'active',
              end_date: '2028-12-31T23:59:59Z'
            },
            {
              id: 9002,
              title: 'MakeMyTrip Student Domestic Flight Flat ₹800 Off Code MMTFLY',
              coupon_code: 'MMTFLY',
              description: 'Use promo code MMTFLY for instant ₹800 discount on flights at ₹4299 (MRP ₹5099)',
              discount_price: 4299,
              original_price: 5099,
              url: 'https://www.makemytrip.com/flights/',
              merchant_name: 'MakeMyTrip',
              categories: ['Travel'],
              campaign_id: 502,
              status: 'active',
              end_date: '2028-12-31T23:59:59Z'
            },
            {
              id: 9003,
              title: 'Bombay Shaving Company Precision Beard Trimmer at ₹999 (MRP ₹1995)',
              description: 'Precision grooming trimmer with stainless blades at 50% off',
              discount_price: 999,
              original_price: 1995,
              url: 'https://bombayshavingcompany.com/products/precision-trimmer',
              merchant_name: 'Bombay Shaving Company',
              categories: ['Grooming & Personal Care'],
              campaign_id: 503,
              status: 'active',
              end_date: '2028-12-31T23:59:59Z'
            },
            {
              id: 9004,
              title: 'Upstox Zero Brokerage Demat Account Offer',
              description: 'Open zero AMC brokerage demat & trading account online in minutes',
              terms: 'Valid for new KYC verified resident Indian accounts',
              url: 'https://upstox.com/open-demat-account/',
              merchant_name: 'Upstox Finance',
              categories: ['Finance'],
              campaign_id: 504,
              status: 'active',
              end_date: '2028-12-31T23:59:59Z'
            },
            {
              id: 9005,
              title: 'Expired Past Offer Should Be Filtered',
              description: 'Expired offer',
              discount_price: 499,
              url: 'https://www.boat-lifestyle.com/products/old',
              merchant_name: 'boAt Lifestyle',
              categories: ['Electronics'],
              campaign_id: 501,
              status: 'expired',
              end_date: '2020-01-01T00:00:00Z'
            }
          ],
          meta: { total: 5, page: 1, total_pages: 1 }
        }), { status: 200 });
      }
      if (url.includes('/campaigns')) {
        return new Response(JSON.stringify({ campaigns: [] }), { status: 200 });
      }
      if (url.includes('/links')) {
        const u = new URL(url);
        let parsedBody: any = {};
        try {
          if (typeof init?.body === 'string') parsedBody = JSON.parse(init.body);
        } catch {}
        const destUrl = String(parsedBody?.url || u.searchParams.get('url') || 'https://www.boat-lifestyle.com/products/rockerz-450-pro');
        const campId = destUrl.includes('makemytrip') ? 502 : destUrl.includes('bombayshaving') ? 503 : destUrl.includes('upstox') ? 504 : 501;
        return new Response(JSON.stringify({
          affiliated: true,
          tracking_url: `https://linksredirect.com/?pub_id=331585CL&url=${encodeURIComponent(destUrl)}`,
          campaign: { id: campId, name: 'Mock Campaign' }
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new CuelinksV3Client({ apiKey: 'test_cuelinks_stagej_key', fetchFn: mockFetch });
    const liveRes = await client.getLiveOffers({ channel_id: '331585' });
    expect(liveRes.channelId).toBe('331585');
    expect(liveRes.offers.length).toBe(4); // Expired 9005 excluded

    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const ingRes = await dealEngine.ingestLiveCuelinksOffers({
      maxPages: 1,
      perPage: 50,
      client
    });
    expect(ingRes.ingested).toBe(4);
    expect(ingRes.categories.length).toBeGreaterThanOrEqual(3);

    // Check priceHistory persistence & CPC vs CPS payout separation
    const electronicsDeal = ingRes.deals.find(d => d.affiliateCampaignId === '501');
    const cpcFinanceDeal = ingRes.deals.find(d => d.affiliateCampaignId === '504');
    expect(electronicsDeal).toBeDefined();
    expect(electronicsDeal?.evidenceJson?.priceHistory?.length).toBeGreaterThanOrEqual(1);
    expect(electronicsDeal?.evidenceJson?.monetizationModel).toBe('CPS');
    expect(cpcFinanceDeal).toBeDefined();
    expect(cpcFinanceDeal?.evidenceJson?.monetizationModel).toBe('CPC');
    expect(cpcFinanceDeal?.evidenceJson?.grossCommissionPerApprovedOrderINR).toBeNull();

    // Check partner_offers provisioning and /api/v1/public/deals/:id/redirect resolution (including Grooming 503)
    const groomingDeal = ingRes.deals.find(d => d.affiliateCampaignId === '503')!;
    const po = db.prepare(`SELECT id, active, status FROM partner_offers WHERE id = ?`).get(groomingDeal.id) as any;
    expect(po?.active).toBe(1);
    expect(po?.status).toBe('ACTIVE');

    // Temporarily wire global Cuelinks client env for /api/v1/public/deals/:id/redirect route test
    const redirectClientSpy = vi.spyOn(CuelinksV3Client, 'getInstance').mockReturnValue(client);
    const redirectRes = await app.request(`/api/v1/public/deals/${encodeURIComponent(groomingDeal.id)}/redirect?ab_exp=${STOREFRONT_DEAL_CTA_EXP_ID}&ab_variant=treatment`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    if (redirectRes.status !== 302) {
      throw new Error(`Expected 302 redirect, got ${redirectRes.status}: ${await redirectRes.text()}`);
    }
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get('location')).toContain('linksredirect.com');
    redirectClientSpy.mockRestore();
  });

  it('Task 3: 72-Hour Evolutionary Catalog Rotation boosts high-intent clicked deals & rotates stale >72h unclicked deals out', async () => {
    const db = getDb();
    const staleCreatedAt = new Date(Date.now() - 125 * 60 * 60 * 1000).toISOString(); // ~5.2 days ago (> 72h)
    const freshCreatedAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, sector_code,
        product_url, affiliate_url, current_price_inr, reference_price_inr, discount_percent,
        availability, verification_status, is_monetizable, product_verified, affiliate_verified,
        evidence_json, last_verified_at, created_at, updated_at
      ) VALUES
      (
        'deal_winner_stagej', 'boat-winner-stagej', 'boat-winner-stagej',
        'boAt Airdopes Winner Deal', 'boAt', 'boAt Lifestyle', 'Electronics', 'SECTOR_B_ELECTRONICS',
        'https://www.boat-lifestyle.com/products/winner', 'https://clnk.in/win', 1299, 2990, 56,
        'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, ?, datetime('now'), ?, datetime('now')
      ),
      (
        'deal_stale_stagej', 'stale-unclicked-stagej', 'stale-unclicked-stagej',
        'Old Unclicked Gadget Deal', 'Generic', 'Store', 'Electronics', 'SECTOR_B_ELECTRONICS',
        'https://example.com/stale', 'https://clnk.in/stale', 1499, 1799, 16,
        'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, ?, datetime('now'), ?, datetime('now')
      ),
      (
        'deal_unexposed_stagej', 'fresh-unexposed-stagej', 'fresh-unexposed-stagej',
        'Unexposed New Arrival Gadget', 'Generic', 'Store', 'Electronics', 'SECTOR_B_ELECTRONICS',
        'https://example.com/unexposed', 'https://clnk.in/unexposed', 1599, 2199, 27,
        'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, ?, datetime('now'), ?, datetime('now')
      )
    `).run(
      JSON.stringify({
        sources: ['https://www.boat-lifestyle.com/products/winner'],
        verificationLogs: [],
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '501',
        hasVerifiedPriceDrop: true,
        verifiedCommissionRatePercent: 7.5,
        observedImpressions: 60,
        observedClicks: 8,
        observedInquiries: 2
      }),
      freshCreatedAt,
      JSON.stringify({
        sources: ['https://example.com/stale'],
        verificationLogs: [],
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '501',
        hasVerifiedPriceDrop: false,
        observedImpressions: 80,
        observedClicks: 0,
        observedInquiries: 0
      }),
      staleCreatedAt,
      JSON.stringify({
        sources: ['https://example.com/unexposed'],
        verificationLogs: [],
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '501',
        hasVerifiedPriceDrop: true,
        observedImpressions: 5,
        observedClicks: 0,
        observedInquiries: 0
      }),
      staleCreatedAt
    );

    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const evoRes = await dealEngine.evolveAndRotateCatalog({ featuredLimit: 4 });
    expect(evoRes.evaluated).toBe(3);
    expect(evoRes.rotatedOut).toBe(1);
    expect(evoRes.featuredIds).toContain('deal_winner_stagej');
    expect(evoRes.featuredIds).toContain('deal_unexposed_stagej');
    expect(evoRes.featuredIds).not.toContain('deal_stale_stagej');

    const winnerRow = db.prepare(`SELECT evidence_json FROM public_deals WHERE id = 'deal_winner_stagej'`).get() as any;
    const staleRow = db.prepare(`SELECT evidence_json FROM public_deals WHERE id = 'deal_stale_stagej'`).get() as any;
    const unexposedRow = db.prepare(`SELECT evidence_json FROM public_deals WHERE id = 'deal_unexposed_stagej'`).get() as any;
    const winnerEv = JSON.parse(winnerRow.evidence_json);
    const staleEv = JSON.parse(staleRow.evidence_json);
    const unexposedEv = JSON.parse(unexposedRow.evidence_json);

    expect(winnerEv.catalogSlot).toBe('FEATURED');
    expect(winnerEv.staleDecayPenalty).toBe(0);
    expect(staleEv.catalogSlot).toBe('ROTATED_OUT_STALE');
    expect(staleEv.staleDecayPenalty).toBeGreaterThanOrEqual(25);
    expect(unexposedEv.staleDecayPenalty).toBe(0);
    expect(unexposedEv.exposureTier).toBe('FRESH_UNEXPOSED');
    expect(winnerEv.evolutionStatus).toBe('RISING_WINNER');
    expect(staleEv.evolutionStatus).toBe('STALE_ROTATED_OUT');

    // / and /deals showcase non-stale featured deal and exclude ROTATED_OUT_STALE from featured slots
    const homeRes = await app.request('/');
    expect(homeRes.status).toBe(200);
    const homeHtml = await homeRes.text();
    expect(homeHtml).toContain('boAt Airdopes Winner Deal');
    expect(homeHtml).not.toContain('Old Unclicked Gadget Deal');

    const dealsRes = await app.request('/deals');
    expect(dealsRes.status).toBe(200);
    const dealsHtml = await dealsRes.text();
    expect(dealsHtml).toContain('boAt Airdopes Winner Deal');
    expect(dealsHtml).not.toContain('Old Unclicked Gadget Deal');
  });

  it('Task 4: Storefront A/B Experiments seed isTest=false, evaluate telemetry without campaign_id, auto-promote SCALE winner CTA, and expand MFAPI radar to 4 schemes', async () => {
    const db = getDb();
    const seeded = db.prepare(`SELECT id, campaign_id, metrics_json FROM experiments WHERE id IN (?, ?)`).all(
      STOREFRONT_DEAL_CTA_EXP_ID,
      STOREFRONT_SITEFIX_CTA_EXP_ID
    ) as any[];
    expect(seeded.length).toBe(2);
    for (const row of seeded) {
      expect(row.campaign_id).toBeNull();
      expect(JSON.parse(row.metrics_json).isTest).toBe(false);
    }

    // Record storefront telemetry for Deal Card CTA (campaign_id IS NULL) where treatment strongly wins (>= 50/arm)
    for (let i = 0; i < 55; i++) {
      ExperimentEngine.recordStorefrontEvent({
        experimentId: STOREFRONT_DEAL_CTA_EXP_ID,
        variant: 'baseline',
        eventType: 'impression'
      });
      if (i < 2) {
        ExperimentEngine.recordStorefrontEvent({
          experimentId: STOREFRONT_DEAL_CTA_EXP_ID,
          variant: 'baseline',
          eventType: 'click'
        });
      }
      ExperimentEngine.recordStorefrontEvent({
        experimentId: STOREFRONT_DEAL_CTA_EXP_ID,
        variant: 'treatment',
        eventType: 'impression'
      });
      if (i < 22) {
        ExperimentEngine.recordStorefrontEvent({
          experimentId: STOREFRONT_DEAL_CTA_EXP_ID,
          variant: 'treatment',
          eventType: 'click'
        });
      }
    }

    const evalResults = ExperimentEngine.evaluateStorefrontExperiments();
    const dealExpResult = evalResults.find(r => r.experimentId === STOREFRONT_DEAL_CTA_EXP_ID);
    expect(dealExpResult?.outcome).toBe('SCALE');
    expect(dealExpResult?.promotedCta).toBe('Claim Verified Deal Price →');

    // Assignment now locks 100% traffic onto the promoted winning CTA regardless of visitor key
    const assignedA = ExperimentEngine.assignStorefrontVariant(STOREFRONT_DEAL_CTA_EXP_ID, 'visitor_alpha_1');
    const assignedB = ExperimentEngine.assignStorefrontVariant(STOREFRONT_DEAL_CTA_EXP_ID, 'visitor_beta_2');
    expect(assignedA.promoted).toBe(true);
    expect(assignedA.ctaText).toBe('Claim Verified Deal Price →');
    expect(assignedB.ctaText).toBe('Claim Verified Deal Price →');

    // /deals renders promoted CTA on deal cards
    db.prepare(`
      INSERT INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, sector_code,
        product_url, affiliate_url, current_price_inr, availability, verification_status,
        is_monetizable, product_verified, affiliate_verified
      ) VALUES (
        'deal_ab_check', 'ab-check-deal', 'ab-check-deal', 'A/B CTA Verified Earbuds', 'boAt', 'boAt',
        'Electronics', 'SECTOR_B_ELECTRONICS', 'https://www.boat-lifestyle.com/products/ab', 'https://clnk.in/ab',
        1499, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1
      )
    `).run();
    const dealsPage = await app.request('/deals');
    expect(await dealsPage.text()).toContain('Claim Verified Deal Price →');

    // SiteFix page accepts A/B variant CTA cleanly
    const sitefixHtml = renderSiteAuditPage({
      experimentId: STOREFRONT_SITEFIX_CTA_EXP_ID,
      variant: 'treatment',
      ctaText: 'Download Complete SEO & Schema Patch — ₹499'
    });
    expect(sitefixHtml).toContain('Download Complete SEO &amp; Schema Patch — ₹499');

    // MultiAssetOpportunityRadar expands live AMFI MFAPI coverage to 6 schemes (8 total tracked benchmarks)
    MultiAssetOpportunityRadar.resetInstance();
    const radar = MultiAssetOpportunityRadar.getInstance();
    const seenUrls: string[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      seenUrls.push(url);
      return new Response(JSON.stringify({
        meta: { scheme_name: `Mock Scheme ${url.split('/').pop()}` },
        data: [
          { date: '12-11-2026', nav: '110.5000' },
          { date: '11-11-2026', nav: '108.2500' }
        ]
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const summary = await radar.getRadarSummary({ skipLiveNetwork: false, fetchFn: mockFetch });
    const liveSnaps = summary.researchSnapshots.filter(s => s.dataFreshness === 'LIVE_DATED_PROVIDER_SERIES');
    expect(liveSnaps.length).toBe(6);
    expect(summary.trackedBenchmarksCount).toBe(8);
    expect(seenUrls.some(u => u.includes('/120716'))).toBe(true);
    expect(seenUrls.some(u => u.includes('/120684'))).toBe(true);
    expect(seenUrls.some(u => u.includes('/120685'))).toBe(true);
    expect(seenUrls.some(u => u.includes('/149780'))).toBe(true);
    expect(seenUrls.some(u => u.includes('/119833'))).toBe(true);
    expect(seenUrls.some(u => u.includes('/131061'))).toBe(true);

    // Structured navFunds payload exposes explicit benchmark labels and numeric NAVs for Dashboard UI
    expect(summary.navFunds?.length).toBe(6);
    expect(summary.navFunds?.map(f => f.benchmarkLabel)).toEqual([
      'Nifty 50',
      'Nifty Next 50',
      'Gold ETF',
      'Silver ETF',
      'SBI 10Y Gilt',
      '10Y Gilt'
    ]);
    expect(summary.navFunds?.[0]?.latestNav).toBe(110.5);
    expect(summary.rankedAssets?.length).toBe(8);

    // GET /api/v1/tools/financial-radar returns hydrated multi-asset radar summary JSON (served from 6h cache)
    const radarApiRes = await app.request('/api/v1/tools/financial-radar');
    expect(radarApiRes.status).toBe(200);
    const radarApiJson = (await radarApiRes.json()) as any;
    expect(radarApiJson.success).toBe(true);
    expect(radarApiJson.data?.navFunds?.length).toBe(6);
    expect(radarApiJson.data?.navFunds?.map((f: any) => f.schemeCode)).toEqual([
      '120716',
      '120684',
      '120685',
      '149780',
      '119833',
      '131061'
    ]);
  });

  it('Task 5: Amazon.in AMAZON_AFFILIATE_TAG monetization, redirect tracking & First-Sale Execution endpoints', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'harshavardhan-21';
    process.env.OWNER_API_KEY = 'stagej_owner_secret_key_999';
    process.env.BREVO_API_KEY = 'xkeysib_test_stagej_brevo_key';
    process.env.BREVO_SENDER_EMAIL = 'harsha@sitefix.in';
    process.env.PUBLIC_CONTACT_EMAIL = 'harsha@sitefix.in';

    // 1. Helper buildAmazonAffiliateUrl & isAuthorizedAmazonTrackingUrl
    const tagged = buildAmazonAffiliateUrl('https://amazon.in/dp/B09G9BL5CP', 'harshavardhan-21', 'clk_test01');
    expect(tagged).toBe('https://www.amazon.in/dp/B09G9BL5CP?tag=harshavardhan-21&linkCode=ll1&subid=clk_test01');
    expect(isAuthorizedAmazonTrackingUrl(tagged!, 'harshavardhan-21')).toBe(true);
    expect(buildAmazonAffiliateUrl('https://flipkart.com/item/p/123', 'harshavardhan-21')).toBeNull();
    expect(buildAmazonAffiliateUrl('https://amazon.in/dp/B09G9BL5CP', 'placeholder')).toBeNull();

    // 2. Ingest verified Amazon.in deal -> provisions part_amazon_in + partner_offers + 302 redirect
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const ingestRes = await dealEngine.ingestAndVerifyDeal({
      title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
      brand: 'Sony',
      merchant: 'Amazon India',
      category: 'Electronics',
      productUrl: 'https://www.amazon.in/dp/B09XS7JWHH',
      sourceUrl: 'https://www.amazon.in/dp/B09XS7JWHH',
      sourceDomain: 'amazon.in',
      sourceClass: 'DIRECT_MERCHANT_FEED',
      currentPriceINR: 24990,
      referencePriceINR: 34990,
      availability: 'IN_STOCK',
      modelOrSku: 'B09XS7JWHH'
    });

    expect(['CREATED_VERIFIED', 'UPDATED_VERIFIED']).toContain(ingestRes.action);
    expect(ingestRes.deal?.affiliateNetwork).toBe('AMAZON_IN');
    expect(ingestRes.deal?.isMonetizable).toBe(true);
    expect(ingestRes.deal?.affiliateVerified).toBe(true);
    expect(ingestRes.deal?.trackingUrl).toContain('tag=harshavardhan-21');

    const db = getDb();
    const amazonPartner = db.prepare(`SELECT id, network, approval_status FROM partners WHERE id = 'part_amazon_in'`).get() as any;
    expect(amazonPartner?.network).toBe('AMAZON_IN');
    expect(amazonPartner?.approval_status).toBe('APPROVED');

    const redirectRes = await app.request(`/api/v1/public/deals/${encodeURIComponent(ingestRes.deal!.id)}/redirect?utm_source=owner_share`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    expect(redirectRes.status).toBe(302);
    const location = redirectRes.headers.get('location') || '';
    expect(location).toContain('https://www.amazon.in/dp/B09XS7JWHH');
    expect(location).toContain('tag=harshavardhan-21');
    expect(location).toContain('linkCode=ll1');
    expect(location).toContain('subid=clk_');

    // 3. Seed completed SiteAudit & pending Outreach Draft for First-Sale Execution Console
    db.prepare(`
      INSERT OR REPLACE INTO site_audits (
        domain, target_url, business_name, performance_score, seo_score, checklist_json, status, updated_at
      ) VALUES (
        'exampleclinic.in', 'https://exampleclinic.in', 'Example Clinic', 52, 61,
        ?, 'COMPLETED', datetime('now')
      )
    `).run(JSON.stringify({
      items: [
        { code: 'MISSING_SCHEMA', status: 'FAIL', title: 'Missing LocalBusiness Schema' },
        { code: 'SLOW_LCP', status: 'CRITICAL', title: 'LCP above 4.2s' }
      ]
    }));

    db.prepare(`
      INSERT OR REPLACE INTO platform_prospects (
        id, business_name, prospect_business_name, prospect_city, prospect_vertical,
        email, prospect_email, website_url, stage, status
      ) VALUES (
        'pros_stagej_01', 'Example Clinic', 'Example Clinic', 'Hyderabad', 'clinic',
        'founder@exampleclinic.in', 'founder@exampleclinic.in',
        'https://exampleclinic.in', 'DISCOVERED', 'NEW'
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, created_at
      ) VALUES (
        'draft_stagej_01', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Example Clinic', 'EMAIL',
        'Hi Example Clinic team, we found 2 critical Core Web Vitals & Schema defects blocking Google indexing.',
        0, 0, 'DRAFT_PENDING_APPROVAL', datetime('now')
      )
    `).run();

    db.prepare(`
      INSERT OR REPLACE INTO public_deals (
        id, slug, canonical_slug, title, brand, merchant, category, sector_code,
        product_url, affiliate_url, current_price_inr, reference_price_inr, discount_percent,
        availability, verification_status, is_monetizable, product_verified, affiliate_verified,
        evidence_json, last_verified_at, created_at, updated_at
      ) VALUES (
        'deal_cuelinks_top_stagej', 'boat-stagej-top-deal', 'boat-stagej-top-deal',
        'boAt Nirvana Ion ANC Earbuds', 'boAt', 'boAt Lifestyle', 'Electronics', 'SECTOR_B_ELECTRONICS',
        'https://www.boat-lifestyle.com/products/nirvana-ion-anc', 'https://clnk.in/nirvana-ion', 1999, 9990, 80,
        'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1,
        '{"affiliateNetwork":"CUELINKS","affiliateCampaignId":"501","verifiedCommissionRatePercent":8,"hasVerifiedPriceDrop":true,"catalogSlot":"FEATURED"}',
        datetime('now'), datetime('now'), datetime('now')
      )
    `).run();

    // Unauthenticated call fails closed with 401
    const unauthRes = await app.request('/api/v1/owner/first-sale/ready-actions');
    expect(unauthRes.status).toBe(401);

    // Authenticated owner session
    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
    const readyRes = await app.request('/api/v1/owner/first-sale/ready-actions', {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(readyRes.status).toBe(200);
    const readyJson = (await readyRes.json()) as any;
    expect(readyJson.success).toBe(true);
    expect(readyJson.data?.readyAudits?.some((a: any) => a.domain === 'exampleclinic.in' && a.defectCount === 2)).toBe(true);
    expect(readyJson.data?.pendingDrafts?.some((d: any) => d.id === 'draft_stagej_01' && d.email === 'founder@exampleclinic.in')).toBe(true);
    expect(readyJson.data?.topDeals?.some((d: any) => d.id === 'deal_cuelinks_top_stagej' && d.affiliateNetwork === 'CUELINKS')).toBe(true);
    expect(readyJson.data?.topDeals?.every((d: any) => d.affiliateNetwork !== 'AMAZON_IN')).toBe(true);
    expect(readyJson.data?.apiUtilization?.length).toBe(7);

    // Approve & Send pending draft via Brevo (mocking Brevo API call)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('api.brevo.com/v3/smtp/email')) {
        return new Response(JSON.stringify({ messageId: '<msg_stagej_ok@brevo>' }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });

    const sendRes = await app.request('/api/v1/owner/first-sale/approve-and-send/draft_stagej_01', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(sendRes.status).toBe(200);
    const sendJson = (await sendRes.json()) as any;
    expect(sendJson.success).toBe(true);
    expect(sendJson.dispatched).toBe(true);
    expect(sendJson.recipientEmail).toBe('founder@exampleclinic.in');

    const updatedDraft = db.prepare(`SELECT human_approved, dispatched, response_status FROM direct_outreach_log WHERE id = 'draft_stagej_01'`).get() as any;
    expect(updatedDraft.human_approved).toBe(1);
    expect(updatedDraft.dispatched).toBe(1);
    expect(updatedDraft.response_status).toBe('DISPATCHED');

    fetchSpy.mockRestore();
  });

  it('Task 6: Universal Fair-Price Checker, Price-Drop Alert Auto-Dispatch & 1-Click GitHub Deploy Bridge', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'harshavardhan-21';
    process.env.OWNER_API_KEY = 'stagej_owner_secret_key_999';
    process.env.BREVO_API_KEY = 'xkeysib_test_stagej_brevo_key';
    process.env.BREVO_SENDER_EMAIL = 'harsha@sitefix.in';
    process.env.PUBLIC_CONTACT_EMAIL = 'harsha@sitefix.in';
    delete process.env.GITHUB_TOKEN;

    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const brevoSentPayloads: any[] = [];
    const dbInit = getDb();
    dbInit.prepare(`
      INSERT OR REPLACE INTO cuelinks_campaigns (
        campaign_id, name, merchant_domain, payout_rate, status, verification_source
      ) VALUES (
        'camp_croma_test', 'Croma', 'croma.com', '5%', 'ACTIVE', 'CUELINKS_API_V3'
      )
    `).run();

    // Seed a non-Amazon verified Cuelinks deal with >= 3 price history observations spanning >= 7 days
    await dealEngine.ingestAndVerifyDeal({
      title: 'Sony WH-1000XM5 Wireless Headphones',
      brand: 'Sony',
      merchant: 'Croma',
      category: 'Electronics',
      productUrl: 'https://www.croma.com/sony-wh-1000xm5',
      sourceUrl: 'https://www.croma.com/sony-wh-1000xm5',
      sourceDomain: 'croma.com',
      sourceClass: 'CUELINKS_FEED',
      currentPriceINR: 22990,
      referencePriceINR: 34990,
      availability: 'IN_STOCK',
      trackingUrl: 'https://linksredirect.com/?pub_id=281897CL264028&source=linkkit&url=https%3A%2F%2Fwww.croma.com%2Fsony-wh-1000xm5',
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: 'camp_croma_test',
      isMonetizable: true,
      modelOrSku: 'SONY-XM5-CROMA',
      evidenceJson: {
        priceHistory: [
          { price: 29990, observedAt: new Date(Date.now() - 10 * 86400000).toISOString() },
          { price: 26990, observedAt: new Date(Date.now() - 5 * 86400000).toISOString() },
          { price: 22990, observedAt: new Date().toISOString() }
        ]
      }
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('api.brevo.com/v3/smtp/email')) {
        brevoSentPayloads.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ messageId: '<fp_alert_01@brevo>' }), { status: 201 });
      }
      if (url.includes('/pulls?') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/trees/feat%2Fstage-k-safe-profit-engine')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/trees/main')) {
        return new Response(JSON.stringify({ sha: 'tree_main_1', tree: [] }), { status: 200 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/ref/heads/feat%2Fstage-k-safe-profit-engine')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/ref/heads/main')) {
        return new Response(JSON.stringify({ object: { sha: 'commit_head_1' } }), { status: 200 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/refs') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ref: 'refs/heads/feat/stage-k-safe-profit-engine', object: { sha: 'commit_head_1' } }), { status: 201 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/commits/commit_head_1')) {
        return new Response(JSON.stringify({ sha: 'commit_head_1', tree: { sha: 'tree_base_1' } }), { status: 200 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/trees/tree_base_1')) {
        return new Response(JSON.stringify({ sha: 'tree_base_1', tree: [] }), { status: 200 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/blobs')) {
        return new Response(JSON.stringify({ sha: 'blob_sha_ok' }), { status: 201 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/trees')) {
        return new Response(JSON.stringify({ sha: 'new_tree_sha' }), { status: 201 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/commits')) {
        return new Response(JSON.stringify({ sha: 'new_commit_sha_777' }), { status: 201 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/git/refs/heads/feat%2Fstage-k-safe-profit-engine')) {
        return new Response(JSON.stringify({ object: { sha: 'new_commit_sha_777' } }), { status: 200 });
      }
      if (url.includes('api.github.com/repos/harshavardhankotu/ai-marketing-organization/pulls') && init?.method === 'POST') {
        return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/harshavardhankotu/ai-marketing-organization/pull/42' }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    });
    dealEngine.setFetchFn(globalThis.fetch);
    BrevoMcpClient.resetInstanceForTesting();
    BrevoMcpClient.getInstance(globalThis.fetch);

    // 1. Public Fair-Price Check on Amazon.in product URL -> monetizes WITHOUT scraping Amazon HTML
    const urlCheckRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryOrUrl: 'https://www.amazon.in/dp/B09XS7JWHH',
        skipAiSynthesis: true
      })
    });
    expect(urlCheckRes.status).toBe(200);
    const urlCheckJson = (await urlCheckRes.json()) as any;
    expect(urlCheckJson.success).toBe(true);
    expect(urlCheckJson.data?.inputType).toBe('PRODUCT_URL');
    expect(urlCheckJson.data?.monetizedDeal?.affiliateNetwork).toBe('AMAZON_IN');
    expect(urlCheckJson.data?.monetizedDeal?.trackingUrl).toContain('tag=harshavardhan-21');
    expect(urlCheckJson.data?.crossStoreOptions?.length).toBeGreaterThan(0);
    expect(urlCheckJson.data?.verdict).toBe('INSUFFICIENT_HISTORY');

    // 2. DPDP consent guard blocks email watch registration without consentGiven: true
    const noConsentRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryOrUrl: 'Sony WH-1000XM5 Wireless Headphones',
        targetFairPriceINR: 23500,
        alertEmail: 'buyer.india@example.com',
        consentGiven: false,
        skipAiSynthesis: true
      })
    });
    expect(noConsentRes.status).toBe(200);
    const noConsentJson = (await noConsentRes.json()) as any;
    expect(noConsentJson.data?.priceDropAlertRegistered?.registered).toBe(false);
    expect(noConsentJson.data?.priceDropAlertRegistered?.reason).toContain('CONSENT_REQUIRED');

    // 3. Explicit OPTED_IN_FIRST_PARTY alert watch on verified non-Amazon product -> triggers BUY_NOW + instant Brevo alert
    const consentRes = await app.request('/api/v1/public/fair-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryOrUrl: 'Sony WH-1000XM5 Wireless Headphones',
        targetFairPriceINR: 23500,
        alertEmail: 'buyer.india@example.com',
        consentGiven: true,
        skipAiSynthesis: true
      })
    });
    expect(consentRes.status).toBe(200);
    const consentJson = (await consentRes.json()) as any;
    expect(['BUY_NOW_BELOW_FAIR_PRICE', 'FAIR_MARKET_PRICE_APPLY_COUPON', 'OVERPRICED_WAIT_FOR_DROP']).toContain(consentJson.data?.verdict);
    expect(consentJson.data?.priceDropAlertRegistered?.registered).toBe(true);
    expect(consentJson.data?.priceDropAlertRegistered?.immediateAlertDispatched).toBe(true);
    expect(brevoSentPayloads.length).toBe(1);
    expect(brevoSentPayloads[0]?.to?.[0]?.email).toBe('buyer.india@example.com');

    const db = getDb();
    const watchRow = db.prepare(`SELECT source, email_authorized, authorization_evidence_json FROM outbound_contacts WHERE prospect_email = 'buyer.india@example.com'`).get() as any;
    expect(watchRow?.source).toBe('FAIR_PRICE_ALERT');
    expect(watchRow?.email_authorized).toBe(1);
    expect(watchRow?.authorization_evidence_json).toContain('OPTED_IN_FIRST_PARTY');

    // 4. GitHub Deploy Bridge auth & PR-branch checks
    const unauthDeployRes = await app.request('/api/v1/owner/deploy/changed-files-manifest');
    expect(unauthDeployRes.status).toBe(401);

    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
    const missingTokRes = await app.request('/api/v1/owner/deploy/push-to-github', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitMessage: 'test push' })
    });
    expect(missingTokRes.status).toBe(400);

    const pushOkRes = await app.request('/api/v1/owner/deploy/push-to-github', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        githubToken: 'ghp_test_token_never_persisted',
        branch: 'feat/stage-k-safe-profit-engine',
        commitMessage: 'feat: test deploy bridge',
        files: ['package.json']
      })
    });
    expect(pushOkRes.status).toBe(200);
    const pushOkJson = (await pushOkRes.json()) as any;
    expect(pushOkJson.success).toBe(true);
    expect(pushOkJson.data?.commitSha).toBe('new_commit_sha_777');
    expect(pushOkJson.data?.filesPushedCount).toBe(1);
    expect(pushOkJson.data?.prUrl).toContain('/pull/42');

    // Ensure helper method directly runs cleanly too
    const directDispatch = await dealEngine.checkAndDispatchTargetPriceAlerts([]);
    expect(directDispatch.checked).toBe(0);

    fetchSpy.mockRestore();
  });
});
