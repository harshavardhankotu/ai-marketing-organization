import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { PaymentTruthService } from '../../src/revenue/payment-truth-service.js';
import { ReplyDeskService } from '../../src/revenue/reply-desk.js';
import app from '../../src/index.js';

describe('Part D: Service Lane, 4-State Truth & Reply Desk', () => {
  const paymentTruth = PaymentTruthService.getInstance();
  const replyDesk = ReplyDeskService.getInstance();

  const resetDb = () => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM revenue_records WHERE source IN ('MANUAL_UPI', 'RAZORPAY_EXPORT')`).run();
      db.prepare(`DELETE FROM manual_upi_claims WHERE utr LIKE 'utr_test_%'`).run();
      db.prepare(`DELETE FROM razorpay_export_records WHERE payment_id LIKE 'pay_test_%'`).run();
      db.prepare(`DELETE FROM reply_desk_query_runs`).run();
      db.prepare(`DELETE FROM reply_desk_drafts WHERE source_url LIKE '%test%'`).run();
    } catch {}
  };

  beforeEach(resetDb);
  afterEach(resetDb);

  describe('1. Four-State Payment Truth Protocol', () => {
    it('State 1: PAYMENT_PAGE_VIEW does not recognize revenue', () => {
      const res = paymentTruth.recordPageView('/offer', 'hash_ip_01');
      expect(res.state).toBe('PAYMENT_PAGE_VIEW');
      expect(res.isRevenue).toBe(false);
    });

    it('State 2: PAYMENT_CLAIMED stores buyer UTR but recognizes zero revenue', () => {
      const claim = paymentTruth.registerClaim({
        businessId: 'biz_platform_aro',
        utr: 'utr_test_claim_01',
        amountINR: 15000,
        serviceRendered: 'AI Lead Conversion System Setup'
      });

      expect(claim.state).toBe('PAYMENT_CLAIMED');
      expect(claim.isRevenue).toBe(false);

      // Verify that verified revenue remains 0
      const db = getDb();
      const revRow = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = 'utr_test_claim_01'`).get();
      expect(revRow).toBeUndefined();
    });

    it('State 3: OWNER_CONFIRMED confirms bank statement credit and counts toward verified revenue', () => {
      // 1. Submit claim first
      paymentTruth.registerClaim({
        businessId: 'biz_platform_aro',
        utr: 'utr_test_claim_02',
        amountINR: 15000
      });

      // 2. Owner confirms
      const confirmed = paymentTruth.confirmByOwner({
        utr: 'utr_test_claim_02',
        businessId: 'biz_platform_aro',
        amountINR: 15000,
        ownerUserId: 'usr_owner_01'
      });

      expect(confirmed.state).toBe('OWNER_CONFIRMED');
      expect(confirmed.isRevenue).toBe(true);
      expect(confirmed.amountINR).toBe(15000);

      // Check verified revenue total
      expect(paymentTruth.getVerifiedRevenueTotal()).toBeGreaterThanOrEqual(15000);
    });

    it('State 4: EXPORT_VERIFIED reconciles Razorpay export rows and counts as verified revenue', () => {
      const exportRows = [
        {
          paymentId: 'pay_test_exp_01',
          amountINR: 15000,
          status: 'captured',
          utr: 'utr_bank_001',
          createdAt: new Date().toISOString()
        },
        {
          paymentId: 'pay_test_exp_02',
          amountINR: 8000,
          status: 'failed', // Failed payment should not be recognized
          createdAt: new Date().toISOString()
        }
      ];

      const res = paymentTruth.reconcileRazorpayExport(exportRows);
      expect(res.totalProcessed).toBe(2);
      expect(res.matchedCount).toBe(1);
      expect(res.verifiedRevenueAddedINR).toBe(15000);
      expect(res.matchedPaymentIds).toContain('pay_test_exp_01');
      expect(res.unmatchedPaymentIds).toContain('pay_test_exp_02');
    });

    it('Owner can mark an order TEST, excluding it from verified revenue', () => {
      // Confirm a ₹15,000 transaction
      paymentTruth.confirmByOwner({
        utr: 'utr_test_claim_03',
        businessId: 'biz_platform_aro',
        amountINR: 15000,
        ownerUserId: 'usr_owner_01'
      });

      const totalBefore = paymentTruth.getVerifiedRevenueTotal();
      expect(totalBefore).toBeGreaterThanOrEqual(15000);

      // Mark order as TEST
      const testRes = paymentTruth.markOrderTest('utr_test_claim_03');
      expect(testRes.marked).toBe(true);

      const totalAfter = paymentTruth.getVerifiedRevenueTotal();
      expect(totalAfter).toBe(totalBefore - 15000);
    });
  });

  describe('2. Reply Desk (D.3)', () => {
    it('enforces at most 2 Tavily queries per day and stores title, snippet, URL, date only (no names)', async () => {
      const today = '2026-10-17';
      const mockSearch = async (query: string) => [
        {
          title: 'Clinic asking about automated WhatsApp response',
          snippet: 'Looking for a tool that answers patient FAQs and schedules bookings automatically',
          url: `https://community.example.com/inquiry-${Date.now()}`,
          date: today
        }
      ];

      // Run 1: performs queries up to cap of 2
      const res1 = await replyDesk.discoverAndDraftReplies(today, mockSearch);
      expect(res1.queriesRun).toBe(2);
      expect(res1.newDraftsCount).toBe(2);

      // Run 2 on same day: blocked by 2-query/day limit
      const res2 = await replyDesk.discoverAndDraftReplies(today, mockSearch);
      expect(res2.queriesRun).toBe(0);
      expect(res2.message).toContain('RATE_LIMIT');

      // Verify drafts in DB: no names stored
      const drafts = replyDesk.getRecentDrafts(3);
      expect(drafts.length).toBeGreaterThan(0);
      for (const d of drafts) {
        expect(d.sourceUrl).toBeDefined();
        expect(d.requestTitle).toBeDefined();
        expect(d.draftAnswer).toContain('automated WhatsApp qualification bot');
        expect(d.status).toBe('DRAFT');
      }
    });
  });

  describe('3. /owner/proposal Refusal & Bio Gate (D.4)', () => {
    it('refuses /owner/proposal with OWNER_BIO_MISSING when owner/BIO.md is missing', async () => {
      const res = await app.request('/owner/proposal');
      expect(res.status).toBe(422);

      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toBe('OWNER_BIO_MISSING');
      expect(json.message).toContain('owner/BIO.md is missing');
      expect(json.message).toContain('Never invent clients or experience');
    });

    it('also refuses on GET /api/v1/owner/proposal when owner/BIO.md is missing', async () => {
      const res = await app.request('/api/v1/owner/proposal');
      expect(res.status).toBe(422);

      const json = await res.json() as any;
      expect(json.error).toBe('OWNER_BIO_MISSING');
    });
  });
});
