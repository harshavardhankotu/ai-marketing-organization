import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { LeadLeakageCalculator } from '../../src/revenue/lead-leakage-calculator.js';
import app from '../../src/index.js';

describe('Part E: Direct Lane & 4-State Payment Truth Test Suite', () => {
  const cleanDb = () => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM referrals WHERE landing_page = '/offer'`).run();
      db.prepare(`DELETE FROM manual_upi_claims WHERE utr LIKE 'test_utr_%'`).run();
      db.prepare(`DELETE FROM revenue_records WHERE source = 'MANUAL_UPI'`).run();
      db.prepare(`DELETE FROM durable_rate_limits`).run();
    } catch {}
  };

  beforeEach(cleanDb);
  afterEach(cleanDb);

  describe('1. Static Offer Page Content & Commercial Terms', () => {
    it('renders two authoritative tiers matching OWN_OFFER.md exactly', () => {
      const page = DirectCommercialOfferPage.getInstance();
      const html = page.renderOfferHtml({
        siteName: 'SupplySpecs India',
        siteUrl: 'https://supplyspecs.in',
        contactEmail: 'contact@supplyspecs.in'
      });

      // Tier 1: PLATFORM_SETUP (₹15,000, 5 days, 14-day guarantee)
      expect(html).toContain('Day 0-5 Setup &amp; Integration');
      expect(html).toContain('₹15,000');
      expect(html).toContain('5 Business Days Delivery SLA');
      expect(html).toContain('14-Day Performance Guarantee');
      expect(html).toContain('Custom WhatsApp Triage &amp; FAQ Bot');
      expect(html).toContain('Google Business Profile (GBP) Integration');
      expect(html).toContain('Multi-Touch Follow-Up Workflow');
      expect(html).toContain('Direct Calendar Booking');
      expect(html).toContain('Handover Report &amp; Verification Run');

      // Tier 2: PLATFORM_MONTHLY (₹8,000, continuous 30-day, cancel anytime)
      expect(html).toContain('Monthly Retainer &amp; SLA');
      expect(html).toContain('₹8,000');
      expect(html).toContain('Continuous 30-Day SLA &bull; Cancel Anytime');
      expect(html).toContain('24/7 Automated Lead Triage');
      expect(html).toContain('Bi-Weekly Prompt &amp; Rubric Tuning');
      expect(html).toContain('Continuous DPDP Act Compliance');
    });

    it('includes all required payment options and statutory compliance note', () => {
      const page = DirectCommercialOfferPage.getInstance();
      const html = page.renderOfferHtml({
        upiVpa: 'harshavardhan.kotu@okhdfcbank',
        razorpayMeUrl: 'https://razorpay.me/@venkatasaiharshavardhankotu'
      });

      // Payment option 1: UPI URI and QR code
      expect(html).toContain('upi://pay?pa=');
      expect(html).toContain('am=15000');
      expect(html).toContain('cu=INR');
      expect(html).toContain('Order Ref:');

      // Payment option 2: Razorpay fallback
      expect(html).toContain('https://razorpay.me/@venkatasaiharshavardhankotu');
      expect(html).toContain('manual remittance fallback');

      // Payment option 3: WhatsApp discussion link
      expect(html).toContain('https://wa.me/');
      expect(html).toContain('Chat on WhatsApp');

      // Statutory NPCI / RBI compliance notice
      expect(html).toContain('Statutory Regulatory Notice (NPCI / RBI UPI Guidelines)');
      expect(html).toContain('personal peer-to-peer (P2P) UPI VPAs are restricted');
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
    it('serves GET /offer and GET /api/v1/offer with complete HTML content', async () => {
      const resTop = await app.request('/offer');
      expect(resTop.status).toBe(200);
      const htmlTop = await resTop.text();
      expect(htmlTop).toContain('AI Inbound Lead Conversion System');
      expect(htmlTop).toContain('Day 0-5 Setup &amp; Integration');
      expect(htmlTop).toContain('Four-State Payment Truth Protocol');

      const resApi = await app.request('/api/v1/offer');
      expect(resApi.status).toBe(200);
      const htmlApi = await resApi.text();
      expect(htmlApi).toContain('AI Inbound Lead Conversion System');
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
