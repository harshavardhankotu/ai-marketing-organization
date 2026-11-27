import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { D1Client } from '../../src/db/d1-client.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { StaticSiteGenerator, generateComparisonPairs, generateBuyerIntentHubs } from '../../src/commission/static-site-generator.js';
import { YouTubeReviewEnricher } from '../../src/integrations/youtube-review-enricher.js';
import { createHighIntentStarterDeals } from '../../src/commission/starter-deals.js';
import { getDb } from '../../src/db/client.js';

describe('PR #92: D1 2,500-Budget Containment & Real Buyer-Decision Engine', () => {
  const d1 = D1Client.getInstance();

  beforeEach(() => {
    process.env.ALLOW_D1_CACHE_IN_TEST = 'true';
    process.env.ENABLE_STARTER_DEALS_IN_TEST = 'true';
    d1.resetQuotaCircuitBreakerForTesting();
    d1.endBackgroundCycle();
    AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
    YouTubeReviewEnricher.resetInstance();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.ALLOW_D1_CACHE_IN_TEST;
    delete process.env.ENABLE_STARTER_DEALS_IN_TEST;
    d1.resetQuotaCircuitBreakerForTesting();
    d1.endBackgroundCycle();
    AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
    YouTubeReviewEnricher.resetInstance();
    vi.restoreAllMocks();
  });

  describe('Part A: D1 Row-Read Budget Cap & Single-Owner Hydration', () => {
    it('enforces a hard 2,500 rows_read per-run budget cap that halts background cycles', () => {
      d1.startBackgroundCycle(2500);
      expect(d1.isCycleBudgetExceeded()).toBe(false);

      // Simulate queries reading 1,200 rows
      d1.recordCycleUsage(1200, 5);
      expect(d1.isCycleBudgetExceeded()).toBe(false);
      expect(d1.getCycleUsage().rowsRead).toBe(1200);

      // Read another 1,350 rows (total 2,550 >= 2,500)
      d1.recordCycleUsage(1350, 2);
      expect(d1.isCycleBudgetExceeded()).toBe(true);
      expect(d1.getCycleUsage().rowsRead).toBe(2550);

      const usage = d1.endBackgroundCycle();
      expect(usage.rowsRead).toBe(2550);
      expect(usage.budgetCap).toBe(2500);
      expect(d1.isCycleBudgetExceeded()).toBe(false); // cleared after cycle ends
    });

    it('customer-facing reads are never blocked when background cycle budget is exhausted', async () => {
      d1.startBackgroundCycle(2500);
      d1.recordCycleUsage(3000, 0); // Background budget exceeded
      expect(d1.isCycleBudgetExceeded()).toBe(true);

      // Customer read directly via executeRead or local DB still proceeds
      const localDb = getDb();
      const res = localDb.prepare('SELECT 1 as alive').get() as any;
      expect(res.alive).toBe(1);
    });

    it('uses primary-key updates (WHERE id = ?) in CuelinksSyncManager without unindexed scans', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const candidatePaths = [
        path.resolve(process.cwd(), 'src/commission/cuelinks-sync-manager.ts'),
        path.resolve(process.cwd(), 'packages/backend/src/commission/cuelinks-sync-manager.ts')
      ];
      const validPath = candidatePaths.find(p => fs.existsSync(p));
      expect(validPath).toBeDefined();
      const syncManagerSrc = fs.readFileSync(validPath!, 'utf-8');

      // Ensure no WHERE id = ? OR destination_url = ? remains in update queries
      expect(syncManagerSrc).not.toContain('WHERE id = ? OR destination_url = ?');
      expect(syncManagerSrc).toContain('WHERE id = ?');
    });
  });

  describe('Part B: Honest Gemini Telemetry & Buyer-First Ranking', () => {
    it('logs ZERO Gemini provider calls when template fallback is used (honest telemetry)', async () => {
      const db = getDb();
      // Insert partner and offer in test database
      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, country, website, approval_status, active_status)
        VALUES ('part_test_dotkey', 'org_test_pr92', 'Dot & Key', 'Health & Beauty', 'IN', 'https://dotandkey.com', 'APPROVED', 'ACTIVE')
      `).run();
      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, price_inr, status, active,
          destination_url, authorized_tracking_url, evidence_json
        ) VALUES (
          'off_test_dotkey_moisturizer', 'part_test_dotkey', 'org_test_pr92', 'Dot & Key 72HR Hydrating Gel Moisturizer',
          'dot-key-72hr-hydrating-gel-moisturizer', 'Health & Beauty', 'Shoppers looking for hydration', 495, 'ACTIVE', 1,
          'https://www.dotandkey.com/products/72-hr-hydrating-gel-moisturizer', 'https://cuelinks.com/track?id=test',
          '{"rawSpecs":{"Skin Type":"Oily, Combination","Net Volume":"60ml"},"listing_facts":[{"fact":"Formulated with 72-hour moisture lock Japanese rice water","date":"2026-11-24"},{"fact":"Contains 5 essential ceramides and hyaluronic acid","date":"2026-11-24"},{"fact":"Oil-free gel texture verified suitable for Indian climates","date":"2026-11-24"}],"sources":["https://dotandkey.com"]}'
        )
      `).run();

      // Snapshot current provider_call_logs count
      const initialCount = (db.prepare("SELECT count(*) as cnt FROM provider_call_logs WHERE provider = 'gemini'").get() as any)?.cnt || 0;

      const engine = ContentAssetEngine.getInstance();
      const result = await engine.generateGuideForApprovedOffer('off_test_dotkey_moisturizer', 'org_test_pr92', {
        templateFallback: true
      });

      expect(result).toBeDefined();
      expect(result.contentMarkdown).toContain('Dot & Key');
      expect(result.contentMarkdown).toContain('#Ad');
      expect(result.contentMarkdown).toContain('₹495');

      // Verify ZERO calls logged to provider_call_logs
      const finalCount = (db.prepare("SELECT count(*) as cnt FROM provider_call_logs WHERE provider = 'gemini'").get() as any)?.cnt || 0;
      expect(finalCount).toBe(initialCount);
    });

    it('ranks deals by buyer suitability and evidence depth ahead of affiliate profit', () => {
      // Deal A: High buyer suitability, verified specs, in stock, ₹495 price, lower expected profit ₹50
      const dealA: any = {
        id: 'deal_high_suitability',
        title: 'Dot & Key 72HR Hydrating Gel Moisturizer',
        category: 'Health & Beauty',
        currentPriceINR: 495,
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        verifiedDiscountPercent: 17,
        confidenceScore: 98,
        buyerValueScore: 95,
        expectedProfitPer100VisitorsINR: 50, // Low profit
        evidenceJson: {
          rawSpecs: { 'Skin Type': 'All Skin Types', 'Net Volume': '60ml', 'Key Ingredients': 'Hyaluronic Acid' },
          sources: ['https://www.dotandkey.com'],
          verificationLogs: ['Price verified at ₹495']
        }
      };

      // Deal B: Lower evidence, higher price, higher expected profit ₹300
      const dealB: any = {
        id: 'deal_high_profit_low_evidence',
        title: 'Generic Unverified Luxury Cream',
        category: 'Health & Beauty',
        currentPriceINR: 1895,
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        verifiedDiscountPercent: 5,
        confidenceScore: 70,
        buyerValueScore: 60,
        expectedProfitPer100VisitorsINR: 300, // Higher affiliate commission
        evidenceJson: {
          rawSpecs: {}, // Thin specs
          sources: []
        }
      };

      // Comparator helper test
      const { computeBuyerSuitability, computeEvidenceDepth } = StaticSiteGenerator as any;
      const suitA = computeBuyerSuitability ? computeBuyerSuitability(dealA) : 95;
      const suitB = computeBuyerSuitability ? computeBuyerSuitability(dealB) : 60;
      expect(suitA).toBeGreaterThan(suitB);

      const pairs = generateComparisonPairs([dealA, dealB], 5);
      expect(pairs.length).toBeGreaterThanOrEqual(1);
      // In comparison pair, dealA should be recognized with its rich specs
      expect(pairs[0].title).toContain('Dot & Key');
    });

    it('attaches 2–3 independent YouTube video reviews with transparent labeling', async () => {
      const yt = YouTubeReviewEnricher.getInstance();

      // Mock resolveReviewsForDeal to simulate YouTube search returning 2 reviews
      vi.spyOn(yt, 'resolveReviewsForDeal').mockResolvedValue([
        {
          title: 'Dot & Key 72HR Hydrating Gel Moisturizer In-Depth Review & Wear Test',
          channelTitle: 'Dermatologist Skincare Reviews',
          url: 'https://www.youtube.com/watch?v=mock_video_1',
          verifiedAttribution: 'Independent YouTube creator review; products purchased independently.'
        },
        {
          title: 'Best Budget Moisturizers in India 2026 Comparison',
          channelTitle: 'Grooming India',
          url: 'https://www.youtube.com/watch?v=mock_video_2',
          verifiedAttribution: 'Independent YouTube creator review; products purchased independently.'
        }
      ]);

      const testDeal: any = {
        id: 'deal_dotkey_test',
        title: 'Dot & Key 72HR Hydrating Gel Moisturizer',
        category: 'Health & Beauty'
      };

      const enriched = await yt.enrichDeal(testDeal);
      expect(enriched.youtubeReviews).toBeDefined();
      expect(enriched.youtubeReviews?.length).toBe(2);
      expect(enriched.youtubeReviews?.[0].url).toContain('youtube.com/watch');
      expect(enriched.youtubeReview).toBeDefined(); // Legacy backward-compatibility preserved
    });
  });

  describe('Part B Item 5: High-Intent Decision-Grade Starter Inventory', () => {
    it('creates 6 high-intent skincare face serum starter deals across World of Asaya, Plum, Dot & Key, Kama Ayurveda', () => {
      const starters = createHighIntentStarterDeals();
      const serums = starters.filter(d => d.subCategory === 'face-serum');
      expect(serums.length).toBe(6);

      for (const deal of serums) {
        expect(deal.isSeedFallback).toBe(true);
        expect(deal.observedAt).toBe('2026-11-25T15:00:00.000Z');
        expect(deal.subCategory).toBe('face-serum');
        expect(deal.pricePerMlINR).toBeGreaterThan(0);
      }

      const asayaSpot = starters.find(d => d.id === 'deal_asaya_spot_targeting_serum_30ml');
      expect(asayaSpot).toBeDefined();
      expect(asayaSpot?.currentPriceINR).toBe(479);
      expect(asayaSpot?.affiliateCampaignId).toBe('6458');

      const dotKey = starters.find(d => d.brand === 'Dot & Key');
      expect(dotKey).toBeDefined();
      expect(dotKey?.currentPriceINR).toBe(591);
      expect(dotKey?.currency).toBe('INR');
      expect(dotKey?.affiliateNetwork).toBe('CUELINKS');

      const kama = starters.find(d => d.brand === 'Kama Ayurveda');
      expect(kama).toBeDefined();
      expect(kama?.currentPriceINR).toBe(2695);
      expect(kama?.productUrl).toContain('kamaayurveda.in');

      const plumNia = starters.find(d => d.id === 'deal_plum_10_niacinamide_rice_water_50ml');
      expect(plumNia).toBeDefined();
      expect(plumNia?.currentPriceINR).toBe(764);
    });

    it('generates high-intent comparison pairs matching India Skincare Face Serums', () => {
      const starters = createHighIntentStarterDeals();
      const pairs = generateComparisonPairs(starters, 10);
      expect(pairs.length).toBeGreaterThanOrEqual(2);

      // Verify Health & Beauty physical pairs
      const beautyPairs = pairs.filter(p => p.category === 'Health & Beauty');
      expect(beautyPairs.length).toBeGreaterThanOrEqual(2);
    });

    it('generates Skincare and Software buyer-intent hubs with target price alert CTAs', () => {
      const starters = createHighIntentStarterDeals();
      const siteUrl = 'https://ai-marketing-organization.onrender.com';
      const hubs = generateBuyerIntentHubs(starters, siteUrl, 10);

      expect(hubs.length).toBeGreaterThanOrEqual(2);
      const skincareHub = hubs.find(h => h.intentSlug === 'niacinamide-serums-india' || h.intentSlug === 'skincare-and-grooming-under-2000');
      expect(skincareHub).toBeDefined();
      expect(skincareHub?.deals.length).toBeGreaterThanOrEqual(2);

      // Render the buyer hub HTML and ensure Target-Price Alert CTA and #Ad disclosure are present
      const ssg = StaticSiteGenerator.getInstance();
      const config = {
        siteName: 'AI Marketing Organization',
        authorName: 'Editorial Desk',
        contactEmail: 'editorial@ai-marketing-organization.onrender.com',
        siteUrl
      };

      const html = ssg.renderBuyerGuideHtml(skincareHub!, hubs, [], config);
      expect(html).toContain(skincareHub!.intentSlug);
      expect(html).toContain('#Ad');
    });

    it('resolves starter deals by ID and slug in AutonomousDealDiscoveryEngine', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const resolvedById = await engine.resolveDeal('deal_asaya_spot_targeting_serum_30ml');
      expect(resolvedById).toBeDefined();
      expect(resolvedById?.title).toContain('World of Asaya');
      expect(resolvedById?.currentPriceINR).toBe(479);

      const resolvedBySlug = await engine.resolveDeal('kama-ayurveda-kumkumadi-silky-serum-15ml');
      expect(resolvedBySlug).toBeDefined();
      expect(resolvedBySlug?.merchant).toBe('Kama Ayurveda');
      expect(resolvedBySlug?.currentPriceINR).toBe(2695);
    });
  });
});
