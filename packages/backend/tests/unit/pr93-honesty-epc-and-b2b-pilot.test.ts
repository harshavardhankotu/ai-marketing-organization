/**
 * PR #93 Regression Test Suite:
 * - Real structured Gemini synthesis in ContentAssetEngine (0 calls on fallback)
 * - Static timestamps and positive EPC in starter-deals and Cuelinks discovery
 * - Daily cumulative background D1 budget cap (250,000 rows/day)
 * - Google PageSpeed 400/429 graceful degradation to honest pageSpeedStatus
 * - Done-For-You B2B pilot proposal generation with zero unbacked rupee/ranking claims
 * - Honest YouTube review links labeling & validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { createHighIntentStarterDeals, STATIC_SEED_PRICE_VERIFIED_AT } from '../../src/commission/starter-deals.js';
import { D1Client } from '../../src/db/d1-client.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { B2BPilotService } from '../../src/revenue/b2b-pilot-service.js';
import { YouTubeReviewEnricher } from '../../src/integrations/youtube-review-enricher.js';

describe('PR #93: Honesty Bugs, Daily D1 Budget, EPC Physical Engine & B2B Pilot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const d1 = D1Client.getInstance();
    d1.resetDailyBackgroundUsage();
    d1.endBackgroundCycle();
  });

  describe('Part 1 Item 1: Real Structured Gemini Synthesis', () => {
    it('parses real structured Gemini response and renders into contentMarkdown', async () => {
      const db = getDb();
      const offerId = 'test_offer_pr93_gemini';
      const now = new Date().toISOString();

      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, country, website, approval_status, active_status)
        VALUES ('part_test_zebra', 'org_owner_primary', 'Zebra Technologies', 'Industrial', 'IN', 'https://zebra.com', 'APPROVED', 'ACTIVE')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, price_inr, status, active,
          destination_url, authorized_tracking_url, evidence_json
        ) VALUES (?, 'part_test_zebra', 'org_owner_primary', 'Zebra Commercial Label Printer ZD421', 'test-thermal-printer',
          'Industrial & Scientific', 'Commercial Logistics Operators', 14999, 'ACTIVE', 1,
          'https://amazon.in/dp/B0TEST01', 'https://amazon.in/dp/B0TEST01?tag=aff-21', ?)
      `).run(
        offerId,
        JSON.stringify({
          display_name: 'Zebra Commercial Label Printer ZD421',
          listing_facts: [
            { fact: '300 DPI direct thermal print resolution', date: '2026-11-20' },
            { fact: 'USB and Ethernet high-speed connectivity', date: '2026-11-21' },
            { fact: 'Supports 4.09 inch standard shipping labels', date: '2026-11-22' }
          ]
        })
      );

      const mockGeminiJson = {
        whoShouldBuy: 'High-volume logistics operators requiring dependable 300 DPI thermal shipping labels.',
        whoShouldAvoid: 'Home users needing occasional full-color document or photo printing.',
        verifiedSpecsVsTradeoffs: '300 DPI resolution yields sharp barcodes but requires premium thermal media for optimal contrast.',
        honestLimitations: 'Does not support Wi-Fi or Bluetooth out of the box; requires wired Ethernet or USB.'
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: '```json\n' + JSON.stringify(mockGeminiJson) + '\n```' }
                ]
              }
            }
          ]
        })
      });

      const engine = ContentAssetEngine.getInstance();
      const asset = await engine.generateGuideForApprovedOffer(offerId, 'org_owner_primary', {
        invokeGemini: true,
        fetchFn: mockFetch as any
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(asset.contentMarkdown).toContain('Objective Buyer Synthesis (AI-Assisted Analysis)');
      expect(asset.contentMarkdown).toContain(mockGeminiJson.whoShouldBuy);
      expect(asset.contentMarkdown).toContain(mockGeminiJson.whoShouldAvoid);
      expect(asset.contentMarkdown).toContain(mockGeminiJson.verifiedSpecsVsTradeoffs);
      expect(asset.contentMarkdown).toContain(mockGeminiJson.honestLimitations);
      expect((asset as any).geminiCallsUsed).toBe(1);
    });

    it('falls back cleanly to deterministic copy and logs 0 Gemini calls when templateFallback=true', async () => {
      const db = getDb();
      const offerId = 'test_offer_pr93_fallback';
      const now = new Date().toISOString();

      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, country, website, approval_status, active_status)
        VALUES ('part_test_tvs', 'org_owner_primary', 'TVS Electronics', 'Industrial', 'IN', 'https://tvs.com', 'APPROVED', 'ACTIVE')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, price_inr, status, active,
          destination_url, authorized_tracking_url, evidence_json
        ) VALUES (?, 'part_test_tvs', 'org_owner_primary', 'TVS RP 3200 Plus Thermal Printer', 'test-thermal-printer-fb',
          'Industrial & Scientific', 'Retail Point of Sale', 7999, 'ACTIVE', 1,
          'https://amazon.in/dp/B0TEST02', 'https://amazon.in/dp/B0TEST02?tag=aff-21', ?)
      `).run(
        offerId,
        JSON.stringify({
          display_name: 'TVS RP 3200 Plus Thermal Printer',
          listing_facts: [
            { fact: '260 mm/sec receipt print speed', date: '2026-11-20' },
            { fact: 'Triple interface USB Serial Ethernet', date: '2026-11-21' },
            { fact: 'Auto-cutter with 1.5 million cuts lifespan', date: '2026-11-22' }
          ]
        })
      );

      const mockFetch = vi.fn();
      const engine = ContentAssetEngine.getInstance();
      const asset = await engine.generateGuideForApprovedOffer(offerId, 'org_owner_primary', {
        templateFallback: true,
        fetchFn: mockFetch as any
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(asset.contentMarkdown).toContain('Objective Buyer Considerations');
      expect(asset.contentMarkdown).not.toContain('Objective Buyer Synthesis (AI-Assisted Analysis)');
      expect((asset as any).geminiCallsUsed).toBe(0);
    });
  });

  describe('Part 1 Item 2: Static Timestamps & EPC Campaign Filtering', () => {
    it('uses explicit static timestamp and isSeedFallback on all starter deals without runtime new Date()', () => {
      const deals1 = createHighIntentStarterDeals();
      expect(deals1.length).toBe(7);

      for (const d of deals1) {
        expect(d.isSeedFallback).toBe(true);
        expect(d.observedAt).toBe(STATIC_SEED_PRICE_VERIFIED_AT);
        expect(d.lastCheckedAt).toBe(STATIC_SEED_PRICE_VERIFIED_AT);
        expect(d.lastVerifiedAt).toBe(STATIC_SEED_PRICE_VERIFIED_AT);
        expect(d.createdAt).toBe(STATIC_SEED_PRICE_VERIFIED_AT);
        expect(d.updatedAt).toBe(STATIC_SEED_PRICE_VERIFIED_AT);
      }

      // Verify no SaaS / AppSumo starter seeds exist
      const saasDeals = deals1.filter(d => d.category === 'Software & SaaS' || d.merchant === 'AppSumo');
      expect(saasDeals.length).toBe(0);

      // Verify physical product deals
      expect(deals1.some(d => d.brand === 'mCaffeine')).toBe(true);
      expect(deals1.some(d => d.brand === 'Beardo')).toBe(true);
      expect(deals1.some(d => d.brand === 'Dot & Key')).toBe(true);
    });
  });

  describe('Part 1 Item 3: Cumulative Daily D1 Background Budget Guard', () => {
    it('enforces cumulative daily ceiling of 250,000 rows_read while permitting customer queries', () => {
      const d1 = D1Client.getInstance();

      // Start background cycle with standard 2,500 budget
      d1.startBackgroundCycle(2500);
      d1.recordCycleUsage(1000, 10);
      expect(d1.isCycleBudgetExceeded()).toBe(false);

      // Simulate cumulative background cycles reaching daily cap (250,000)
      d1.recordCycleUsage(249500, 100);
      expect(d1.isDailyBackgroundBudgetExceeded()).toBe(true);
      expect(d1.isCycleBudgetExceeded()).toBe(true);

      const dailyUsage = d1.getDailyBackgroundUsage();
      expect(dailyUsage.dailyRowsRead).toBeGreaterThanOrEqual(250000);
      expect(dailyUsage.dailyBudgetExceeded).toBe(true);

      const cycleSummary = d1.endBackgroundCycle();
      expect(cycleSummary.dailyBudgetExceeded).toBe(true);
      expect(cycleSummary.budgetStopped).toBe(true);

      // Verify customer-facing reads execute unaffected
      const db = getDb();
      const customerRead = db.prepare('SELECT 1 as customer_live_read').get() as any;
      expect(customerRead.customer_live_read).toBe(1);
    });
  });

  describe('Part 1 Item 4: PageSpeed 400/429 Honest Degradation', () => {
    it('degrades HTTP 429 cleanly to UNAVAILABLE_RATE_LIMITED without inventing scores', async () => {
      const psClient = GooglePageSpeedClient.getInstance();
      vi.spyOn(psClient as any, 'fetchFn').mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded'
      });

      const res = await psClient.runAudit('https://example-school.in', 'mobile');
      expect(res.status).toBe('UNAVAILABLE_RATE_LIMITED');
      expect(res.reason).toBe('UNAVAILABLE_RATE_LIMITED');
      expect(res.performanceScore).toBeUndefined();
      expect(res.coreWebVitals).toBeNull();
    });

    it('degrades HTTP 400 cleanly to UNAVAILABLE_KEY_ERROR without inventing scores', async () => {
      const psClient = GooglePageSpeedClient.getInstance();
      vi.spyOn(psClient as any, 'fetchFn').mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'API key invalid'
      });

      const res = await psClient.runAudit('https://example-institute.in', 'mobile');
      expect(res.status).toBe('UNAVAILABLE_KEY_ERROR');
      expect(res.reason).toBe('UNAVAILABLE_KEY_ERROR');
      expect(res.coreWebVitals).toBeNull();
    });
  });

  describe('Part 1 Item 5 & Part 2 Item 2: Security & YouTube Review Link Labeling', () => {
    it('strictly validates youtube.com/youtu.be domains and deduplicates review channels', async () => {
      const enricher = YouTubeReviewEnricher.getInstance();
      process.env.TAVILY_API_KEY = 'test_tavily_key_active';

      // Mock Tavily returning youtube and non-youtube links
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('tavily')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [
                {
                  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                  title: 'Dot & Key Gel Review - Channel Alpha',
                  author: 'Channel Alpha'
                },
                {
                  url: 'https://malicious-site.com/watch?v=fakevideo12',
                  title: 'Fake Review'
                },
                {
                  url: 'https://youtu.be/dQw4w9WgXcQ', // Duplicate video ID
                  title: 'Duplicate Video - Channel Alpha',
                  author: 'Channel Alpha'
                },
                {
                  url: 'https://www.youtube.com/watch?v=L_LUpnjgPso',
                  title: 'Dot & Key In-Depth Test - Beauty Guru',
                  author: 'Beauty Guru'
                }
              ]
            })
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      // Clear D1/in-memory cache for test
      vi.spyOn(enricher as any, 'getCachedReviews').mockResolvedValue(null);

      const reviews = await (enricher as any).searchTavilyFallback('Dot & Key 72HR Hydrating Gel', 3);
      expect(reviews.length).toBe(2);
      expect(reviews[0].videoId).toBe('dQw4w9WgXcQ');
      expect(reviews[0].label).toBe('Independent Video Reviews to Watch');
      expect(reviews[0].aiWatchedFullVideo).toBe(false);
      expect(reviews[1].videoId).toBe('L_LUpnjgPso');
      expect(reviews[1].channelTitle).toBe('Beauty Guru');
    });
  });

  describe('Part 2 Item 1: Done-For-You B2B Service Engine', () => {
    it('generates a clean Before-Action Audit & Pilot Proposal with verified findings and owner-approved pricing', async () => {
      const b2bService = B2BPilotService.getInstance();

      const proposal = await b2bService.generateProposal({
        targetUrl: 'https://apex-coaching-academy.in',
        businessName: 'Apex Coaching Academy',
        ownerApproved: true,
        priceINR: 12500,
        checkoutBaseUrl: 'https://ai-marketing-organization.onrender.com'
      });

      expect(proposal.proposalId).toBeDefined();
      expect(proposal.packageName).toBe('Website & Admissions Enquiry Conversion Setup');
      expect(proposal.verifiedFindings.length).toBeGreaterThanOrEqual(3);
      expect(proposal.priceINR).toBe(12500);
      expect(proposal.checkoutUrl).toContain('package=WEBSITE_ENQUIRY_CONVERSION_SETUP');
      expect(proposal.checkoutUrl).toContain('amount=12500');

      // Verify Markdown output contains factual findings and NO unbacked ranking guarantees
      expect(proposal.markdown).toContain('# Before-Action Audit & Pilot Implementation Proposal');
      expect(proposal.markdown).toContain('Apex Coaching Academy');
      expect(proposal.markdown).toContain('Direct WhatsApp Click-to-Chat Integration');
      expect(proposal.markdown).toContain('₹12,500');
      expect(proposal.markdown).toContain('We never guarantee specific student admission counts or search ranking positions');

      // Verify HTML output is self-contained and clean
      expect(proposal.html).toContain('<!DOCTYPE html>');
      expect(proposal.html).toContain('Before-Action Audit &amp; Pilot Proposal');
      expect(proposal.html).toContain('₹12,500');
      expect(proposal.html).toContain('checkout?package=WEBSITE_ENQUIRY_CONVERSION_SETUP');
    });

    it('emits TBD / owner consultation status when ownerApproved=false (never unauthorized prices)', async () => {
      const b2bService = B2BPilotService.getInstance();

      const proposal = await b2bService.generateProposal({
        targetUrl: 'https://vijayawada-dental-clinic.in',
        businessName: 'Vijayawada Dental Clinic',
        ownerApproved: false
      });

      expect(proposal.ownerApproved).toBe(false);
      expect(proposal.priceINR).toBeNull();
      expect(proposal.checkoutUrl).toBeNull();
      expect(proposal.markdown).toContain('To be confirmed upon owner consultation');
      expect(proposal.markdown).toContain('OWNER_REVIEW_PENDING');
      expect(proposal.html).toContain('Commercial terms and fee to be confirmed upon consultation with business owner');
    });
  });
});
