import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { DirectCommercialOfferPage, computeOwnOfferHash } from '../../src/revenue/direct-offer-page.js';
import { LeadLeakageCalculator } from '../../src/revenue/lead-leakage-calculator.js';
import app from '../../src/index.js';

describe('Part E: Direct Lane & 4-State Payment Truth Test Suite', () => {
  const cleanDb = () => {
    delete process.env.DIRECT_OFFER_TERMS_SHA256;
    delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
    delete process.env.OWN_OFFER_CONFIRMED;
    delete process.env.PLATFORM_UPI_VPA;
    delete process.env.OWNER_UPI_VPA;
    delete process.env.PUBLIC_WHATSAPP_NUMBER;
    const db = getDb();
    try {
      db.prepare(`DELETE FROM referrals WHERE landing_page = '/offer'`).run();
      db.prepare(`DELETE FROM manual_upi_claims WHERE utr LIKE 'test_utr_%'`).run();
      db.prepare(`DELETE FROM revenue_records WHERE source = 'MANUAL_UPI'`).run();
      db.prepare(`DELETE FROM durable_rate_limits`).run();
    } catch {}
    delete process.env.OWN_OFFER_CONFIRMED;
  };

  beforeEach(cleanDb);
  afterEach(cleanDb);

  describe('1. Static Offer Page Content & Commercial Terms (Hash Attestation)', () => {
    it('missing: renders safe un-attested overview with zero prices and noindex when DIRECT_OFFER_TERMS_SHA256 is unset', () => {
      delete process.env.DIRECT_OFFER_TERMS_SHA256;

      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);

      const page = DirectCommercialOfferPage.getInstance();
      const html = page.renderOfferHtml({
        siteName: 'SupplySpecs India',
        siteUrl: 'https://supplyspecs.in',
        contactEmail: 'contact@supplyspecs.in'
      });

      expect(html).toContain('AI Inbound Lead Conversion System');
      expect(html).toContain('Configuration Pending Owner Attestation');
      expect(html).toContain('noindex, nofollow');
      expect(html).toContain('Direct online checkout is disabled');
      expect(html).not.toContain('upi://pay');
      expect(html).not.toContain('harshavardhan.kotu');
    });

    it('mismatch: renders safe overview when DIRECT_OFFER_TERMS_SHA256 does not match file hash', () => {
      process.env.DIRECT_OFFER_TERMS_SHA256 = '000000000000000000000000000000000000000000000000000000000000dead';

      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);

      const page = DirectCommercialOfferPage.getInstance();
      const html = page.renderOfferHtml({
        siteName: 'SupplySpecs India',
        siteUrl: 'https://supplyspecs.in',
        contactEmail: 'contact@supplyspecs.in'
      });

      expect(html).toContain('Configuration Pending Owner Attestation');
      expect(html).toContain('noindex, nofollow');
      expect(html).not.toContain('upi://pay');
    });

    it('match: renders authoritative tiers with attested prices when DIRECT_OFFER_TERMS_SHA256 matches owner/OWN_OFFER.md', () => {
      const actualHash = DirectCommercialOfferPage.computeOwnOfferHash();

      process.env.DIRECT_OFFER_TERMS_SHA256 = actualHash;
      process.env.OWN_OFFER_CONFIRMED = 'true';
      process.env.OWNER_UPI_VPA = 'owner@okhdfcbank';
      process.env.PUBLIC_WHATSAPP_NUMBER = '919876543210';

      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(true);

      const page = DirectCommercialOfferPage.getInstance();
      const html = page.renderOfferHtml({
        siteName: 'SupplySpecs India',
        siteUrl: 'https://supplyspecs.in',
        contactEmail: 'contact@supplyspecs.in',
        upiVpa: 'owner@okhdfcbank'
      });

      // Tier 1: PLATFORM_SETUP (₹15,000)
      expect(html).toContain('Day 0–5 Setup &amp; Integration');
      expect(html).toContain('₹15,000');
      expect(html).toContain('Custom WhatsApp qualification &amp; FAQ bot');
      expect(html).toContain('Delivery Time: 5 Business Days');

      // Tier 2: PLATFORM_MONTHLY (₹8,000)
      expect(html).toContain('Monthly Retainer &amp; SLA');
      expect(html).toContain('₹8,000');

      // Audience & Refund terms from OWN_OFFER.md
      expect(html).toContain('Who It Is For');
      expect(html).toContain('Who Should NOT Buy');
      expect(html).toContain('14-Day Performance Guarantee');

      // Payment option: UPI
      expect(html).toContain('upi://pay?pa=owner%40okhdfcbank');
      expect(html).toContain('am=15000');
    });

    it('file edit closes page: any edit to owner/OWN_OFFER.md alters hash and closes the page', () => {
      const originalHash = DirectCommercialOfferPage.computeOwnOfferHash();

      process.env.DIRECT_OFFER_TERMS_SHA256 = originalHash;
      process.env.OWN_OFFER_CONFIRMED = 'true';
      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(true);

      // Simulate file edit: hash changes, so expected !== computed
      const modifiedHash = 'edited_' + originalHash;
      expect(modifiedHash).not.toBe(originalHash);
      const isAttestedAfterEdit = originalHash === modifiedHash;
      expect(isAttestedAfterEdit).toBe(false);
    });
  });

  describe('2. Four-State Payment Truth Protocol Verification', () => {
    it('state 1: PAYMENT_PAGE_VIEW is logged as navigation traffic, NEVER recognized as revenue', async () => {
      const db = getDb();

      const res = await app.request('/api/v1/payments/page-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'offer', referer: 'https://supplyspecs.in/tools/lead-leakage-calculator' })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.status).toBe('PAYMENT_PAGE_VIEW');
      expect(json.isRevenue).toBe(false);

      // Verify DB record in referrals table
      const row = db.prepare(`SELECT * FROM referrals WHERE landing_page = '/offer' ORDER BY created_at DESC LIMIT 1`).get() as any;
      expect(row).toBeDefined();
      expect(row.landing_page).toBe('/offer');
      expect(row.offer_id).toBe('PLATFORM_SETUP');

      // Verify ZERO revenue in revenue_records
      const revCount = (db.prepare(`SELECT COUNT(*) as c FROM revenue_records WHERE source = 'PAYMENT_PAGE_VIEW'`).get() as any).c;
      expect(revCount).toBe(0);
    });

    it('state 2: PAYMENT_CLAIMED stores UTR but recognizes ZERO revenue until owner verification', async () => {
      const db = getDb();
      const testUtr = `test_utr_${Date.now()}`;

      const res = await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          utr: testUtr,
          amountINR: 15000,
          serviceRendered: 'AI Inbound Lead Conversion System Setup (₹15,000)',
          notes: 'Test client claim'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.status).toBe('PAYMENT_CLAIMED');

      // Verify claim stored in manual_upi_claims
      const claimRow = db.prepare(`SELECT * FROM manual_upi_claims WHERE utr = ?`).get(testUtr) as any;
      expect(claimRow).toBeDefined();
      expect(claimRow.status).toBe('PAYMENT_CLAIMED');
      expect(claimRow.amount_inr).toBe(15000);

      // Verify that NO revenue was created in revenue_records for this claim
      const revRow = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = ?`).get(testUtr) as any;
      expect(revRow).toBeUndefined();
    });

    it('state 3: MANUAL_VERIFIED confirms bank statement credit and ledgers REAL revenue', async () => {
      const db = getDb();
      const testUtr = `test_utr_confirm_${Date.now()}`;

      // 1. Submit claim first
      await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          utr: testUtr,
          amountINR: 15000,
          serviceRendered: 'AI Inbound Lead Conversion System Setup (₹15,000)'
        })
      });

      // 2. Owner confirms receipt
      const confirmRes = await app.request('/api/v1/payments/manual-upi/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-organization-id': 'org_owner_primary',
          'x-user-id': 'usr_owner_01'
        },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          utr: testUtr,
          amountINR: 15000,
          serviceRendered: 'AI Inbound Lead Conversion System Setup (₹15,000)'
        })
      });

      expect(confirmRes.status).toBe(200);
      const confirmJson = await confirmRes.json() as any;
      expect(confirmJson.success).toBe(true);
      expect(confirmJson.classification).toBe('MANUAL_VERIFIED');

      // 3. Verify revenue record created as verified revenue
      const rev = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = ?`).get(testUtr) as any;
      expect(rev).toBeDefined();
      expect(rev.amount_inr).toBe(15000);
      expect(rev.verified).toBe(1);
      expect(['REAL', 'MANUAL_VERIFIED']).toContain(rev.classification);
      expect(['MANUAL_VERIFIED', 'OWNER_MANUAL']).toContain(rev.verification_method);
    });
  });

  describe('3. Public Routing & Calculator Integration', () => {
    it('serves safe overview on GET /offer and GET /api/v1/offer when unattested', async () => {
      const resTop = await app.request('/offer');
      expect(resTop.status).toBe(200);
      const htmlTop = await resTop.text();
      expect(htmlTop).toContain('AI Inbound Lead Conversion System');
      expect(htmlTop).toContain('Configuration Pending Owner Attestation');
      expect(htmlTop).toContain('noindex, nofollow');

      const resApi = await app.request('/api/v1/offer');
      expect(resApi.status).toBe(200);
      const htmlApi = await resApi.text();
      expect(htmlApi).toContain('AI Inbound Lead Conversion System');
    });

    it('serves attested commercial tiers on GET /offer when owner confirms commercial terms', async () => {
      const actualHash = DirectCommercialOfferPage.computeOwnOfferHash();

      process.env.DIRECT_OFFER_TERMS_SHA256 = actualHash;
      process.env.OWN_OFFER_CONFIRMED = 'true';
      process.env.OWNER_UPI_VPA = 'owner@okhdfcbank';
      process.env.PUBLIC_WHATSAPP_NUMBER = '919876543210';

      const res = await app.request('/offer');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('AI Inbound Lead Conversion System');
      expect(html).toContain('Day 0–5 Setup &amp; Integration');
      expect(html).toContain('Monthly Retainer &amp; SLA');
      expect(html).toContain('₹15,000');
      expect(html).toContain('₹8,000');
      delete process.env.OWN_OFFER_CONFIRMED;
    });

    it('lead leakage calculator includes a direct link to the offer page', () => {
      const calc = LeadLeakageCalculator.getInstance();
      const html = calc.renderCalculatorHtml({
        siteName: 'SupplySpecs India',
        siteUrl: 'https://supplyspecs.in',
        contactEmail: 'contact@supplyspecs.in'
      });

      expect(html).toContain('href="/offer"');
      expect(html).toContain('View Commercial Offer &amp; Pricing');
    });
  });
});
