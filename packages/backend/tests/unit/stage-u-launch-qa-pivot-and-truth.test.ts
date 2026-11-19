import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import app from '../../src/index.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { DPDPComplianceManager } from '../../src/compliance/dpdp-manager.js';
import { normalizeCategoryName } from '../../src/commission/static-site-generator.js';

describe('Stage U — Close All PR #79 Blockers, Fix lint:owner-prices, Align Privacy/Deliverable Truth & Launch Developer Website Launch QA Pivot', () => {
  beforeEach(() => {
    const db = resetDbForTesting();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_default', 'Default Org', 'default-org')`).run();
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Org', 'owner-primary')`).run();
    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier, country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live)
      VALUES ('biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'platform-aro', 'TECHNOLOGY', 'Technology', 'LOW', 'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'Direct', 'ASSISTED', 0, 0)
    `).run();
    process.env.PUBLIC_SITE_NAME = 'SiteFix AI';
    process.env.PUBLIC_SITE_URL = 'https://ai-marketing-organization.onrender.com';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@sitefix.ai';
    process.env.SITE_AUDIT_SIGNING_SECRET = 'test_secret_must_be_at_least_32_characters_long_for_hmac_safety';
  });

  afterEach(() => {
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.PUBLIC_CONTACT_EMAIL;
    delete process.env.SITE_AUDIT_SIGNING_SECRET;
  });

  describe('Task 1: P0/P1 PR #79 Blockers, Privacy Truth & Normalization', () => {
    it('1.1 normalizeCategoryName consistently title-cases words and hyphenated variants so case variants map to canonical key', () => {
      expect(normalizeCategoryName('audio')).toBe('Audio');
      expect(normalizeCategoryName('Audio')).toBe('Audio');
      expect(normalizeCategoryName('AUDIO')).toBe('Audio');
      expect(normalizeCategoryName('smart-watches')).toBe('Smart Watches');
      expect(normalizeCategoryName('SMART-WATCHES')).toBe('Smart Watches');
      expect(normalizeCategoryName('home_appliances')).toBe('Home Appliances');
      expect(normalizeCategoryName({ name: 'Audio' })).toBe('Audio');
      expect(normalizeCategoryName({ slug: 'audio' })).toBe('Audio');
    });

    it('1.2 /privacy accurately states non-converted inquiries purge at 30 days while statutory financial records are retained per accounting rules', async () => {
      const res = await app.request('/privacy');
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('30 days');
      expect(html).toContain('DPDP Act 2023');
      expect(html).toContain('statutory commercial transaction records, financial ledgers, and tax invoices');
      expect(html).toContain('mandatory accounting compliance periods');
    });

    it('1.3 DPDPComplianceManager.purgeExpiredInquiries idempotently avoids double-counting already-scrubbed tombstones', async () => {
      const db = getDb();
      const pastDate = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
      const tombstoneId = `price_alert_claim_test_tombstone_${Date.now()}`;

      // Insert an in-flight delivery claim older than 30 days
      db.prepare(`
        INSERT INTO durable_events (id, organization_id, event_type, payload_json, processed, error_message, created_at)
        VALUES (?, 'org_default', 'PRICE_ALERT_DELIVERY_CLAIMED', '{"subscriberEmail":"leak@test.com","targetPrice":999}', 0, 'PROVIDER_CALL_ATTEMPTED_FAIL_CLOSED_CAS', ?)
      `).run(tombstoneId, pastDate);

      const manager = DPDPComplianceManager.getInstance();

      // First run: scrubs PII payload and sets dpdp_retention_purged:true
      const run1 = await manager.purgeExpiredInquiries(30);
      expect(run1.localDeleted).toBeGreaterThanOrEqual(1);

      const rowAfterRun1 = db.prepare(`SELECT payload_json FROM durable_events WHERE id = ?`).get(tombstoneId) as any;
      expect(rowAfterRun1).toBeDefined();
      expect(rowAfterRun1.payload_json).toContain('"dpdp_retention_purged":true');
      expect(rowAfterRun1.payload_json).not.toContain('leak@test.com');

      // Second run: MUST NOT recount or re-update the already-scrubbed tombstone
      const run2 = await manager.purgeExpiredInquiries(30);
      const rowAfterRun2 = db.prepare(`SELECT payload_json FROM durable_events WHERE id = ?`).get(tombstoneId) as any;
      expect(rowAfterRun2.payload_json).toBe(rowAfterRun1.payload_json);

      // Cleanup
      db.prepare(`DELETE FROM durable_events WHERE id = ?`).run(tombstoneId);
    });

    it('1.4 /api/v1/public/deals/:id/redirect hashes clientInfo.ip with daily prefix and never stores raw IP in referrals.ip', async () => {
      const db = getDb();
      const testDealId = `deal_test_hash_${Date.now()}`;
      const testSlug = `test-deal-ip-hash-${Date.now()}`;

      // Reset any leaked D1 credentials from earlier test suites
      delete process.env.CLOUDFLARE_D1_DATABASE_ID;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_D1_API_TOKEN;
      delete process.env.ALLOW_REMOTE_D1_READS;
      delete process.env.ALLOW_REMOTE_D1_WRITES;

      // Clean up any stale data from previous test runs
      db.prepare(`DELETE FROM partner_offers WHERE destination_url LIKE '%example.com%'`).run();
      db.prepare(`DELETE FROM referrals WHERE destination_url LIKE '%example.com%'`).run();
      db.prepare(`DELETE FROM referral_click_events WHERE destination_url LIKE '%example.com%'`).run();
      db.prepare(`DELETE FROM public_deals WHERE id = ?`).run(testDealId);

      const { AutonomousDealDiscoveryEngine } = await import('../../src/commission/autonomous-deal-discovery-engine.js');
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.clearInjectedDealsForTesting();
      engine.injectCandidateDealForTesting({
        id: testDealId,
        title: 'Test Earbuds ANC Pro',
        brand: 'TestBrand',
        merchant: 'ExampleMerchant',
        category: 'Audio',
        currentPriceINR: 999,
        referencePriceINR: 1999,
        currency: 'INR',
        productUrl: 'https://example.com/product',
        trackingUrl: 'https://linksredirect.com/?id=123',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '123',
        verificationStatus: 'VERIFIED',
        buyerValueScore: 92,
        scannedAt: new Date().toISOString()
      });

      // Insert persistent public_deals record for DB query resolution
      db.prepare(`
        INSERT OR REPLACE INTO public_deals (
          id, slug, canonical_slug, deal_kind, title, brand, merchant, category,
          sector_code, product_url, affiliate_url, current_price_inr, reference_price_inr,
          currency, availability, verification_status, evidence_json,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'PRODUCT', 'Test Earbuds ANC Pro', 'TestBrand', 'ExampleMerchant', 'Audio',
          'CONS_ELEC', 'https://example.com/product', 'https://linksredirect.com/?id=123', 999, 1999,
          'INR', 'IN_STOCK', 'VERIFIED', ?,
          datetime('now'), datetime('now')
        )
      `).run(
        testDealId,
        testSlug,
        testSlug,
        JSON.stringify({
          affiliateCampaignId: '123',
          affiliateNetwork: 'CUELINKS'
        })
      );

      // Mock approved channel & dynamic conversion
      const { CuelinksSyncManager } = await import('../../src/commission/cuelinks-sync-manager.js');
      const { CuelinksV3Client } = await import('../../src/commission/cuelinks-v3-client.js');
      const syncMgr = CuelinksSyncManager.getInstance();
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        channel: { id: 123, status: 'approved', name: 'ARO Deals' } as any,
        approved: true
      });
      const cuelinksClient = CuelinksV3Client.getInstance();
      vi.spyOn(cuelinksClient, 'convertLink').mockImplementation(async (opts: any) => ({
        url: opts.url,
        tracking_url: `https://linksredirect.com/?id=123&subid=${opts.subid}&subid2=${opts.subid2}&subid4=${opts.subid4}&url=${encodeURIComponent(opts.url)}`,
        affiliated: true,
        campaign: { id: 123, name: 'ExampleMerchant' } as any
      }));

      // Insert partner offer
      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer,
          destination_url, authorized_tracking_url, active, status
        ) VALUES (
          ?, 'part_cuelinks', 'org_owner_primary', 'Test Earbuds ANC Pro', ?, 'Audio', 'Shoppers',
          'https://example.com/product', 'https://linksredirect.com/?id=123', 1, 'ACTIVE'
        )
      `).run(testDealId, testSlug);

      const rawTestIp = '203.0.113.195';
      const res = await app.request(`/api/v1/public/deals/${testDealId}/redirect`, {
        headers: {
          'x-forwarded-for': rawTestIp,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0'
        }
      });
      expect(res.status).toBe(302);

      // Query referrals table for this redirect
      const refRow = db.prepare(`SELECT ip FROM referrals WHERE offer_id = ? ORDER BY created_at DESC LIMIT 1`).get(testDealId) as any;
      expect(refRow).toBeDefined();
      // Crucial: Raw IP MUST NOT be stored in referrals.ip
      expect(refRow.ip).not.toBe(rawTestIp);
      // It should be a 32-char hex SHA-256 hash prefix
      expect(refRow.ip).toMatch(/^[a-f0-9]{32}$/);

      // Cleanup
      db.prepare(`DELETE FROM partner_offers WHERE id = ?`).run(testDealId);
      db.prepare(`DELETE FROM public_deals WHERE id = ?`).run(testDealId);
      db.prepare(`DELETE FROM referrals WHERE offer_id = ?`).run(testDealId);
      db.prepare(`DELETE FROM referral_click_events WHERE offer_id = ?`).run(testDealId);
    });

    it('1.5 recordManualUpiClaim rejects IDOR attempts when invoiceRef belongs to another business or organization', async () => {
      const db = getDb();
      const { RazorpayAdapter } = await import('../../src/integrations/razorpay.js');
      const razorpay = new RazorpayAdapter();

      // Seed organization and two businesses
      db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_test_idor_1', 'Org 1', 'org-idor-1')`).run();
      db.prepare(`
        INSERT OR IGNORE INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier, country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live)
        VALUES ('biz_victim_01', 'org_test_idor_1', 'Victim Biz', 'victim', 'TECHNOLOGY', 'Technology', 'LOW', 'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Madhapur', 'Direct', 'ASSISTED', 0, 0)
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier, country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live)
        VALUES ('biz_attacker_01', 'org_test_idor_1', 'Attacker Biz', 'attacker', 'TECHNOLOGY', 'Technology', 'LOW', 'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Madhapur', 'Direct', 'ASSISTED', 0, 0)
      `).run();

      // Seed payment link belonging to biz_victim_01
      const victimLinkId = `plink_victim_${Date.now()}`;
      db.prepare(`
        INSERT INTO payment_provider_links (id, business_id, organization_id, provider_link_id, short_url, reference_id, amount_inr, status, created_at)
        VALUES (?, 'biz_victim_01', 'org_test_idor_1', ?, 'https://rzp.io/l/victim', 'ref_victim_01', 15000, 'CREATED', datetime('now'))
      `).run(victimLinkId, victimLinkId);

      // Attempt by biz_attacker_01 to claim victim's link reference must be rejected with UNAUTHORIZED_LINK_REFERENCE
      await expect(
        razorpay.recordManualUpiClaim({
          businessId: 'biz_attacker_01',
          invoiceRef: victimLinkId,
          utr: 'UTR_ATTACKER_IDOR_01',
          amountINR: 15000,
          payerName: 'Attacker'
        })
      ).rejects.toThrow(/UNAUTHORIZED_LINK_REFERENCE/);
    });

    it('1.6 DirectCommercialOfferPage supports single-read content for both attestation check and terms parsing', async () => {
      const { DirectCommercialOfferPage, parseDirectOfferTerms } = await import('../../src/revenue/direct-offer-page.js');
      const sampleTerms = '# Commercial Terms\n**Full Title:** AI Inbound Lead Conversion System\n**Price:** ₹15,000 Setup\n**Target Audience:** Indian SMBs\n**Billing Model:** One-Time';
      const terms = parseDirectOfferTerms(undefined, sampleTerms);
      expect(terms.isPayable).toBe(true);
      expect(terms.setupPriceINR).toBe(15000);
      expect(terms.billingModel).toBe('One-Time');
    });
  });

  describe('Task 2: Developer Website Launch QA Pivot & Recheck API', () => {
    it('2.1 Homepage (GET /) features the single-focus Developer Website Launch QA hero and CTAs', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Headline and Subheadline
      expect(html).toContain('Website Technical Launch Check &amp; Developer Fix-Pack — ₹499');
      expect(html).toContain('Run a free public HTML, metadata, Schema.org JSON-LD, robots.txt, and sitemap check before client handover. Unlock ready-to-paste fix files + 1 post-fix verification recheck for ₹499.');

      // Clear primary CTA to /tools/site-audit and secondary link to /deals
      expect(html).toContain('href="/tools/site-audit" class="btn btn-primary"');
      expect(html).toContain('href="/deals" class="btn btn-secondary"');

      // SiteFix audit card is primary under hero
      expect(html).toContain('SiteFix AI — Self-Serve Website &amp; Metadata Check');

      // Secondary section retains administrative inquiry capture for regression compatibility
      expect(html).toContain('Administrative Website &amp; WhatsApp Inquiry Capture');
    });

    it('2.2 /tools/site-audit renders the Copy Developer Handover Summary button and Post-Fix Included Recheck section', async () => {
      const res = await app.request('/tools/site-audit');
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('id="copyHandoverSummaryBtn"');
      expect(html).toContain('Copy Developer Handover Summary');
      expect(html).toContain('copyDeveloperHandoverSummary()');
      expect(html).toContain('tools/site-audit?url=');
      // Verify regex escapes in client script do not break into JavaScript comments
      expect(html).not.toContain('u.pathname.match(//tools/site-audit/');

      expect(html).toContain('id="postFixRecheckSection"');
      expect(html).toContain('Verify Fixes (Included Recheck)');
      expect(html).toContain('runPostFixRecheck()');
    });

    it('2.3 POST /api/v1/tools/site-audit/:auditId/recheck fails closed without valid audit or entitlement token', async () => {
      // 1. Non-existent auditId -> 404
      const res404 = await app.request('/api/v1/tools/site-audit/audit_non_existent/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'mock_token' })
      });
      expect(res404.status).toBe(404);
      const json404 = await res404.json() as any;
      expect(json404.error).toContain('AUDIT_NOT_FOUND');

      // 2. Existing audit without token -> 403
      const service = SiteAuditService.getInstance();
      const mockAudit = await service.runScan('https://example.com');
      expect(mockAudit.auditId).toBeDefined();

      const res403 = await app.request(`/api/v1/tools/site-audit/${mockAudit.auditId}/recheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid_token' })
      });
      expect(res403.status).toBe(403);
      const json403 = await res403.json() as any;
      expect(json403.error).toContain('RECHECK_UNAUTHORIZED');
    });

    it('2.4 POST /api/v1/tools/site-audit/:auditId/recheck executes scan, evaluates defects, and is idempotent on repeat calls', async () => {
      const service = SiteAuditService.getInstance();
      const mockAudit = await service.runScan('https://example.com');
      const auditId = mockAudit.auditId;

      // Generate genuine delivery token for this audit with order_test_ prefix
      const token = service.generateDeliveryToken('order_test_recheck', auditId, 'pay_test_recheck');

      // 1. First recheck call
      const res1 = await app.request(`/api/v1/tools/site-audit/${auditId}/recheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json() as any;
      expect(json1.success).toBe(true);
      expect(json1.auditId).toBe(auditId);
      expect(json1.beforeScore).toBe(mockAudit.score);
      expect(typeof json1.afterScore).toBe('number');
      expect(Array.isArray(json1.fixedChecks)).toBe(true);
      expect(Array.isArray(json1.remainingChecks)).toBe(true);

      // 2. Second recheck call (Idempotency test: returns cached payload without re-scanning)
      const res2 = await app.request(`/api/v1/tools/site-audit/${auditId}/recheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json() as any;
      expect(json2).toEqual(json1);
    });

    it('2.5 /owner/proposal and /offer keep payable checkout suppressed when DIRECT_OFFER.md has Price: TBD', async () => {
      const origReadFileSync = fs.readFileSync;
      const fsSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: any, encoding?: any) => {
        const p = String(filePath);
        if (p.includes('DIRECT_OFFER.md')) {
          return '# AI Inbound Lead Conversion System\n\n**Price:** TBD. Owner decides.\n**Monthly Retainer:** TBD\n**Billing Model:** TBD\n';
        }
        return origReadFileSync(filePath, encoding);
      });

      try {
        const { parseDirectOfferTerms, DirectCommercialOfferPage } = await import('../../src/revenue/direct-offer-page.js');
        const { OwnerAuthService } = await import('../../src/auth/owner-auth.js');
        const terms = parseDirectOfferTerms();
        expect(terms.isPayable).toBe(false);
        expect(terms.setupPriceINR).toBeNull();
        expect(terms.priceRaw).toContain('TBD');

        // /owner/proposal requires owner session and returns isPayable: false and setupPriceINR: null
        const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
        const propRes = await app.request('/owner/proposal', {
          headers: {
            Authorization: `Bearer ${session.token}`
          }
        });
        expect(propRes.status).toBe(200);
        const propJson = await propRes.json() as any;
        expect(propJson.isPayable).toBe(false);
        expect(propJson.data.setupPriceINR).toBeNull();

        // /offer HTML with attested terms renders the pending pricing notice rather than payment buttons or dead anchor
        const { resolveDirectOfferPath } = await import('../../src/revenue/direct-offer-page.js');
        const resolvedOfferPath = resolveDirectOfferPath();
        const actualHash = DirectCommercialOfferPage.computeDirectOfferHash(resolvedOfferPath || undefined);
        process.env.DIRECT_OFFER_TERMS_SHA256 = actualHash!;
        process.env.DIRECT_OFFER_TERMS_ATTESTED = 'true';

        const page = DirectCommercialOfferPage.getInstance();
        const offerHtml = page.renderOfferHtml({}, resolvedOfferPath || undefined);
        // When attested with pricing TBD, it does not offer ₹15,000 checkout buttons or dead #inquiry-card anchor
        expect(offerHtml).not.toContain('Generate ₹15,000 Setup Link');
        expect(offerHtml).not.toContain('href="#inquiry-card"');
        expect(offerHtml).toContain('Commercial Terms Attested — Pricing Pending Definition');

        delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
        delete process.env.DIRECT_OFFER_TERMS_SHA256;

        // POST /api/v1/payments/public/create-link fails closed when terms.isPayable is false
        const linkRes = await app.request('/api/v1/payments/public/create-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offerId: 'PLATFORM_SETUP',
            customerName: 'Test Client'
          })
        });
        expect(linkRes.status).toBe(400);
        const linkJson = await linkRes.json() as any;
        expect(linkJson.error).toBe('OFFER_PRICING_PENDING');
      } finally {
        fsSpy.mockRestore();
      }
    });

    it('2.6 parseDirectOfferTerms rejects price ranges, parses decimals and monthly retainer', async () => {
      const { parseDirectOfferTerms } = await import('../../src/revenue/direct-offer-page.js');
      const originalReadFileSync = fs.readFileSync;

      // Range check
      const spyRange = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: any, encoding?: any) => {
        if (String(filePath).includes('DIRECT_OFFER.md')) {
          return '# Direct Offer\n\n**Price:** ₹15,000–₹25,000 (scope dependent)\n**Billing Model:** ONE_TIME\n';
        }
        return originalReadFileSync(filePath, encoding);
      });
      try {
        const termsRange = parseDirectOfferTerms();
        expect(termsRange.isPayable).toBe(false);
        expect(termsRange.setupPriceINR).toBeNull();
      } finally {
        spyRange.mockRestore();
      }

      // Valid decimal + monthly retainer check
      const spyValid = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: any, encoding?: any) => {
        if (String(filePath).includes('DIRECT_OFFER.md')) {
          return '# Direct Offer\n\n**Price:** ₹14,999.50 Setup\n**Monthly Retainer:** ₹7,999/month\n**Billing Model:** ONE_TIME\n';
        }
        return originalReadFileSync(filePath, encoding);
      });
      try {
        const termsValid = parseDirectOfferTerms();
        expect(termsValid.isPayable).toBe(true);
        expect(termsValid.setupPriceINR).toBe(14999.5);
        expect(termsValid.monthlyPriceINR).toBe(7999);
      } finally {
        spyValid.mockRestore();
      }
    });

    it('2.7 resolveAuthorizedOffer strictly fails closed when offer has no payable price', async () => {
      const origReadFileSync = fs.readFileSync;
      const fsSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: any, encoding?: any) => {
        const p = String(filePath);
        if (p.includes('DIRECT_OFFER.md')) {
          return '# AI Inbound Lead Conversion System\n\n**Price:** TBD. Owner decides.\n**Monthly Retainer:** TBD\n**Billing Model:** TBD\n';
        }
        return origReadFileSync(filePath, encoding);
      });

      try {
        const { resolveAuthorizedOffer } = await import('../../src/revenue/offer-catalog.js');
        expect(() => resolveAuthorizedOffer('PLATFORM_SETUP', 'biz_platform_aro', 'org_owner_primary'))
          .toThrow(/OFFER_PRICING_PENDING/i);
        expect(() => resolveAuthorizedOffer('PLATFORM_MONTHLY', 'biz_platform_aro', 'org_owner_primary'))
          .toThrow(/OFFER_PRICING_PENDING/i);
      } finally {
        fsSpy.mockRestore();
      }
    });

    it('2.8 proposal checkout validates against approved proposal price rather than direct offer pricing', async () => {
      const db = getDb();
      const testPropId = `prop_val_checkout_${Date.now()}`;
      db.prepare(`
        INSERT INTO proposals (
          id, organization_id, business_id, prospect_id, title,
          customer_problem, proposed_solution, deliverables_json, timeline_days,
          setup_price_inr, monthly_price_inr, payment_terms, scope_boundary,
          next_step, status, created_at
        ) VALUES (
          ?, 'org_owner_primary', 'biz_platform_aro', 'prosp_test_1',
          'Approved Proposal', 'Prob', 'Sol', '[]', 5,
          15000, 8000, '50% upfront', 'Boundary',
          'Deploy', 'APPROVED', datetime('now')
        )
      `).run(testPropId);

      // Tampered amount (100) is rejected against the proposal's approved amount (15000)
      const resTampered = await app.request('/api/v1/payments/public/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: testPropId,
          amountINR: 100
        })
      });
      expect(resTampered.status).toBe(400);
      const jsonTampered = await resTampered.json() as any;
      expect(jsonTampered.error).toBe('PRICE_TAMPERING_REJECTED');

      // Matching amount (15000) succeeds even though DIRECT_OFFER.md is TBD
      const resMatch = await app.request('/api/v1/payments/public/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: testPropId,
          amountINR: 15000
        })
      });
      expect([200, 201]).toContain(resMatch.status);
      const jsonMatch = await resMatch.json() as any;
      expect(jsonMatch.success).toBe(true);
      expect(jsonMatch.data.amountINR).toBe(15000);
    });

    it('2.9 handleSiteAuditRecheck correctly matches fixed checks by stable checkId', async () => {
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const { SecureUrlFetcher } = await import('../../src/tools/site-audit/secure-url-fetcher.js');
      const service = SiteAuditService.getInstance();
      const testUrl = 'https://example.com';

      // Hermetic deterministic fetch stub to prevent live network dependency
      const fetchSpy = vi.spyOn(SecureUrlFetcher.prototype, 'fetch').mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!DOCTYPE html><html><head><title>Test Example Site</title></head><body><h1>Deterministic Test</h1></body></html>',
        finalUrl: 'https://example.com',
        redirectCount: 0,
        timingMs: 40
      } as any);

      // 1. Initial scan of example.com (has defects like meta_description_missing, schema_jsonld_missing)
      const initialAudit = await service.runScan(testUrl);

      // Verify initial findings include at least one defect with a stable checkId
      const initialDefect = initialAudit.findings.find(f => f.status !== 'PASS');
      expect(initialDefect).toBeDefined();
      const defectCheckId = initialDefect?.checkId;
      expect(defectCheckId).toBeDefined();

      // 2. Generate genuine delivery token for audit
      const token = service.generateDeliveryToken('order_test_checkid', initialAudit.auditId, 'pay_test_checkid');

      // 3. Mock rescan result where the defect is now resolved to PASS
      const originalRunScan = service.runScan.bind(service);
      const rescanSpy = vi.spyOn(service, 'runScan').mockImplementation(async (url: string) => {
        const fresh = await originalRunScan(url);
        // Flip the initial defect finding to PASS with the same checkId
        fresh.findings = fresh.findings.map(f => {
          if (f.checkId === defectCheckId) {
            return {
              ...f,
              id: `${defectCheckId}_optimal`,
              title: `${f.title} (Resolved Optimal)`,
              status: 'PASS',
              severity: 'INFO'
            };
          }
          return f;
        });
        return fresh;
      });

      try {
        const recheckRes = await app.request(`/api/v1/tools/site-audit/${initialAudit.auditId}/recheck`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        expect(recheckRes.status).toBe(200);
        const recheckJson = await recheckRes.json() as any;
        expect(recheckJson.success).toBe(true);
        expect(recheckJson.fixedCount).toBeGreaterThanOrEqual(1);
        const fixedDefect = recheckJson.fixedChecks.find((f: any) => f.checkId === defectCheckId);
        expect(fixedDefect).toBeDefined();
        expect(fixedDefect.currentStatus).toBe('VERIFIED');
      } finally {
        fetchSpy.mockRestore();
        rescanSpy.mockRestore();
      }
    });
  });
});
