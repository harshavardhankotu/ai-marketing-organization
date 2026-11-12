import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../../src/index.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { ReferralTrackingEngine } from '../../src/commission/referral-tracking.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { resolveVerificationTokens } from '../../src/config/env.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { seedDatabase } from '../../src/db/seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Stage F-Lite — Production Integrity & Conversion Readiness', () => {
  const originalEnv = { ...process.env };
  const testConfig = {
    siteName: 'AI Marketing Organization',
    authorName: 'Editorial Desk',
    contactEmail: 'editorial@ai-marketing-organization.onrender.com',
    siteUrl: 'https://ai-marketing-organization.onrender.com'
  };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.PUBLIC_SITE_NAME = 'AI Marketing Organization';
    process.env.PUBLIC_SITE_URL = 'https://ai-marketing-organization.onrender.com';
    seedDatabase();
    await AutomationRegistryEngine.getInstance().ensureInitialized();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM A: Published Guide Affiliate Link Integrity & Claim Sanitization
  // --------------------------------------------------------------------------
  describe('Workstream A — Published Guide Affiliate Link Integrity', () => {
    const validChain = (id: string, partnerId: string, campaignId: string) => ({
      productVerified: true,
      affiliateVerified: true,
      isMonetizable: true,
      availability: 'IN_STOCK',
      expiryDate: '2029-12-31T23:59:59.000Z',
      partnerOffer: {
        id: `off_${id}`,
        partner_id: partnerId,
        status: 'ACTIVE',
        active: 1,
        expiry_date: '2029-12-31T23:59:59.000Z'
      },
      partner: {
        id: partnerId,
        approval_status: 'APPROVED',
        authorization_status: 'AUTHORIZED',
        active_status: 1
      },
      campaign: {
        campaign_id: campaignId,
        status: 'ACTIVE'
      }
    });

    const mockEligibleDeals = [
      {
        id: 'deal_4ea10ff4-5',
        title: 'boAt Rockerz 430 Gen 2 Wireless Headphones',
        brand: 'boAt',
        merchant: 'boAt',
        productUrl: 'https://www.boat-lifestyle.com/products/rockerz-430',
        affiliateRedirectUrl: 'https://clnk.in/D8C9',
        currentPriceINR: 1299,
        ...validChain('deal_4ea10ff4-5', 'part_boat', 'camp_boat')
      },
      {
        id: 'deal_1f758bfb-7',
        title: 'boAt Airdopes Plus 221 Earbuds',
        brand: 'boAt',
        merchant: 'boAt',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-221',
        affiliateRedirectUrl: 'https://clnk.in/D8Da',
        currentPriceINR: 899,
        ...validChain('deal_1f758bfb-7', 'part_boat', 'camp_boat')
      },
      {
        id: 'deal_660e8e2f-1',
        title: 'Noise Kore Smartwatch',
        brand: 'Noise',
        merchant: 'Noise',
        productUrl: 'https://www.gonoise.com/products/noise-kore',
        affiliateRedirectUrl: 'https://clnk.in/D8Dt',
        currentPriceINR: 1199,
        ...validChain('deal_660e8e2f-1', 'part_noise', 'camp_noise')
      },
      {
        id: 'deal_3d917061-8',
        title: 'Noise ColorFit Icon Rise Max',
        brand: 'Noise',
        merchant: 'Noise',
        productUrl: 'https://www.gonoise.com/products/colorfit-icon-rise-max',
        affiliateRedirectUrl: 'https://clnk.in/D8Du',
        currentPriceINR: 1499,
        ...validChain('deal_3d917061-8', 'part_noise', 'camp_noise')
      }
    ];

    it('dynamically rewrites eligible affiliate links to tracked redirect endpoints with rel="sponsored nofollow"', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const guide = {
        slug: 'best-wireless-audio-smartwatches-india',
        title: 'Budget Wireless Audio & Smartwatch Buying Guide (India 2026)',
        content_markdown: `
Check verified gear:
* [boAt Rockerz 430 Gen 2 Wireless Headphones](https://clnk.in/D8C9)
* [Noise Kore Smartwatch](https://clnk.in/D8Dt)
        `,
        disclosure_markdown: 'Affiliate disclosure'
      };

      const html = ssg.renderGuideHtml(guide, testConfig, mockEligibleDeals);

      expect(html).toContain('href="/api/v1/public/deals/deal_4ea10ff4-5/redirect"');
      expect(html).toContain('href="/api/v1/public/deals/deal_660e8e2f-1/redirect"');
      expect(html).toContain('rel="sponsored nofollow"');
      expect(html).toContain('class="affiliate-link"');
      expect(html).not.toContain('https://clnk.in/D8C9');
      expect(html).not.toContain('https://clnk.in/D8Dt');
    });

    it('fails closed on unmapped affiliate links by stripping anchor tags to plain text', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const flightGuide = {
        slug: 'student-flight-discounts-india',
        title: 'Student Air Travel Discounts Guide',
        content_markdown: `
Airline concessions:
* [Book Student Fares on Air India Express](https://clnk.in/DKRM)
* [Book Student Fares on Akasa Air](https://clnk.in/DKX3)
* [Compare on Cleartrip](https://clnk.in/DKRN)
* [Read DGCA Safety Guidelines](https://dgca.gov.in/safety)
        `
      };

      // When rendered with commerce deals (which don't include airline tickets)
      const html = ssg.renderGuideHtml(flightGuide, testConfig, mockEligibleDeals);

      // Unmapped affiliate links must have anchor tags stripped completely
      expect(html).not.toContain('https://clnk.in/DKRM');
      expect(html).not.toContain('https://clnk.in/DKX3');
      expect(html).not.toContain('https://clnk.in/DKRN');
      expect(html).not.toContain('href="https://clnk.in');
      expect(html).toContain('Book Student Fares on Air India Express');
      expect(html).toContain('Book Student Fares on Akasa Air');

      // Legitimate non-affiliate external links remain preserved
      expect(html).toContain('<a href="https://dgca.gov.in/safety" target="_blank" rel="noopener noreferrer">Read DGCA Safety Guidelines</a>');
    });

    it('suppresses unbacked penalty claims and tariff numbers in student flight guide', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const guideWithClaims = {
        slug: 'student-flight-discounts-india',
        title: 'Student Air Travel Discounts Guide',
        content_markdown: `
Missing ID: Airlines charge standard walk-up difference along with standard excess baggage rates (typically ₹500–₹550 per kg for the extra 10 kg = ₹5,000+ penalty).
        `
      };

      const html = ssg.renderGuideHtml(guideWithClaims, testConfig, mockEligibleDeals);

      expect(html).not.toContain('₹500–₹550 per kg');
      expect(html).not.toContain('₹5,000+ penalty');
      expect(html).toContain('standard excess baggage rates per airline policy');
    });

    it('renders educational notice when all affiliate links are stripped in student flight guide', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const flightGuide = {
        slug: 'student-flight-discounts-india',
        title: 'Student Air Travel Discounts Guide',
        content_markdown: 'Educational overview.'
      };

      const html = ssg.renderGuideHtml(flightGuide, testConfig, mockEligibleDeals);

      expect(html).toContain('Editorial Notice: Carrier student concession rules and baggage allowances vary by airline and change over time.');
      expect(html).not.toContain('As an Amazon Associate I earn from qualifying purchases');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM B: Legacy /r/ Click-ID Integrity & Bot Traffic Isolation
  // --------------------------------------------------------------------------
  describe('Workstream B — Legacy /r/ Click-ID Integrity & Provenance', () => {
    it('generates distinct unique click IDs for concurrent and independent referral hits', async () => {
      const trackingEngine = ReferralTrackingEngine.getInstance();
      const db = getDb();

      db.prepare(`
        INSERT OR REPLACE INTO partners (
          id, organization_id, name, industry, website, network, approval_status, authorization_status
        ) VALUES ('part_boat_b', 'org_owner_primary', 'boAt Lifestyle India', 'electronics', 'https://www.boat-lifestyle.com', 'CUELINKS', 'APPROVED', 'AUTHORIZED')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, destination_url, authorized_tracking_url, active, status
        ) VALUES ('off_boat_b_430', 'part_boat_b', 'org_owner_primary', 'boAt Rockerz 430', 'boat-rockerz-430-test', 'Audio', 'Consumers', 'https://linksredirect.com/?cid=123&url=https%3A%2F%2Fwww.boat-lifestyle.com&subid=INITIAL', 'https://linksredirect.com/?cid=123&url=https%3A%2F%2Fwww.boat-lifestyle.com&subid=INITIAL', 1, 'ACTIVE')
      `).run();

      // Execute 3 concurrent hits
      const results = await Promise.all([
        trackingEngine.resolveReferralClick('boat-rockerz-430-test', 'initial_ref_1', {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          ip: '103.21.244.1',
          utmSource: 'whatsapp',
          utmCampaign: 'test_campaign_1'
        }),
        trackingEngine.resolveReferralClick('boat-rockerz-430-test', 'initial_ref_2', {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
          ip: '103.21.244.2',
          utmSource: 'telegram',
          utmCampaign: 'test_campaign_2'
        }),
        trackingEngine.resolveReferralClick('boat-rockerz-430-test', 'initial_ref_3', {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
          ip: '103.21.244.3',
          utmSource: 'twitter',
          utmCampaign: 'test_campaign_3'
        })
      ]);

      const subids = results.map(r => new URL(r.destinationUrl).searchParams.get('subid'));
      expect(subids[0]).toBeTruthy();
      expect(subids[1]).toBeTruthy();
      expect(subids[2]).toBeTruthy();

      // All subids must be cryptographically distinct
      expect(subids[0]).not.toBe(subids[1]);
      expect(subids[1]).not.toBe(subids[2]);
      expect(subids[0]).not.toBe(subids[2]);
    });

    it('isolates bot and diagnostic probe traffic from incrementing content asset metrics', async () => {
      const trackingEngine = ReferralTrackingEngine.getInstance();
      const db = getDb();

      db.prepare(`
        INSERT OR REPLACE INTO partners (
          id, organization_id, name, industry, website, network, approval_status, authorization_status
        ) VALUES ('part_boat_bot', 'org_owner_primary', 'boAt Lifestyle India', 'electronics', 'https://www.boat-lifestyle.com', 'CUELINKS', 'APPROVED', 'AUTHORIZED')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, destination_url, authorized_tracking_url, active, status
        ) VALUES ('off_boat_bot_221', 'part_boat_bot', 'org_owner_primary', 'boAt Airdopes 221', 'boat-airdopes-221-test', 'Audio', 'Consumers', 'https://linksredirect.com/?cid=123&url=https%3A%2F%2Fwww.boat-lifestyle.com&subid=INITIAL', 'https://linksredirect.com/?cid=123&url=https%3A%2F%2Fwww.boat-lifestyle.com&subid=INITIAL', 1, 'ACTIVE')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, location, intent_target,
          content_markdown, primary_offer_id, referral_click_count, status
        ) VALUES ('asset_bot_test_1', 'org_owner_primary', 'test-guide-slug', 'BUYING_GUIDE', 'Test Guide', 'Electronics', 'India', 'Intent', 'Content', 'off_boat_bot_221', 0, 'PUBLISHED')
      `).run();

      // Hit 1: Bot traffic (Googlebot user agent)
      await trackingEngine.resolveReferralClick('boat-airdopes-221-test', 'ref_bot_1', {
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        ip: '66.249.66.1'
      });

      // Hit 2: Diagnostic probe (header marked)
      await trackingEngine.resolveReferralClick('boat-airdopes-221-test', 'ref_diag_1', {
        userAgent: 'curl/7.68.0',
        ip: '127.0.0.1',
        isTestTraffic: true
      });

      const rowAfterBot = db.prepare('SELECT referral_click_count FROM commission_content_assets WHERE id = ?').get('asset_bot_test_1') as any;
      expect(rowAfterBot.referral_click_count).toBe(0);

      // Hit 3: Genuine human visitor
      await trackingEngine.resolveReferralClick('boat-airdopes-221-test', 'ref_human_1', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        ip: '103.21.244.5'
      });

      const rowAfterHuman = db.prepare('SELECT referral_click_count FROM commission_content_assets WHERE id = ?').get('asset_bot_test_1') as any;
      expect(rowAfterHuman.referral_click_count).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM C: Sitemap, RSS & Canonical Content URLs
  // --------------------------------------------------------------------------
  describe('Workstream C — Sitemap, RSS & Canonical Content URL Parity', () => {
    it('advertises canonical SSR URLs including /deals/:slug product pages and excludes /rss.xml from SPA shells', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, location, intent_target,
          content_markdown, primary_offer_id, status
        ) VALUES ('guide_test_c', 'org_owner_primary', 'best-wireless-audio-smartwatches-india', 'BUYING_GUIDE', 'Electronics Guide', 'Electronics', 'India', 'Intent', 'Content', 'deal_4ea10ff4-5', 'PUBLISHED')
      `).run();

      const res = await app.request('/sitemap.xml');
      expect(res.status).toBe(200);
      const text = await res.text();

      // Must include primary SSR canonical URLs
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/deals</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/offer</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/tools/site-audit</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/tools/lead-leakage-calculator</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/revenue</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/public/disclosure</loc>');
      expect(text).toContain('<loc>https://ai-marketing-organization.onrender.com/guides/best-wireless-audio-smartwatches-india</loc>');
      // Unverified/nonexistent slugs must never appear in sitemap.xml
      expect(text).not.toContain('/deals/nonexistent-unverified-deal');
    });

    it('points deals in /rss.xml to canonical /deals landing rather than SPA shells', async () => {
      const res = await app.request('/rss.xml');
      expect(res.status).toBe(200);
      const text = await res.text();

      expect(text).toContain('<link>https://ai-marketing-organization.onrender.com/deals</link>');
      expect(text).not.toContain('<link>https://ai-marketing-organization.onrender.com/deals/deal_');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM D: /deals Page Title Accuracy & Ambiguous Offer Quarantine
  // --------------------------------------------------------------------------
  describe('Workstream D — /deals Page Accuracy & Duplicate Mapping Quarantine', () => {
    it('renders clean title tag without duplicate "| Verified Deals & Price Evidence"', async () => {
      const res = await app.request('/deals');
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('<title>Verified Deals &amp; Price Evidence | AI Marketing Organization</title>');
      expect(html).not.toContain('Verified Deals &amp; Price Evidence | Verified Deals &amp; Price Evidence');
      expect(html).not.toContain('Verified Deals & Price Evidence | Verified Deals & Price Evidence');
    });

    it('dynamically constructs meta description and merchant list without hardcoded unverified brands', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const deals = [
        { brand: 'boAt', merchant: 'boAt', title: 'Earbuds', currentPriceINR: 999 },
        { brand: 'Noise', merchant: 'Noise', title: 'Watch', currentPriceINR: 1299 }
      ];

      const html = ssg.renderDealsHtml(deals, testConfig);

      // Must list active merchants without unverified MRP claims
      expect(html).toContain('Merchant-reported Indian e-commerce deal snapshots across boAt, Noise');
      expect(html).not.toContain('Zero inflated discounts');
      // Must not contain unbacked merchants like Lenovo or Amazon
      expect(html).not.toContain('Lenovo');
      expect(html).not.toContain('Amazon');
    });

    it('quarantines and excludes conflicting synthetic canonical-destination deals while keeping valid unrelated deal', async () => {
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      const db = getDb();
      db.prepare('DELETE FROM public_deals').run();
      db.prepare('DELETE FROM partner_offers').run();
      db.prepare('DELETE FROM partners').run();
      (dealEngine as any).dealsMap?.clear();
      (dealEngine as any).dealSlugMap?.clear();

      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, approval_status, authorization_status, active_status)
        VALUES ('part_synth_ok', 'org_owner_primary', 'Synth Audio', 'electronics', 'https://synthaudiostore.example.com', 'CUELINKS', 'APPROVED', 'AUTHORIZED', 1)
      `).run();

      // Two conflicting deals claiming identical canonical destination URL -> BOTH quarantined
      for (const id of ['deal_conflict_1', 'deal_conflict_2']) {
        db.prepare(`
          INSERT INTO public_deals (
            id, slug, canonical_slug, title, brand, merchant, category, sector_code,
            product_url, affiliate_url, current_price_inr, reference_price_inr,
            discount_percent, availability, verification_status, is_monetizable,
            product_verified, affiliate_verified, updated_at
          ) VALUES (
            ?, ?, ?, 'Conflicting Earbuds', 'Synth', 'Synth Audio', 'Electronics', 'SECTOR_B_ELECTRONICS',
            'https://synthaudiostore.example.com/products/conflict-pod?utm_source=test',
            'https://linksredirect.com/?cid=1&url=https%3A%2F%2Fsynthaudiostore.example.com%2Fproducts%2Fconflict-pod',
            999, 1999, 50, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, datetime('now')
          )
        `).run(id, `slug-${id}`, `slug-${id}`);
        db.prepare(`
          INSERT INTO partner_offers (
            id, partner_id, organization_id, title, offer_slug, category, target_customer,
            destination_url, authorized_tracking_url, active, status
          ) VALUES (
            ?, 'part_synth_ok', 'org_owner_primary', 'Conflicting Earbuds', ?, 'Electronics', 'Consumers',
            'https://synthaudiostore.example.com/products/conflict-pod',
            'https://linksredirect.com/?cid=1&url=conflict', 1, 'ACTIVE'
          )
        `).run(`off_${id}`, `slug-${id}`);
      }

      // One clean, uniquely mapped product
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, reference_price_inr,
          discount_percent, availability, verification_status, is_monetizable,
          product_verified, affiliate_verified, updated_at
        ) VALUES (
          'deal_clean_unique', 'clean-unique-headset', 'clean-unique-headset', 'Clean Unique Headset',
          'Synth', 'Synth Audio', 'Electronics', 'SECTOR_B_ELECTRONICS',
          'https://synthaudiostore.example.com/products/clean-headset',
          'https://linksredirect.com/?cid=1&url=https%3A%2F%2Fsynthaudiostore.example.com%2Fproducts%2Fclean-headset',
          1499, 2499, 40, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, datetime('now')
        )
      `).run();
      db.prepare(`
        INSERT INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer,
          destination_url, authorized_tracking_url, active, status
        ) VALUES (
          'off_clean_unique', 'part_synth_ok', 'org_owner_primary', 'Clean Unique Headset', 'clean-unique-headset',
          'Electronics', 'Consumers',
          'https://synthaudiostore.example.com/products/clean-headset',
          'https://linksredirect.com/?cid=1&url=clean', 1, 'ACTIVE'
        )
      `).run();

      expect(await dealEngine.resolveDeal('deal_conflict_1')).toBeNull();
      expect(await dealEngine.resolveDeal('deal_conflict_2')).toBeNull();

      // Insert a deal with missing partner_offers mapping and prove requireStrictChain/production rejects it
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, reference_price_inr,
          discount_percent, availability, verification_status, is_monetizable,
          product_verified, affiliate_verified, updated_at
        ) VALUES (
          'deal_unmapped_strict', 'unmapped-strict', 'unmapped-strict', 'Unmapped Strict Deal',
          'Synth', 'Synth Audio', 'Electronics', 'SECTOR_B_ELECTRONICS',
          'https://synthaudiostore.example.com/products/unmapped-only',
          'https://linksredirect.com/?cid=1&url=https%3A%2F%2Fsynthaudiostore.example.com%2Fproducts%2Funmapped-only',
          1299, 1999, 35, 'IN_STOCK', 'AFFILIATE_VERIFIED', 1, 1, 1, datetime('now')
        )
      `).run();

      const eligible = await dealEngine.getEligiblePublicDeals({ requireStrictChain: true });
      expect(eligible.deals.find(d => d.id === 'deal_conflict_1')).toBeUndefined();
      expect(eligible.deals.find(d => d.id === 'deal_conflict_2')).toBeUndefined();
      expect(eligible.deals.find(d => d.id === 'deal_unmapped_strict')).toBeUndefined();
      const validFound = eligible.deals.find(d => d.id === 'deal_clean_unique');
      expect(validFound).toBeDefined();
      expect(validFound?.partnerOffer?.id).toBe('off_clean_unique');

      db.prepare('DELETE FROM public_deals').run();
      db.prepare('DELETE FROM partner_offers').run();
      db.prepare('DELETE FROM partners').run();
      (dealEngine as any).dealsMap?.clear();
      (dealEngine as any).dealSlugMap?.clear();
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM E: Homepage Three-Journey Reorganization
  // --------------------------------------------------------------------------
  describe('Workstream E — Homepage Three-Journey Reorganization', () => {
    it('renders Section 1 (B2B Lead Capture), Section 2 (SiteFix AI), and Section 3 (Verified Deals)', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Section 1: Administrative Lead Capture with explicit non-clinical notice & DPDP form
      expect(html).toContain('Administrative Website &amp; WhatsApp Inquiry Capture');
      expect(html).toContain('[Illustrative Administrative Example — No Clinical or Medical Triage]');
      expect(html).toContain('id="lead-inquiry-form-home"');
      expect(html).toContain('DPDP Act 2023');

      // Section 2: SiteFix AI Self-Serve Website Check
      expect(html).toContain('SiteFix AI — Self-Serve Website &amp; Metadata Check');
      expect(html).toContain('href="/tools/site-audit"');
      expect(html).toContain('href="/tools/lead-leakage-calculator"');

      // Section 3: Commercial Consumer Deals & Buying Guides with #Ad disclosure
      expect(html).toContain('Commercial Consumer Deals &amp; Buying Guides');
      expect(html).toContain('#Ad — Affiliate Links');
      expect(html).toContain('href="/deals"');
      expect(html).toContain('href="/compare/electronics-technology"');
      expect(html).toContain('href="/guides/best-wireless-audio-smartwatches-india"');
      expect(html).toContain('href="/guides/student-flight-discounts-india"');

      // Clean footer disclosure without unbacked airline names or unverified claims
      expect(html).not.toContain('Akasa Air, Air India Express, Cleartrip');
      expect(html).toContain('tracked affiliate links to authorized partner programs');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM F: Direct Outreach Endpoint Coverage
  // --------------------------------------------------------------------------
  describe('Workstream F — Direct Outreach Endpoint Regression Coverage', () => {
    it('enforces owner authentication controls on direct outreach endpoint', async () => {
      // Unauthenticated request must return 401
      const res = await app.request('/api/v1/owner/direct-outreach?status=pending');
      expect(res.status).toBe(401);
    });

    it('returns empty array [] when direct_outreach_log has zero matching records for authenticated owner', async () => {
      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');

      const res = await app.request('/api/v1/owner/direct-outreach?status=pending', {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBe(0);
    });

    it('returns formatted outreach draft rows when records exist for authenticated owner', async () => {
      const db = getDb();
      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');

      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft,
          compliance_checked, human_approved, dispatched, created_at
        ) VALUES (
          'draft_unit_1', 'biz_platform_aro', 'Dental', 'Apex Dental Care', 'WHATSAPP',
          'Hi Dr. Sharma, noticed your practice has after-hours patient inquiries.',
          1, 0, 0, datetime('now')
        )
      `).run();

      const res = await app.request('/api/v1/owner/direct-outreach?status=pending', {
        headers: { Authorization: `Bearer ${session.token}` }
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBe(1);
      expect(json.data[0].id).toBe('draft_unit_1');
      expect(json.data[0].prospectName).toBe('Apex Dental Care');
      expect(json.data[0].messageDraft).toContain('after-hours patient inquiries');
      expect(json.data[0].oneClickWhatsAppUrl).toContain('https://wa.me');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM G: /api/v1/cron/status Telemetry Truth
  // --------------------------------------------------------------------------
  describe('Workstream G — /api/v1/cron/status Telemetry Truth', () => {
    it('reports recent pings and executions from automation_execution_log', async () => {
      const db = getDb();
      const nowIso = new Date().toISOString();

      // Clear any leftover failed workflow state from prior tests in shared worker
      db.prepare("UPDATE automation_registry SET last_status = 'IDLE', last_error = NULL, retry_count = 0").run();
      try { db.prepare('DELETE FROM durable_job_queue').run(); } catch {}

      // Seed cron telemetry
      db.prepare(`
        INSERT OR REPLACE INTO cron_telemetry (
          id, total_pings, last_observed_ping, last_successful_cycle, cycle_result, last_user_agent, worker_source
        ) VALUES (
          'cloudflare_worker_cron', 50, ?, ?, 'SUCCESS', 'ai-marketing-cron-worker/1.0', 'CLOUDFLARE_WORKER'
        )
      `).run(nowIso, nowIso);

      // Seed autonomous cycle log for CLOUDFLARE_CRON ping tracking
      db.prepare(`
        INSERT OR REPLACE INTO autonomous_cycle_log (
          id, organization_id, trigger_source, cycle_start, status, actions_taken
        ) VALUES (
          'cyc_recent_test_cron_stage_f', 'org_owner_primary', 'CLOUDFLARE_CRON', datetime('now'), 'COMPLETED', 0
        )
      `).run();

      // Seed execution logs with a registered workflow_id: 2 hourly CLOUDFLARE_CRON runs, 1 manual run
      const ts = Date.now();
      db.prepare(`
        INSERT OR REPLACE INTO automation_execution_log (
          id, workflow_id, trigger_source, status, started_at, completed_at
        ) VALUES 
          (?, 'daily_market_demand_research', 'CLOUDFLARE_CRON', 'COMPLETED', datetime('now', '-1 hour'), datetime('now', '-1 hour')),
          (?, 'daily_market_demand_research', 'CLOUDFLARE_CRON', 'COMPLETED', datetime('now'), datetime('now')),
          (?, 'daily_market_demand_research', 'MANUAL_DISPATCH', 'COMPLETED', datetime('now'), datetime('now'))
      `).run(`exec_cron_${ts}_1`, `exec_cron_${ts}_2`, `exec_man_${ts}_1`);

      const res = await app.request('/api/v1/cron/status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(['HEALTHY', 'PARTIAL']).toContain(json.data.status);
      expect(json.data.totalPings).toBe(50);
      expect(json.data.recentPings24h).toBeGreaterThanOrEqual(1);
      expect(json.data.scheduledWorkflowExecutions24h).toBeGreaterThanOrEqual(2);
      expect(json.data.manualExecutions24h).toBeGreaterThanOrEqual(1);
    });

    it('flags STALE when Cloudflare Worker last ping is older than 75 minutes', async () => {
      const db = getDb();
      const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT OR REPLACE INTO cron_telemetry (
          id, total_pings, last_observed_ping, last_successful_cycle, cycle_result, last_user_agent
        ) VALUES (
          'cloudflare_worker_cron', 10, ?, ?, 'SUCCESS', 'ai-marketing-cron-worker/1.0'
        )
      `).run(staleIso, staleIso);

      const res = await app.request('/api/v1/cron/status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.status).toBe('STALE');
      expect(json.data.heartbeatAgeMinutes).toBeGreaterThanOrEqual(85);
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM H: docs/SHARE_KIT.md Presence & Compliance
  // --------------------------------------------------------------------------
  describe('Workstream H — docs/SHARE_KIT.md Verification', () => {
    it('verifies docs/SHARE_KIT.md exists and contains canonical URLs, UTM guidelines, and Cuelinks checklist', () => {
      const kitPath = fs.existsSync(path.resolve(process.cwd(), 'docs/SHARE_KIT.md'))
        ? path.resolve(process.cwd(), 'docs/SHARE_KIT.md')
        : path.resolve(__dirname, '../../../../docs/SHARE_KIT.md');
      expect(fs.existsSync(kitPath)).toBe(true);

      const content = fs.readFileSync(kitPath, 'utf-8');
      expect(content).toContain('https://ai-marketing-organization.onrender.com/deals');
      expect(content).toContain('https://ai-marketing-organization.onrender.com/compare/electronics-technology');
      expect(content).toContain('https://ai-marketing-organization.onrender.com/guides/best-wireless-audio-smartwatches-india');
      expect(content).toContain('https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india');
      expect(content).toContain('https://ai-marketing-organization.onrender.com/tools/site-audit');
      expect(content).toContain('utm_source');
      expect(content).toContain('utm_medium');
      expect(content).toContain('utm_campaign');
      expect(content).toContain('#Ad');
      expect(content).toContain('social_media_publishers_allowed');
      expect(content).toContain('deeplink_allowed');
      expect(content).toContain('sub_ids_allowed');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM I: Automation Registry Truthful Output Handlers
  // --------------------------------------------------------------------------
  describe('Workstream I — Automation Registry Truthful Status Handlers', () => {
    it('returns NO_ACTION_DUE or COMPLETED_NO_FINDINGS when empty input tables or zero records verified', async () => {
      const registryEngine = AutomationRegistryEngine.getInstance();

      // Test 1: Deduplication qualification with 0 candidates
      const resProspects = await registryEngine.executeWorkflow('prospect_dedup_qualification');
      expect(['NO_ACTION_DUE', 'COMPLETED_NO_FINDINGS']).toContain(resProspects.status);

      // Test 2: Inbound customer inquiry handling with 0 new inquiries
      const resInquiries = await registryEngine.executeWorkflow('new_inquiry_processing');
      expect(resInquiries.status).toBe('NO_ACTION_DUE');

      // Test 3: Quota health check with 0 purged items
      const resQuota = await registryEngine.executeWorkflow('quota_health_checks');
      expect(['NO_ACTION_DUE', 'COMPLETED']).toContain(resQuota.status);

      // Test 4: B2B compliance audit with 0 purged items
      const resB2BCompliance = await registryEngine.executeWorkflow('b2b_suppression_and_compliance_audit');
      expect(['NO_ACTION_DUE', 'COMPLETED']).toContain(resB2BCompliance.status);
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM J: Exact Affiliate Mapping & Full Chain Validation (Section 1)
  // --------------------------------------------------------------------------
  describe('Workstream J — Exact 1:1 Affiliate Mapping & Chain Validation', () => {
    const ssg = StaticSiteGenerator.getInstance();
    const baseChain = (dealId: string, partnerId = 'part_exact_1', campaignId = 'camp_exact_1') => ({
      productVerified: true,
      affiliateVerified: true,
      isMonetizable: true,
      availability: 'IN_STOCK',
      expiryDate: '2029-12-31T23:59:59.000Z',
      partnerOffer: {
        id: `off_${dealId}`,
        partner_id: partnerId,
        status: 'ACTIVE',
        active: 1,
        expiry_date: '2029-12-31T23:59:59.000Z'
      },
      partner: {
        id: partnerId,
        approval_status: 'APPROVED',
        authorization_status: 'AUTHORIZED',
        active_status: 1
      },
      campaign: {
        campaign_id: campaignId,
        status: 'ACTIVE'
      }
    });

    it('rejects title similarity, partial IDs, partial tracking URLs/shortcodes, ambiguous destinations, and incomplete chains', () => {
      const deals = [
        {
          id: 'deal_10',
          title: 'Noise ColorFit Ultra Buzz Smartwatch',
          brand: 'Noise',
          merchant: 'Noise',
          productUrl: 'https://www.gonoise.com/products/ultra-buzz',
          affiliateRedirectUrl: 'https://clnk.in/D8ABC',
          ...baseChain('deal_10')
        }
      ];

      // 1. Exact tracking URL match -> rewrites to redirect endpoint
      const htmlExact = ssg.renderGuideHtml(
        { slug: 'exact-test', title: 'Exact', content_markdown: '[Buy Ultra Buzz](https://clnk.in/D8ABC)' },
        testConfig,
        deals
      );
      expect(htmlExact).toContain('href="/api/v1/public/deals/deal_10/redirect"');

      const contentOnly = (html: string) => html.split('<article class="content">')[1].split('</article>')[0];

      // 2. Different product with similar title + unmapped link -> fail closed (stripped)
      const htmlSimilarTitle = ssg.renderGuideHtml(
        { slug: 'sim-test', title: 'Similar', content_markdown: '[Noise ColorFit Ultra Buzz Smartwatch](https://clnk.in/UNMAPPED1)' },
        testConfig,
        deals
      );
      expect(contentOnly(htmlSimilarTitle)).not.toContain('href=');
      expect(contentOnly(htmlSimilarTitle)).toContain('Noise ColorFit Ultra Buzz Smartwatch');

      // 3. Partial ID match ('deal_1' vs 'deal_10') -> fail closed
      const htmlPartialId = ssg.renderGuideHtml(
        { slug: 'pid-test', title: 'Partial ID', content_markdown: '[Check deal_1](/api/v1/public/deals/deal_1/redirect)' },
        testConfig,
        deals
      );
      expect(contentOnly(htmlPartialId)).not.toContain('href=');

      // 4. Partial shortcode/tracking prefix ('https://clnk.in/D8A' vs 'https://clnk.in/D8ABC') -> fail closed
      const htmlPartialCode = ssg.renderGuideHtml(
        { slug: 'pcode-test', title: 'Partial Code', content_markdown: '[Short](https://clnk.in/D8A)' },
        testConfig,
        deals
      );
      expect(contentOnly(htmlPartialCode)).not.toContain('href=');

      // 5. Ambiguous destination (multiple deals claiming the same canonical product URL) -> fail closed
      const ambiguousDeals = [
        { ...deals[0] },
        {
          id: 'deal_20',
          title: 'Noise ColorFit Ultra Buzz Smartwatch Duplicate',
          brand: 'Noise',
          merchant: 'Noise',
          productUrl: 'https://www.gonoise.com/products/ultra-buzz?utm_source=dup',
          affiliateRedirectUrl: 'https://clnk.in/D8DUP',
          ...baseChain('deal_20')
        }
      ];
      const htmlAmbiguous = ssg.renderGuideHtml(
        { slug: 'ambig-test', title: 'Ambig', content_markdown: '[Buy Ultra Buzz](https://clnk.in/D8ABC)' },
        testConfig,
        ambiguousDeals
      );
      expect(contentOnly(htmlAmbiguous)).not.toContain('href=');

      // 6. Expired/inactive partner offer -> fail closed
      const expiredOfferDeals = [
        {
          ...deals[0],
          partnerOffer: { ...deals[0].partnerOffer, status: 'INACTIVE', active: 0 }
        }
      ];
      expect(
        contentOnly(ssg.renderGuideHtml({ slug: 'exp-off', title: 'Exp', content_markdown: '[Buy](https://clnk.in/D8ABC)' }, testConfig, expiredOfferDeals))
      ).not.toContain('href=');

      // 7. Unapproved partner -> fail closed
      const unapprovedPartnerDeals = [
        {
          ...deals[0],
          partner: { ...deals[0].partner, approval_status: 'PENDING', authorization_status: 'UNVERIFIED' }
        }
      ];
      expect(
        contentOnly(ssg.renderGuideHtml({ slug: 'unapp-part', title: 'Unapp', content_markdown: '[Buy](https://clnk.in/D8ABC)' }, testConfig, unapprovedPartnerDeals))
      ).not.toContain('href=');

      // 8. Missing partnerOffer mapping -> fail closed
      const missingMappingDeals = [{ ...deals[0], partnerOffer: undefined }];
      expect(
        contentOnly(ssg.renderGuideHtml({ slug: 'no-map', title: 'NoMap', content_markdown: '[Buy](https://clnk.in/D8ABC)' }, testConfig, missingMappingDeals))
      ).not.toContain('href=');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM K: HTTP 503 vs HTTP 200 (0 Deals) vs HTTP 404 Distinction (Section 2)
  // --------------------------------------------------------------------------
  describe('Workstream K — D1 Failure vs Zero Deals Distinction', () => {
    it('returns HTTP 503 GUIDE_DATA_UNAVAILABLE when D1 read fails on /guides/:slug', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, intent_target,
          content_markdown, disclosure_markdown, status
        ) VALUES (
          'asset_d1_503_test', 'org_owner_primary', 'd1-outage-guide', 'BUYING_GUIDE',
          'D1 Outage Test Guide', 'Electronics', 'Compare options',
          'See [Sample Offer](https://clnk.in/D8Z9).', '#Ad Affiliate Disclosure', 'PUBLISHED'
        )
      `).run();

      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      vi.spyOn(d1Repo, 'queryOne').mockRejectedValueOnce(new Error('D1 HTTP 500 timeout'));

      const res = await app.request('/guides/d1-outage-guide');
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('GUIDE_DATA_UNAVAILABLE');
    });

    it('returns HTTP 503 GUIDE_DATA_UNAVAILABLE when getEligiblePublicDeals fails during guide render', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, intent_target,
          content_markdown, disclosure_markdown, status
        ) VALUES (
          'asset_deals_503_test', 'org_owner_primary', 'deals-outage-guide', 'BUYING_GUIDE',
          'Deals Outage Test Guide', 'Electronics', 'Compare options',
          'See [Sample Offer](https://clnk.in/D8Z9).', '#Ad Affiliate Disclosure', 'PUBLISHED'
        )
      `).run();

      process.env.PUBLIC_AUTHOR_NAME = 'Editorial Desk';
      process.env.PUBLIC_CONTACT_EMAIL = 'editorial@ai-marketing-organization.onrender.com';

      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValueOnce({
        id: 'asset_deals_503_test',
        slug: 'deals-outage-guide',
        title: 'Deals Outage Test Guide',
        content_markdown: 'See [Sample Offer](https://clnk.in/D8Z9).',
        disclosure_markdown: '#Ad Affiliate Disclosure',
        status: 'PUBLISHED'
      });
      vi.spyOn(d1Repo, 'executeRead').mockImplementation(async (table: string) => {
        if (table === 'public_deals') {
          throw new Error('D1 deals read connection refused');
        }
        return { results: [], source: 'CLOUDFLARE_D1' } as any;
      });

      const res = await app.request('/guides/deals-outage-guide');
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('GUIDE_DATA_UNAVAILABLE');
    });

    it('returns HTTP 200 without affiliate CTAs when D1 succeeds with 0 eligible deals, and HTTP 404 when guide is missing', async () => {
      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValueOnce(null);

      const res404 = await app.request('/guides/non-existent-guide-slug-xyz');
      expect(res404.status).toBe(404);

      vi.spyOn(d1Repo, 'queryOne').mockResolvedValueOnce({
        id: 'asset_zero_deals_ok',
        slug: 'zero-deals-clean-guide',
        title: 'Clean Guide Zero Deals',
        content_markdown: 'Check [Stripped Link](https://clnk.in/UNMAPPED_OFFER).',
        disclosure_markdown: '#Ad Affiliate Disclosure',
        status: 'PUBLISHED'
      });
      vi.spyOn(d1Repo, 'executeRead').mockResolvedValue({ results: [], meta: {} } as any);

      const res200 = await app.request('/guides/zero-deals-clean-guide');
      expect(res200.status).toBe(200);
      const html = await res200.text();
      expect(html).not.toContain('https://clnk.in/UNMAPPED_OFFER');
      expect(html).toContain('Stripped Link');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM L: Removal of Unverified Commercial Claims (Section 3) & Verification Meta Parity (Section 6)
  // --------------------------------------------------------------------------
  describe('Workstream L — Truthful Copy & Verification Metadata Parity', () => {
    it('omits unverified baggage, discount guarantee, and fabricated verification tokens when unconfigured', async () => {
      delete process.env.GOOGLE_SITE_VERIFICATION;
      delete process.env.CUELINKS_VERIFICATION_CODE;

      const kitPath = fs.existsSync(path.resolve(process.cwd(), 'docs/SHARE_KIT.md'))
        ? path.resolve(process.cwd(), 'docs/SHARE_KIT.md')
        : path.resolve(__dirname, '../../../../docs/SHARE_KIT.md');
      const kit = fs.readFileSync(kitPath, 'utf-8');
      expect(kit).not.toContain('10 kg complimentary extra check-in baggage');
      expect(kit).not.toContain('currently in stock with confirmed discounts');
      expect(kit).not.toContain('genuine MRP checks');

      const homeRes = await app.request('/');
      const homeHtml = await homeRes.text();
      expect(homeHtml).not.toContain('VERIFY-CL-YE94W8YS');
      expect(homeHtml).not.toContain('WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I');
      expect(homeHtml).not.toContain('name="cuelinks-verification"');
      expect(homeHtml).not.toContain('name="google-site-verification"');
      expect(homeHtml).not.toContain('corroborated across official retailer stores');

      const ssg = StaticSiteGenerator.getInstance();
      const staticHomeHtml = ssg.renderLandingPageHtml([], testConfig);
      expect(staticHomeHtml).not.toContain('name="cuelinks-verification"');
      expect(staticHomeHtml).not.toContain('name="google-site-verification"');
      expect(staticHomeHtml).toContain('#Ad');
      expect(homeHtml).toContain('#Ad');

      // When explicitly configured, both static index.html and dynamic GET / emit matching verification tags
      process.env.CUELINKS_VERIFICATION_CODE = 'CFG-CL-999';
      process.env.GOOGLE_SITE_VERIFICATION = 'CFG-GSC-888';
      const homeConfigured = await (await app.request('/')).text();
      const staticConfigured = ssg.renderLandingPageHtml([], {
        ...testConfig,
        cuelinksVerificationCode: 'CFG-CL-999',
        googleSiteVerification: 'CFG-GSC-888'
      });
      expect(homeConfigured).toContain('content="CFG-CL-999"');
      expect(homeConfigured).toContain('content="CFG-GSC-888"');
      expect(staticConfigured).toContain('content="CFG-CL-999"');
      expect(staticConfigured).toContain('content="CFG-GSC-888"');
    });

    it('restores owner verified production GSC and Cuelinks tokens in non-test production runtime when env vars are omitted', () => {
      const resolved = resolveVerificationTokens(undefined, { NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      expect(resolved.googleSiteVerification).toBe('WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I');
      expect(resolved.cuelinksVerificationCode).toBe('VERIFY-CL-YE94W8YS');

      const overridden = resolveVerificationTokens(undefined, {
        NODE_ENV: 'production',
        GOOGLE_SITE_VERIFICATION: 'OVERRIDE-GSC',
        CUELINKS_VERIFICATION_CODE: 'OVERRIDE-CL'
      } as NodeJS.ProcessEnv);
      expect(overridden.googleSiteVerification).toBe('OVERRIDE-GSC');
      expect(overridden.cuelinksVerificationCode).toBe('OVERRIDE-CL');
    });
  });

  // --------------------------------------------------------------------------
  // WORKSTREAM M: Workflow Status Truth & Sector Attribution (Section 4)
  // --------------------------------------------------------------------------
  describe('Workstream M — Workflow Status & Ledger Query Truthfulness', () => {
    it('daily_commercial_summary reports COMPLETED on clean reads (0 or non-zero), UNMEASURED adSpend, and ERROR/PARTIAL on DB failures', async () => {
      const registry = AutomationRegistryEngine.getInstance();
      const db = getDb();
      db.prepare('DELETE FROM transactions').run();
      db.prepare('DELETE FROM public_deals').run();
      db.prepare('DELETE FROM platform_prospects').run();

      // 1. Genuine clean zero rows
      const zeroRes = await registry.executeWorkflow('daily_commercial_summary', 'TEST_HARNESS');
      expect(zeroRes.status).toBe('COMPLETED');
      expect(zeroRes.itemsProcessed).toBe(3);
      expect(zeroRes.itemsSucceeded).toBe(3);
      expect(zeroRes.itemsFailed).toBe(0);
      expect(zeroRes.resultSummary.verifiedBankCashINR).toBe(0);
      expect(zeroRes.resultSummary.activeDeals).toBe(0);
      expect(zeroRes.resultSummary.qualifiedProspects).toBe(0);
      expect(zeroRes.resultSummary.adSpendStatus).toBe('UNMEASURED');
      expect(zeroRes.resultSummary.operatingCostsINR).toBeNull();
      expect(zeroRes.resultSummary.netContributionINR).toBeNull();

      // 2. Partial query failure via D1 simulation (transactions fails, public_deals & prospects succeed)
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const d1Repo = D1RevenueRepository.getInstance();
      const origQueryOne = d1Repo.queryOne.bind(d1Repo);
      const querySpy = vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql?: string, params?: any[]) => {
        if (table === 'transactions') throw new Error('transactions table read failed');
        if (table === 'public_deals' || table === 'platform_prospects') return { total: 0, c: 2 };
        return origQueryOne(table, sql || '', params);
      });
      try {
        const partialRes = await registry.executeWorkflow('daily_commercial_summary', 'TEST_HARNESS');
        expect(partialRes.status).toBe('PARTIAL');
        expect(partialRes.itemsFailed).toBe(1);
        expect(partialRes.itemsSucceeded).toBe(2);
        expect(partialRes.resultSummary.verifiedBankCashINR).toBeNull();

        // 3. Total query failure -> ERROR
        querySpy.mockImplementation(async (table: string, sql?: string, params?: any[]) => {
          if (table === 'transactions' || table === 'public_deals' || table === 'platform_prospects') {
            throw new Error('D1 unreachable');
          }
          return origQueryOne(table, sql || '', params);
        });
        const errRes = await registry.executeWorkflow('daily_commercial_summary', 'TEST_HARNESS');
        expect(errRes.status).toBe('ERROR');
        expect(errRes.itemsSucceeded).toBe(0);
        expect(errRes.itemsFailed).toBe(3);
      } finally {
        querySpy.mockRestore();
        process.env.NODE_ENV = origEnv;
      }
    });

    it('prospect_dedup_qualification reports ERROR instead of NO_ACTION_DUE on query failures', async () => {
      const registry = AutomationRegistryEngine.getInstance();
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const d1Repo = D1RevenueRepository.getInstance();
      const spy = vi.spyOn(d1Repo, 'query').mockRejectedValueOnce(new Error('D1 candidate read failure'));
      try {
        const errRes = await registry.executeWorkflow('prospect_dedup_qualification', 'TEST_HARNESS');
        expect(errRes.status).toBe('ERROR');
        expect(errRes.itemsFailed).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
        process.env.NODE_ENV = origEnv;
      }
    });

    it('daily_market_demand_research never counts unrelated-sector deals as selected-sector findings', async () => {
      const registry = AutomationRegistryEngine.getInstance();
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      (dealEngine as any).dealsMap?.clear();

      // Seed ONLY an electronics deal, while forcing selected sector to SECTOR_A_PRECIOUS_METALS
      dealEngine.injectDealForTesting({
        id: 'deal_unrelated_elec_1',
        title: 'Electronics Earbuds Unrelated',
        brand: 'Synth',
        merchant: 'Synth',
        category: 'Electronics',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        productUrl: 'https://synth.example.com/earbuds',
        currentPriceINR: 999,
        currency: 'INR',
        discountVerificationType: 'MERCHANT_LISTED_MRP',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        lastCheckedAt: new Date().toISOString(),
        sourceUrl: 'https://synth.example.com/feed',
        sourceDomain: 'synth.example.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'VERIFIED',
        confidenceScore: 80,
        buyerValueScore: 80,
        rejectionReasons: [],
        isMonetizable: true,
        evidenceJson: { sources: [], verificationLogs: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const { CommercialLearningEngine } = await import('../../src/commission/commercial-learning-engine.js');
      vi.spyOn(CommercialLearningEngine.getInstance(), 'selectNextSectorToExplore').mockReturnValue({
        selectedSector: 'SECTOR_A_PRECIOUS_METALS',
        selectionMode: 'THOMPSON_SAMPLING_EXPLOITATION',
        sampleScore: 0.9,
        allSectors: {} as any
      });
      vi.spyOn(dealEngine, 'discoverDealsForSector').mockResolvedValue({
        discovered: 0,
        sectorCode: 'SECTOR_A_PRECIOUS_METALS'
      } as any);
      vi.spyOn(dealEngine, 'harvestAllApprovedMerchantFeeds').mockResolvedValue({} as any);
      vi.spyOn(dealEngine, 'executeAutonomousCycle').mockResolvedValue({
        offersDiscovered: 1,
        offersVerified: 1,
        offersRejected: 0,
        status: 'COMPLETED'
      } as any);

      const res = await registry.executeWorkflow('daily_market_demand_research', 'TEST_HARNESS');
      expect(res.status).toBe('COMPLETED_NO_FINDINGS');
      expect(res.itemsSucceeded).toBe(0);
      expect(res.resultSummary.activeSectorDealsCount).toBe(0);
    });

    it('isolates lane failures inside daily_market_demand_research so a SiteFix error yields PARTIAL without halting Affiliate deal verification', async () => {
      const db = getDb();
      const { AutonomousDealDiscoveryEngine } = await import('../../src/commission/autonomous-deal-discovery-engine.js');
      const { CommercialLearningEngine } = await import('../../src/commission/commercial-learning-engine.js');
      const { AutomationRegistryEngine } = await import('../../src/automation/automation-registry-engine.js');
      const registry = AutomationRegistryEngine.getInstance();
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();

      db.prepare('DELETE FROM public_deals').run();
      vi.spyOn(CommercialLearningEngine.getInstance(), 'selectNextSectorToExplore').mockReturnValue({
        selectedSector: 'SECTOR_B_ELECTRONICS',
        selectionMode: 'THOMPSON_SAMPLING_EXPLOITATION',
        sampleScore: 0.9,
        allSectors: {} as any
      });
      vi.spyOn(dealEngine, 'discoverDealsForSector').mockResolvedValue({ discovered: 1, sectorCode: 'SECTOR_B_ELECTRONICS' } as any);
      vi.spyOn(dealEngine, 'harvestAllApprovedMerchantFeeds').mockResolvedValue({} as any);
      vi.spyOn(dealEngine, 'executeAutonomousCycle').mockResolvedValue({
        offersDiscovered: 1,
        offersVerified: 1,
        offersRejected: 0,
        status: 'COMPLETED'
      } as any);
      vi.spyOn(registry as any, 'autoAuditNextUnauditedDomain').mockRejectedValue(new Error('PAGESPEED_UPSTREAM_TIMEOUT'));

      const res = await registry.executeWorkflow('daily_market_demand_research', 'TEST_HARNESS');
      expect(res.status).toBe('PARTIAL');
      expect(res.resultSummary.isolatedLaneErrors?.siteFixAudit).toContain('PAGESPEED_UPSTREAM_TIMEOUT');
    });
  });

  describe('Workstream N — Stage I P0-P2 Queue Recovery, Inbound 24h Exemption, & Real Economics', () => {
    it('recovers >24h stale QUEUED jobs & parked-workflow BLOCKED jobs under 0044 CHECK constraints while enforcing priority lanes', async () => {
      const db = getDb();
      const { DurableJobQueue, QueuePriorityLane, getWorkflowPriorityLane } = await import('../../src/automation/durable-job-queue.js');
      expect(getWorkflowPriorityLane('new_inquiry_processing')).toBe(QueuePriorityLane.CRITICAL_INBOUND);
      expect(getWorkflowPriorityLane('daily_market_demand_research')).toBe(QueuePriorityLane.NORMAL_RESEARCH);
      expect(getWorkflowPriorityLane('seo_guide_content_refresh')).toBe(QueuePriorityLane.LOW_SEO_CONTENT);

      db.prepare('DELETE FROM automation_jobs').run();
      try {
        db.prepare(`INSERT OR IGNORE INTO automation_registry (id, name, category, cadence_minutes, enabled) VALUES ('parked_legacy_wf', 'Parked WF', 'GROWTH', 360, 0)`).run();
        db.prepare(`INSERT OR IGNORE INTO automation_registry (id, name, category, cadence_minutes, enabled) VALUES ('affiliate_offer_reconciliation', 'Affiliate Offer Reconciliation', 'COMMERCE', 60, 1)`).run();
      } catch {}

      db.prepare(`
        INSERT INTO automation_jobs (id, organization_id, business_id, workflow_id, idempotency_key, status, priority, payload_json, created_at, updated_at)
        VALUES ('job_stale_72h', 'org_owner_primary', 'biz_platform_aro', 'affiliate_offer_reconciliation', 'idem_stale_72h', 'QUEUED', 2, '{}', datetime('now', '-72 hours'), datetime('now', '-72 hours'))
      `).run();
      db.prepare(`
        INSERT INTO automation_jobs (id, organization_id, business_id, workflow_id, idempotency_key, status, priority, payload_json, created_at, updated_at)
        VALUES ('job_parked_blk', 'org_owner_primary', 'biz_platform_aro', 'parked_legacy_wf', 'idem_parked_blk', 'BLOCKED', 3, '{}', datetime('now', '-48 hours'), datetime('now', '-48 hours'))
      `).run();

      db.prepare(`
        INSERT INTO automation_jobs (id, organization_id, business_id, workflow_id, idempotency_key, status, attempts, payload_json, created_at, available_at)
        VALUES ('job_cred_blk', 'org_owner_primary', 'biz_platform_aro', 'authorized_outreach_dispatch', 'idem_cred_blk', 'BLOCKED', 1, '{}', datetime('now', '-2 hours'), datetime('now', '-2 hours'))
      `).run();
      const updErr = db.prepare(`UPDATE automation_jobs SET last_error = 'META_WHATSAPP_TOKEN_MISSING' WHERE id = 'job_cred_blk'`).run();
      expect(updErr.changes).toBe(1);

      const recovery = await DurableJobQueue.getInstance().recoverStaleAndBlockedJobs({
        staleHoursThreshold: 24,
        parkedWorkflowIds: ['parked_legacy_wf'],
        activeWorkflowIds: ['affiliate_offer_reconciliation']
      });

      expect(recovery.supersededStaleCount).toBe(1);
      expect(recovery.cancelledParkedBlockedCount).toBe(1);
      expect(recovery.deferredMissingCredentialCount).toBe(1);
      expect(recovery.freshJobsScheduledCount).toBe(1);
      expect(recovery.queueStatsAfter.blocked).toBe(0);
      expect(recovery.queueStatsAfter.oldestQueuedAgeMinutes).toBeLessThan(60);

      const staleRow = db.prepare(`SELECT status, last_error FROM automation_jobs WHERE id = 'job_stale_72h'`).get() as any;
      expect(staleRow.status).toBe('DEFERRED');
      expect(staleRow.last_error).toBe('SUPERSEDED_STALE_WINDOW');

      const credRow = db.prepare(`SELECT status, last_error FROM automation_jobs WHERE id = 'job_cred_blk'`).get() as any;
      expect(credRow.status).toBe('DEFERRED');
      expect(credRow.last_error).toBe('DEFERRED_MISSING_CREDENTIAL:META_WHATSAPP');

      const parkedRow = db.prepare(`SELECT status, last_error FROM automation_jobs WHERE id = 'job_parked_blk'`).get() as any;
      expect(parkedRow.status).toBe('NO_ACTION_DUE');
      expect(parkedRow.last_error).toBe('CANCELLED_WORKFLOW_PARKED');
    });

    it('exempts customer-initiated WhatsApp 24h inbound replies from 5/24h cold outbound caps while blocking 6th cold send', async () => {
      const db = getDb();
      const { AutonomyPolicyController } = await import('../../src/revenue/autonomy-policy.js');
      db.prepare('DELETE FROM direct_outreach_log').run();
      for (let i = 0; i < 5; i++) {
        db.prepare(`
          INSERT INTO direct_outreach_log (id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, dispatch_timestamp, created_at)
          VALUES (?, 'biz_platform_aro', 'B2B_SMB', 'Prospect', 'EMAIL', 'Body', 1, 1, datetime('now'), datetime('now'))
        `).run(`out_log_${i}_${Date.now()}`);
      }

      const policyCtrl = new AutonomyPolicyController();
      const coldEval = policyCtrl.evaluateAction('org_default', 'OUTBOUND_DISPATCH', {
        channel: 'EMAIL',
        isColdOutreach: true,
        isApproved: true,
        isInboundResponse: false,
        costINR: 0
      });
      expect(coldEval.allowed).toBe(false);
      expect(coldEval.violatedRule).toBe('DAILY_OUTBOUND_CAP_REACHED');

      const waInboundEval = policyCtrl.evaluateAction('org_default', 'OUTBOUND_DISPATCH', {
        channel: 'WHATSAPP',
        isColdOutreach: false,
        isInboundResponse: true,
        costINR: 0
      });
      expect({
        allowed: waInboundEval.allowed,
        violatedRule: waInboundEval.violatedRule,
        reason: waInboundEval.reason
      }).toEqual({ allowed: true, violatedRule: undefined, reason: expect.any(String) });
    });

    it('keeps prospect_dedup_qualification unblocked when >10 drafts are pending, replaces 65% hardcoded margin, and removes STRIPE global blocker', async () => {
      const db = getDb();
      const { AutomationRegistryEngine } = await import('../../src/automation/automation-registry-engine.js');
      const { RealEconomicsEngine, calculateLaneUnitEconomics } = await import('../../src/revenue/real-economics.js');
      const { SystemReadinessEngine } = await import('../../src/control-plane/system-readiness.js');

      db.prepare('DELETE FROM direct_outreach_log').run();
      for (let i = 0; i < 15; i++) {
        db.prepare(`
          INSERT INTO direct_outreach_log (id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched)
          VALUES (?, 'biz_platform_aro', 'B2B_SMB', ?, 'EMAIL', 'Draft body', 0, 0)
        `).run(`draft_blk_${i}`, `Clinic ${i}`);
      }

      const registry = AutomationRegistryEngine.getInstance();
      const dedupRes = await registry.executeWorkflow('prospect_dedup_qualification', 'TEST_HARNESS');
      expect(dedupRes.resultSummary?.reason).not.toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');

      const draftPrepRes = await registry.executeWorkflow('outreach_draft_preparation', 'TEST_HARNESS');
      expect(draftPrepRes.resultSummary?.reason).toBe('UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED');

      const econSummary = new RealEconomicsEngine().calculate('biz_platform_aro');
      expect(econSummary.grossMarginPercent).not.toBe(65);
      expect(econSummary.grossMarginPercent).toBe(0);

      const unknownCostLane = calculateLaneUnitEconomics({ lane: 'LANE_D_DIGITAL_PRODUCTS', grossRevenueINR: 1000 });
      expect(unknownCostLane.netContributionINR).toBeNull();
      expect(unknownCostLane.contributionStatus).toBe('UNKNOWN_MISSING_COST_DATA');

      const zeroLane = calculateLaneUnitEconomics({ lane: 'LANE_D_DIGITAL_PRODUCTS', grossRevenueINR: 0, directCostINR: 0 });
      expect(zeroLane.grossMarginPercent).toBeNull();
      const liveLane = calculateLaneUnitEconomics({ lane: 'LANE_D_DIGITAL_PRODUCTS', grossRevenueINR: 1000, directCostINR: 0, gatewayFeePercent: 2 });
      expect(liveLane.grossMarginPercent).toBe(98);

      const readiness = SystemReadinessEngine.evaluateReadiness('biz_platform_aro');
      expect((readiness.capabilities || {})['STRIPE']).toBeUndefined();
      expect((readiness.capabilities || {})['DIRECT_UPI']?.verified).toBe(true);
    });

    it('Stage I.1 (P0, P1, P2, P6): 24/7 customer-desk resolves catalog offers & escalations, cron status reads cron_telemetry heartbeats, and GET /tools/financial-radar returns HTTP 200', async () => {
      const db = getDb();
      const { OwnerDigestService } = await import('../../src/revenue/owner-digest.js');

      db.prepare('DELETE FROM public_deals').run();
      db.prepare('DELETE FROM reply_desk_drafts').run();
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, sector_code, title, brand, category, merchant,
          product_url, affiliate_url, current_price_inr,
          reference_price_inr, discount_percent, availability, deal_kind, product_verified, affiliate_verified, is_monetizable,
          verification_status, evidence_json, last_verified_at
        ) VALUES (
          'deal_sony_desk', 'sony-wh1000xm5-desk', 'sony-wh1000xm5-desk',
          'SECTOR_B_ELECTRONICS', 'Sony WH-1000XM5 Headphones', 'Sony', 'Audio', 'Amazon India',
          'https://www.amazon.in/dp/B09XS7JWHH', 'https://linksredirect.com/?pub_id=1&url=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB09XS7JWHH',
          24990, 34990, 29, 'IN_STOCK', 'PRODUCT_DEAL', 1, 1, 1, 'VERIFIED', '{}', datetime('now')
        )
      `).run();

      // 1. SiteFix inquiry returns ₹499 (never ₹15,000 clinic fallback)
      const sitefixRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'How much does a sitefix website audit cost?',
          productSlugOrContext: 'sitefix',
          customerName: 'Arjun',
          contactChannel: 'WEB_DESK'
        })
      });
      expect(sitefixRes.status).toBe(200);
      const sitefixJson = await sitefixRes.json() as any;
      expect(sitefixJson.success).toBe(true);
      expect(sitefixJson.reply).toContain('499');
      expect(sitefixJson.reply).not.toContain('15,000');
      expect(sitefixJson.resolvedOffer?.idOrSlug).toBe('sitefix_core_499');

      // 2. Product deal slug inquiry resolves exact Sony headphones price
      const dealRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'How much is this deal and what is the discount?',
          productSlugOrContext: 'sony-wh1000xm5-desk',
          contactChannel: 'WEB_DESK'
        })
      });
      expect(dealRes.status).toBe(200);
      const dealJson = await dealRes.json() as any;
      expect(dealJson.resolvedOffer?.priceINR).toBe(24990);
      expect(dealJson.reply).toContain('24,990');

      // 3. Escalation inquiry creates OWNER_ESCALATION_REQUIRED row surfaced on /owner/today
      const escRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'This is too expensive and I need director approval for custom enterprise deployment',
          senderContact: 'cto@example.in',
          customerName: 'Vikram',
          contactChannel: 'WEB_DESK'
        })
      });
      expect(escRes.status).toBe(200);
      const escJson = await escRes.json() as any;
      expect(escJson.escalationCreated).toBe(true);
      expect(escJson.escalationId).toBeTruthy();

      const digest = await OwnerDigestService.getInstance().generateDigestAsync();
      expect((digest.escalations || []).length).toBeGreaterThanOrEqual(1);
      const ownerHtml = OwnerDigestService.getInstance().renderHtml(digest);
      expect(ownerHtml).toContain('Owner Escalations Required');

      // 4. Cron ping + status reads genuineCronWorkerRuns24h & manualOrCurlPings24h directly from cron_telemetry
      db.prepare('DELETE FROM cron_telemetry').run();
      await app.request('/api/v1/cron/ping', {
        method: 'POST',
        headers: {
          'X-Cron-Secret': 'cron_ping_default_dev',
          'User-Agent': 'ai-marketing-cron-worker/1.0'
        }
      });
      await app.request('/api/v1/cron/ping', {
        method: 'POST',
        headers: {
          'X-Cron-Secret': 'cron_ping_default_dev',
          'User-Agent': 'curl/8.4.0'
        }
      });
      const statusRes = await app.request('/api/v1/cron/status');
      expect(statusRes.status).toBe(200);
      const statusJson = await statusRes.json() as any;
      expect(statusJson.data.recentPings24h).toBeGreaterThanOrEqual(1);
      expect(statusJson.data.genuineCronWorkerRuns24h).toBeGreaterThanOrEqual(1);
      expect(statusJson.data.manualOrCurlPings24h).toBeGreaterThanOrEqual(1);

      // 5. Public SSR /tools/financial-radar and /sitemap.xml
      const radarPageRes = await app.request('/tools/financial-radar');
      expect(radarPageRes.status).toBe(200);
      const radarHtml = await radarPageRes.text();
      expect(radarHtml).toContain('EDUCATIONAL_RESEARCH_AND_PAPER_PORTFOLIO_ONLY');

      const sitemapRes = await app.request('/sitemap.xml');
      expect(sitemapRes.status).toBe(200);
      const sitemapXml = await sitemapRes.text();
      expect(sitemapXml).toContain('/tools/financial-radar');
    });

    it('Stage I.2 (P0–P6): enforces anti-impersonation provenance, clarification, server-authoritative checkout, verified fulfillment bridge, retry/DLQ, honest DIRECT_UPI, and Concierge widget', async () => {
      const db = getDb();
      const { default: app } = await import('../../src/index.js');
      const { OwnerDigestService } = await import('../../src/revenue/owner-digest.js');
      const { RazorpayAdapter } = await import('../../src/integrations/razorpay.js');
      const { DurableEventBus } = await import('../../src/revenue/durable-event-bus.js');
      const { IntegrationCapabilityRegistry } = await import('../../src/control-plane/integration-capability-registry.js');

      db.prepare('DELETE FROM outreach_suppression_list').run();
      db.prepare('DELETE FROM demand_signals').run();
      db.prepare('DELETE FROM manual_upi_claims').run();
      db.prepare('DELETE FROM delivery_tasks').run();
      db.prepare('DELETE FROM durable_events').run();
      db.prepare('DELETE FROM payment_requests').run();
      db.prepare('DELETE FROM public_deals').run();

      // 1. Seed 2 verified wireless headphone deals for clarification test
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, sector_code, title, brand, category, merchant,
          product_url, affiliate_url, current_price_inr, reference_price_inr, discount_percent,
          availability, deal_kind, product_verified, affiliate_verified, is_monetizable,
          verification_status, evidence_json, last_verified_at
        ) VALUES
        ('deal_i2_hp1', 'sony-wh1000xm5-wireless', 'sony-wh1000xm5-wireless', 'SECTOR_B_ELECTRONICS',
         'Sony WH-1000XM5 Wireless Headphones', 'Sony', 'Audio & Electronics', 'Amazon India',
         'https://www.amazon.in/dp/B09XS7JWHH', 'https://linksredirect.com/?pub_id=1&url=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB09XS7JWHH',
         24990, 34990, 29, 'IN_STOCK', 'PRODUCT_DEAL', 1, 1, 1, 'VERIFIED', '{}', datetime('now')),
        ('deal_i2_hp2', 'bose-quietcomfort-wireless', 'bose-quietcomfort-wireless', 'SECTOR_B_ELECTRONICS',
         'Bose QuietComfort Wireless Headphones', 'Bose', 'Audio & Electronics', 'Flipkart',
         'https://www.flipkart.com/bose-qc/p/itm123', 'https://linksredirect.com/?pub_id=1&url=https%3A%2F%2Fwww.flipkart.com%2Fbose-qc%2Fp%2Fitm123',
         19990, 29990, 33, 'IN_STOCK', 'PRODUCT_DEAL', 1, 1, 1, 'VERIFIED', '{}', datetime('now'))
      `).run();

      // P0a: Payload limit (>8KB -> 413)
      const hugeRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(8500) })
      });
      expect(hugeRes.status).toBe(413);

      // P0b: Anti-impersonation opt-out on unverified public HTTP route must NOT add senderContact to outreach_suppression_list
      const fakeStopRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'STOP messaging me immediately',
          senderContact: 'victim@business.in',
          contactChannel: 'WHATSAPP'
        })
      });
      expect(fakeStopRes.status).toBe(200);
      const fakeStopJson = await fakeStopRes.json() as any;
      expect(fakeStopJson.provenance).toBe('UNVERIFIED_WEB_CONTACT');
      expect(fakeStopJson.suppressedScope).toBe('SESSION_ONLY');
      expect(fakeStopJson.contactSuppressed).toBe(false);
      const supRows = db.prepare('SELECT * FROM outreach_suppression_list WHERE identifier = ?').all('victim@business.in') as any[];
      expect(supRows.length).toBe(0);

      // P1: Broad category query triggers CLARIFICATION_NEEDED with top options
      const clarRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Which wireless headphones do you have right now?'
        })
      });
      expect(clarRes.status).toBe(200);
      const clarJson = await clarRes.json() as any;
      expect(clarJson.conversationState).toBe('CLARIFICATION_NEEDED');
      expect(clarJson.clarificationOptions.length).toBe(2);

      // P2a: End-to-end SiteFix inquiry -> READY_TO_BUY -> OWNED_CHECKOUT_CREATED -> UPI claim (NO fulfillment yet) -> HUMAN_VERIFIED_PAYMENT -> delivery_tasks + FULFILLED
      const deskSession = 'sess_stage_i2_buyer';
      const sitefixInquiryRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: deskSession,
          message: 'Tell me the price for SiteFix Core Fix-Pack',
          productSlugOrContext: 'sitefix_core_499'
        })
      });
      expect(sitefixInquiryRes.status).toBe(200);
      const inqJson = await sitefixInquiryRes.json() as any;
      expect(inqJson.resolvedOffer?.idOrSlug).toBe('sitefix_core_499');
      expect(inqJson.journeyId).toBeTruthy();

      // Verify first-party demand signal recorded cleanly
      const sigRow = db.prepare(`SELECT * FROM demand_signals WHERE source_host = 'FIRST_PARTY_CUSTOMER_DESK'`).get() as any;
      expect(sigRow).toBeTruthy();
      expect(sigRow.status).toBe('DISCOVERED');

      // Diagnostic probe quarantines its signal & journey
      await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Diagnostic-Probe': 'true' },
        body: JSON.stringify({
          message: 'Diagnostic check for SiteFix audit',
          productSlugOrContext: 'sitefix_core_499'
        })
      });
      const qSig = db.prepare(`SELECT status FROM demand_signals WHERE status = 'QUARANTINED'`).get() as any;
      expect(qSig?.status).toBe('QUARANTINED');

      // Turn 2: Ready to buy in same session -> server-authoritative order created in payment_requests
      const buyOwnedRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: deskSession,
          message: 'Yes buy now confirm purchase'
        })
      });
      expect(buyOwnedRes.status).toBe(200);
      const buyOwnedJson = await buyOwnedRes.json() as any;
      expect(buyOwnedJson.checkout?.checkoutMode).toBe('OWNED_CHECKOUT_CREATED');
      expect(buyOwnedJson.checkout?.amountINR).toBe(499);
      expect(buyOwnedJson.checkout?.orderId).toBeTruthy();
      expect(buyOwnedJson.pipelineStage).toBe('PAYMENT_REQUEST_CREATED');

      // Honest DIRECT_UPI state before human verification
      const capBefore = IntegrationCapabilityRegistry.evaluateAll({ humanVerifiedUpiReceiptsCount: 0, upiClaimTested: true });
      const upiBefore = capBefore.integrations.find(i => i.id === 'DIRECT_UPI');
      expect(upiBefore?.state).not.toBe('OPERATIONALLY_VERIFIED');
      expect(upiBefore?.subState).toBe('PAYMENT_CLAIM_TESTED');

      // Submit UTR claim (PAYMENT_CLAIMED): MUST NOT auto-provision delivery_tasks
      const claimRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: buyOwnedJson.checkout.orderId,
          journeyId: buyOwnedJson.journeyId,
          utr: '432198765432',
          payerName: 'Stage I2 Test Buyer'
        })
      });
      expect(claimRes.status).toBe(201);
      const claimJson = await claimRes.json() as any;
      const claimId = claimJson.data.claimId;
      expect(db.prepare('SELECT COUNT(*) as c FROM delivery_tasks').get() as any).toMatchObject({ c: 0 });

      // Owner verifies bank receipt (HUMAN_VERIFIED_PAYMENT) -> fulfills delivery_tasks + FULFILLED journey + DIRECT_UPI OPERATIONALLY_VERIFIED
      const verifyResult = await new RazorpayAdapter().confirmManualUpiClaim({
        claimId,
        utr: '432198765432',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        amountINR: 499,
        journeyId: buyOwnedJson.journeyId,
        ownerUserId: 'usr_owner_01',
        serviceRendered: 'SiteFix AI Core Technical Fix-Pack'
      });
      expect(verifyResult.status).toBe('HUMAN_VERIFIED_PAYMENT');
      expect(verifyResult.fulfillment?.provisioned).toBe(true);
      expect(verifyResult.fulfillment?.stage).toBe('FULFILLMENT_READY');

      const delivTask = db.prepare('SELECT * FROM delivery_tasks WHERE id = ?').get(verifyResult.fulfillment.taskId) as any;
      expect(delivTask?.stage).toBe('FULFILLMENT_READY');
      const jRow = db.prepare('SELECT stage FROM customer_journeys WHERE id = ?').get(buyOwnedJson.journeyId) as any;
      expect(jRow?.stage).toBe('FULFILLED');

      const digestAfterVerify = await OwnerDigestService.getInstance().generateDigestAsync();
      const upiCapAfter = digestAfterVerify.arosControlCenter?.integrationCapabilities?.integrations?.find((i: any) => i.id === 'DIRECT_UPI');
      expect(upiCapAfter?.subState).toBe('PAYMENT_RECEIPT_HUMAN_VERIFIED');
      expect(upiCapAfter?.state).toBe('OPERATIONALLY_VERIFIED');

      // P2b: Affiliate deal READY_TO_BUY produces AFFILIATE_REDIRECT_READY
      const buyDealRes = await app.request('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'I want to purchase now',
          productSlugOrContext: 'sony-wh1000xm5-wireless'
        })
      });
      expect(buyDealRes.status).toBe(200);
      const buyDealJson = await buyDealRes.json() as any;
      expect(buyDealJson.checkout?.checkoutMode).toBe('AFFILIATE_REDIRECT_READY');
      expect(buyDealJson.checkout?.clickId).toBeTruthy();
      expect(buyDealJson.checkout?.redirectUrl).toContain('/api/v1/public/deals/sony-wh1000xm5-wireless/redirect');

      // P4: DurableEventBus retry -> RETRY_WAIT (attempts 1..2) -> DEAD_LETTER (attempt 3, surfaced in OwnerDigest)
      const evtId = await DurableEventBus.emitAsync({
        eventType: 'NEW_LEAD',
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        payload: { test: true }
      });
      const r1 = DurableEventBus.markRetryOrDeadLetter(evtId, 'aro-orchestrator', 'Transient timeout 1');
      expect(r1).toEqual({ status: 'RETRY_WAIT', attempts: 1 });
      const r2 = DurableEventBus.markRetryOrDeadLetter(evtId, 'aro-orchestrator', 'Transient timeout 2');
      expect(r2).toEqual({ status: 'RETRY_WAIT', attempts: 2 });
      const r3 = DurableEventBus.markRetryOrDeadLetter(evtId, 'aro-orchestrator', 'Fatal error 3');
      expect(r3).toEqual({ status: 'DEAD_LETTER', attempts: 3 });

      const dlqDigest = await OwnerDigestService.getInstance().generateDigestAsync();
      expect(dlqDigest.arosControlCenter?.scheduledExecutionTruth?.deadLetterEventsCount).toBe(1);

      // P6: Concierge widget present on /, /deals, and /tools/site-audit
      for (const routePath of ['/', '/deals', '/tools/site-audit']) {
        const htmlRes = await app.request(routePath);
        expect(htmlRes.status).toBe(200);
        const bodyHtml = await htmlRes.text();
        expect(bodyHtml).toContain('aros-desk-root');
        expect(bodyHtml).toContain('/api/v1/customer-desk/message');
      }
    });
  });
});
