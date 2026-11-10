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
import { getDb } from '../../src/db/client.js';
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
    const mockEligibleDeals = [
      {
        id: 'deal_4ea10ff4-5',
        title: 'boAt Rockerz 430 Gen 2 Wireless Headphones',
        brand: 'boAt',
        merchant: 'boAt',
        productUrl: 'https://www.boat-lifestyle.com/products/rockerz-430',
        affiliateRedirectUrl: 'https://clnk.in/D8C9',
        isMonetizable: true,
        availability: 'IN_STOCK',
        currentPriceINR: 1299
      },
      {
        id: 'deal_1f758bfb-7',
        title: 'boAt Airdopes Plus 221 Earbuds',
        brand: 'boAt',
        merchant: 'boAt',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-221',
        affiliateRedirectUrl: 'https://clnk.in/D8Da',
        isMonetizable: true,
        availability: 'IN_STOCK',
        currentPriceINR: 899
      },
      {
        id: 'deal_660e8e2f-1',
        title: 'Noise Kore Smartwatch',
        brand: 'Noise',
        merchant: 'Noise',
        productUrl: 'https://www.gonoise.com/products/noise-kore',
        affiliateRedirectUrl: 'https://clnk.in/D8Dt',
        isMonetizable: true,
        availability: 'IN_STOCK',
        currentPriceINR: 1199
      },
      {
        id: 'deal_3d917061-8',
        title: 'Noise ColorFit Icon Rise Max',
        brand: 'Noise',
        merchant: 'Noise',
        productUrl: 'https://www.gonoise.com/products/colorfit-icon-rise-max',
        affiliateRedirectUrl: 'https://clnk.in/D8Du',
        isMonetizable: true,
        availability: 'IN_STOCK',
        currentPriceINR: 1499
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

      expect(html).toContain('Editorial Notice: This educational guide provides factual comparison of official airline student concession rules');
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
    it('excludes generic SPA shell paths (/deals/:slug) from /sitemap.xml and advertises canonical SSR URLs', async () => {
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

      // Generic SPA shell deals (/deals/deal_...) must NOT be in sitemap.xml
      expect(text).not.toContain('<loc>https://ai-marketing-organization.onrender.com/deals/deal_');
      expect(text).not.toContain('<loc>https://ai-marketing-organization.onrender.com/deals/boat-');
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

      // Must list active merchants
      expect(html).toContain('across boAt, Noise with reference MRP verification');
      // Must not contain unbacked merchants like Lenovo or Amazon
      expect(html).not.toContain('Lenovo');
      expect(html).not.toContain('Amazon');
    });

    it('quarantines and excludes ambiguous/duplicate offer mappings (boAt Airdopes 141 Gen 2)', async () => {
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();

      // Attempting to resolve deal_boat_airdopes_141_gen2 or off_boat_airdopes_141_gen2 must fail closed
      const resolvedDeal = await dealEngine.resolveDeal('deal_boat_airdopes_141_gen2');
      expect(resolvedDeal).toBeNull();

      const resolvedOff = await dealEngine.resolveDeal('off_boat_airdopes_141_gen2');
      expect(resolvedOff).toBeNull();

      // Eligible public deals must not contain either ID
      const eligible = await dealEngine.getEligiblePublicDeals();
      expect(eligible.deals.find(d => d.id === 'deal_boat_airdopes_141_gen2')).toBeUndefined();
      expect(eligible.deals.find(d => d.id === 'off_boat_airdopes_141_gen2')).toBeUndefined();
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

      // Section 2: SiteFix AI Self-Serve Technical Audit
      expect(html).toContain('SiteFix AI — Autonomous Technical Website &amp; Conversion Audit');
      expect(html).toContain('href="/tools/site-audit"');
      expect(html).toContain('href="/tools/lead-leakage-calculator"');

      // Section 3: Verified Deals & Consumer Buying Guides with #Ad disclosure
      expect(html).toContain('Verified Consumer Deals &amp; Buying Guides');
      expect(html).toContain('#Ad — Independently Verified Deals');
      expect(html).toContain('href="/deals"');
      expect(html).toContain('href="/compare/electronics-technology"');
      expect(html).toContain('href="/guides/best-wireless-audio-smartwatches-india"');
      expect(html).toContain('href="/guides/student-flight-discounts-india"');

      // Clean footer disclosure without unbacked airline names
      expect(html).not.toContain('Akasa Air, Air India Express, Cleartrip');
      expect(html).toContain('boAt, Noise, and authorized affiliate networks');
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

      // Seed cron telemetry
      db.prepare(`
        INSERT OR REPLACE INTO cron_telemetry (
          id, total_pings, last_observed_ping, last_successful_cycle, cycle_result, last_user_agent, worker_source
        ) VALUES (
          'cloudflare_worker_cron', 50, ?, ?, 'SUCCESS', 'ai-marketing-cron-worker/1.0', 'CLOUDFLARE_WORKER'
        )
      `).run(nowIso, nowIso);

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
      const kitPath = path.resolve(process.cwd(), 'docs/SHARE_KIT.md');
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
});
