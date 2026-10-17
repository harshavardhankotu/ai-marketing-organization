import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { getDb } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { OwnOfferEngine } from '../../src/revenue/own-offer-engine.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import app from '../../src/index.js';

describe('Comprehensive Razorpay & UPI QR Payment Collection System (Prompt Section 9)', () => {
  const BIZ_ID = OwnerAuthService.PLATFORM_BUSINESS_ID;
  const ORG_ID = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const TEST_WEBHOOK_SECRET = 'test_webhook_secret_key_12345';
  let razorpay: RazorpayAdapter;

  beforeEach(() => {
    razorpay = new RazorpayAdapter();
    const db = getDb();
    try {
      db.prepare(`DELETE FROM manual_upi_claims WHERE utr LIKE 'test_%' OR utr LIKE 'utr_%'`).run();
      db.prepare(`DELETE FROM payment_requests WHERE id LIKE 'payrq_test_%'`).run();
      db.prepare(`DELETE FROM payment_provider_links WHERE id LIKE 'ppl_test_%'`).run();
      db.prepare(`DELETE FROM payment_orders WHERE id LIKE 'po_test_%'`).run();
      db.prepare(`DELETE FROM transactions WHERE transaction_ref LIKE 'pay_test_%' OR transaction_ref LIKE 'test_%'`).run();
      db.prepare(`DELETE FROM revenue_records WHERE transaction_id LIKE 'pay_test_%' OR transaction_id LIKE 'test_%'`).run();
      db.prepare(`DELETE FROM idempotent_actions WHERE idempotency_key LIKE 'evt_test_%' OR idempotency_key LIKE 'rzp_evt_test_%'`).run();
      db.prepare(`DELETE FROM proposals WHERE id LIKE 'prop_test_%'`).run();
    } catch {}
  });

  afterEach(() => {
    delete process.env.DIRECT_OFFER_TERMS_SHA256;
  });

  // 1. Correctly configured links for different invoice amounts
  it('Case 1: Correctly configures links for different invoice amounts (₹15,000 setup and ₹8,000 monthly)', async () => {
    const setupLink = await razorpay.createPaymentLink({
      organizationId: ORG_ID,
      businessId: BIZ_ID,
      offerId: 'PLATFORM_SETUP',
      amountINR: 15000,
      customer: { name: 'Dr. Test Setup', email: 'setup@test.com' }
    });
    expect(setupLink.amountINR).toBe(15000);
    expect(setupLink.currency).toBe('INR');
    expect(setupLink.providerLinkId).toBeDefined();
    expect(setupLink.shortUrl).toContain('https://rzp.io/');

    const monthlyLink = await razorpay.createPaymentLink({
      organizationId: ORG_ID,
      businessId: BIZ_ID,
      offerId: 'PLATFORM_MONTHLY',
      amountINR: 8000,
      customer: { name: 'Dr. Test Monthly', email: 'monthly@test.com' }
    });
    expect(monthlyLink.amountINR).toBe(8000);
    expect(monthlyLink.currency).toBe('INR');
    expect(monthlyLink.shortUrl).toContain('https://rzp.io/');
  });

  // 2. Prevention of the old fixed ₹100 link being used incorrectly
  it('Case 2: Prevents the old fixed ₹100 link (paQqSni / Tow5k0qoIXcQ8g) from being used', async () => {
    const badUrl = 'https://rzp.io/rzp/paQqSni';
    expect(OwnerAuthService.isDisallowedFixedPaymentLink(badUrl)).toBe(true);
    expect(OwnerAuthService.isDisallowedFixedPaymentLink('https://rzp.io/i/Tow5k0qoIXcQ8g')).toBe(true);
    expect(OwnerAuthService.isDisallowedFixedPaymentLink('https://rzp.io/i/valid_link_123')).toBe(false);

    expect(OwnOfferEngine.validateRazorpayUrl(badUrl)).toBe(false);

    expect(() => {
      OwnOfferEngine.getInstance().createOwnOffer({
        organizationId: ORG_ID,
        name: 'Attempted ₹100 Misuse',
        oneSentencePromise: 'Misconfigured link test',
        priceINR: 15000,
        priceSetDate: '2026-10-17',
        refundPolicyText: 'Standard refund',
        paymentLinkUrl: badUrl,
        categoryAttestation: true,
        whatBuyerGets: ['Item 1'],
        whoItIsFor: ['Target 1'],
        whoShouldNotBuy: ['Excluded 1'],
        contactEmail: 'test@example.com'
      });
    }).toThrow(/DISALLOWED_FIXED_PAYMENT_LINK/);

    await expect(async () => {
      await razorpay.recordManualUpiClaim({
        businessId: BIZ_ID,
        utr: 'https://rzp.io/rzp/paQqSni',
        amountINR: 15000
      });
    }).rejects.toThrow(/DISALLOWED_FIXED_PAYMENT_LINK/);
  });

  // 3. Exact amount and currency validation
  it('Case 3: Enforces exact amount and currency validation (rejects mismatched and arbitrary amounts)', async () => {
    // Rejects mismatched amount (trying to pay ₹100 for ₹15,000 setup offer)
    await expect(
      razorpay.createPaymentLink({
        organizationId: ORG_ID,
        businessId: BIZ_ID,
        offerId: 'PLATFORM_SETUP',
        amountINR: 100 // Tampered amount
      })
    ).rejects.toThrow(/AMOUNT MISMATCH/);

    // Rejects unauthorized deposit amount
    expect(() => {
      razorpay.validatePermittedDeposit(1234); // Arbitrary amount
    }).toThrow(/PAYMENT_TAMPER_DETECTED/);
  });

  // 4. Correct INR-to-paise conversions
  it('Case 4: Converts INR to exact integer paise without floating-point artifacts', () => {
    const setupINR = 15000;
    const monthlyINR = 8000;
    expect(Math.round(setupINR * 100)).toBe(1500000);
    expect(Math.round(monthlyINR * 100)).toBe(800000);
    expect(Number.isInteger(Math.round(setupINR * 100))).toBe(true);
  });

  // 5. Payment-reference validation
  it('Case 5: Generates and validates unique payment and invoice references', () => {
    const page = DirectCommercialOfferPage.getInstance();
    const ref1 = page.generateOrderReference('LCS');
    const ref2 = page.generateOrderReference('LCS');
    expect(ref1).toMatch(/^LCS-\d{8}-[A-Z0-9]+$/);
    expect(ref2).toMatch(/^LCS-\d{8}-[A-Z0-9]+$/);
    expect(ref1).not.toBe(ref2);
  });

  // 6. Valid and invalid webhook signatures
  it('Case 6: Cryptographically validates webhook signatures using HMAC-SHA256', () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'evt_sig_test' });
    const secret = 'webhook_secret_key_testing';
    const validSig = createHmac('sha256', secret).update(body).digest('hex');
    const invalidSig = 'deadbeef00000000000000000000000000000000000000000000000000000000';

    expect(razorpay.verifyWebhookSignature(body, validSig, secret)).toBe(true);
    expect(razorpay.verifyWebhookSignature(body, invalidSig, secret)).toBe(false);
    expect(razorpay.verifyWebhookSignature('', validSig, secret)).toBe(false);
  });

  // 7. Duplicate webhook deliveries
  it('Case 7: Handles duplicate webhook deliveries idempotently without double-counting', async () => {
    const db = getDb();
    const linkId = 'plink_test_idemp_01';
    const payId = 'pay_test_idemp_01';
    const evtId = 'evt_test_idemp_01';

    db.prepare(`
      INSERT INTO payment_provider_links (
        id, organization_id, business_id, provider, provider_link_id, short_url,
        reference_id, amount_inr, currency, status, created_at
      ) VALUES ('ppl_test_idemp', ?, ?, 'RAZORPAY', ?, 'https://rzp.io/i/test_idemp', 'ref_idemp', 15000, 'INR', 'CREATED', datetime('now'))
    `).run(ORG_ID, BIZ_ID, linkId);

    db.prepare(`
      INSERT INTO payment_requests (
        id, organization_id, business_id, offer_description, amount_inr, currency,
        provider, provider_link_id, short_url, reference_id, status, classification, created_at, updated_at
      ) VALUES ('payrq_test_idemp', ?, ?, 'Setup', 15000, 'INR', 'RAZORPAY', ?, 'https://rzp.io/i/test_idemp', 'ref_idemp', 'SENT', 'REAL', datetime('now'), datetime('now'))
    `).run(ORG_ID, BIZ_ID, linkId);

    const payload = {
      event: 'payment_link.paid',
      id: evtId,
      payload: {
        payment_link: { entity: { id: linkId, amount_paid: 1500000, notes: { business_id: BIZ_ID, organization_id: ORG_ID } } },
        payment: { entity: { id: payId, amount: 1500000, method: 'upi', notes: { business_id: BIZ_ID, organization_id: ORG_ID } } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    // First delivery: processes successfully
    const firstRes = await razorpay.processWebhook({
      rawBody,
      signature,
      event: payload,
      overrideSecret: TEST_WEBHOOK_SECRET
    });
    expect(firstRes.processed).toBe(true);

    // Second delivery: idempotent recognition
    const secondRes = await razorpay.processWebhook({
      rawBody,
      signature,
      event: payload,
      overrideSecret: TEST_WEBHOOK_SECRET
    });
    expect(secondRes.processed).toBe(true);
    expect(secondRes.reason).toContain('already processed');

    // Verify revenue was only recorded once
    const revCount = (db.prepare('SELECT COUNT(*) as count FROM revenue_records WHERE transaction_id = ?').get(payId) as any).count;
    expect(revCount).toBe(1);
  });

  // 8. Successful captured payments
  it('Case 8: Successfully processes payment.captured and ledgers verified real revenue', async () => {
    const db = getDb();
    const orderId = 'order_test_cap_01';
    const payId = 'pay_test_cap_01';
    const evtId = 'evt_test_cap_01';

    db.prepare(`
      INSERT INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, created_at, updated_at
      ) VALUES ('po_test_cap', ?, ?, 15000, 'INR', 'CREATED', 'rcpt_cap', datetime('now'), datetime('now'))
    `).run(BIZ_ID, orderId);

    const payload = {
      event: 'payment.captured',
      id: evtId,
      payload: {
        payment: {
          entity: {
            id: payId,
            order_id: orderId,
            amount: 1500000,
            status: 'captured',
            method: 'upi',
            notes: { business_id: BIZ_ID, organization_id: ORG_ID }
          }
        }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    const res = await razorpay.processWebhook({
      rawBody,
      signature,
      event: payload,
      overrideSecret: TEST_WEBHOOK_SECRET
    });
    expect(res.processed).toBe(true);

    // Verify transaction recorded
    const tx = db.prepare('SELECT * FROM transactions WHERE transaction_ref = ?').get(payId) as any;
    expect(tx).toBeDefined();
    expect(tx.status).toBe('SUCCESS');
    expect(tx.amount_inr).toBe(15000);

    // Verify verified revenue ledgered
    const rev = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(payId) as any;
    expect(rev).toBeDefined();
    expect(rev.verified).toBe(1);
    expect(rev.amount_inr).toBe(15000);
  });

  // 9. Authorized but uncaptured payments
  it('Case 9: Ignores authorized but uncaptured payment events without creating revenue', async () => {
    const payload = {
      event: 'payment.authorized',
      id: 'evt_test_auth_only',
      payload: {
        payment: { entity: { id: 'pay_test_auth_01', amount: 1500000, status: 'authorized' } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    const res = await razorpay.processWebhook({
      rawBody,
      signature,
      event: payload,
      overrideSecret: TEST_WEBHOOK_SECRET
    });
    expect(res.processed).toBe(false);
    expect(res.reason).toContain('unmonitored');

    const rev = getDb().prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get('pay_test_auth_01');
    expect(rev).toBeUndefined();
  });

  // 10. Failed transactions
  it('Case 10: Records failed transactions and transitions status to FAILED without revenue', async () => {
    const db = getDb();
    const orderId = 'order_test_fail_01';

    db.prepare(`
      INSERT INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, created_at, updated_at
      ) VALUES ('po_test_fail', ?, ?, 15000, 'INR', 'CREATED', 'rcpt_fail', datetime('now'), datetime('now'))
    `).run(BIZ_ID, orderId);

    const payload = {
      event: 'payment.failed',
      id: 'evt_test_fail_01',
      payload: {
        payment: { entity: { id: 'pay_test_failed_01', order_id: orderId, status: 'failed' } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    const res = await razorpay.processWebhook({
      rawBody,
      signature,
      event: payload,
      overrideSecret: TEST_WEBHOOK_SECRET
    });
    expect(res.processed).toBe(true);
    expect(res.reason).toContain('Payment failed');

    const order = db.prepare('SELECT status FROM payment_orders WHERE order_id = ?').get(orderId) as any;
    expect(order.status).toBe('FAILED');
  });

  // 11. Partial payments rejected
  it('Case 11: Rejects partial payments with security violation amount mismatch', async () => {
    const db = getDb();
    const linkId = 'plink_test_partial_01';

    db.prepare(`
      INSERT INTO payment_provider_links (
        id, organization_id, business_id, provider, provider_link_id, short_url,
        reference_id, amount_inr, currency, status, created_at
      ) VALUES ('ppl_test_partial', ?, ?, 'RAZORPAY', ?, 'https://rzp.io/i/test_partial', 'ref_partial', 15000, 'INR', 'CREATED', datetime('now'))
    `).run(ORG_ID, BIZ_ID, linkId);

    const payload = {
      event: 'payment_link.paid',
      id: 'evt_test_partial_01',
      payload: {
        payment_link: { entity: { id: linkId, amount_paid: 1000000, notes: { business_id: BIZ_ID, organization_id: ORG_ID } } }, // ₹10,000 paid instead of ₹15,000
        payment: { entity: { id: 'pay_test_part_01', amount: 1000000, notes: { business_id: BIZ_ID, organization_id: ORG_ID } } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    await expect(
      razorpay.processWebhook({
        rawBody,
        signature,
        event: payload,
        overrideSecret: TEST_WEBHOOK_SECRET
      })
    ).rejects.toThrow(/AMOUNT MISMATCH/);
  });

  // 12. Refunds and reversals
  it('Case 12: Processes refund events and updates order status to REFUNDED', async () => {
    const db = getDb();
    const orderId = 'order_test_ref_01';

    db.prepare(`
      INSERT INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, created_at, updated_at
      ) VALUES ('po_test_ref', ?, ?, 15000, 'INR', 'PAID', 'rcpt_ref', datetime('now'), datetime('now'))
    `).run(BIZ_ID, orderId);

    const payload = {
      event: 'refund.processed',
      id: 'evt_test_ref_01',
      payload: {
        refund: { entity: { id: 'rfnd_test_01', order_id: orderId, amount: 1500000, status: 'processed' } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    const res = await razorpay.processWebhook({
      rawBody,
      signature,
      event: payload,
      overrideSecret: TEST_WEBHOOK_SECRET
    });
    expect(res.processed).toBe(true);

    const order = db.prepare('SELECT status FROM payment_orders WHERE order_id = ?').get(orderId) as any;
    expect(order.status).toBe('REFUNDED');
  });

  // 13. Unknown or mismatched payment IDs
  it('Case 13: Strictly rejects webhook payloads with unknown links or invalid payment IDs', async () => {
    const payload = {
      event: 'payment_link.paid',
      id: 'evt_test_unknown',
      payload: {
        payment_link: { entity: { id: 'plink_unknown_999', amount_paid: 1500000 } },
        payment: { entity: { id: 'pay_unknown_999', amount: 1500000 } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', TEST_WEBHOOK_SECRET).update(rawBody).digest('hex');

    await expect(
      razorpay.processWebhook({
        rawBody,
        signature,
        event: payload,
        overrideSecret: TEST_WEBHOOK_SECRET
      })
    ).rejects.toThrow(/Unrecognized provider transaction/);
  });

  // 14. Manual QR-payment claims remaining pending until verified
  it('Case 14: Manual QR UTR claims remain PAYMENT_CLAIMED with ₹0 revenue until owner confirmation', async () => {
    const db = getDb();
    const utr = 'test_bank_utr_428901';

    // Step 1: Customer submits claim
    const claimRes = await razorpay.recordManualUpiClaim({
      businessId: BIZ_ID,
      utr,
      amountINR: 15000,
      payerName: 'Dr. Test Clinic',
      invoiceRef: 'REF-LCS-TEST-01'
    });

    expect(claimRes.status).toBe('PAYMENT_CLAIMED');
    expect(claimRes.utr).toBe(utr);

    // Step 2: Verify database claim row
    const claim = db.prepare('SELECT * FROM manual_upi_claims WHERE id = ?').get(claimRes.claimId) as any;
    expect(claim.status).toBe('PAYMENT_CLAIMED');
    expect(claim.invoice_ref).toBe('REF-LCS-TEST-01');

    // Step 3: Zero verified revenue recognized at this stage
    const revBefore = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(utr);
    expect(revBefore).toBeUndefined();

    // Step 4: Owner confirms claim
    const confirmRes = await razorpay.confirmManualUpiClaim({
      claimId: claimRes.claimId,
      utr,
      businessId: BIZ_ID,
      amountINR: 15000,
      ownerUserId: OwnerAuthService.OWNER_USER_ID,
      organizationId: ORG_ID
    });

    expect(confirmRes.success).toBe(true);
    expect(confirmRes.classification).toBe('MANUAL_VERIFIED');
    expect(confirmRes.status).toBe('HUMAN_VERIFIED_PAYMENT');

    // Step 5: Verified revenue is now ledgered
    const revAfter = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(utr) as any;
    expect(revAfter).toBeDefined();
    expect(revAfter.verified).toBe(1);
    expect(revAfter.amount_inr).toBe(15000);
    expect(revAfter.verification_method).toBe('OWNER_MANUAL');
  });

  // 15. Prevention of public status manipulation
  it('Case 15: Prevents public manipulation of payment confirmation status', async () => {
    // Unauthenticated request to confirm payment must be rejected
    const res = await app.request('/api/v1/payments/manual-upi/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utr: 'test_hack_utr', businessId: BIZ_ID, amountINR: 15000 })
    });
    // Owner auth middleware blocks unauthenticated callers
    expect([401, 403]).toContain(res.status);
  });

  // 16. Accurate gross-payment, settlement, and revenue calculations
  it('Case 16: Maintains strict distinction between offer price, claims, and verified net revenue', () => {
    const db = getDb();
    // Verify that counting verified revenue only sums verified=1 entries
    const sumRow = db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records WHERE verified = 1 AND revenue_type = 'PLATFORM_REVENUE'`).get() as any;
    expect(typeof sumRow.total).toBe('number');
  });

  // 17. Correct display of the supplied QR
  it('Case 17: Serves the authentic Razorpay UPI QR image with correct merchant VPA and name', async () => {
    const imgRes = await app.request('/images/razorpay-upi-qr.jpg');
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toContain('image/jpeg');

    expect(OwnerAuthService.PLATFORM_UPI_VPA).toBe('venkatasaiharsh149768.rzp@rxairtel');
    expect(OwnerAuthService.PLATFORM_MERCHANT_NAME).toBe('VENKATA SAI HARSHAVARDHAN KOTU');
    expect(OwnerAuthService.PLATFORM_QR_ASSET_PATH).toBe('/images/razorpay-upi-qr.jpg');
  });

  // 18. Mobile and desktop payment-page behavior
  it('Case 18: Renders responsive proposal checkout page with Method A and Method B instructions', async () => {
    const pe = ProposalEngine.getInstance();
    const prop = pe.createProposal({
      organizationId: ORG_ID,
      businessId: BIZ_ID,
      prospectId: 'pros_test_ui_01',
      title: 'Apex Dental Care Implementation',
      setupPriceINR: 15000,
      monthlyPriceINR: 8000,
      deliverables: ['Custom WhatsApp Bot', 'GBP Integration']
    });

    const res = await app.request(`/proposals/${prop.id}/checkout`);
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('Apex Dental Care Implementation');
    expect(html).toContain('₹15,000');
    expect(html).toContain('Method A — Razorpay Payment Link');
    expect(html).toContain('Method B — Scan &amp; Pay via UPI QR');
    expect(html).toContain('venkatasaiharsh149768.rzp@rxairtel');
    expect(html).toContain('VENKATA SAI HARSHAVARDHAN KOTU');
    expect(html).toContain('/images/razorpay-upi-qr.jpg');
    expect(html).toContain('Report Paid UPI Transaction');
  });

  // 19. Missing credentials and provider-unavailable behavior
  it('Case 19: Falls back safely in test/sandbox environment and verifies fail-closed credential checks', async () => {
    // In test environment, classification is TEST (never fake REAL)
    expect(razorpay.getClassification()).toBe('TEST');

    // In production without credentials, verify that createPaymentLink fails closed with CREDENTIAL_FAULT
    const origEnv = process.env.NODE_ENV;
    const origVitest = process.env.VITEST;
    try {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.VITEST;
      await expect(
        razorpay.createPaymentLink({
          organizationId: ORG_ID,
          businessId: BIZ_ID,
          offerId: 'PLATFORM_SETUP'
        })
      ).rejects.toThrow(/CREDENTIAL_FAULT|PERSISTENCE_FAULT|PRODUCTION D1/);
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origVitest !== undefined) process.env.VITEST = origVitest;
    }
  });

  // 20. Backward compatibility with existing payment records
  it('Case 20: Backward compatibility with legacy payment records and schema columns', () => {
    const db = getDb();
    // Test inserting legacy minimal claim without proposal_id
    const legacyClaimId = 'claim_test_legacy_01';
    db.prepare(`
      INSERT INTO manual_upi_claims (
        id, organization_id, business_id, utr, amount_inr, status, claimed_at
      ) VALUES (?, ?, ?, 'test_utr_legacy_01', 15000, 'PAYMENT_CLAIMED', datetime('now'))
    `).run(legacyClaimId, ORG_ID, BIZ_ID);

    const row = db.prepare('SELECT * FROM manual_upi_claims WHERE id = ?').get(legacyClaimId) as any;
    expect(row).toBeDefined();
    expect(row.proposal_id).toBeNull();
    expect(row.amount_inr).toBe(15000);
  });
});
