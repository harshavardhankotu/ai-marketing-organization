import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import app from '../../src/index.js';

describe('Item 6: Razorpay Fail-Closed D1 Durability', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';
  const testSecret = 'test_webhook_secret_fail_closed_123';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed when writing revenue_records to D1 throws: status transitions to RECONCILIATION_REQUIRED and never PAID', async () => {
    const db = getDb();
    const adapter = new RazorpayAdapter();

    const journeyId = 'journey_failclosed_01';
    db.prepare(`
      INSERT INTO customer_journeys (
        id, organization_id, business_id, visitor_id, customer_name, customer_phone,
        stage, first_touch_channel, last_touch_channel, touchpoints_json,
        total_lifetime_value_inr, classification, created_at, updated_at
      ) VALUES (?, ?, ?, 'vis_failclosed_01', 'Test Patient', '+919999988888',
        'OPPORTUNITY', 'GOOGLE_SEARCH', 'WHATSAPP', '[]',
        0, 'REAL', datetime('now'), datetime('now'))
    `).run(journeyId, orgId, businessId);

    const orderId = 'order_failclosed_test_01';
    db.prepare(`
      INSERT OR REPLACE INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, created_at, updated_at
      ) VALUES ('pord_failclosed_01', ?, ?, 25000, 'INR', 'CREATED', 'rcpt_failclosed_01', datetime('now'), datetime('now'))
    `).run(businessId, orderId);

    const linkId = 'plink_failclosed_test_01';
    db.prepare(`
      INSERT OR REPLACE INTO payment_provider_links (
        id, organization_id, business_id, provider, provider_link_id, short_url,
        reference_id, amount_inr, currency, status, created_at, provider_response_json
      ) VALUES ('ppl_failclosed_01', ?, ?, 'RAZORPAY', ?, 'https://rzp.io/i/testfail',
        'ref_failclosed_01', 25000, 'INR', 'CREATED', datetime('now'), '{}')
    `).run(orgId, businessId, linkId);

    db.prepare(`
      INSERT OR REPLACE INTO payment_requests (
        id, organization_id, business_id, offer_id, offer_description, amount_inr,
        currency, billing_model, provider, provider_link_id, short_url, reference_id,
        classification, status, payment_link, created_at, updated_at
      ) VALUES ('payrq_failclosed_01', ?, ?, 'OFFER_ALIGNERS_SETUP', 'Aligners Setup', 25000,
        'INR', 'ONE_TIME', 'RAZORPAY', ?, 'https://rzp.io/i/testfail', 'ref_failclosed_01',
        'REAL', 'CREATED', 'https://rzp.io/i/testfail', datetime('now'), datetime('now'))
    `).run(orgId, businessId, linkId);

    // Mock D1 to throw on insert
    const d1Repo = D1RevenueRepository.getInstance();
    const executeWriteSpy = vi.spyOn(d1Repo, 'executeWrite').mockRejectedValue(
      new Error('Cloudflare D1 internal error: simulated network timeout')
    );

    const paymentId = 'pay_failclosed_captured_123';
    const eventPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 2500000, // ₹25,000 in paise
            currency: 'INR',
            status: 'captured',
            order_id: orderId,
            payment_link_id: linkId,
            method: 'upi',
            description: 'Clear Aligners Setup',
            notes: {
              business_id: businessId,
              organization_id: orgId,
              journey_id: journeyId,
              invoice_number: 'INV-FAIL-CLOSED-01',
              service: 'Clear Aligners Treatment'
            }
          }
        }
      }
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = createHmac('sha256', testSecret).update(rawBody).digest('hex');

    // Webhook processing must throw REVENUE_PERSISTENCE_FAILED
    await expect(adapter.processWebhook({
      rawBody,
      signature,
      event: eventPayload,
      overrideSecret: testSecret,
      overrideClassification: 'REAL'
    })).rejects.toThrow(/REVENUE_PERSISTENCE_FAILED/);

    expect(executeWriteSpy).toHaveBeenCalled();

    // ASSERT: Status MUST NOT transition to PAID, MUST be RECONCILIATION_REQUIRED
    const updatedOrder = db.prepare('SELECT status FROM payment_orders WHERE order_id = ?').get(orderId) as any;
    expect(updatedOrder.status).toBe('RECONCILIATION_REQUIRED');
    expect(updatedOrder.status).not.toBe('PAID');

    const updatedLink = db.prepare('SELECT status FROM payment_provider_links WHERE provider_link_id = ?').get(linkId) as any;
    expect(updatedLink.status).toBe('RECONCILIATION_REQUIRED');
    expect(updatedLink.status).not.toBe('PAID');

    const updatedPayReq = db.prepare('SELECT status FROM payment_requests WHERE provider_link_id = ?').get(linkId) as any;
    expect(updatedPayReq.status).toBe('RECONCILIATION_REQUIRED');
    expect(updatedPayReq.status).not.toBe('PAID');

    // ASSERT: Customer MUST NOT be marked ONBOARDED or elevated to CUSTOMER
    const updatedJourney = db.prepare('SELECT stage FROM customer_journeys WHERE id = ?').get(journeyId) as any;
    expect(updatedJourney.stage).not.toBe('CUSTOMER');
    expect(updatedJourney.stage).toBe('OPPORTUNITY');

    const deliveries = db.prepare('SELECT * FROM platform_customer_deliveries WHERE payment_id = ?').all(paymentId);
    expect(deliveries.length).toBe(0);

    // ASSERT: No successful transactions row was created
    const tx = db.prepare('SELECT * FROM transactions WHERE transaction_ref = ?').get(paymentId);
    expect(tx).toBeUndefined();
  });

  it('HTTP POST /api/v1/webhooks/razorpay returns 500 when D1 write fails so Razorpay retries', async () => {
    const db = getDb();

    const orderId = 'order_http_failclosed_01';
    db.prepare(`
      INSERT OR REPLACE INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, created_at, updated_at
      ) VALUES ('pord_http_fail_01', ?, ?, 10000, 'INR', 'CREATED', 'rcpt_http_fail_01', datetime('now'), datetime('now'))
    `).run(businessId, orderId);

    // Mock D1 to throw on insert
    const d1Repo = D1RevenueRepository.getInstance();
    vi.spyOn(d1Repo, 'executeWrite').mockRejectedValue(
      new Error('Cloudflare D1 down: rate limit / unavailable')
    );

    const paymentId = 'pay_http_failclosed_999';
    const eventPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 1000000, // ₹10,000 in paise
            currency: 'INR',
            status: 'captured',
            order_id: orderId,
            method: 'upi',
            description: 'Consultation Deposit',
            notes: {
              business_id: businessId,
              organization_id: orgId
            }
          }
        }
      }
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const prevSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      process.env.RAZORPAY_WEBHOOK_SECRET = testSecret;

      const res = await app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature
        },
        body: rawBody
      });

      // Webhook endpoint MUST return 500 so Razorpay retries
      expect(res.status).toBe(500);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('REVENUE_PERSISTENCE_FAILED');

      // Verify order was transitioned to RECONCILIATION_REQUIRED, never PAID
      const order = db.prepare('SELECT status FROM payment_orders WHERE order_id = ?').get(orderId) as any;
      expect(order.status).toBe('RECONCILIATION_REQUIRED');
      expect(order.status).not.toBe('PAID');
    } finally {
      if (prevSecret) process.env.RAZORPAY_WEBHOOK_SECRET = prevSecret;
      else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    }
  });

  it('succeeds, transitions to PAID, and books revenue when D1 write succeeds', async () => {
    const db = getDb();
    const adapter = new RazorpayAdapter();

    const orderId = 'order_success_01';
    db.prepare(`
      INSERT OR REPLACE INTO payment_orders (
        id, business_id, order_id, amount_inr, currency, status, receipt, created_at, updated_at
      ) VALUES ('pord_success_01', ?, ?, 15000, 'INR', 'CREATED', 'rcpt_success_01', datetime('now'), datetime('now'))
    `).run(businessId, orderId);

    const paymentId = 'pay_success_123';
    const eventPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 1500000, // ₹15,000 in paise
            currency: 'INR',
            status: 'captured',
            order_id: orderId,
            method: 'upi',
            description: 'Standard Clinical Plan',
            notes: {
              business_id: businessId,
              organization_id: orgId
            }
          }
        }
      }
    };

    const rawBody = JSON.stringify(eventPayload);
    const signature = createHmac('sha256', testSecret).update(rawBody).digest('hex');

    const res = await adapter.processWebhook({
      rawBody,
      signature,
      event: eventPayload,
      overrideSecret: testSecret,
      overrideClassification: 'REAL'
    });

    expect(res.processed).toBe(true);

    // Verify status is PAID
    const order = db.prepare('SELECT status FROM payment_orders WHERE order_id = ?').get(orderId) as any;
    expect(order.status).toBe('PAID');

    // Verify revenue record was created
    const revRecord = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(paymentId) as any;
    expect(revRecord).toBeDefined();
    expect(revRecord.amount_inr).toBe(15000);
    expect(revRecord.verified).toBe(1);
  });
});
