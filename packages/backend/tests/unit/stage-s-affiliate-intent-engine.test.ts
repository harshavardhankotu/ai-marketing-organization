import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AutonomousDealDiscoveryEngine,
  isImpulseConversionDeal,
  NormalizedDeal
} from '../../src/commission/autonomous-deal-discovery-engine.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { renderCustomerDeskWidgetHtml } from '../../src/revenue/customer-desk-widget.js';
import { SalesConversationEngine } from '../../src/revenue/sales-conversation-engine.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { YouTubeReviewEnricher } from '../../src/integrations/youtube-review-enricher.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { app } from '../../src/index.js';

describe('Stage S: Zero-Budget Affiliate Buyer-Intent Engine', () => {
  const origEnv = { ...process.env };
  const db = getDb();

  beforeEach(() => {
    process.env = { ...origEnv };
    // Ensure core foreign keys exist
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug)
        VALUES ('org_owner_primary', 'Platform Owner Org', 'owner-org')
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO businesses (id, organization_id, name, slug)
        VALUES ('biz_platform_aro', 'org_owner_primary', 'ARO Platform', 'platform-aro')
      `).run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
    try {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      (engine as any).dealsMap?.delete('deal_high_ticket_99');
      (engine as any).dealsMap?.delete('deal_impulse_perfume_99');
      (engine as any).dealsMap?.delete('deal_plum_vanilla_01');
      (engine as any).dealsMap?.delete('deal_fragrance_combo_01');
    } catch {}
  });

  describe('Task 1: isImpulseConversionDeal & Impulse-Conversion Scoring Boost', () => {
    it('correctly identifies valid impulse offers (₹299–₹1,499 with >=25% discount and confirmed monetization)', () => {
      const impulseDeal: Partial<NormalizedDeal> = {
        id: 'deal_perfume_combo',
        title: 'Luxury Perfume Gift Set 100ml',
        currentPriceINR: 799,
        referencePriceINR: 1599,
        verifiedDiscountPercent: 50,
        availability: 'IN_STOCK',
        isMonetizable: true,
        trackingUrl: 'https://example.com/perfume',
        catalogSlot: 'FEATURED_HERO'
      };
      expect(isImpulseConversionDeal(impulseDeal)).toBe(true);
    });

    it('rejects high-ticket items outside the impulse range (e.g. ₹17,999)', () => {
      const highTicketDeal: Partial<NormalizedDeal> = {
        id: 'deal_laptop_expensive',
        title: 'Premium Ultra-Light Laptop',
        currentPriceINR: 17999,
        referencePriceINR: 24999,
        verifiedDiscountPercent: 28,
        availability: 'IN_STOCK',
        isMonetizable: true
      };
      expect(isImpulseConversionDeal(highTicketDeal)).toBe(false);
    });

    it('rejects items priced under ₹299 or with less than 25% discount', () => {
      const cheapDeal: Partial<NormalizedDeal> = {
        id: 'deal_cheap_cable',
        title: 'USB Cable',
        currentPriceINR: 199,
        referencePriceINR: 399,
        verifiedDiscountPercent: 50,
        availability: 'IN_STOCK',
        isMonetizable: true
      };
      expect(isImpulseConversionDeal(cheapDeal)).toBe(false);

      const lowDiscountDeal: Partial<NormalizedDeal> = {
        id: 'deal_low_discount',
        title: 'Earbuds',
        currentPriceINR: 999,
        referencePriceINR: 1099,
        verifiedDiscountPercent: 10,
        availability: 'IN_STOCK',
        isMonetizable: true
      };
      expect(isImpulseConversionDeal(lowDiscountDeal)).toBe(false);
    });

    it('rejects out of stock or rotated stale deals', () => {
      const outOfStock: Partial<NormalizedDeal> = {
        id: 'deal_oos',
        title: 'Perfume Combo',
        currentPriceINR: 599,
        verifiedDiscountPercent: 35,
        availability: 'OUT_OF_STOCK',
        isMonetizable: true
      };
      expect(isImpulseConversionDeal(outOfStock)).toBe(false);

      const stale: Partial<NormalizedDeal> = {
        id: 'deal_stale',
        title: 'Grooming Kit',
        currentPriceINR: 699,
        verifiedDiscountPercent: 30,
        availability: 'IN_STOCK',
        isMonetizable: true,
        catalogSlot: 'ROTATED_OUT_STALE'
      };
      expect(isImpulseConversionDeal(stale)).toBe(false);
    });

    it('prioritizes impulse deals ahead of high-ticket items in getEligiblePublicDeals', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const highTicketDeal: NormalizedDeal = {
        id: 'deal_high_ticket_99',
        slug: 'expensive-gadget',
        canonicalSlug: 'expensive-gadget',
        title: 'Flagship Smartphone Pro 256GB',
        brand: 'FlagshipBrand',
        merchant: 'Amazon',
        category: 'Electronics',
        currentPriceINR: 17999,
        referencePriceINR: 24999,
        verifiedDiscountPercent: 28,
        confidenceScore: 95,
        buyerValueScore: 88,
        expectedProfitPer100VisitorsINR: 500,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'amazon.in',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://example.com/gadget',
        productUrl: 'https://example.com/gadget',
        evidence: {} as any
      };

      const impulseDeal: NormalizedDeal = {
        id: 'deal_impulse_perfume_99',
        slug: 'bellavita-luxury-perfume-combo',
        canonicalSlug: 'bellavita-luxury-perfume-combo',
        title: 'Bella Vita Luxury Organic Perfume Gift Set',
        brand: 'Bella Vita',
        merchant: 'Bella Vita',
        category: 'Fragrance',
        currentPriceINR: 699,
        referencePriceINR: 1299,
        verifiedDiscountPercent: 46,
        confidenceScore: 85,
        buyerValueScore: 78,
        expectedProfitPer100VisitorsINR: 200,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'bellavita.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://example.com/perfume',
        productUrl: 'https://example.com/perfume',
        evidence: {} as any
      };

      (engine as any).dealsMap.set(highTicketDeal.id, highTicketDeal);
      (engine as any).dealsMap.set(impulseDeal.id, impulseDeal);

      const eligibleRes = await engine.getEligiblePublicDeals({ limit: 10 });
      const foundHigh = eligibleRes.deals.findIndex(d => d.id === highTicketDeal.id);
      const foundImpulse = eligibleRes.deals.findIndex(d => d.id === impulseDeal.id);

      expect(foundImpulse).toBeGreaterThanOrEqual(0);
      expect(foundHigh).toBeGreaterThanOrEqual(0);
      expect(foundImpulse).toBeLessThan(foundHigh);
    });

    it('awards +15 bonus points in calculateBuyerValueScore for impulse conversion deals', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const baseDeal: NormalizedDeal = {
        id: 'deal_score_calc',
        slug: 'test-deal',
        canonicalSlug: 'test-deal',
        title: 'Test Deal',
        brand: 'TestBrand',
        merchant: 'TestStore',
        category: 'General',
        currentPriceINR: 4999, // not impulse
        referencePriceINR: 7999,
        verifiedDiscountPercent: 37,
        confidenceScore: 80,
        buyerValueScore: 0,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'teststore.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://teststore.com/deal',
        productUrl: 'https://teststore.com/deal',
        evidence: {} as any
      };

      const scoreNonImpulse = engine.calculateBuyerValueScore(baseDeal);

      // Convert to impulse price band ₹299–₹1,499
      const impulseDeal = { ...baseDeal, currentPriceINR: 899 };
      const scoreImpulse = engine.calculateBuyerValueScore(impulseDeal);

      expect(scoreImpulse).toBeGreaterThan(scoreNonImpulse);
      expect(scoreImpulse - scoreNonImpulse).toBe(15);
    });
  });

  describe('Task 2: Front-Door Fair-Price & Price-Drop Capture Loop', () => {
    it('renders the 1-row opt-in price-drop alert box on SSR deal, comparison, and guide pages', () => {
      const generator = new StaticSiteGenerator();
      const config = {
        siteName: 'AI Marketing Organization',
        authorName: 'Harshavardhan Kotu',
        contactEmail: 'contact@example.com',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      };

      const testDeal = {
        id: 'deal_audio_earbuds_01',
        slug: 'boat-airdopes-141-anc',
        title: 'boAt Airdopes 141 ANC TWS Earbuds',
        merchant: 'boAt Lifestyle',
        brand: 'boAt',
        category: 'Audio',
        currentPriceINR: 1299,
        referencePriceINR: 4490,
        verifiedDiscountPercent: 71,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED'
      };

      const dealDetailHtml = generator.renderDealDetailHtml(testDeal, [], config);
      expect(dealDetailHtml).toContain('price-drop-alert-box');
      expect(dealDetailHtml).toContain('/api/v1/customer-desk/subscribe-alerts');
      expect(dealDetailHtml).toContain('Get Instant Price-Drop Alert');
      expect(dealDetailHtml).toContain('#Ad');

      // Test comparison page
      const compDealB = {
        id: 'deal_audio_noise_01',
        slug: 'noise-buds-vs104',
        title: 'Noise Buds VS104 Truly Wireless Earbuds',
        merchant: 'Noise',
        brand: 'Noise',
        category: 'Audio',
        currentPriceINR: 1199,
        referencePriceINR: 3499,
        verifiedDiscountPercent: 65,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED'
      };
      const pair = {
        comparisonSlug: 'boat-airdopes-141-vs-noise-buds-vs104',
        dealA: testDeal,
        dealB: compDealB,
        title: 'boAt Airdopes 141 vs Noise Buds VS104',
        description: 'Head to head comparison'
      };
      const compHtml = generator.renderComparisonHtml(pair as any, config, []);
      expect(compHtml).toContain('price-drop-alert-box');
      expect(compHtml).toContain('/api/v1/customer-desk/subscribe-alerts');
      expect(compHtml).toContain('#Ad');

      // Test Instagram Bio storefront page (/ig)
      const igHtml = generator.renderInstagramBioStorefrontHtml(config, [testDeal, compDealB]);
      expect(igHtml).toContain('price-drop-alert-box');
      expect(igHtml).toContain('/api/v1/customer-desk/subscribe-alerts');
    });

    it('subscribes buyer via POST /api/v1/customer-desk/subscribe-alerts and records durable event', async () => {
      const testEmail = `buyer_${Date.now()}@example.com`;
      const reqPayload = {
        email: testEmail,
        productSlug: 'boat-airdopes-141-anc',
        category: 'Audio',
        dealId: 'deal_audio_earbuds_01',
        targetPriceINR: 999
      };

      const res = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqPayload)
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.subscribed).toBe(true);
      expect(json.consentStatus).toBe('OPTED_IN_FIRST_PARTY');
      expect(json.email).toBe(testEmail);

      // Verify outbound_contacts persistence
      const contactRow = db.prepare(`SELECT * FROM outbound_contacts WHERE prospect_email = ?`).get(testEmail) as any;
      expect(contactRow).toBeDefined();
      expect(contactRow.email_authorized).toBe(1);

      // Verify durable_events persistence
      const eventRows = db.prepare(`SELECT * FROM durable_events WHERE event_type = 'PRICE_DROP_SUBSCRIPTION' ORDER BY created_at DESC`).all() as any[];
      const matchingEvent = eventRows.find(e => e.payload_json && e.payload_json.includes(testEmail));
      expect(matchingEvent).toBeDefined();
      expect(matchingEvent.processed).toBe(0);
    });

    it('dispatches Brevo alert email when catalog price drops at or below targetPriceINR', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const testEmail = `alert_drop_${Date.now()}@example.com`;

      // Spy on Brevo sendTransactionalEmail
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_123',
        status: 'SENT'
      });

      // Insert an opted-in watch in outbound_contacts
      const contactId = `cnt_test_${Date.now()}`;
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name, prospect_email, channel,
          email_authorized, whatsapp_opt_in, authorization_source, authorization_evidence_json,
          source, status, is_opted_out, is_bounced, is_suppressed
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'Alert Tester', ?, 'EMAIL',
          1, 0, 'EXPLICIT_CONSENT', ?, 'CUSTOMER_DESK_ALERT_OPTIN', 'ACTIVE', 0, 0, 0
        )
      `).run(
        contactId,
        testEmail,
        JSON.stringify({
          consent_status: 'OPTED_IN_FIRST_PARTY',
          watches: [{
            target_deal_id: 'deal_drop_test_01',
            target_deal_slug: 'test-earbuds-drop',
            target_price_inr: 850,
            registered_at: new Date().toISOString(),
            dispatched_at: null
          }]
        })
      );

      const dealPricedBelowTarget: NormalizedDeal = {
        id: 'deal_drop_test_01',
        slug: 'test-earbuds-drop',
        canonicalSlug: 'test-earbuds-drop',
        title: 'Test Wireless Earbuds',
        brand: 'AudioPro',
        merchant: 'AudioStore',
        category: 'Audio',
        currentPriceINR: 799, // <= 850 target
        referencePriceINR: 1999,
        verifiedDiscountPercent: 60,
        confidenceScore: 90,
        buyerValueScore: 85,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'audiostore.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://audiostore.com/deal',
        productUrl: 'https://audiostore.com/deal',
        evidence: {} as any
      };

      const dispatchResult = await engine.checkAndDispatchTargetPriceAlerts([dealPricedBelowTarget]);
      expect(dispatchResult.dispatched).toBeGreaterThanOrEqual(1);
      expect(sendSpy).toHaveBeenCalled();
      const lastCall = sendSpy.mock.calls[0][0];
      expect(lastCall.textContent).toContain('utm_source=price_alert');
    });

    it('renders the 4 intent starter chips in Customer Desk Concierge widget', () => {
      const widgetHtml = renderCustomerDeskWidgetHtml();
      expect(widgetHtml).toContain('Perfume combos under');
      expect(widgetHtml).toContain('Best earbuds under');
      expect(widgetHtml).toContain('Check if a deal is real');
      expect(widgetHtml).toContain('Top verified drops today');
      expect(widgetHtml).toContain('renderStarterChips');
    });
  });

  describe('Task 3: Zero-Cost Buyer-Intent Distribution Kit', () => {
    it('returns grounded distribution snippets for top impulse deals with zero fabricated prices', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const impulseDeal: NormalizedDeal = {
        id: 'deal_fragrance_combo_01',
        slug: 'plum-bodylovin-vanilla-vibes-combo',
        canonicalSlug: 'plum-bodylovin-vanilla-vibes-combo',
        title: 'Plum BodyLovin Vanilla Vibes Eau De Parfum & Body Mist Combo',
        brand: 'Plum',
        merchant: 'Plum Goodness',
        category: 'Fragrance',
        currentPriceINR: 749,
        referencePriceINR: 1250,
        verifiedDiscountPercent: 40,
        confidenceScore: 92,
        buyerValueScore: 90,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'plumgoodness.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://plumgoodness.com/vanilla',
        productUrl: 'https://plumgoodness.com/vanilla',
        evidence: {} as any
      };

      (engine as any).dealsMap.set(impulseDeal.id, impulseDeal);

      // Mock YouTubeReviewEnricher
      vi.spyOn(YouTubeReviewEnricher.getInstance(), 'resolveReviewForDeal').mockResolvedValue({
        videoId: 'vid_plum_rev_01',
        title: 'Plum BodyLovin Vanilla Vibes Honest Review',
        channelTitle: 'Fragrance Diaries India',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        videoUrl: 'https://www.youtube.com/watch?v=vid_plum_rev_01',
        embedUrl: 'https://www.youtube-nocookie.com/embed/vid_plum_rev_01'
      });

      // Configure IndexNow key
      process.env.INDEXNOW_KEY = '38f9d0c2';

      // Request distribution kit as owner
      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const res = await app.request('/api/v1/owner/first-sale/intent-distribution-kit', {
        headers: {
          Authorization: `Bearer ${session.token}`
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.topImpulseDeals)).toBe(true);
      expect(json.topImpulseDeals.length).toBeGreaterThan(0);

      const targetItem = json.topImpulseDeals.find((d: any) => d.dealId === impulseDeal.id);
      expect(targetItem).toBeDefined();
      expect(targetItem.priceINR).toBe(749); // Strictly grounded in D1 deal price
      expect(targetItem.referencePriceINR).toBe(1250);
      expect(targetItem.targetSubreddit).toBe('r/DesiFragranceAddicts');

      // Verify snippets and statutory #Ad disclosures
      const { youtubeCommentReply, redditReply, igTelegramCaption } = targetItem.snippets;
      expect(youtubeCommentReply).toContain('#Ad');
      expect(youtubeCommentReply).toContain('₹749');
      expect(youtubeCommentReply).toContain('MRP ₹1,250');

      expect(redditReply).toContain('#Ad');
      expect(redditReply).toContain('₹749');
      expect(redditReply).toContain('40%');

      expect(igTelegramCaption).toContain('#Ad');
      expect(igTelegramCaption).toContain('/ig');
      expect(igTelegramCaption).toContain('₹749');

      // Verify search engine checklist
      expect(json.searchEngineChecklist).toBeDefined();
      expect(json.searchEngineChecklist.sitemapUrl).toContain('/sitemap.xml');
      expect(json.searchEngineChecklist.robotsUrl).toContain('/robots.txt');
      expect(json.searchEngineChecklist.indexNowKeyUrl).toContain('/38f9d0c2.txt');
      expect(json.searchEngineChecklist.indexNowStatus).toBe('ACTIVE');
    });
  });
});
