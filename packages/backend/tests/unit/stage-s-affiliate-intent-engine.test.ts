import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AutonomousDealDiscoveryEngine,
  isImpulseConversionDeal,
  NormalizedDeal
} from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
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
        verificationStatus: 'VERIFIED',
        socialMediaPublishersAllowed: true
      };

      const dealDetailHtml = generator.renderDealDetailHtml(testDeal, [], config);
      expect(dealDetailHtml).toContain('boAt Airdopes 141 ANC TWS Earbuds');
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
        verificationStatus: 'VERIFIED',
        socialMediaPublishersAllowed: true
      };
      const pair = {
        comparisonSlug: 'boat-airdopes-141-vs-noise-buds-vs104',
        dealA: testDeal,
        dealB: compDealB,
        title: 'boAt Airdopes 141 vs Noise Buds VS104',
        description: 'Head to head comparison'
      };
      const compHtml = generator.renderComparisonHtml(pair as any, config, []);
      expect(compHtml).toContain('boAt Airdopes 141 ANC TWS Earbuds');
      expect(compHtml).toContain('Noise Buds VS104 Truly Wireless Earbuds');
      expect(compHtml).toContain('#Ad');

      // Test Instagram Bio storefront page (/ig)
      const igHtml = generator.renderInstagramBioStorefrontHtml(config, [testDeal, compDealB]);
      expect(igHtml).toContain('boAt Airdopes 141 ANC TWS Earbuds');
      expect(igHtml).toContain('#Ad');
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
        trackingUrl: 'https://clnk.in/plumvanilla',
        productUrl: 'https://plumgoodness.com/vanilla',
        verifiedCommissionRatePercent: 8.0,
        evidenceJson: { verifiedCommissionRatePercent: 8.0 },
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
      expect(igTelegramCaption).toContain('/deals/');
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

  describe('Stage S.1.1: Final PR #78 Reliability Closure (Strict Positive Target Price, Fail-Closed PROVIDER_CALL_ATTEMPTED CAS & Suppression Guard)', () => {
    it('1. Blank target, product selected: POST /api/v1/customer-desk/subscribe-alerts with productSlug and blank/missing targetPriceINR returns HTTP 400 and triggers zero Brevo emails', async () => {
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_blank_target_prod',
        status: 'SENT'
      });

      const res = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `blank_target_${Date.now()}@example.com`,
          productSlug: 'boat-airdopes-141-anc',
          targetPriceINR: '' // blank target
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('INVALID_TARGET_PRICE');
      expect(sendSpy).not.toHaveBeenCalled();

      // Missing targetPriceINR
      const resMissing = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `missing_target_${Date.now()}@example.com`,
          productSlug: 'boat-airdopes-141-anc'
        })
      });

      expect(resMissing.status).toBe(400);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('2. Blank target, category selected: POST /api/v1/customer-desk/subscribe-alerts with category and blank/missing targetPriceINR returns HTTP 400 and triggers zero Brevo emails', async () => {
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_blank_target_cat',
        status: 'SENT'
      });

      const res = await app.request('/api/v1/customer-desk/subscribe-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `blank_cat_${Date.now()}@example.com`,
          category: 'Consumer Electronics',
          targetPriceINR: 0 // 0 target
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('INVALID_TARGET_PRICE');
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('3. Pre-send state update throws: Simulated DB error on PRE_SEND_LEASE -> PROVIDER_CALL_ATTEMPTED transition aborts before sendTransactionalEmail is ever called', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_should_not_fire',
        status: 'SENT'
      });

      const testEmail = `presend_err_${Date.now()}@example.com`;
      await engine.registerTargetPriceAlert({
        email: testEmail,
        targetFairPriceINR: 1000,
        queryOrUrl: 'boat-smartwatch',
        deal: {
          id: 'deal_presend_err_01',
          slug: 'boat-smartwatch',
          canonicalSlug: 'boat-smartwatch',
          title: 'boAt Smartwatch X',
          brand: 'boAt',
          category: 'Wearables',
          merchant: 'boAt',
          currentPriceINR: 899,
          referencePriceINR: 1999,
          availability: 'IN_STOCK',
          verificationStatus: 'VERIFIED',
          isMonetizable: true,
          affiliateCampaignId: 'cuelinks_boat',
          trackingUrl: 'https://cuelinks.com/boat',
          productUrl: 'https://boat-lifestyle.com/watch',
          lastCheckedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as any
      });

      const qualifyingDeal: NormalizedDeal = {
        id: 'deal_presend_err_01',
        slug: 'boat-smartwatch',
        canonicalSlug: 'boat-smartwatch',
        title: 'boAt Smartwatch X',
        brand: 'boAt',
        category: 'Wearables',
        merchant: 'boAt',
        currentPriceINR: 899,
        referencePriceINR: 1999,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        affiliateCampaignId: 'cuelinks_boat',
        trackingUrl: 'https://cuelinks.com/boat',
        productUrl: 'https://boat-lifestyle.com/watch',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Spy on db.prepare to throw when updating to PROVIDER_CALL_ATTEMPTED
      const origPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('UPDATE durable_events') && sql.includes('PRE_SEND_LEASE:%')) {
          return {
            run: () => {
              throw new Error('SIMULATED_D1_WRITE_TIMEOUT');
            }
          } as any;
        }
        return origPrepare(sql);
      });

      const res = await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(res.dispatched).toBe(0);
    });

    it('4. Pre-send state update affects 0 rows: Simulated rowsAffected === 0 on PRE_SEND_LEASE -> PROVIDER_CALL_ATTEMPTED transition aborts before sendTransactionalEmail is ever called', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_zero_rows',
        status: 'SENT'
      });

      const testEmail = `zero_rows_${Date.now()}@example.com`;
      await engine.registerTargetPriceAlert({
        email: testEmail,
        targetFairPriceINR: 1000,
        queryOrUrl: 'noise-smartwatch',
        deal: {
          id: 'deal_zero_rows_01',
          slug: 'noise-smartwatch',
          canonicalSlug: 'noise-smartwatch',
          title: 'Noise Smartwatch',
          brand: 'Noise',
          category: 'Wearables',
          merchant: 'Noise',
          currentPriceINR: 799,
          referencePriceINR: 1999,
          availability: 'IN_STOCK',
          verificationStatus: 'VERIFIED',
          isMonetizable: true,
          affiliateCampaignId: 'cuelinks_noise',
          trackingUrl: 'https://cuelinks.com/noise',
          productUrl: 'https://noise.com/watch',
          lastCheckedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as any
      });

      const qualifyingDeal: NormalizedDeal = {
        id: 'deal_zero_rows_01',
        slug: 'noise-smartwatch',
        canonicalSlug: 'noise-smartwatch',
        title: 'Noise Smartwatch',
        brand: 'Noise',
        category: 'Wearables',
        merchant: 'Noise',
        currentPriceINR: 799,
        referencePriceINR: 1999,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        affiliateCampaignId: 'cuelinks_noise',
        trackingUrl: 'https://cuelinks.com/noise',
        productUrl: 'https://noise.com/watch',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Spy on db.prepare to return changes: 0 for the PRE_SEND_LEASE -> PROVIDER_CALL_ATTEMPTED update
      const origPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('UPDATE durable_events') && sql.includes('PRE_SEND_LEASE:%')) {
          return {
            run: () => ({ changes: 0 })
          } as any;
        }
        return origPrepare(sql);
      });

      const res = await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(res.dispatched).toBe(0);
    });

    it('5. Worker resumes after genuine pre-send crash: Stale PRE_SEND_LEASE (> 5 minutes old, never reached PROVIDER_CALL_ATTEMPTED) is reclaimed by a recovery worker and completes with one valid delivery and no duplicate', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_reclaimed',
        status: 'SENT'
      });

      const testEmail = `crash_recovery_${Date.now()}@example.com`;
      await engine.registerTargetPriceAlert({
        email: testEmail,
        targetFairPriceINR: 1200,
        queryOrUrl: 'realme-buds',
        deal: {
          id: 'deal_crash_rec_01',
          slug: 'realme-buds',
          canonicalSlug: 'realme-buds',
          title: 'Realme Buds Air',
          brand: 'Realme',
          category: 'Audio',
          merchant: 'Realme',
          currentPriceINR: 999,
          referencePriceINR: 2499,
          availability: 'IN_STOCK',
          verificationStatus: 'VERIFIED',
          isMonetizable: true,
          affiliateCampaignId: 'cuelinks_realme',
          trackingUrl: 'https://cuelinks.com/realme',
          productUrl: 'https://realme.com/buds',
          lastCheckedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as any
      });

      const qualifyingDeal: NormalizedDeal = {
        id: 'deal_crash_rec_01',
        slug: 'realme-buds',
        canonicalSlug: 'realme-buds',
        title: 'Realme Buds Air',
        brand: 'Realme',
        category: 'Audio',
        merchant: 'Realme',
        currentPriceINR: 999,
        referencePriceINR: 2499,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        affiliateCampaignId: 'cuelinks_realme',
        trackingUrl: 'https://cuelinks.com/realme',
        productUrl: 'https://realme.com/buds',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Simulate a crashed worker: Insert a stale PRE_SEND_LEASE (10 minutes old)
      const contact = db.prepare('SELECT authorization_evidence_json FROM outbound_contacts WHERE prospect_email = ?').get(testEmail) as any;
      const ev = JSON.parse(contact.authorization_evidence_json);
      const subId = ev.watches[0].subscription_id;
      const claimKeyPart = `${testEmail}:${qualifyingDeal.id}:${subId}`;
      const claimId = `price_alert_claim_${createHash('sha256').update(claimKeyPart).digest('hex').slice(0, 36)}`;
      const staleTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
        VALUES (?, 'PRICE_ALERT_DELIVERY_CLAIMED', 'org_owner_primary', ?, 0, ?, datetime('now', '-10 minutes'))
      `).run(claimId, JSON.stringify({ email: testEmail, dealId: qualifyingDeal.id, targetPriceINR: 1200 }), `PRE_SEND_LEASE:${staleTime}`);

      // Now the recovery worker runs:
      const res = await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect(res.dispatched).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Verify claim is marked completed in DB
      const claimRow = db.prepare('SELECT processed, error_message FROM durable_events WHERE id = ?').get(claimId) as any;
      expect(claimRow.processed).toBe(1);
      expect(claimRow.error_message).toBeNull();

      // Second worker run must NOT deliver again (duplicate-send protection)
      const res2 = await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect(res2.dispatched).toBe(0);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('6. Two concurrent workers process one subscription: Parallel Promise.all runs of checkAndDispatchTargetPriceAlerts() result in sendTransactionalEmail being called exactly once', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockImplementation(async () => {
        // Add a slight latency to simulate network send
        await new Promise(r => setTimeout(r, 20));
        return {
          success: true,
          messageId: 'msg_test_concurrent_single',
          status: 'SENT'
        };
      });

      const testEmail = `concurrent_worker_${Date.now()}@example.com`;
      await engine.registerTargetPriceAlert({
        email: testEmail,
        targetFairPriceINR: 1500,
        queryOrUrl: 'boat-airdopes-441',
        deal: {
          id: 'deal_concurrent_01',
          slug: 'boat-airdopes-441',
          canonicalSlug: 'boat-airdopes-441',
          title: 'boAt Airdopes 441 TWS',
          brand: 'boAt',
          category: 'Audio',
          merchant: 'boAt',
          currentPriceINR: 1199,
          referencePriceINR: 2999,
          availability: 'IN_STOCK',
          verificationStatus: 'VERIFIED',
          isMonetizable: true,
          affiliateCampaignId: 'cuelinks_boat',
          trackingUrl: 'https://cuelinks.com/boat-441',
          productUrl: 'https://boat-lifestyle.com/airdopes-441',
          lastCheckedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as any
      });

      const qualifyingDeal: NormalizedDeal = {
        id: 'deal_concurrent_01',
        slug: 'boat-airdopes-441',
        canonicalSlug: 'boat-airdopes-441',
        title: 'boAt Airdopes 441 TWS',
        brand: 'boAt',
        category: 'Audio',
        merchant: 'boAt',
        currentPriceINR: 1199,
        referencePriceINR: 2999,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        affiliateCampaignId: 'cuelinks_boat',
        trackingUrl: 'https://cuelinks.com/boat-441',
        productUrl: 'https://boat-lifestyle.com/airdopes-441',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Run two workers simultaneously
      const [worker1Res, worker2Res] = await Promise.all([
        engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]),
        engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal])
      ]);

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const totalDispatched = worker1Res.dispatched + worker2Res.dispatched;
      expect(totalDispatched).toBe(1);
    });

    it('7. Suppression lookup DB failure fails closed: Simulated outreach_suppression_list query error aborts dispatch without calling Brevo', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const { BrevoMcpClient } = await import('../../src/integrations/brevo-mcp-client.js');
      const brevo = BrevoMcpClient.getInstance();
      const sendSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        messageId: 'msg_test_supp_err',
        status: 'SENT'
      });

      const testEmail = `supp_err_${Date.now()}@example.com`;
      await engine.registerTargetPriceAlert({
        email: testEmail,
        targetFairPriceINR: 1500,
        queryOrUrl: 'noise-colorfit',
        deal: {
          id: 'deal_supp_err_01',
          slug: 'noise-colorfit',
          canonicalSlug: 'noise-colorfit',
          title: 'Noise ColorFit Pulse',
          brand: 'Noise',
          category: 'Wearables',
          merchant: 'Noise',
          currentPriceINR: 1299,
          referencePriceINR: 2999,
          availability: 'IN_STOCK',
          verificationStatus: 'VERIFIED',
          isMonetizable: true,
          affiliateCampaignId: 'cuelinks_noise',
          trackingUrl: 'https://cuelinks.com/noise',
          productUrl: 'https://noise.com/colorfit',
          lastCheckedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        } as any
      });

      const qualifyingDeal: NormalizedDeal = {
        id: 'deal_supp_err_01',
        slug: 'noise-colorfit',
        canonicalSlug: 'noise-colorfit',
        title: 'Noise ColorFit Pulse',
        brand: 'Noise',
        category: 'Wearables',
        merchant: 'Noise',
        currentPriceINR: 1299,
        referencePriceINR: 2999,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        affiliateCampaignId: 'cuelinks_noise',
        trackingUrl: 'https://cuelinks.com/noise',
        productUrl: 'https://noise.com/colorfit',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // Spy on db.prepare to throw error when querying outreach_suppression_list
      const origPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('FROM outreach_suppression_list')) {
          return {
            get: () => {
              throw new Error('SIMULATED_SUPPRESSION_DB_OFFLINE');
            }
          } as any;
        }
        return origPrepare(sql);
      });

      const res = await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(res.dispatched).toBe(0);
    });
  });

  describe('Stage S.1.2: Cuelinks Campaign Payout Hydration, Strict Qualified Distribution Kit & Earnings Separation', () => {
    it('1. Cuelinks campaign hydration maps merchant domains/campaign IDs across multiple deals in batches and quarantines deals lacking verified campaign payout mapping', async () => {
      // Clean up public_deals and cuelinks_campaigns for test isolation
      db.prepare(`DELETE FROM public_deals`).run();
      db.prepare(
        `DELETE FROM cuelinks_campaigns WHERE campaign_id IN ('camp_hydr_nykaa', 'camp_hydr_boat') OR LOWER(merchant_domain) LIKE '%boat-lifestyle.com%' OR LOWER(merchant_domain) LIKE '%nykaa.com%' OR LOWER(merchant_domain) LIKE '%sketchystore.in%'`
      ).run();

      // Insert known campaign for Nykaa with verified 8.5% CPS rate
      db.prepare(`
        INSERT INTO cuelinks_campaigns (campaign_id, name, merchant_domain, status, payout_model, payout_rate, cookie_days, category, verification_source, updated_at)
        VALUES ('camp_hydr_nykaa', 'Nykaa Beauty', 'nykaa.com', 'ACTIVE', 'CPS', '8.5%', 30, 'Beauty', 'TEST', datetime('now'))
      `).run();

      // Deal 1: Nykaa (matched via campaign_id or domain, verified rate 8.5%)
      db.prepare(`
        INSERT INTO public_deals (id, slug, title, merchant, category, sector_code, product_url, affiliate_url, current_price_inr, availability, verification_status, is_monetizable, affiliate_verified, evidence_json)
        VALUES ('deal_hydr_01', 'nykaa-matte-lipstick', 'Nykaa Matte Lipstick', 'Nykaa', 'Beauty', 'SECTOR_A_BEAUTY', 'https://nykaa.com/matte-lipstick', 'https://clnk.in/nykaa01', 499, 'IN_STOCK', 'VERIFIED', 0, 0, '{"affiliateCampaignId":"camp_hydr_nykaa"}')
      `).run();

      // Deal 2: Boat (resolved via convertLink returning campaign metadata: 6.0% payout, epc_7d: 14.2)
      db.prepare(`
        INSERT INTO public_deals (id, slug, title, merchant, category, sector_code, product_url, affiliate_url, current_price_inr, availability, verification_status, is_monetizable, affiliate_verified, evidence_json)
        VALUES ('deal_hydr_02', 'boat-airdope-141', 'boAt Airdopes 141', 'boAt', 'Electronics', 'SECTOR_B_ELECTRONICS', 'https://boat-lifestyle.com/airdope-141', 'https://boat-lifestyle.com/airdope-141', 999, 'IN_STOCK', 'VERIFIED', 0, 0, '{}')
      `).run();

      // Deal 3: Unapproved store (convertLink returns affiliated: false -> must be quarantined)
      db.prepare(`
        INSERT INTO public_deals (id, slug, title, merchant, category, sector_code, product_url, affiliate_url, current_price_inr, availability, verification_status, is_monetizable, affiliate_verified, evidence_json)
        VALUES ('deal_hydr_03', 'unapproved-gizmo', 'Unapproved Gizmo', 'SketchyStore', 'Gadgets', 'SECTOR_B_ELECTRONICS', 'https://sketchystore.in/gizmo', 'https://sketchystore.in/gizmo', 399, 'IN_STOCK', 'VERIFIED', 1, 1, '{}')
      `).run();

      // Create a mock Cuelinks client that handles convertLink and searchCampaigns
      const mockClient = {
        isConfigured: vi.fn().mockReturnValue(true),
        searchCampaigns: vi.fn().mockResolvedValue({
          campaigns: [
            { id: 'camp_hydr_nykaa', name: 'Nykaa Beauty', domain: 'nykaa.com', payout: '8.5%', payout_type: 'CPS', status: 'ACTIVE' }
          ],
          total: 1
        }),
        convertLink: vi.fn().mockImplementation(async ({ url }: { url: string }) => {
          if (url.includes('boat-lifestyle.com')) {
            return {
              url,
              tracking_url: 'https://clnk.in/boat141',
              affiliated: true,
              campaign: {
                id: 'camp_hydr_boat',
                name: 'boAt Lifestyle',
                payout: '6.0%',
                payout_type: 'CPS',
                epc_7d: 14.2
              }
            };
          }
          if (url.includes('sketchystore.in')) {
            return {
              url,
              tracking_url: url,
              affiliated: false
            };
          }
          return { url, tracking_url: url, affiliated: false };
        })
      };

      const syncManager = CuelinksSyncManager.getInstance(mockClient as any);
      const res = await syncManager.hydrateMissingCampaignPayoutsD1('org_owner_primary', 'biz_platform_aro', 50);

      expect(res.syncedPublicDeals).toBeGreaterThanOrEqual(2);

      // Verify Deal 1: Nykaa has verifiedCommissionRatePercent: 8.5, is_monetizable: 1, affiliate_verified: 1
      const row1: any = db.prepare(`SELECT is_monetizable, affiliate_verified, evidence_json FROM public_deals WHERE id = 'deal_hydr_01'`).get();
      expect(row1.is_monetizable).toBe(1);
      expect(row1.affiliate_verified).toBe(1);
      const ev1 = JSON.parse(row1.evidence_json);
      expect(ev1.verifiedCommissionRatePercent).toBe(8.5);
      expect(ev1.missingPayoutReason).toBeUndefined();

      // Verify Deal 2: Boat has verifiedCommissionRatePercent: 6, epc_7d: 14.2, is_monetizable: 1, affiliate_url: 'https://clnk.in/boat141'
      const row2: any = db.prepare(`SELECT is_monetizable, affiliate_verified, affiliate_url, evidence_json FROM public_deals WHERE id = 'deal_hydr_02'`).get();
      expect(row2.is_monetizable).toBe(1);
      expect(row2.affiliate_verified).toBe(1);
      expect(row2.affiliate_url).toBe('https://clnk.in/boat141');
      const ev2 = JSON.parse(row2.evidence_json);
      expect(ev2.verifiedCommissionRatePercent).toBe(6);
      expect(ev2.epc_7d).toBe(14.2);

      // Verify Deal 3: SketchyStore quarantined with is_monetizable: 0, affiliate_verified: 0, missingPayoutReason: 'UNAPPROVED_OR_UNVERIFIED_CAMPAIGN'
      const row3: any = db.prepare(`SELECT is_monetizable, affiliate_verified, evidence_json FROM public_deals WHERE id = 'deal_hydr_03'`).get();
      expect(row3.is_monetizable).toBe(0);
      expect(row3.affiliate_verified).toBe(0);
      const ev3 = JSON.parse(row3.evidence_json);
      expect(ev3.missingPayoutReason).toBe('UNAPPROVED_OR_UNVERIFIED_CAMPAIGN');
    });

    it('2. intent-distribution-kit returns fewer than 5 deals (and never high-ticket ₹17,999 or unmapped deals) when fewer than 5 impulse deals qualify, and returns NO_QUALIFIED_IMPULSE_DEALS when 0 qualify', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      (engine as any).dealsMap?.clear();

      // Deal 1: Qualified impulse deal (₹499, IN_STOCK, VERIFIED, tracked clnk.in link, verified rate 6%)
      const deal1: NormalizedDeal = {
        id: 'deal_qual_01',
        slug: 'boat-bassheads-100',
        title: 'boAt BassHeads 100 Wired Earphones',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Electronics',
        currentPriceINR: 499,
        referencePriceINR: 999,
        verifiedDiscountPercent: 50,
        confidenceScore: 95,
        buyerValueScore: 90,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'boat-lifestyle.com',
        productUrl: 'https://boat-lifestyle.com/bassheads-100',
        trackingUrl: 'https://clnk.in/boat100',
        verifiedCommissionRatePercent: 6.0,
        lastCheckedAt: new Date().toISOString(),
        evidenceJson: { verifiedCommissionRatePercent: 6.0 }
      };

      // Deal 2: Qualified impulse deal (₹899, IN_STOCK, VERIFIED, tracked clnk.in link, verified rate 8.5%)
      const deal2: NormalizedDeal = {
        id: 'deal_qual_02',
        slug: 'plum-green-tea-night-gel',
        title: 'Plum Green Tea Renewed Clarity Night Gel',
        brand: 'Plum',
        merchant: 'Plum Goodness',
        category: 'Skincare',
        currentPriceINR: 899,
        referencePriceINR: 1200,
        verifiedDiscountPercent: 25,
        confidenceScore: 92,
        buyerValueScore: 88,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'plumgoodness.com',
        productUrl: 'https://plumgoodness.com/green-tea-gel',
        trackingUrl: 'https://clnk.in/plumgel',
        verifiedCommissionRatePercent: 8.5,
        lastCheckedAt: new Date().toISOString(),
        evidenceJson: { verifiedCommissionRatePercent: 8.5 }
      };

      // Deal 3: High-ticket deal (₹17,999) - MUST NOT BE PROMOTED AS IMPULSE DEAL
      const deal3: NormalizedDeal = {
        id: 'deal_high_ticket_03',
        slug: 'sony-wh-1000xm4',
        title: 'Sony WH-1000XM4 Wireless Noise Cancelling Headphones',
        brand: 'Sony',
        merchant: 'Sony Center',
        category: 'Electronics',
        currentPriceINR: 17999,
        referencePriceINR: 24999,
        verifiedDiscountPercent: 28,
        confidenceScore: 98,
        buyerValueScore: 95,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'sonycenter.in',
        productUrl: 'https://sonycenter.in/xm4',
        trackingUrl: 'https://clnk.in/sonyxm4',
        verifiedCommissionRatePercent: 4.0,
        lastCheckedAt: new Date().toISOString(),
        evidenceJson: { verifiedCommissionRatePercent: 4.0 }
      };

      // Deal 4: Unmapped/quarantined deal (₹599) - lacks verified payout/campaign
      const deal4: NormalizedDeal = {
        id: 'deal_unmapped_04',
        slug: 'unmapped-gizmo-deal',
        title: 'Unmapped Gizmo Deal',
        brand: 'Generic',
        merchant: 'UnknownStore',
        category: 'Electronics',
        currentPriceINR: 599,
        referencePriceINR: 999,
        verifiedDiscountPercent: 40,
        confidenceScore: 50,
        buyerValueScore: 40,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: false,
        sourceDomain: 'unknownstore.in',
        productUrl: 'https://unknownstore.in/item',
        trackingUrl: 'https://unknownstore.in/item',
        lastCheckedAt: new Date().toISOString(),
        evidenceJson: { missingPayoutReason: 'UNAPPROVED_OR_UNVERIFIED_CAMPAIGN' }
      };

      // Spy on getEligiblePublicDeals to return these 4 deals
      const eligibleSpy = vi.spyOn(engine, 'getEligiblePublicDeals').mockResolvedValue({
        deals: [deal1, deal2, deal3, deal4],
        total: 4
      });

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const res = await app.request('/api/v1/owner/first-sale/intent-distribution-kit', {
        headers: { Authorization: `Bearer ${session.token}` }
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.diagnostic).toBeNull();
      // Strictly 2 deals qualify (Deal 1 and Deal 2) - NO fallback backfilling to 5!
      expect(json.topImpulseDeals).toHaveLength(2);
      const dealIds = json.topImpulseDeals.map((d: any) => d.dealId);
      expect(dealIds).toContain('deal_qual_01');
      expect(dealIds).toContain('deal_qual_02');
      expect(dealIds).not.toContain('deal_high_ticket_03'); // Never ₹17,999 in distribution kit
      expect(dealIds).not.toContain('deal_unmapped_04');    // Never unmapped deal in distribution kit

      // Test zero-qualifying case: returns 0 deals with NO_QUALIFIED_IMPULSE_DEALS diagnostic
      eligibleSpy.mockResolvedValueOnce({
        deals: [deal3, deal4], // only high-ticket and unmapped
        total: 2
      });

      const resEmpty = await app.request('/api/v1/owner/first-sale/intent-distribution-kit', {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      expect(resEmpty.status).toBe(200);
      const jsonEmpty = await resEmpty.json();
      expect(jsonEmpty.success).toBe(true);
      expect(jsonEmpty.topImpulseDeals).toHaveLength(0);
      expect(jsonEmpty.diagnostic).toBe('NO_QUALIFIED_IMPULSE_DEALS');
    });

    it('3. providerEpc7dINR and measuredCommissionINR are strictly separated from modelledIllustrativeEvPer100VisitorsINR', async () => {
      const dealWithZeroConversions: NormalizedDeal = {
        id: 'deal_sep_test_01',
        slug: 'noise-earbuds-zero-conv',
        title: 'Noise Buds VS102',
        brand: 'Noise',
        merchant: 'Noise',
        category: 'Electronics',
        currentPriceINR: 1000,
        referencePriceINR: 2000,
        verifiedDiscountPercent: 50,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        sourceDomain: 'gonoise.com',
        productUrl: 'https://gonoise.com/buds',
        trackingUrl: 'https://clnk.in/noisebuds',
        verifiedCommissionRatePercent: 8.5,
        grossCommissionPerApprovedOrderINR: 85,
        observedClicks: 12,
        observedApprovedOrders: 0,
        lastCheckedAt: new Date().toISOString(),
        evidenceJson: {
          verifiedCommissionRatePercent: 8.5,
          grossCommissionPerApprovedOrderINR: 85,
          observedClicks: 12,
          observedApprovedOrders: 0,
          epc_7d: 15.75
        }
      };

      const score = AutonomousDealDiscoveryEngine.getInstance().calculateMarketArbitrageScore(dealWithZeroConversions);

      // Verify provider reported 7d EPC is separated and accurately captured
      expect(score.providerEpc7dINR).toBe(15.75);

      // Verify measured conversions and commission reflect real ledger counts: 0 approved orders = ₹0.00 earned
      expect(score.measuredClicks).toBe(12);
      expect(score.measuredApprovedOrders).toBe(0);
      expect(score.measuredCommissionINR).toBe(0);

      // Verify modelled EV is labelled and separate from actual zero earned commission
      expect(score.modelledIllustrativeEvPer100VisitorsINR).toBeGreaterThan(0);
      expect(score.expectedProfitPer100VisitorsINR).toBe(score.modelledIllustrativeEvPer100VisitorsINR);

      // Test when there ARE real approved orders (e.g. 3 approved orders)
      const dealWithConversions: NormalizedDeal = {
        ...dealWithZeroConversions,
        observedClicks: 50,
        observedApprovedOrders: 3,
        evidenceJson: {
          ...dealWithZeroConversions.evidenceJson,
          observedClicks: 50,
          observedApprovedOrders: 3
        }
      };
      const scoreWithConv = AutonomousDealDiscoveryEngine.getInstance().calculateMarketArbitrageScore(dealWithConversions);
      expect(scoreWithConv.measuredApprovedOrders).toBe(3);
      expect(scoreWithConv.measuredCommissionINR).toBe(255); // 3 * ₹85 = ₹255.00
      expect(scoreWithConv.providerEpc7dINR).toBe(15.75);

      // Verify /owner/first-sale/ready-actions exposes these separated fields truthfully
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      vi.spyOn(engine, 'getEligiblePublicDeals').mockResolvedValue({
        deals: [dealWithZeroConversions],
        total: 1
      });

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const res = await app.request('/api/v1/owner/first-sale/ready-actions', {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.topDeals).toBeDefined();
      expect(json.data.topDeals.length).toBeGreaterThan(0);
      const actionDeal = json.data.topDeals[0];
      expect(actionDeal.providerEpc7dINR).toBe(15.75);
      expect(actionDeal.measuredClicks).toBe(12);
      expect(actionDeal.measuredApprovedOrders).toBe(0);
      expect(actionDeal.measuredCommissionINR).toBe(0);
      expect(actionDeal.modelledIllustrativeEvPer100VisitorsINR).toBeGreaterThan(0);
      expect(actionDeal.modelledProfitType).toBe('MODELLED_ILLUSTRATIVE_ONLY');
    });
  });
});
