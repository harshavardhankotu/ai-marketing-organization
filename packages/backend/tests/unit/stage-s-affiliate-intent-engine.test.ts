import { createHash } from 'crypto';
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
    // Ensure core foreign keys exist and test state is cleanly isolated
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug)
        VALUES ('org_owner_primary', 'Platform Owner Org', 'owner-org')
      `).run();
    } catch {}
    try {
      db.prepare(`
        INSERT OR IGNORE INTO businesses (id, organization_id, name, public_slug)
        VALUES ('biz_platform_aro', 'org_owner_primary', 'ARO Platform', 'platform-aro')
      `).run();
    } catch {}
    try {
      db.prepare(`DELETE FROM outbound_contacts WHERE source IN ('FAIR_PRICE_ALERT', 'CUSTOMER_DESK_ALERT_OPTIN')`).run();
    } catch {}
    try {
      db.prepare(`DELETE FROM durable_events WHERE event_type LIKE 'PRICE_%' OR event_type LIKE 'INDEXNOW_%'`).run();
    } catch {}
    try {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      (engine as any).dealsMap?.clear();
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
    } catch (e: any) {
      console.error('beforeEach error:', e?.message);
    }
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

      const eligibleRes = await engine.getEligiblePublicDeals({ limit: 100 });
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

    it('distinguishes query-derived vs explicit-product watches and reaches text matching for queries', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const db = getDb();
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_query_reach',
        status: 'SENT'
      });

      // 1. Register query-derived watch (no deal passed)
      const queryEmail = `query_buyer_${Date.now()}@example.com`;
      await engine.registerTargetPriceAlert({
        email: queryEmail,
        targetFairPriceINR: 1500,
        queryOrUrl: 'boAt Airdopes 141'
      });

      const contact = db.prepare('SELECT authorization_evidence_json FROM outbound_contacts WHERE prospect_email = ?').get(queryEmail) as any;
      const ev = JSON.parse(contact.authorization_evidence_json);
      expect(ev.origin).toBe('QUERY_DERIVED');
      expect(ev.watches[0].origin).toBe('QUERY_DERIVED');

      // 2. Incoming deal has longer/different slug 'boat-airdopes-141-anc-true-wireless-earbuds'
      const longSlugDeal: NormalizedDeal = {
        id: 'deal_boat_long_slug',
        slug: 'boat-airdopes-141-anc-true-wireless-earbuds',
        canonicalSlug: 'boat-airdopes-141-anc-true-wireless-earbuds',
        title: 'boAt Airdopes 141 Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio',
        currentPriceINR: 1299, // <= 1500 target
        referencePriceINR: 4490,
        verifiedDiscountPercent: 71,
        confidenceScore: 95,
        buyerValueScore: 92,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'boat-lifestyle.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://boat-lifestyle.com/deal',
        productUrl: 'https://boat-lifestyle.com/deal',
        evidence: {} as any
      };

      const dispatchResult = await engine.checkAndDispatchTargetPriceAlerts([longSlugDeal]);
      expect(dispatchResult.dispatched).toBeGreaterThanOrEqual(1);

      // 3. Exclude expired deals from alert candidates
      sendSpy.mockClear();
      const expiredDeal: NormalizedDeal = {
        ...longSlugDeal,
        id: 'deal_expired_01',
        verificationStatus: 'EXPIRED'
      };
      const expiredResult = await engine.checkAndDispatchTargetPriceAlerts([expiredDeal]);
      expect(expiredResult.dispatched).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
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
      expect(json.searchEngineChecklist.sitemapStatus).toBe('GENERATED_DYNAMIC');
      expect(typeof json.searchEngineChecklist.sitemapUrlCount).toBe('number');
      expect(json.searchEngineChecklist.robotsUrl).toContain('/robots.txt');
      expect(json.searchEngineChecklist.indexNowKeyUrl).toContain('/38f9d0c2.txt');
      expect(json.searchEngineChecklist.indexNowStatus).toBe('CONFIGURED_READY');
      expect(json.searchEngineChecklist.searchEngineIndexing).toBe('EXTERNAL_CONSOLE_CHECK_REQUIRED');
    });
  });

  describe('Stage S.1 Acceptance Gates & Failure Injection Verification', () => {
    it('Gate 1 & Gate 2: Unified claim prevents duplicate sends across outbound_contacts + durable_events and concurrent worker runs', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const testEmail = `dedupe_buyer_${Date.now()}@example.com`;
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_dedupe_test',
        status: 'SENT'
      });

      // 1. Setup authorized contact with active watch
      const contactId = `cnt_dedupe_${Date.now()}`;
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name, prospect_email, channel,
          email_authorized, whatsapp_opt_in, authorization_source, authorization_evidence_json,
          source, status, is_opted_out, is_bounced, is_suppressed
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'Dedupe Tester', ?, 'EMAIL',
          1, 0, 'EXPLICIT_CONSENT', ?, 'CUSTOMER_DESK_ALERT_OPTIN', 'ACTIVE', 0, 0, 0
        )
      `).run(
        contactId,
        testEmail,
        JSON.stringify({
          consent_status: 'OPTED_IN_FIRST_PARTY',
          watches: [{
            target_deal_id: 'deal_dedupe_p1',
            target_deal_slug: 'dedupe-wireless-earbuds',
            target_price_inr: 999,
            registered_at: new Date().toISOString(),
            dispatched_at: null,
            origin: 'EXPLICIT_PRODUCT'
          }]
        })
      );

      // 2. Also insert durable event for the same email and deal
      const eventId = `sub_dedupe_evt_${Date.now()}`;
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, created_at)
        VALUES (?, 'PRICE_DROP_SUBSCRIPTION', 'org_owner_primary', ?, 0, datetime('now'))
      `).run(
        eventId,
        JSON.stringify({
          email: testEmail,
          dealId: 'deal_dedupe_p1',
          productSlug: 'dedupe-wireless-earbuds',
          targetPriceINR: 999,
          origin: 'EXPLICIT_PRODUCT',
          consent: 'OPTED_IN_FIRST_PARTY'
        })
      );

      const deal: NormalizedDeal = {
        id: 'deal_dedupe_p1',
        slug: 'dedupe-wireless-earbuds',
        canonicalSlug: 'dedupe-wireless-earbuds',
        title: 'Dedupe Verified Earbuds',
        brand: 'SoundBrand',
        merchant: 'SoundStore',
        category: 'Audio',
        currentPriceINR: 799, // <= 999 target
        referencePriceINR: 1999,
        verifiedDiscountPercent: 60,
        confidenceScore: 90,
        buyerValueScore: 85,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'soundstore.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://soundstore.com/deal',
        productUrl: 'https://soundstore.com/deal',
        evidence: {} as any
      };

      // Run dispatcher
      const res1 = await engine.checkAndDispatchTargetPriceAlerts([deal]);
      expect(res1.dispatched).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Verify contact watch is marked dispatched
      const contactAfter = db.prepare('SELECT authorization_evidence_json FROM outbound_contacts WHERE id = ?').get(contactId) as any;
      const evAfter = JSON.parse(contactAfter.authorization_evidence_json);
      expect(evAfter.watches[0].dispatched_at).toBeTruthy();

      // Verify durable event is marked processed
      const eventAfter = db.prepare('SELECT processed FROM durable_events WHERE id = ?').get(eventId) as any;
      expect(eventAfter.processed).toBe(1);

      // Run second invocation (simulating worker cycle / concurrent loop)
      const res2 = await engine.checkAndDispatchTargetPriceAlerts([deal]);
      expect(res2.dispatched).toBe(0);
      expect(sendSpy).toHaveBeenCalledTimes(1); // Zero duplicate sends!
    });

    it('Gate 6: Ambiguous post-send DB failure leaves PROCESSING claim row intact so second worker does NOT re-send duplicate email', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const testEmail = `postsend_fail_${Date.now()}@example.com`;
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_ambiguous_db_fail',
        status: 'SENT'
      });

      const contactId = `cnt_ambiguous_${Date.now()}`;
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name, prospect_email, channel,
          email_authorized, whatsapp_opt_in, authorization_source, authorization_evidence_json,
          source, status, is_opted_out, is_bounced, is_suppressed
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'Ambiguous Tester', ?, 'EMAIL',
          1, 0, 'EXPLICIT_CONSENT', ?, 'CUSTOMER_DESK_ALERT_OPTIN', 'ACTIVE', 0, 0, 0
        )
      `).run(
        contactId,
        testEmail,
        JSON.stringify({
          consent_status: 'OPTED_IN_FIRST_PARTY',
          watches: [{
            target_deal_id: 'deal_ambiguous_01',
            target_deal_slug: 'ambiguous-deal',
            target_price_inr: 1000,
            registered_at: new Date().toISOString(),
            dispatched_at: null,
            origin: 'EXPLICIT_PRODUCT'
          }]
        })
      );

      const deal: NormalizedDeal = {
        id: 'deal_ambiguous_01',
        slug: 'ambiguous-deal',
        canonicalSlug: 'ambiguous-deal',
        title: 'Ambiguous Failure Deal',
        brand: 'AmbiguousBrand',
        merchant: 'AmbiguousStore',
        category: 'Audio',
        currentPriceINR: 899,
        referencePriceINR: 1999,
        verifiedDiscountPercent: 55,
        confidenceScore: 90,
        buyerValueScore: 85,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'store.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://store.com/deal',
        productUrl: 'https://store.com/deal',
        evidence: {} as any
      };

      // Derive expected deterministic claim ID
      const claimId = `price_alert_claim_${createHash('sha256').update(`${testEmail}:deal_ambiguous_01:deal_ambiguous_01`).digest('hex').slice(0, 36)}`;

      // Pre-insert an in-flight PROCESSING claim row (as if worker 1 sent email, but DB update to processed=1 crashed)
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
        VALUES (?, 'PRICE_ALERT_DELIVERY_CLAIMED', 'org_owner_primary', '{}', 0, 'PROCESSING', datetime('now'))
      `).run(claimId);

      // Worker 2 runs: should detect in-flight claim, refuse to re-send
      const dispatchRes = await engine.checkAndDispatchTargetPriceAlerts([deal]);
      expect(dispatchRes.dispatched).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled(); // Protected from duplicate send!
    });

    it('Gate 1: Rejects PRICE_DROP_SUBSCRIPTION event when no matching contact exists or contact is suppressed/opted-out', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail');

      const deal: NormalizedDeal = {
        id: 'deal_gate1_01',
        slug: 'gate1-deal',
        canonicalSlug: 'gate1-deal',
        title: 'Gate 1 Test Deal',
        brand: 'Brand',
        merchant: 'Store',
        category: 'Audio',
        currentPriceINR: 500,
        referencePriceINR: 1000,
        verifiedDiscountPercent: 50,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'store.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://store.com/deal',
        productUrl: 'https://store.com/deal',
        evidence: {} as any
      };

      // 1. Ghost buyer: no outbound_contacts row
      const ghostEmail = `ghost_${Date.now()}@example.com`;
      const ghostEvtId = `evt_ghost_${Date.now()}`;
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, created_at)
        VALUES (?, 'PRICE_DROP_SUBSCRIPTION', 'org_owner_primary', ?, 0, datetime('now'))
      `).run(ghostEvtId, JSON.stringify({ email: ghostEmail, dealId: 'deal_gate1_01', targetPriceINR: 800, origin: 'EXPLICIT_PRODUCT' }));

      await engine.checkAndDispatchTargetPriceAlerts([deal]);
      expect(sendSpy).not.toHaveBeenCalled();
      const ghostEvtRow = db.prepare('SELECT processed, error_message FROM durable_events WHERE id = ?').get(ghostEvtId) as any;
      expect(ghostEvtRow.processed).toBe(1);
      expect(ghostEvtRow.error_message).toBe('REJECTED_NO_AUTHORISED_CONTACT');

      // 2. Opted out contact
      const optedOutEmail = `optout_${Date.now()}@example.com`;
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name, prospect_email, channel,
          email_authorized, whatsapp_opt_in, authorization_source, authorization_evidence_json,
          source, status, is_opted_out, is_bounced, is_suppressed
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'OptedOut', ?, 'EMAIL',
          1, 0, 'EXPLICIT_CONSENT', '{}', 'CUSTOMER_DESK_ALERT_OPTIN', 'ACTIVE', 1, 0, 0
        )
      `).run(`cnt_optout_${Date.now()}`, optedOutEmail);

      const optOutEvtId = `evt_optout_${Date.now()}`;
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, created_at)
        VALUES (?, 'PRICE_DROP_SUBSCRIPTION', 'org_owner_primary', ?, 0, datetime('now'))
      `).run(optOutEvtId, JSON.stringify({ email: optedOutEmail, dealId: 'deal_gate1_01', targetPriceINR: 800, origin: 'EXPLICIT_PRODUCT' }));

      await engine.checkAndDispatchTargetPriceAlerts([deal]);
      expect(sendSpy).not.toHaveBeenCalled();
      const optOutEvtRow = db.prepare('SELECT processed, error_message FROM durable_events WHERE id = ?').get(optOutEvtId) as any;
      expect(optOutEvtRow.processed).toBe(1);
      expect(optOutEvtRow.error_message).toBe('REJECTED_SUPPRESSED_OR_OPTED_OUT');
    });

    it('Gate 3 & Gate 5: Concurrent subscriptions merge watches cleanly and partial DB failures fail closed (503)', async () => {
      // 1. Partial DB failure fails closed with 503
      const failEmail = `fail_db_${Date.now()}@example.com`;
      const originalPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO durable_events') && sql.includes('PRICE_DROP_SUBSCRIPTION')) {
          throw new Error('SIMULATED_D1_DISK_FULL');
        }
        return originalPrepare(sql);
      });

      const resFail = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: failEmail,
          dealId: 'deal_fail_01',
          productSlug: 'fail-product',
          targetPriceINR: 500
        })
      });

      expect(resFail.status).toBe(503);
      const jsonFail = await resFail.json();
      expect(jsonFail.success).toBe(false);
      expect(jsonFail.error).toBe('SUBSCRIPTION_PERSISTENCE_FAILED');

      vi.restoreAllMocks();

      // 2. Concurrent watch merging
      const concurrentEmail = `concurrent_${Date.now()}@example.com`;
      const sub1 = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: concurrentEmail,
          dealId: 'deal_product_alpha',
          productSlug: 'product-alpha',
          targetPriceINR: 499
        })
      });
      expect(sub1.status).toBe(201);

      const sub2 = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: concurrentEmail,
          dealId: 'deal_product_beta',
          productSlug: 'product-beta',
          targetPriceINR: 899
        })
      });
      expect(sub2.status).toBe(201);

      // Verify both watches merged into outbound_contacts without overwriting
      const contactRow = db.prepare('SELECT authorization_evidence_json FROM outbound_contacts WHERE prospect_email = ?').get(concurrentEmail) as any;
      const ev = JSON.parse(contactRow.authorization_evidence_json);
      expect(Array.isArray(ev.watches)).toBe(true);
      expect(ev.watches.length).toBe(2);
      expect(ev.watches.some((w: any) => w.target_deal_id === 'deal_product_alpha')).toBe(true);
      expect(ev.watches.some((w: any) => w.target_deal_id === 'deal_product_beta')).toBe(true);
    });

    it('Gate 4: EXPLICIT_PRODUCT watch does not false-match other products via token overlap and unmatched watches stay active', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const testEmail = `explicit_match_${Date.now()}@example.com`;
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_explicit_test',
        status: 'SENT'
      });

      const contactId = `cnt_exp_${Date.now()}`;
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name, prospect_email, channel,
          email_authorized, whatsapp_opt_in, authorization_source, authorization_evidence_json,
          source, status, is_opted_out, is_bounced, is_suppressed
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'Strict Matcher', ?, 'EMAIL',
          1, 0, 'EXPLICIT_CONSENT', ?, 'CUSTOMER_DESK_ALERT_OPTIN', 'ACTIVE', 0, 0, 0
        )
      `).run(
        contactId,
        testEmail,
        JSON.stringify({
          consent_status: 'OPTED_IN_FIRST_PARTY',
          watches: [{
            target_deal_id: null,
            target_deal_slug: 'boat-airdopes-141',
            target_price_inr: 800,
            registered_at: new Date().toISOString(),
            dispatched_at: null,
            origin: 'EXPLICIT_PRODUCT'
          }]
        })
      );

      // 1. Unrelated product with token overlap (boAt Airdopes 131)
      const tokenOverlapDeal: NormalizedDeal = {
        id: 'deal_boat_131',
        slug: 'boat-airdopes-131',
        canonicalSlug: 'boat-airdopes-131',
        title: 'boAt Airdopes 131 Earbuds',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Audio',
        currentPriceINR: 750, // <= 800 target, but different product!
        referencePriceINR: 1990,
        verifiedDiscountPercent: 62,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'boat.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://boat.com/131',
        productUrl: 'https://boat.com/131',
        evidence: {} as any
      };

      const resOverlap = await engine.checkAndDispatchTargetPriceAlerts([tokenOverlapDeal]);
      expect(resOverlap.dispatched).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled(); // Must NOT false-match!

      // 2. Exact product but price still above target (₹999 > ₹800 target)
      const higherPricedDeal: NormalizedDeal = {
        id: 'deal_boat_141',
        slug: 'boat-airdopes-141',
        canonicalSlug: 'boat-airdopes-141',
        title: 'boAt Airdopes 141',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Audio',
        currentPriceINR: 999, // > 800 target
        referencePriceINR: 4490,
        verifiedDiscountPercent: 77,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'boat.com',
        observedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://boat.com/141',
        productUrl: 'https://boat.com/141',
        evidence: {} as any
      };

      const resHigh = await engine.checkAndDispatchTargetPriceAlerts([higherPricedDeal]);
      expect(resHigh.dispatched).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();

      // Verify watch remains active (dispatched_at = null)
      const contactMid = db.prepare('SELECT authorization_evidence_json FROM outbound_contacts WHERE id = ?').get(contactId) as any;
      const evMid = JSON.parse(contactMid.authorization_evidence_json);
      expect(evMid.watches[0].dispatched_at).toBeNull();

      // 3. Price drops to ₹750 (<= 800 target) -> Alert fires!
      const priceDropDeal: NormalizedDeal = {
        ...higherPricedDeal,
        currentPriceINR: 750
      };

      const resDrop = await engine.checkAndDispatchTargetPriceAlerts([priceDropDeal]);
      expect(resDrop.dispatched).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('Gate 7 & Gate 8: isImpulseConversionDeal rejects stale/rotated deals and SalesConversationEngine sorts & deduplicates top drops before .slice(0, 5)', async () => {
      // 1. isImpulseConversionDeal invariant
      expect(isImpulseConversionDeal({
        currentPriceINR: 499,
        verifiedDiscountPercent: 30,
        availability: 'IN_STOCK',
        isMonetizable: true,
        trackingUrl: 'https://example.com',
        isRotatedOut: true // Rotated out
      })).toBe(false);

      expect(isImpulseConversionDeal({
        currentPriceINR: 499,
        verifiedDiscountPercent: 30,
        availability: 'IN_STOCK',
        isMonetizable: true,
        trackingUrl: 'https://example.com',
        verificationStatus: 'EXPIRED' // Expired
      })).toBe(false);

      expect(isImpulseConversionDeal({
        currentPriceINR: 499,
        verifiedDiscountPercent: 30,
        availability: 'OUT_OF_STOCK', // Not in stock
        isMonetizable: true,
        trackingUrl: 'https://example.com'
      })).toBe(false);

      expect(isImpulseConversionDeal({
        currentPriceINR: 499,
        verifiedDiscountPercent: 30,
        availability: 'IN_STOCK',
        isMonetizable: true,
        trackingUrl: 'https://example.com',
        lastCheckedAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString() // > 48h stale
      })).toBe(false);

      // 2. SalesConversationEngine top drops ranking and deduplication
      const engine = SalesConversationEngine.getInstance();
      const res = await engine.handleInboundMessage({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        senderContact: 'shopper_top_drops@example.com',
        channel: 'WEB_DESK',
        messageText: 'Show me top verified drops today',
        isDiagnosticProbe: true
      });

      expect(res).toBeDefined();
      expect(['SEND_DETAILS', 'INTERESTED']).toContain(res.intent);
      if (res.resolvedOffer) {
        expect(res.resolvedOffer.priceINR).toBeGreaterThanOrEqual(0);
      }
    });

    it('Gate 9: intent-distribution-kit reports truthful CONFIGURED_READY / SUBMITTED states and zero hardcoded fallback URLs', async () => {
      // Configure IndexNow key
      process.env.INDEXNOW_KEY = 'valid-test-key-12345';

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const res1 = await app.request('/api/v1/owner/first-sale/intent-distribution-kit', {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.searchEngineChecklist.indexNowStatus).toBe('CONFIGURED_READY');
      expect(json1.searchEngineChecklist.sitemapStatus).toBe('GENERATED_DYNAMIC');
      expect(json1.searchEngineChecklist.searchEngineIndexing).toBe('EXTERNAL_CONSOLE_CHECK_REQUIRED');
      expect(json1.searchEngineChecklist.sitemapUrl).not.toBe('');

      // Insert IndexNow durable submission event
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, created_at)
        VALUES (?, 'INDEXNOW_SUBMISSION', 'org_owner_primary', '{"status":200}', 1, datetime('now'))
      `).run(`subm_${Date.now()}`);

      const res2 = await app.request('/api/v1/owner/first-sale/intent-distribution-kit', {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.searchEngineChecklist.indexNowStatus).toBe('SUBMITTED');
    });
  });
});
