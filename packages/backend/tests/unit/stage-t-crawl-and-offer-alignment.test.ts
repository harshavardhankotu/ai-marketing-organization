import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { app } from '../../src/index.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { DirectCommercialOfferPage, computeOwnOfferHash, computeDirectOfferHash } from '../../src/revenue/direct-offer-page.js';
import { normalizeCategoryName, generateBuyerIntentHubs } from '../../src/commission/static-site-generator.js';
import { normalizeCategoryName as dealEngineNormalize } from '../../src/commission/autonomous-deal-discovery-engine.js';

describe('Stage T — Live OpenSEO Crawl Leaks & Commercial Offer Alignment (PR #79)', () => {
  const originalDirectSha = process.env.DIRECT_OFFER_TERMS_SHA256;
  const originalDirectAttested = process.env.DIRECT_OFFER_TERMS_ATTESTED;
  const originalOwnConfirmed = process.env.OWN_OFFER_CONFIRMED;

  beforeEach(() => {
    delete process.env.DIRECT_OFFER_TERMS_SHA256;
    delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
    delete process.env.OWN_OFFER_CONFIRMED;
  });

  afterEach(() => {
    if (originalDirectSha !== undefined) process.env.DIRECT_OFFER_TERMS_SHA256 = originalDirectSha;
    else delete process.env.DIRECT_OFFER_TERMS_SHA256;

    if (originalDirectAttested !== undefined) process.env.DIRECT_OFFER_TERMS_ATTESTED = originalDirectAttested;
    else delete process.env.DIRECT_OFFER_TERMS_ATTESTED;

    if (originalOwnConfirmed !== undefined) process.env.OWN_OFFER_CONFIRMED = originalOwnConfirmed;
    else delete process.env.OWN_OFFER_CONFIRMED;
  });

  describe('Task 1: Homepage (GET /) Positioning, Metadata & CTAs', () => {
    it('serves <title> <= 60 chars and <meta name="description"> <= 155 chars', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Title check
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      expect(titleMatch).toBeTruthy();
      const rawTitle = titleMatch![1].replace(/&amp;/g, '&');
      expect(rawTitle).toBe('SiteFix AI — Free Website SEO Audit & Fair-Price Deals India');
      expect(rawTitle.length).toBeLessThanOrEqual(60);
      expect(rawTitle.length).toBe(60);

      // Meta description check
      const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
      expect(descMatch).toBeTruthy();
      const rawDesc = descMatch![1].replace(/&amp;/g, '&');
      expect(rawDesc).toBe('Run a free technical website scan and get ready-to-paste SEO & Schema fixes for ₹499, or compare verified fair-price deals in India.');
      expect(rawDesc.length).toBeLessThanOrEqual(155);
      expect(rawDesc.length).toBe(132);
    });

    it('positions Primary CTA (/tools/site-audit) and Secondary CTA (/deals) prominently in hero', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Primary CTA
      expect(html).toContain('href="/tools/site-audit"');
      expect(html).toMatch(/Run Free Technical Website Scan/i);

      // Secondary CTA
      expect(html).toContain('href="/deals"');
      expect(html).toMatch(/Browse Verified Fair-Price Deals/i);

      // Top nav contains links
      expect(html).toContain('href="/tools/site-audit"');
      expect(html).toContain('href="/deals"');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
    });
  });

  describe('Task 2: Decoupled /offer Attestation & Cross-Product Isolation', () => {
    it('strictly refuses attestation when DIRECT_OFFER_TERMS_SHA256 matches owner/OWN_OFFER.md (SiteFix hash)', () => {
      const sitefixHash = computeOwnOfferHash();
      expect(sitefixHash).toBeDefined();

      // Attacker or misconfigured system attempts to unlock /offer with SiteFix OWN_OFFER.md hash
      process.env.DIRECT_OFFER_TERMS_SHA256 = sitefixHash!;
      process.env.DIRECT_OFFER_TERMS_ATTESTED = 'true';
      process.env.OWN_OFFER_CONFIRMED = 'true';

      // MUST NOT UNLOCK!
      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);

      // Passing OWN_OFFER.md custom path must also be rejected
      const ownOfferPath = path.resolve(process.cwd(), 'owner', 'OWN_OFFER.md');
      expect(DirectCommercialOfferPage.isDirectOfferAttested(ownOfferPath)).toBe(false);
    });

    it('refuses attestation if DIRECT_OFFER_TERMS_ATTESTED is not true even if hash matches DIRECT_OFFER.md', () => {
      const directHash = computeDirectOfferHash();
      expect(directHash).toBeDefined();

      process.env.DIRECT_OFFER_TERMS_SHA256 = directHash!;
      delete process.env.DIRECT_OFFER_TERMS_ATTESTED;

      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);
    });

    it('unlocks attestation ONLY when DIRECT_OFFER_TERMS_ATTESTED=true and hash matches owner/DIRECT_OFFER.md', () => {
      const directHash = computeDirectOfferHash();
      expect(directHash).toBeDefined();

      process.env.DIRECT_OFFER_TERMS_SHA256 = directHash!;
      process.env.DIRECT_OFFER_TERMS_ATTESTED = 'true';

      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(true);
    });

    it('renders <meta name="robots" content="noindex, nofollow"> and zero payment links when unattested', () => {
      delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
      delete process.env.DIRECT_OFFER_TERMS_SHA256;

      const page = DirectCommercialOfferPage.getInstance();
      const html = page.renderOfferHtml({
        siteName: 'AI Marketing Organization',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      });

      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).not.toContain('upi://pay');
      expect(html).not.toContain('razorpay.me');
      expect(html).not.toContain('checkout.razorpay.com');
      expect(html).not.toContain('₹15,000');
    });
  });

  describe('Task 3: Category Normalization, Sitemap Cleanup & Outgoing Nav Links', () => {
    it('normalizeCategoryName correctly handles objects, strings, nulls, and eliminates [object Object]', () => {
      expect(normalizeCategoryName({ name: 'Electronics & Audio' })).toBe('Electronics & Audio');
      expect(normalizeCategoryName({ title: 'Grooming & Fragrance' })).toBe('Grooming & Fragrance');
      expect(normalizeCategoryName({ slug: 'smart-watches' })).toBe('Smart Watches');
      expect(normalizeCategoryName('Fashion & Apparel')).toBe('Fashion & Apparel');
      expect(normalizeCategoryName('audio')).toBe('Audio');
      expect(normalizeCategoryName('Audio')).toBe('Audio');
      expect(normalizeCategoryName('AUDIO')).toBe('Audio');
      expect(normalizeCategoryName(null)).toBe('General');
      expect(normalizeCategoryName(undefined)).toBe('General');
      expect(normalizeCategoryName('[object Object]')).toBe('General');
      expect(normalizeCategoryName('[object object]')).toBe('General');

      // Verify parity with dealEngine re-export
      expect(dealEngineNormalize({ name: 'Home Appliances' })).toBe('Home Appliances');
      expect(dealEngineNormalize('[object Object]')).toBe('General');

      // Verify recursive unnesting
      expect(normalizeCategoryName({ category: { name: 'Travel' } })).toBe('Travel');
      expect(normalizeCategoryName({ category: 'Electronics' })).toBe('Electronics');
    });

    it('generateBuyerIntentHubs never generates best-object-object-deals-india slug', () => {
      const mockDeals = [
        {
          id: 'deal_obj_01',
          productVerified: true,
          affiliateVerified: true,
          isMonetizable: true,
          availability: 'IN_STOCK',
          affiliateNetwork: 'CUELINKS',
          productUrl: 'https://example.com/p1',
          currentPriceINR: 799,
          title: 'Object Deal 1',
          category: { name: 'Audio' } as any
        },
        {
          id: 'deal_obj_02',
          productVerified: true,
          affiliateVerified: true,
          isMonetizable: true,
          availability: 'IN_STOCK',
          affiliateNetwork: 'CUELINKS',
          productUrl: 'https://example.com/p2',
          currentPriceINR: 899,
          title: 'Object Deal 2',
          category: { name: 'Audio' } as any
        },
        {
          id: 'deal_bad_01',
          productVerified: true,
          affiliateVerified: true,
          isMonetizable: true,
          availability: 'IN_STOCK',
          affiliateNetwork: 'CUELINKS',
          productUrl: 'https://example.com/p3',
          currentPriceINR: 999,
          title: 'Bad Object Deal 1',
          category: '[object Object]' as any
        },
        {
          id: 'deal_bad_02',
          productVerified: true,
          affiliateVerified: true,
          isMonetizable: true,
          availability: 'IN_STOCK',
          affiliateNetwork: 'CUELINKS',
          productUrl: 'https://example.com/p4',
          currentPriceINR: 1099,
          title: 'Bad Object Deal 2',
          category: '[object Object]' as any
        }
      ];

      const hubs = generateBuyerIntentHubs(mockDeals, 'https://test.site', 10);
      const slugs = hubs.map(h => h.intentSlug);

      expect(slugs.some(s => s.includes('object-object'))).toBe(false);
      expect(slugs.some(s => s.includes('object'))).toBe(false);
    });

    it('GET /sitemap.xml omits unattested /offer and emits only URLs that resolve HTTP 200', async () => {
      // Unattested state: /offer must NOT appear in sitemap
      delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
      delete process.env.DIRECT_OFFER_TERMS_SHA256;

      const res = await app.request('/sitemap.xml');
      expect(res.status).toBe(200);
      const xml = await res.text();

      // Must NOT contain unattested noindex /offer URL
      expect(xml).not.toContain('<loc>https://ai-marketing-organization.onrender.com/offer</loc>');

      // Must NOT contain object-object
      expect(xml).not.toContain('object-object');

      // Must contain core active 200 routes
      expect(xml).toContain('<loc>https://ai-marketing-organization.onrender.com/</loc>');
      expect(xml).toContain('<loc>https://ai-marketing-organization.onrender.com/deals</loc>');
      expect(xml).toContain('<loc>https://ai-marketing-organization.onrender.com/tools/site-audit</loc>');
      expect(xml).toContain('<loc>https://ai-marketing-organization.onrender.com/revenue</loc>');
      expect(xml).toContain('<loc>https://ai-marketing-organization.onrender.com/privacy</loc>');
      expect(xml).toContain('<loc>https://ai-marketing-organization.onrender.com/terms</loc>');

      // Verify that all core static routes return HTTP 200
      const coreRoutes = ['/', '/deals', '/tools/site-audit', '/revenue', '/privacy', '/terms'];
      for (const r of coreRoutes) {
        const routeRes = await app.request(r);
        expect(routeRes.status).toBe(200);
      }
    });

    it('adds outgoing navigation links on /tools/site-audit pointing to /, /deals, /privacy, and /terms', async () => {
      const res = await app.request('/tools/site-audit');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Check header nav
      expect(html).toContain('<nav');
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/deals"');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');

      // Check footer nav
      expect(html).toContain('<footer');
      expect(html).toContain('Privacy Policy');
      expect(html).toContain('Terms of Service');
    });

    it('handles legacy or missing /guides/:slug with clean 404 (noindex) without 502/503 errors', async () => {
      const res = await app.request('/guides/non-existent-legacy-guide-test');
      // Must be 404 with noindex (or 301 redirect) — NEVER 502 or 503
      expect([301, 404]).toContain(res.status);
      if (res.status === 404) {
        expect(res.headers.get('x-robots-tag')).toContain('noindex');
        const body = await res.text();
        expect(body).toContain('noindex, nofollow');
      }
    });

    it('DPDP Compliance Manager purges PRICE_DROP_SUBSCRIPTION older than 30 days from durable_events', async () => {
      const { getDb } = await import('../../src/db/client.js');
      const { DPDPComplianceManager } = await import('../../src/compliance/dpdp-manager.js');
      const db = getDb();

      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date().toISOString();

      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, created_at)
        VALUES ('evt_old_dpdp_test', 'PRICE_DROP_SUBSCRIPTION', 'org_owner_primary', '{"email":"old@test.com"}', 1, ?)
      `).run(oldDate);

      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, created_at)
        VALUES ('evt_recent_dpdp_test', 'PRICE_DROP_SUBSCRIPTION', 'org_owner_primary', '{"email":"recent@test.com"}', 0, ?)
      `).run(recentDate);

      const res = await DPDPComplianceManager.getInstance().purgeExpiredInquiries(30);
      expect(res.purgedCount).toBeGreaterThanOrEqual(1);
      expect(res.localDeleted).toBeGreaterThanOrEqual(1);
      expect(['EXECUTED', 'SKIPPED']).toContain(res.remoteStatus);

      const oldEvt = db.prepare(`SELECT * FROM durable_events WHERE id = 'evt_old_dpdp_test'`).get();
      expect(oldEvt).toBeUndefined();

      const recentEvt = db.prepare(`SELECT * FROM durable_events WHERE id = 'evt_recent_dpdp_test'`).get();
      expect(recentEvt).toBeDefined();

      // Clean up
      db.prepare(`DELETE FROM durable_events WHERE id = 'evt_recent_dpdp_test'`).run();
    });

    it('DPDP purge preserves PROVIDER_CALL_ATTEMPTED and PRE_SEND_LEASE delivery-safety tombstones while scrubbing PII', async () => {
      const { getDb } = await import('../../src/db/client.js');
      const { DPDPComplianceManager } = await import('../../src/compliance/dpdp-manager.js');
      const db = getDb();

      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();

      // 1. In-flight claim with PROVIDER_CALL_ATTEMPTED (MUST NOT BE DELETED; PII scrubbed)
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
        VALUES ('price_alert_claim_attempted_01', 'PRICE_ALERT_DELIVERY_CLAIMED', 'org_owner_primary', '{"email":"patient@provider.com","targetPrice":499}', 0, 'PROVIDER_CALL_ATTEMPTED:BREVO:1795000000', ?)
      `).run(oldDate);

      // 2. In-flight claim with PRE_SEND_LEASE (MUST NOT BE DELETED; PII scrubbed)
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
        VALUES ('price_alert_claim_leased_02', 'PRICE_ALERT_DELIVERY_CLAIMED', 'org_owner_primary', '{"email":"leased@customer.com","targetPrice":299}', 0, 'PRE_SEND_LEASE:1795000000', ?)
      `).run(oldDate);

      // 3. Completed terminal claim without lease/attempted error (MUST BE DELETED)
      db.prepare(`
        INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
        VALUES ('price_alert_claim_completed_03', 'PRICE_ALERT_DELIVERY_CLAIMED', 'org_owner_primary', '{"email":"done@customer.com","targetPrice":999}', 1, NULL, ?)
      `).run(oldDate);

      const res = await DPDPComplianceManager.getInstance().purgeExpiredInquiries(30);
      expect(res.localDeleted).toBeGreaterThanOrEqual(1);

      // Check attempted claim: row remains, PII scrubbed
      const attemptedRow = db.prepare(`SELECT * FROM durable_events WHERE id = 'price_alert_claim_attempted_01'`).get() as any;
      expect(attemptedRow).toBeDefined();
      expect(attemptedRow.payload_json).not.toContain('patient@provider.com');
      expect(attemptedRow.payload_json).toContain('"scrubbed":true');

      // Check leased claim: row remains, PII scrubbed
      const leasedRow = db.prepare(`SELECT * FROM durable_events WHERE id = 'price_alert_claim_leased_02'`).get() as any;
      expect(leasedRow).toBeDefined();
      expect(leasedRow.payload_json).not.toContain('leased@customer.com');
      expect(leasedRow.payload_json).toContain('"scrubbed":true');

      // Check terminal claim: row deleted completely
      const completedRow = db.prepare(`SELECT * FROM durable_events WHERE id = 'price_alert_claim_completed_03'`).get();
      expect(completedRow).toBeUndefined();

      // Clean up
      db.prepare(`DELETE FROM durable_events WHERE id IN ('price_alert_claim_attempted_01', 'price_alert_claim_leased_02')`).run();
    });

    it('DPDP purge uses D1 authorized write path (executeWrite) when remote D1 writes are allowed', async () => {
      const { D1RevenueRepository } = await import('../../src/db/d1-revenue-repository.js');
      const { DPDPComplianceManager } = await import('../../src/compliance/dpdp-manager.js');
      const d1Repo = D1RevenueRepository.getInstance();

      const writesLogged: Array<{ table: string; sql: string; params: any[] }> = [];
      const origIsWriteAllowed = d1Repo.isRemoteD1WriteAllowed.bind(d1Repo);
      const origExecuteWrite = d1Repo.executeWrite.bind(d1Repo);

      // Mock remote D1 write allowed and track executeWrite calls
      d1Repo.isRemoteD1WriteAllowed = () => true;
      d1Repo.executeWrite = async (table: any, sql: string, params: any[] = []) => {
        writesLogged.push({ table, sql, params });
        return { rowsAffected: 1, source: 'CLOUDFLARE_D1' };
      };

      try {
        const res = await DPDPComplianceManager.getInstance().purgeExpiredInquiries(30);
        expect(res.remoteStatus).toBe('EXECUTED');
        expect(res.remoteDeleted).toBeGreaterThanOrEqual(1);
        expect(writesLogged.length).toBe(6);
        expect(writesLogged.some(w => w.table === 'platform_prospects')).toBe(true);
        expect(writesLogged.some(w => w.table === 'durable_events' && w.sql.includes('PRICE_DROP_SUBSCRIPTION'))).toBe(true);
        expect(writesLogged.some(w => w.table === 'durable_events' && w.sql.includes('PRICE_ALERT_DELIVERY_CLAIMED'))).toBe(true);
        expect(writesLogged.some(w => w.table === 'outbound_contacts')).toBe(true);
      } finally {
        d1Repo.isRemoteD1WriteAllowed = origIsWriteAllowed;
        d1Repo.executeWrite = origExecuteWrite;
      }
    });

    it('/tools/site-audit renders #sampleFixPackSection with real snippets and honest disclosure', async () => {
      const res = await app.request('/tools/site-audit');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Inspect Real Sample Fix-Pack drawer exists
      expect(html).toContain('id="sampleFixPackSection"');
      expect(html).toContain('Inspect Real Sample Fix-Pack (Before You Pay ₹499)');

      // Disclosure statement
      expect(html).toContain('Files are generated from your live scan for you or your developer to review and paste. SiteFix does not modify your live server or guarantee search rankings.');

      // Before / After meta snippets
      expect(html).toContain('Before / After &lt;title&gt; &amp; &lt;meta name="description"&gt;');
      expect(html).toContain('SiteFix AI — Free Website SEO Audit &amp; Fair-Price Deals India');

      // Valid Schema.org WebApplication snippet
      expect(html).toContain('"@type": "WebApplication"');
      expect(html).toContain('"applicationCategory": "BusinessApplication"');

      // robots.txt and sitemap.xml rules
      expect(html).toContain('robots.txt:');
      expect(html).toContain('Sitemap: https://ai-marketing-organization.onrender.com/sitemap.xml');

      // 5-step checklist
      expect(html).toContain('5-Step Developer / Owner Verification Checklist');
      expect(html).toContain('Google Rich Results Test');

      // Findings template includes Commercial Impact & Fix-Pack deliverable tagging
      expect(html).toContain('Commercial Impact:');
      expect(html).toContain('Included in ₹499 Fix-Pack:');
    });

    it('/owner/proposal and /owner/facts-status consistently reference owner/DIRECT_OFFER.md', async () => {
      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const propRes = await app.request('/owner/proposal', {
        headers: {
          Authorization: `Bearer ${session.token}`
        }
      });
      expect(propRes.status).toBe(200);
      const propJson = await propRes.json();
      expect(propJson.message).toContain('owner/DIRECT_OFFER.md');
      expect(propJson.data.source).toContain('owner/DIRECT_OFFER.md');

      const factsRes = await app.request('/api/v1/owner/facts-status', {
        headers: {
          Authorization: `Bearer ${session.token}`
        }
      });
      expect(factsRes.status).toBe(200);
      const factsJson = await factsRes.json();
      const directCheck = factsJson.directLane?.facts?.find((c: any) => c.field === 'DIRECT_OFFER_TERMS_SHA256')
        || factsJson.data?.allFacts?.find((c: any) => c.field === 'DIRECT_OFFER_TERMS_SHA256');
      expect(directCheck).toBeDefined();
      expect(directCheck.reason).toContain('owner/DIRECT_OFFER.md');
    });

    it('/privacy explicitly describes non-PII first-party clickId and Cuelinks SubID attribution', async () => {
      const res = await app.request('/privacy');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('clickId');
      expect(html).toContain('Cuelinks SubID');
      expect(html).toContain('zero device fingerprinting');
    });
  });
});
