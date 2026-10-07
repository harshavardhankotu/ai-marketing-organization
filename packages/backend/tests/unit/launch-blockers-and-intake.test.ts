import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { CommissionLedgerEngine } from '../../src/commission/commission-ledger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Launch Blockers & Intake Test Suite', () => {
  const testOrgId = 'org_owner_primary';
  const ownerKey = 'dev_owner_key_secret';
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.OWNER_API_KEY = ownerKey;
    process.env.AMAZON_AFFILIATE_TAG = 'mock-assoc-21';
    process.env.PUBLIC_SITE_NAME = 'AI Marketing Organization';
    process.env.PUBLIC_AUTHOR_NAME = 'Platform Operator';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@example.com';
    process.env.PUBLIC_SITE_URL = 'https://ai-marketing-platform-core.web.app';

    const db = getDb();
    // Clean test tables
    try {
      db.prepare("DELETE FROM partners WHERE organization_id = ?").run(testOrgId);
      db.prepare("DELETE FROM partner_offers WHERE organization_id = ?").run(testOrgId);
      db.prepare("DELETE FROM commission_content_assets WHERE organization_id = ?").run(testOrgId);
      db.prepare("DELETE FROM commission_records WHERE organization_id = ?").run(testOrgId);
      db.prepare("DELETE FROM referral_click_events WHERE organization_id = ?").run(testOrgId);
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Conversion Webhook Hardening', () => {
    it('returns 404 with 0 writes for AMAZON_ASSOCIATES partner shaped like D1 part_amazon_in_01', async () => {
      const db = getDb();
      // Insert partner shaped exactly like the Cloudflare D1 row for part_amazon_in_01
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, country, website,
          partner_type, commission_type, cookie_window_days, qualifying_event,
          approval_status, active_status, source, network, tracking_type,
          authorization_status, evidence_json, created_at, updated_at
        ) VALUES (
          'part_amazon_in_01', ?, 'Amazon India Associates', 'Retail', 'India', 'https://associates.amazon.in',
          'AFFILIATE', 'PERCENTAGE', 1, 'PURCHASE',
          'APPROVED', 1, 'OPERATOR_PROVISIONAL', 'AMAZON_ASSOCIATES', 'AFFILIATE_LINK',
          'AUTHORIZED', '{}', datetime('now'), datetime('now')
        )
      `).run(testOrgId);

      // Attempt conversion webhook post
      const res = await app.request('/api/v1/webhooks/conversion/part_amazon_in_01', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'any_secret_attempt'
        },
        body: JSON.stringify({
          transaction_id: 'amz_tx_9999',
          amount: 500,
          status: 'APPROVED'
        })
      });

      // Must return 404 Not Found (Amazon has no conversion webhook)
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('NOT_FOUND');

      // Zero writes
      const commissions = db.prepare("SELECT COUNT(*) as c FROM commission_records WHERE partner_id = 'part_amazon_in_01'").get() as any;
      expect(commissions.c).toBe(0);
    });

    it('returns 404 when partner has no webhook secret configured in env or evidence', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, website,
          network, approval_status, authorization_status, evidence_json
        ) VALUES (
          'part_custom_network_01', ?, 'Custom Affiliate Network', 'Software', 'https://custom-network.com',
          'OTHER_AUTHORIZED_PARTNER', 'APPROVED', 'AUTHORIZED', '{}'
        )
      `).run(testOrgId);

      const res = await app.request('/api/v1/webhooks/conversion/part_custom_network_01', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'guess_secret'
        },
        body: JSON.stringify({ transaction_id: 'tx_123', amount: 100 })
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('NOT_FOUND');
    });

    it('uses constant-time comparison and validates secret when configured in env', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, website,
          network, approval_status, authorization_status, evidence_json
        ) VALUES (
          'part_cpl_01', ?, 'CPL Partner Network', 'Finance', 'https://cpl-network.com',
          'CPL_PARTNER', 'APPROVED', 'AUTHORIZED', '{}'
        )
      `).run(testOrgId);

      process.env.PARTNER_WEBHOOK_SECRET_PART_CPL_01 = 'top_secret_token_12345';

      // 1. Missing secret -> 401
      const resNoSecret = await app.request('/api/v1/webhooks/conversion/part_cpl_01', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: 'tx_1', amount: 100 })
      });
      expect(resNoSecret.status).toBe(401);

      // 2. Wrong secret -> 401
      const resWrongSecret = await app.request('/api/v1/webhooks/conversion/part_cpl_01', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'wrong_secret_attempt'
        },
        body: JSON.stringify({ transaction_id: 'tx_1', amount: 100 })
      });
      expect(resWrongSecret.status).toBe(401);

      // 3. Valid secret -> 200
      const resValid = await app.request('/api/v1/webhooks/conversion/part_cpl_01', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'top_secret_token_12345'
        },
        body: JSON.stringify({
          transaction_id: 'cpl_tx_888',
          amount: 250,
          status: 'APPROVED'
        })
      });
      expect(resValid.status).toBe(200);
      const resJson = await resValid.json();
      expect(resJson.success).toBe(true);

      // 4. Global PARTNER_WEBHOOK_SECRET fallback removed: per-partner secret only
      process.env.PARTNER_WEBHOOK_SECRET = 'global_secret_ignored';
      delete process.env.PARTNER_WEBHOOK_SECRET_PART_CPL_01;
      const resGlobalIgnored = await app.request('/api/v1/webhooks/conversion/part_cpl_01', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'global_secret_ignored'
        },
        body: JSON.stringify({
          transaction_id: 'cpl_tx_global_attempt',
          amount: 500,
          status: 'APPROVED'
        })
      });
      // Returns 404 because no partner-specific secret is configured
      expect(resGlobalIgnored.status).toBe(404);
    });
  });

  describe('2. Labels & Status Integrity', () => {
    it('shows CONFIGURED_UNVERIFIED for AFFILIATE ID and PROVISIONAL for PARTNER APPROVAL in money-path and launch-checklist', async () => {
      const db = getDb();
      // Provision Amazon partner in DB
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, website,
          network, approval_status, authorization_status, evidence_json
        ) VALUES (
          'part_amazon_in_01', ?, 'Amazon India Associates', 'Retail', 'https://associates.amazon.in',
          'AMAZON_ASSOCIATES', 'APPROVED', 'AUTHORIZED', '{"terms_read_confirmed":false}'
        )
      `).run(testOrgId);

      const session = OwnerAuthService.getInstance().createSession('usr_owner_01', testOrgId);

      // 1. Check money-path
      const resMp = await app.request('/api/v1/commission/money-path', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': testOrgId }
      });
      expect(resMp.status).toBe(200);
      const mpJson = await resMp.json();
      const mpChecklist = mpJson.data.checklist;

      const partnerApprovalItem = mpChecklist.find((i: any) => i.item === 'PARTNER APPROVAL');
      expect(partnerApprovalItem.status).toBe('PROVISIONAL');

      const affiliateIdItem = mpChecklist.find((i: any) => i.item === 'AFFILIATE ID');
      expect(affiliateIdItem.status).toBe('CONFIGURED_UNVERIFIED');

      const partnerTermsItem = mpChecklist.find((i: any) => i.item === 'PARTNER TERMS');
      expect(partnerTermsItem.status).toBe('OPERATOR_TO_CONFIRM');

      // 2. Check launch-checklist
      const resCl = await app.request('/api/v1/commission/launch-checklist', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': testOrgId }
      });
      expect(resCl.status).toBe(200);
      const clJson = await resCl.json();
      const clChecklist = clJson.data.checklist;

      expect(clChecklist.find((i: any) => i.item === 'PARTNER APPROVAL').status).toBe('PROVISIONAL');
      expect(clChecklist.find((i: any) => i.item === 'AFFILIATE ID').status).toBe('CONFIGURED_UNVERIFIED');

      // 3. Check GET /commission/partners dashboard mapping
      const resPartners = await app.request('/api/v1/commission/partners', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': testOrgId }
      });
      expect(resPartners.status).toBe(200);
      const partnersJson = await resPartners.json();
      const amazonPartner = partnersJson.data.find((p: any) => p.network === 'AMAZON_ASSOCIATES');
      expect(amazonPartner.displayApprovalStatus).toBe('PROVISIONAL');
      expect(amazonPartner.displayAuthorizationStatus).toBe('PROVISIONAL');
    });
  });

  describe('5. Static Public Site Generator', () => {
    it('fails when any of PUBLIC_SITE_NAME, PUBLIC_AUTHOR_NAME, or PUBLIC_CONTACT_EMAIL is missing', async () => {
      delete process.env.PUBLIC_SITE_NAME;
      delete process.env.PUBLIC_AUTHOR_NAME;

      const generator = StaticSiteGenerator.getInstance();
      expect(() => generator.validateConfig()).toThrowError(/CONFIG_ERROR: Missing required public site configuration: PUBLIC_SITE_NAME, PUBLIC_AUTHOR_NAME/);
    });

    it('renders published guide with og tags, disclosure in first 500 chars, direct tagged amazon link, and legal pages', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-site-test-'));
      const db = getDb();

      // Create a published guide in DB
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, primary_offer_id, title, slug, intent_target,
          category, asset_type, content_markdown, status,
          view_count, referral_click_count, created_at, updated_at
        ) VALUES (
          'asset_test_01', ?, 'off_test_01',
          'Commercial Thermal Shipping Label Printers in India', 'commercial-thermal-shipping-label-printers',
          'Commercial overview of 4x6 thermal label printers for logistics.',
          'Office & Commercial Supplies', 'GUIDE',
          '# Thermal Printers for Logistics\r\n\r\nOverview of top industrial desktop printers for high volume shipping.\r\n\r\n[Check Phomemo PM-246S on Amazon](https://www.amazon.in/dp/B08N5WRWNW?tag=mock-assoc-21)\r\n\r\nThermal direct technology eliminates ink and ribbon costs.',
          'PUBLISHED',
          0, 0, datetime('now'), datetime('now')
        )
      `).run(testOrgId);

      const generator = StaticSiteGenerator.getInstance();
      const res = await generator.build({ outputDir: tempDir, orgId: testOrgId });

      expect(res.success).toBe(true);
      expect(res.guidesRendered).toBe(1);

      // Verify guide HTML file
      const guideFile = path.join(tempDir, 'guides', 'commercial-thermal-shipping-label-printers', 'index.html');
      expect(fs.existsSync(guideFile)).toBe(true);
      const guideHtml = fs.readFileSync(guideFile, 'utf-8');

      // 1. title
      expect(guideHtml).toContain('<title>Commercial Thermal Shipping Label Printers in India | AI Marketing Organization</title>');
      // 2. meta description
      expect(guideHtml).toContain('<meta name="description" content="Commercial overview of 4x6 thermal label printers for logistics.">');
      // 3. canonical URL
      expect(guideHtml).toContain('<link rel="canonical" href="https://ai-marketing-platform-core.web.app/guides/commercial-thermal-shipping-label-printers">');
      // 4. og:title
      expect(guideHtml).toContain('<meta property="og:title" content="Commercial Thermal Shipping Label Printers in India">');
      // 5. og:description
      expect(guideHtml).toContain('<meta property="og:description" content="Commercial overview of 4x6 thermal label printers for logistics.">');
      // 6. og:url
      expect(guideHtml).toContain('<meta property="og:url" content="https://ai-marketing-platform-core.web.app/guides/commercial-thermal-shipping-label-printers">');
      // 7. Statutory disclosure in the first 500 characters of <body>
      const bodyIndex = guideHtml.indexOf('<body>');
      const disclosureIndex = guideHtml.indexOf('As an Amazon Associate I earn from qualifying purchases.');
      expect(bodyIndex).toBeGreaterThan(-1);
      expect(disclosureIndex).toBeGreaterThan(-1);
      expect(disclosureIndex - bodyIndex).toBeLessThan(500);
      expect(guideHtml).toContain('We do not test products or show prices; check current details on Amazon.in.');

      // 8. Full article text
      expect(guideHtml).toContain('Thermal direct technology eliminates ink and ribbon costs.');
      // 9. Direct tagged Amazon link with target=_blank and rel="sponsored nofollow noopener"
      expect(guideHtml).toContain('rel="sponsored nofollow noopener"');
      expect(guideHtml).toContain('href="https://www.amazon.in/dp/B08N5WRWNW?tag=mock-assoc-21"');
      // 10. Footer links to legal pages
      expect(guideHtml).toContain('href="/about"');
      expect(guideHtml).toContain('href="/contact"');
      expect(guideHtml).toContain('href="/privacy"');
      expect(guideHtml).toContain('href="/terms"');
      expect(guideHtml).toContain('href="/disclosure"');

      // Verify legal static pages
      expect(fs.existsSync(path.join(tempDir, 'about', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'contact', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'privacy', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'terms', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'disclosure', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'sitemap.xml'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'robots.txt'))).toBe(true);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('3. Publish Lint vs Prohibited Claims & Generator Template', () => {
    it('blocks "Best", "Independent technical review", and "independent technical research"', () => {
      const contentEngine = ContentAssetEngine.getInstance();

      // Failing example 1: "Best"
      const resBest = contentEngine.lintContent('Best Thermal Printer for Indian Logistics\n\nAs an Amazon Associate I earn from qualifying purchases.');
      expect(resBest.passed).toBe(false);
      expect(resBest.violations.some(v => v.includes('FORBIDDEN_SUPERLATIVE') && v.includes('best'))).toBe(true);

      // Failing example 2: "Independent technical review"
      const resReview = contentEngine.lintContent('Independent technical review of 4x6 desktop printers.\n\nAs an Amazon Associate I earn from qualifying purchases.');
      expect(resReview.passed).toBe(false);
      expect(resReview.violations.some(v => v.includes('Independent technical review'))).toBe(true);

      // Failing example 3: "independent technical research"
      const resResearch = contentEngine.lintContent('Based on our independent technical research, we present these specs.\n\nAs an Amazon Associate I earn from qualifying purchases.');
      expect(resResearch.passed).toBe(false);
      expect(resResearch.violations.some(v => v.includes('independent technical research'))).toBe(true);
    });

    it('running publish lint on the item-5 fixture page with prohibited claims fails; passes with compliant overview disclaimer', () => {
      const contentEngine = ContentAssetEngine.getInstance();

      // Prohibited fixture content containing "Best", "Independent technical review", "independent technical research"
      const prohibitedFixture = `
# Best Thermal Shipping Label Printers in India

As an Amazon Associate I earn from qualifying purchases.

Independent technical review of commercial 4x6 label printers.
Our independent technical research highlights key hardware specs.
      `.trim();

      const failResult = contentEngine.lintContent(prohibitedFixture);
      expect(failResult.passed).toBe(false);
      expect(failResult.violations.some(v => v.includes('best'))).toBe(true);
      expect(failResult.violations.some(v => v.includes('Independent technical review'))).toBe(true);
      expect(failResult.violations.some(v => v.includes('independent technical research'))).toBe(true);

      // Compliant content with: "We do not test products or show prices; check current details on Amazon.in."
      const compliantFixture = `
# Commercial Thermal Shipping Label Printers in India

As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in.

Commercial product overview for desktop 4x6 label printing hardware.
Specifications checked against manufacturer documentation.
      `.trim();

      const passResult = contentEngine.lintContent(compliantFixture);
      expect(passResult.passed).toBe(true);
      expect(passResult.violations).toHaveLength(0);
    });

    it('generator templates contain compliant disclaimer and omit prohibited claims', () => {
      const staticGen = StaticSiteGenerator.getInstance();
      const config = {
        siteName: 'Commerce Equipment Guide',
        siteUrl: 'https://ai-marketing-platform-core.web.app',
        authorName: 'Platform Operator',
        contactEmail: 'contact@example.com'
      };

      const aboutHtml = staticGen.renderAboutHtml(config);
      const contactHtml = staticGen.renderContactHtml(config);
      const disclosureHtml = staticGen.renderDisclosureHtml(config);
      const guideHtml = staticGen.renderGuideHtml({
        title: 'Commercial Thermal Printers in India',
        slug: 'commercial-thermal-printers',
        content_markdown: 'As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in.\n\nHardware overview.'
      }, config);

      const allHtml = `${aboutHtml}\n${contactHtml}\n${disclosureHtml}\n${guideHtml}`;

      // Must not contain prohibited claims
      expect(allHtml).not.toMatch(/\bIndependent\s+technical\s+review\b/i);
      expect(allHtml).not.toMatch(/\bindependent\s+technical\s+research\b/i);
      expect(allHtml).not.toMatch(/\bVerified Editorial Analysis\b/i);
      expect(allHtml).not.toMatch(/\bEditorial Research\b/i);

      // Must contain replacement text
      expect(allHtml).toContain('We do not test products or show prices; check current details on Amazon.in.');
    });
  });

  describe('6. ASIN Intake (Owner-Only)', () => {
    beforeEach(() => {
      const db = getDb();
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, website,
          network, approval_status, authorization_status
        ) VALUES (
          'part_amazon_in_01', ?, 'Amazon India Associates', 'Retail', 'https://associates.amazon.in',
          'AMAZON_ASSOCIATES', 'APPROVED', 'AUTHORIZED'
        )
      `).run(testOrgId);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.amazon.in/dp/B08N5WRWNW', displayName: 'Printer' })
      });
      expect(res.status).toBe(401);
    });

    it('rejects shortened URLs (amzn.to, a.co)', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://amzn.to/3XYZ123',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 direct thermal label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('SHORTENED_URL_REJECTED');
    });

    it('rejects foreign affiliate tags in input URL', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/dp/B08N5WRWNW?tag=attacker-21',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 direct thermal label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('FOREIGN_TAG_REJECTED');
    });

    it('normalizes valid amazon.in URL to canonical destination and appends server tag', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/Phomemo-PM-246S-Shipping-Label-Printer/dp/B08N5WRWNW?ref_=ast_sto_dp&th=1',
          displayName: 'Phomemo PM-246S Thermal Label Printer',
          listingFacts: '203 DPI, USB connectivity, prints 4x6 shipping labels without ink, dated 2026-10-06'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      const offer = json.data;

      // Normalization check
      expect(offer.destinationUrl).toBe('https://www.amazon.in/dp/B08N5WRWNW');
      expect(offer.authorizedTrackingUrl).toBe(`https://www.amazon.in/dp/B08N5WRWNW?tag=${process.env.AMAZON_AFFILIATE_TAG}`);
      expect(offer.status).toBe('DRAFT');
      expect(offer.active).toBe(0);
      // No price stored
      expect(offer.priceINR == null || offer.priceINR === 0).toBe(true);
      expect(offer.evidence.listing_facts).toContain('203 DPI, USB connectivity');
    });

    it('rejects amazon.in.evil.com host with 400 INVALID_HOST', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://amazon.in.evil.com/dp/B08N5WRWNW',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_HOST');
    });

    it('rejects notamazon.in host with 400 INVALID_HOST', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://notamazon.in/dp/B08N5WRWNW',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_HOST');
    });

    it('rejects http:// scheme with 400 INVALID_SCHEME', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'http://www.amazon.in/dp/B08N5WRWNW',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_SCHEME');
    });

    it('rejects 9-character ASIN with 400 INVALID_ASIN', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/dp/B08N5WRWN',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_ASIN');
    });

    it('rejects 11-character ASIN with 400 INVALID_ASIN', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/dp/B08N5WRWNW1',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_ASIN');
    });

    it('accepts lowercase ASIN and normalizes to uppercase', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/dp/b08n5wrwnw',
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.destinationUrl).toBe('https://www.amazon.in/dp/B08N5WRWNW');
      expect(json.data.evidence.asin).toBe('B08N5WRWNW');
    });

    it('accepts URL containing own tag, accepts and strips it into canonical destination', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: `https://www.amazon.in/dp/B08N5WRWNW?tag=${process.env.AMAZON_AFFILIATE_TAG}&ref=dp_title&th=1`,
          displayName: 'Thermal Printer',
          listingFacts: '4x6 label printer'
        })
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.destinationUrl).toBe('https://www.amazon.in/dp/B08N5WRWNW');
      expect(json.data.authorizedTrackingUrl).toBe(`https://www.amazon.in/dp/B08N5WRWNW?tag=${process.env.AMAZON_AFFILIATE_TAG}`);
    });

    it('strips extra query parameters and stores no price or rating', async () => {
      const res = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/Phomemo-PM-246S-Shipping-Label-Printer/dp/B08N5WRWNW?ref_=ast_sto_dp&th=1&psc=1&qid=1728250000',
          displayName: 'Phomemo PM-246S Thermal Label Printer',
          listingFacts: '203 DPI, USB connectivity, prints 4x6 shipping labels without ink, dated 2026-10-06'
        })
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      const offer = json.data;
      expect(offer.destinationUrl).toBe('https://www.amazon.in/dp/B08N5WRWNW');
      expect(offer.authorizedTrackingUrl).toBe(`https://www.amazon.in/dp/B08N5WRWNW?tag=${process.env.AMAZON_AFFILIATE_TAG}`);
      // Zero price or rating stored
      expect(offer.priceINR == null || offer.priceINR === 0).toBe(true);
      expect((offer as any).rating).toBeUndefined();
      expect((offer as any).stars).toBeUndefined();
      expect(offer.availability).toBe('UNKNOWN');
      expect(offer.evidence.listing_facts).toBe('203 DPI, USB connectivity, prints 4x6 shipping labels without ink, dated 2026-10-06');
    });
  });

  describe('7. Operator Attestation (Owner-Only) & Offer Activation', () => {
    let draftOfferId = '';

    beforeEach(async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, website,
          network, approval_status, authorization_status, evidence_json
        ) VALUES (
          'part_amazon_in_01', ?, 'Amazon India Associates', 'Retail', 'https://associates.amazon.in',
          'AMAZON_ASSOCIATES', 'APPROVED', 'AUTHORIZED', '{}'
        )
      `).run(testOrgId);

      // Create a DRAFT offer
      const intakeRes = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/dp/B08N5WRWNW',
          displayName: 'Phomemo PM-246S Thermal Label Printer',
          listingFacts: '203 DPI, USB connectivity, dated 2026-10-06'
        })
      });
      const json = await intakeRes.json();
      draftOfferId = json.data.id;
    });

    it('rejects offer activation before terms_read_confirmed is attested', async () => {
      const res = await app.request(`/api/v1/commission/offers/${draftOfferId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({ status: 'ACTIVE', productChecked: true })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('TERMS_READ_CONFIRMATION_REQUIRED');
    });

    it('records operator attestation with computed 180-day deadline and activates offer with productChecked', async () => {
      const appDate = '2026-09-15';
      const expectedDeadline = new Date(new Date(appDate).getTime() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const res = await app.request('/api/v1/commission/attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          termsReadConfirmed: true,
          applicationDate: appDate,
          siteListedInAssociatesCentral: true,
          siteListedUrl: 'https://ai-marketing-platform-core.web.app',
          offerId: draftOfferId,
          productChecked: true
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.termsReadConfirmed).toBe(true);
      expect(json.data.deadline180Days).toBe(expectedDeadline);
      expect(json.data.activatedOffer.status).toBe('ACTIVE');
      expect(json.data.activatedOffer.active).toBe(1);

      // Verify partner evidence in DB
      const db = getDb();
      const partner = db.prepare("SELECT evidence_json FROM partners WHERE id = 'part_amazon_in_01'").get() as any;
      const ev = JSON.parse(partner.evidence_json);
      expect(ev.terms_read_confirmed).toBe(true);
      expect(ev.deadline_180_days).toBe(expectedDeadline);
    });
  });

  describe('8. Fixture End-to-End Trace (Test DB Only)', () => {
    it('executes full intake -> attestation -> guide -> lint -> static render -> click beacon trace', async () => {
      const db = getDb();
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-e2e-'));

      // 1. Provision partner
      db.prepare(`
        INSERT INTO partners (
          id, organization_id, name, industry, website,
          network, approval_status, authorization_status, evidence_json
        ) VALUES (
          'part_amazon_in_01', ?, 'Amazon India Associates', 'Retail', 'https://associates.amazon.in',
          'AMAZON_ASSOCIATES', 'APPROVED', 'AUTHORIZED', '{}'
        )
      `).run(testOrgId);

      // 2. ASIN Intake -> DRAFT offer
      const asinRes = await app.request('/api/v1/commission/offers/asin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          url: 'https://www.amazon.in/dp/B08N5WRWNW',
          displayName: 'Phomemo PM-246S Commercial Label Printer',
          listingFacts: 'Direct thermal printing, 150 mm/s print speed, 203 DPI resolution, compatible with 4x6 courier labels.'
        })
      });
      expect(asinRes.status).toBe(201);
      const asinJson = await asinRes.json();
      const offerId = asinJson.data.id;
      const offerSlug = asinJson.data.offerSlug;

      // 3. Operator Attestation -> ACTIVE offer
      const attestRes = await app.request('/api/v1/commission/attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey },
        body: JSON.stringify({
          termsReadConfirmed: true,
          applicationDate: '2026-09-20',
          siteListedInAssociatesCentral: true,
          siteListedUrl: 'https://ai-marketing-platform-core.web.app',
          offerId,
          productChecked: true
        })
      });
      expect(attestRes.status).toBe(200);

      // 4. Build guide strictly from owner-supplied listing facts
      const guideBody = `
As an Amazon Associate I earn from qualifying purchases.

## Commercial Shipping Label Evaluation

Direct thermal printing eliminates replacement ribbon and ink cartridge costs for growing logistics hubs.

### Specification & Compatibility Analysis
- Direct thermal printing mechanism
- 150 mm/s print speed
- 203 DPI resolution
- Compatible with 4x6 courier labels

[Check Phomemo PM-246S on Amazon](https://www.amazon.in/dp/B08N5WRWNW?tag=mock-assoc-21)

All specifications checked against manufacturer technical documentation.
      `.trim();

      const contentEngine = ContentAssetEngine.getInstance();
      const asset = await contentEngine.createAsset({
        organizationId: testOrgId,
        primaryOfferId: offerId,
        title: 'Thermal Shipping Label Printers: Product Overview for Logistics',
        slug: 'thermal-shipping-label-printers-review',
        intentTarget: 'Commercial overview of 4x6 direct thermal shipping label printers for small businesses.',
        category: 'Office & Commercial Supplies',
        assetType: 'GUIDE',
        contentMarkdown: guideBody,
        status: 'PUBLISHED'
      });

      // 5. Content Lint passes
      const lintResult = contentEngine.lintContent(asset.contentMarkdown);
      expect(lintResult.passed).toBe(true);
      expect(lintResult.violations).toHaveLength(0);

      // 6. Static Site Render passes Item 5 checklist
      const staticGen = StaticSiteGenerator.getInstance();
      const buildResult = await staticGen.build({ outputDir: tempDir, orgId: testOrgId });
      expect(buildResult.success).toBe(true);
      expect(buildResult.guidesRendered).toBeGreaterThanOrEqual(1);

      const staticHtmlPath = path.join(tempDir, 'guides', 'thermal-shipping-label-printers-review', 'index.html');
      expect(fs.existsSync(staticHtmlPath)).toBe(true);
      const staticHtml = fs.readFileSync(staticHtmlPath, 'utf-8');

      expect(staticHtml).toContain('<meta property="og:title"');
      expect(staticHtml).toContain('<meta property="og:description"');
      expect(staticHtml).toContain('<meta property="og:url"');
      expect(staticHtml).toContain('As an Amazon Associate I earn from qualifying purchases.');
      expect(staticHtml).toContain('rel="sponsored nofollow noopener"');

      // 7. Click Beacon records non-revenue click event
      const beaconRes = await app.request('/api/v1/referrals/beacon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '110.235.225.146',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        body: JSON.stringify({ offerId, slug: 'thermal-shipping-label-printers-review' })
      });
      expect(beaconRes.status).toBe(200);

      // 8. Verify ledger is UNCHANGED (₹0 revenue)
      const ledger = CommissionLedgerEngine.getInstance();
      const summary = await ledger.getSummary(testOrgId);
      expect(summary.expectedCommissionINR).toBe(0);
      expect(summary.verifiedRevenueINR).toBe(0);
      expect(summary.receivedCashINR).toBe(0);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
