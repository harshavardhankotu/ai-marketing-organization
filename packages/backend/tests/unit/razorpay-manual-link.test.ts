import { describe, it, expect, beforeEach } from 'vitest';
import { OwnOfferEngine } from '../../src/revenue/own-offer-engine.js';
import { RazorpayExportReconciler } from '../../src/revenue/razorpay-export-reconciler.js';
import { RazorpayPaymentExportRow } from '../../src/revenue/own-offer-types.js';
import { getDb } from '../../src/db/client.js';

describe('Razorpay Manual-Link Mode Test Suite (Step 5)', () => {
  const ownOfferEngine = OwnOfferEngine.getInstance();
  const reconciler = RazorpayExportReconciler.getInstance();
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM own_offers WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM own_offer_clicks`).run();
      db.prepare(`DELETE FROM manual_reconciled_payments WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM revenue_records WHERE organization_id = ? AND source LIKE 'RAZORPAY_EXPORT%'`).run(orgId);
    } catch {}
  });

  describe('1. Host Validation (Only rzp.io and razorpay.com, reject lookalikes)', () => {
    it('accepts canonical rzp.io and razorpay.com HTTPS links', () => {
      expect(OwnOfferEngine.validateRazorpayUrl('https://rzp.io/l/my-setup-offer')).toBe(true);
      expect(OwnOfferEngine.validateRazorpayUrl('https://razorpay.com/payment-button/pl_123/widget')).toBe(true);
      expect(OwnOfferEngine.validateRazorpayUrl('https://pages.razorpay.com/pl_consultation')).toBe(true);
    });

    it('rejects lookalike, phishing, and non-HTTPS hosts', () => {
      expect(OwnOfferEngine.validateRazorpayUrl('http://rzp.io/l/insecure')).toBe(false); // non-https
      expect(OwnOfferEngine.validateRazorpayUrl('https://rzp.io.phish.com/l/fake')).toBe(false); // lookalike subdomain
      expect(OwnOfferEngine.validateRazorpayUrl('https://razorpay.com.attacker.org/pay')).toBe(false); // lookalike
      expect(OwnOfferEngine.validateRazorpayUrl('https://fake-rzp.io/offer')).toBe(false);
      expect(OwnOfferEngine.validateRazorpayUrl('https://stripe.com/pay')).toBe(false);
      expect(OwnOfferEngine.validateRazorpayUrl('javascript:alert(1)')).toBe(false);
    });

    it('refuses to create Own Offer with non-allowlisted host', () => {
      expect(() => {
        ownOfferEngine.createOwnOffer({
          organizationId: orgId,
          name: 'Consultation Package',
          oneSentencePromise: 'Get 1-on-1 strategy audit in 24 hours.',
          priceINR: 5000,
          priceSetDate: '2026-10-10',
          refundPolicyText: 'Full refund within 7 days if unsatisfied.',
          paymentLinkUrl: 'https://phishing-rzp.io/pay',
          categoryAttestation: true,
          whatBuyerGets: ['1-hour call', 'Written action plan'],
          whoItIsFor: ['Local clinic owners'],
          whoShouldNotBuy: ['Anyone without an active business'],
          contactEmail: 'owner@example.com',
          active: true
        });
      }).toThrow(/INVALID_PAYMENT_URL/i);
    });

    it('refuses to create Own Offer without owner category attestation', () => {
      expect(() => {
        ownOfferEngine.createOwnOffer({
          organizationId: orgId,
          name: 'Consultation Package',
          oneSentencePromise: 'Get 1-on-1 strategy audit in 24 hours.',
          priceINR: 5000,
          priceSetDate: '2026-10-10',
          refundPolicyText: 'Full refund within 7 days if unsatisfied.',
          paymentLinkUrl: 'https://rzp.io/l/my-setup-offer',
          categoryAttestation: false, // NOT attested
          whatBuyerGets: ['1-hour call'],
          whoItIsFor: ['Local clinic owners'],
          whoShouldNotBuy: ['Anyone without an active business'],
          contactEmail: 'owner@example.com',
          active: true
        });
      }).toThrow(/ATTESTATION_REQUIRED/i);
    });
  });

  describe('2. Static Landing and Policy Page Generation', () => {
    it('generates landing page with owner price, promise, and email', () => {
      const offer = ownOfferEngine.createOwnOffer({
        organizationId: orgId,
        name: 'Local SEO Booster',
        oneSentencePromise: 'Rank your Google listing in top 3 local pack in 30 days.',
        priceINR: 7500,
        priceSetDate: '2026-10-10',
        refundPolicyText: '100% money back if rankings do not improve.',
        paymentLinkUrl: 'https://rzp.io/l/local-seo-booster',
        categoryAttestation: true,
        whatBuyerGets: ['Full GBP audit', 'Citation building', 'Review triage workflow'],
        whoItIsFor: ['Doctors and Dentists'],
        whoShouldNotBuy: ['E-commerce websites'],
        contactEmail: 'support@myagency.in',
        active: true
      });

      const html = ownOfferEngine.generateLandingPageHtml(offer);
      expect(html).toContain('Local SEO Booster');
      expect(html).toContain('₹7,500');
      expect(html).toContain('2026-10-10');
      expect(html).toContain('https://rzp.io/l/local-seo-booster');
      expect(html).toContain('support@myagency.in');
      expect(html).toContain('Who Should NOT Buy');
      expect(html).toContain('Full GBP audit');
    });

    it('generates policy pages marked with NEEDS OWNER REVIEW badge', () => {
      const offer = ownOfferEngine.createOwnOffer({
        organizationId: orgId,
        name: 'Lead Generation Setup',
        oneSentencePromise: 'Launch instant WhatsApp lead capture.',
        priceINR: 12000,
        priceSetDate: '2026-10-10',
        refundPolicyText: 'Refundable before onboarding kick-off.',
        paymentLinkUrl: 'https://razorpay.com/payment-button/pl_setup_99',
        categoryAttestation: true,
        whatBuyerGets: ['WhatsApp bot setup'],
        whoItIsFor: ['Service businesses'],
        whoShouldNotBuy: ['Hobbyists'],
        contactEmail: 'support@myagency.in',
        active: true
      });

      const { refundHtml, deliveryHtml, contactHtml } = ownOfferEngine.generatePolicyPages(offer);
      expect(refundHtml).toContain('NEEDS OWNER REVIEW');
      expect(deliveryHtml).toContain('NEEDS OWNER REVIEW');
      expect(contactHtml).toContain('NEEDS OWNER REVIEW');
      expect(deliveryHtml).toContain('OWNER_MANUAL');
      expect(refundHtml).toContain('support@myagency.in');
    });
  });

  describe('3. Outbound Payment Link Click Tracking', () => {
    it('records outbound click with refId and NEVER increments revenue', () => {
      const db = getDb();
      const clickEvent = ownOfferEngine.recordOutboundPaymentClick('ownoff_test_123', 'hash_ip_abc', 'Mozilla/5.0');

      expect(clickEvent.refId).toMatch(/^ref_pay_/);
      expect(clickEvent.isRevenue).toBe(false);

      // Verify DB row
      const row = db.prepare(`SELECT * FROM own_offer_clicks WHERE ref_id = ?`).get(clickEvent.refId) as any;
      expect(row).toBeDefined();
      expect(row.is_revenue).toBe(0);

      // Verify zero revenue recorded
      const rev = db.prepare(`SELECT COUNT(*) as c FROM revenue_records WHERE source = 'OWN_OFFER_CLICK'`).get() as any;
      expect(rev.c).toBe(0);
    });
  });

  describe('4. Razorpay Export Reconciliation & Zero API Call Invariant', () => {
    it('fails when export contains unknown columns', () => {
      const headers = ['payment_id', 'amount', 'status', 'captured', 'hacker_injection_column'];
      expect(() => reconciler.validateHeaders(headers)).toThrow(/UNKNOWN_COLUMNS_ERROR/i);
      expect(() => reconciler.validateHeaders(headers)).toThrow(/hacker_injection_column/i);
    });

    it('moves captured rows to VERIFIED and settled rows to PAID', () => {
      const db = getDb();
      const rows: RazorpayPaymentExportRow[] = [
        {
          paymentId: 'pay_captured_001',
          amountINR: 5000,
          status: 'captured',
          captured: true,
          settled: false,
          createdAt: '2026-10-10T09:00:00Z'
        },
        {
          paymentId: 'pay_settled_002',
          amountINR: 8000,
          status: 'captured',
          captured: true,
          settled: true,
          createdAt: '2026-10-09T08:00:00Z'
        },
        {
          paymentId: 'pay_failed_003',
          amountINR: 2000,
          status: 'failed',
          captured: false,
          createdAt: '2026-10-10T10:00:00Z'
        }
      ];

      const res = reconciler.reconcileExportRows(rows, orgId, bizId);
      expect(res.rowsProcessed).toBe(3);
      expect(res.verifiedCount).toBe(1);
      expect(res.verifiedRevenueINR).toBe(5000);
      expect(res.paidCount).toBe(1);
      expect(res.paidRevenueINR).toBe(8000);

      const dbCaptured = db.prepare(`SELECT * FROM manual_reconciled_payments WHERE payment_id = 'pay_captured_001'`).get() as any;
      expect(dbCaptured.ledger_state).toBe('VERIFIED');

      const dbSettled = db.prepare(`SELECT * FROM manual_reconciled_payments WHERE payment_id = 'pay_settled_002'`).get() as any;
      expect(dbSettled.ledger_state).toBe('PAID');

      // Failed row was ignored from verified revenue
      const dbFailed = db.prepare(`SELECT * FROM manual_reconciled_payments WHERE payment_id = 'pay_failed_003'`).get() as any;
      expect(dbFailed).toBeUndefined();
    });

    it('excludes TEST marked rows from revenue and KPIs', () => {
      const db = getDb();
      const rows: RazorpayPaymentExportRow[] = [
        {
          paymentId: 'pay_test_004',
          amountINR: 15000,
          status: 'captured',
          captured: true,
          isTest: true,
          createdAt: '2026-10-10T11:00:00Z'
        },
        {
          paymentId: 'pay_test_note_005',
          amountINR: 10000,
          status: 'captured',
          captured: true,
          notes: { purpose: 'TEST payment verification' },
          createdAt: '2026-10-10T11:30:00Z'
        }
      ];

      const res = reconciler.reconcileExportRows(rows, orgId, bizId);
      expect(res.testRowsExcluded).toBe(2);
      expect(res.verifiedCount).toBe(0);
      expect(res.verifiedRevenueINR).toBe(0);

      const revRecords = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id IN ('pay_test_004', 'pay_test_note_005')`).all();
      expect(revRecords.length).toBe(0);
    });

    it('reverses refunded rows in durable ledger', () => {
      const db = getDb();
      const refundRow: RazorpayPaymentExportRow = {
        paymentId: 'pay_refunded_006',
        amountINR: 4000,
        status: 'refunded',
        captured: false,
        createdAt: '2026-10-10T12:00:00Z'
      };

      const res = reconciler.reconcileExportRows([refundRow], orgId, bizId);
      expect(res.refundedCount).toBe(1);
      expect(res.refundedRevenueINR).toBe(4000);

      const revRecord = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = 'pay_refunded_006'`).get() as any;
      expect(revRecord.amount_inr).toBe(-4000);
      expect(revRecord.revenue_type).toBe('OWN_OFFER_REVERSAL');
    });
  });

  describe('5. RAZORPAY_API_UPGRADE_THRESHOLD Config', () => {
    it('advises API attachment when verified count reaches threshold', () => {
      reconciler.setUpgradeThreshold(10);

      // Below threshold (9 verified)
      const below = reconciler.getApiUpgradeStatus(9);
      expect(below.upgradeRecommended).toBe(false);
      expect(below.actionItem).toBeNull();

      // At threshold (10 verified)
      const atThreshold = reconciler.getApiUpgradeStatus(10);
      expect(atThreshold.upgradeRecommended).toBe(true);
      expect(atThreshold.actionItem).toBe('Attach Razorpay API keys and webhook');

      // Above threshold (15 verified)
      const above = reconciler.getApiUpgradeStatus(15);
      expect(above.upgradeRecommended).toBe(true);
    });
  });
});
