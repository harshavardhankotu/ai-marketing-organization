import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { createHmac, createHash } from 'node:crypto';

describe('Stage P.3.3 — First Genuine Sale Closure: FK Integrity, Audit Truth, Brevo Status, Credential Resolution & Webhook Idempotency', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;
  const originalEnv = { ...process.env };

  function mockDomainAudit(domain: string) {
    const mockAudit = {
      auditId: `audit_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`,
      domain,
      url: `https://${domain}`,
      businessName: 'Mock Business',
      scorecard: { totalScore: 82, items: [] },
      findings: []
    };
    vi.spyOn(SiteAuditService.getInstance(), 'getAuditByDomain').mockImplementation(async (d: string) => {
      if (d.includes(domain)) return mockAudit as any;
      return null;
    });
    return mockAudit;
  }

  beforeEach(() => {
    const db = getDb();
    try { db.exec(`DELETE FROM durable_events`); } catch {}
    try { db.exec(`DELETE FROM universal_orders`); } catch {}
    try { db.exec(`DELETE FROM delivery_tasks`); } catch {}
    try { db.exec(`DELETE FROM customer_journeys`); } catch {}
    try { db.exec(`DELETE FROM transactions`); } catch {}

    d1Repo = D1RevenueRepository.getInstance();
    RazorpayStandardAdapter.resetInstance();
    BrevoMcpClient.resetInstanceForTesting();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Task 1: delivery_tasks Foreign Key Integrity & Genuine Audit Scan (P0)', () => {
    it('1.1: verifyPaymentAndFulfill inserts into delivery_tasks with PRAGMA foreign_keys = ON without FK violation', async () => {
      const db = getDb();
      db.exec('PRAGMA foreign_keys = ON;');

      const adapter = RazorpayStandardAdapter.getInstance();
      const targetDomain = 'foreign-key-safe-domain.com';
      const buyerEmail = 'buyer@foreign-key-safe-domain.com';

      mockDomainAudit(targetDomain);

      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: targetDomain,
        buyerEmail: buyerEmail,
        customerName: 'Safe Buyer'
      });

      const keySecret = adapter.getKeySecret();
      const payId = `pay_fk_test_${Date.now()}`;
      const sig = createHmac('sha256', keySecret).update(`${order.razorpayOrderId || order.orderId}|${payId}`).digest('hex');

      // verifyPaymentAndFulfill should complete cleanly under PRAGMA foreign_keys = ON
      const result = await adapter.verifyPaymentAndFulfill({
        orderId: order.orderId,
        razorpay_order_id: order.razorpayOrderId || order.orderId,
        razorpay_payment_id: payId,
        razorpay_signature: sig
      });

      expect(result.success).toBe(true);

      // Verify that customer_journeys has the corresponding parent row
      const journey = await d1Repo.queryOne<any>(
        'customer_journeys',
        `SELECT id, stage, customer_email FROM customer_journeys WHERE customer_email = ?`,
        [buyerEmail]
      );
      expect(journey).toBeDefined();
      expect(journey.customer_email).toBe(buyerEmail);

      // Verify that delivery_tasks has the corresponding delivery row linked to customer_journey_id
      const deliv = await d1Repo.queryOne<any>(
        'delivery_tasks',
        `SELECT id, customer_journey_id, service_type, stage FROM delivery_tasks WHERE customer_journey_id = ?`,
        [journey.id]
      );
      expect(deliv).toBeDefined();
      expect(deliv.stage).toBe('COMPLETED');
      expect(deliv.service_type).toBe('SITE_AUDIT_FIXPACK');
    });

    it('1.2: failed live scan does NOT create fake score-55 audit and sets PAYMENT_CAPTURED_PENDING_DELIVERY', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const targetDomain = 'failing-scan-target.com';
      const buyerEmail = 'founder@failing-scan-target.com';

      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: targetDomain,
        buyerEmail: buyerEmail,
        customerName: 'Scan Test Buyer'
      });

      // Mock SiteAuditService to fail live scan
      const auditService = SiteAuditService.getInstance();
      vi.spyOn(auditService, 'getAuditByDomain').mockResolvedValue(null);
      vi.spyOn(auditService, 'runScan').mockRejectedValue(new Error('Network probe connection timed out'));

      const keySecret = adapter.getKeySecret();
      const payId = `pay_scan_fail_${Date.now()}`;
      const sig = createHmac('sha256', keySecret).update(`${order.razorpayOrderId || order.orderId}|${payId}`).digest('hex');

      const result = await adapter.verifyPaymentAndFulfill({
        orderId: order.orderId,
        razorpay_order_id: order.razorpayOrderId || order.orderId,
        razorpay_payment_id: payId,
        razorpay_signature: sig
      });

      // Must capture payment without 500, but set retryRequired and PAYMENT_CAPTURED_PENDING_DELIVERY
      expect(result.success).toBe(true);
      expect(result.paymentCaptured).toBe(true);
      expect(result.fulfillmentStatus).toBe('PAYMENT_CAPTURED_PENDING_DELIVERY');
      expect(result.deliverableStatus).toBe('PENDING');
      expect(result.retryRequired).toBe(true);

      // Verify D1 universal_orders was updated to PAYMENT_CAPTURED_PENDING_DELIVERY
      const stored = await d1Repo.queryOne<any>(
        'universal_orders',
        `SELECT fulfillment_status, status FROM universal_orders WHERE id = ?`,
        [order.orderId]
      );
      expect(stored.fulfillmentStatus || stored.fulfillment_status).toBe('PAYMENT_CAPTURED_PENDING_DELIVERY');
    });
  });

  describe('Task 2: Brevo Send Status Verification & Deliverable/Email Separation (P0)', () => {
    it('2.1: Brevo send failure marks emailReceiptStatus = PENDING_RETRY and fulfillmentStatus = DELIVERABLE_READY_EMAIL_PENDING', async () => {
      process.env.BREVO_API_KEY = 'test_brevo_active_key_123';
      const adapter = RazorpayStandardAdapter.getInstance();
      const targetDomain = 'brevo-fail-test.io';
      const buyerEmail = 'user@brevo-fail-test.io';

      mockDomainAudit(targetDomain);

      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: targetDomain,
        buyerEmail: buyerEmail,
        customerName: 'Brevo Lead'
      });

      // Mock Brevo to return failure status
      const brevo = BrevoMcpClient.getInstance();
      vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: false,
        status: 'ERROR',
        reason: 'Daily transactional limit reached'
      });

      const keySecret = adapter.getKeySecret();
      const payId = `pay_brevo_err_${Date.now()}`;
      const sig = createHmac('sha256', keySecret).update(`${order.razorpayOrderId || order.orderId}|${payId}`).digest('hex');

      const result = await adapter.verifyPaymentAndFulfill({
        orderId: order.orderId,
        razorpay_order_id: order.razorpayOrderId || order.orderId,
        razorpay_payment_id: payId,
        razorpay_signature: sig
      });

      expect(result.success).toBe(true);
      expect(result.deliverableStatus).toBe('READY');
      expect(result.emailReceiptStatus).toBe('PENDING_RETRY');
      expect(result.fulfillmentStatus).toBe('DELIVERABLE_READY_EMAIL_PENDING');
      expect(result.retryRequired).toBe(true);

      // Check D1 universal_orders
      const stored = await d1Repo.queryOne<any>(
        'universal_orders',
        `SELECT fulfillment_status, metadata_json FROM universal_orders WHERE id = ?`,
        [order.orderId]
      );
      expect(stored.fulfillment_status).toBe('DELIVERABLE_READY_EMAIL_PENDING');
      const meta = JSON.parse(stored.metadata_json);
      expect(meta.deliverable_status).toBe('READY');
      expect(meta.email_receipt_status).toBe('PENDING_RETRY');
    });

    it('2.2: Brevo send success marks emailReceiptStatus = SENT and fulfillmentStatus = DELIVERED', async () => {
      process.env.BREVO_API_KEY = 'test_brevo_active_key_123';
      const adapter = RazorpayStandardAdapter.getInstance();
      const targetDomain = 'brevo-success-test.io';
      const buyerEmail = 'happy@brevo-success-test.io';

      mockDomainAudit(targetDomain);

      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: targetDomain,
        buyerEmail: buyerEmail,
        customerName: 'Happy Customer'
      });

      // Mock Brevo to return successful delivery
      const brevo = BrevoMcpClient.getInstance();
      vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
        success: true,
        status: 'SENT',
        messageId: 'msg_brevo_abc123'
      });

      const keySecret = adapter.getKeySecret();
      const payId = `pay_brevo_ok_${Date.now()}`;
      const sig = createHmac('sha256', keySecret).update(`${order.razorpayOrderId || order.orderId}|${payId}`).digest('hex');

      const result = await adapter.verifyPaymentAndFulfill({
        orderId: order.orderId,
        razorpay_order_id: order.razorpayOrderId || order.orderId,
        razorpay_payment_id: payId,
        razorpay_signature: sig
      });

      expect(result.success).toBe(true);
      expect(result.deliverableStatus).toBe('READY');
      expect(result.emailReceiptStatus).toBe('SENT');
      expect(result.fulfillmentStatus).toBe('DELIVERED');
      expect(result.retryRequired).toBe(false);

      const stored = await d1Repo.queryOne<any>(
        'universal_orders',
        `SELECT fulfillment_status, metadata_json FROM universal_orders WHERE id = ?`,
        [order.orderId]
      );
      expect(stored.fulfillment_status).toBe('DELIVERED');
      const meta = JSON.parse(stored.metadata_json);
      expect(meta.deliverable_status).toBe('READY');
      expect(meta.email_receipt_status).toBe('SENT');
    });
  });

  describe('Task 3: Event-ID Webhook Idempotency & Missing ID Validation (P0)', () => {
    it('3.1: webhook rejects immediately with HTTP 400 when paymentId or orderId is missing', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_123';
      const testSecret = 'whsec_test_secret_123';

      const missingPaymentPayload = {
        event: 'payment.captured',
        payload: {
          order: { entity: { id: 'ord_rzp_mock123', receipt: 'ord_rzp_mock123' } }
          // payment is omitted
        }
      };
      const raw1 = JSON.stringify(missingPaymentPayload);
      const sig1 = createHmac('sha256', testSecret).update(raw1).digest('hex');

      const res1 = await app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': sig1
        },
        body: raw1
      });
      expect(res1.status).toBe(400);
      const json1 = await res1.json();
      expect(json1.error).toContain('MISSING_PROVIDER_PAYMENT_OR_ORDER_ID');
    });

    it('3.2: duplicate webhook with same x-razorpay-event-id is deduplicated and returns HTTP 200 { received: true, duplicate: true }', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_123';
      const testSecret = 'whsec_test_secret_123';

      mockDomainAudit('webhook-dedupe.com');

      const adapter = RazorpayStandardAdapter.getInstance();
      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: 'webhook-dedupe.com',
        buyerEmail: 'client@webhook-dedupe.com',
        customerName: 'Webhook Lead'
      });

      const paymentId = 'pay_wh_dedupe_999';
      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: order.razorpayOrderId || order.orderId,
              amount: 49900,
              currency: 'INR',
              status: 'captured'
            }
          },
          order: {
            entity: {
              id: order.razorpayOrderId || order.orderId,
              receipt: order.orderId
            }
          }
        }
      };
      const rawBody = JSON.stringify(eventPayload);
      const sig = createHmac('sha256', testSecret).update(rawBody).digest('hex');
      const eventId = 'evt_test_dedupe_unique_id_1';

      // First webhook call
      const res1 = await app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': eventId
        },
        body: rawBody
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(json1.received).toBe(true);
      expect(json1.duplicate).toBeUndefined();

      // Verify event was recorded in durable_events
      const dedupeKey = `rzp_wh_evt_${createHash('sha256').update(eventId).digest('hex').slice(0, 40)}`;
      const recordedEvt = await d1Repo.queryOne<any>(
        'durable_events',
        `SELECT id, event_type FROM durable_events WHERE id = ?`,
        [dedupeKey]
      );
      expect(recordedEvt).toBeDefined();
      expect(recordedEvt.id).toBe(dedupeKey);
      expect(recordedEvt).toBeDefined();
      expect(recordedEvt.id).toBe(dedupeKey);

      // Second webhook call with identical eventId
      const res2 = await app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': sig,
          'x-razorpay-event-id': eventId
        },
        body: rawBody
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.received).toBe(true);
      expect(json2.duplicate).toBe(true);
    });
  });

  describe('Task 4: Flexible Paired Credential Resolution & Health Check (P0)', () => {
    it('4.1: resolveCredentials handles rzp_test_* in RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET', () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_main_key_123';
      process.env.RAZORPAY_KEY_SECRET = 'main_secret_abc456';
      delete process.env.RAZORPAY_TEST_KEY_ID;
      delete process.env.RAZORPAY_TEST_KEY_SECRET;
      delete process.env.RAZORPAY_MODE;

      const adapter = RazorpayStandardAdapter.getInstance();
      const creds = adapter.resolveCredentials();
      expect(creds.keyId).toBe('rzp_test_main_key_123');
      expect(creds.keySecret).toBe('main_secret_abc456');
      expect(creds.isLive).toBe(false);
      expect(creds.mode).toBe('TEST_SANDBOX');
    });

    it('4.2: resolveCredentials respects process.env.RAZORPAY_MODE = test even when live keys are present', () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_live_real_key_999';
      process.env.RAZORPAY_KEY_SECRET = 'real_secret_live_999';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_override_111';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'override_secret_111';
      process.env.RAZORPAY_MODE = 'test';

      const adapter = RazorpayStandardAdapter.getInstance();
      const creds = adapter.resolveCredentials();
      expect(creds.keyId).toBe('rzp_test_override_111');
      expect(creds.keySecret).toBe('override_secret_111');
      expect(creds.isLive).toBe(false);
      expect(creds.mode).toBe('TEST_SANDBOX');
    });

    it('4.3: GET /api/v1/payments/razorpay/health returns keyMode and providerAcceptedAuth', async () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_probe_key_123';
      process.env.RAZORPAY_KEY_SECRET = 'probe_secret_123';
      delete process.env.RAZORPAY_TEST_KEY_ID;
      delete process.env.RAZORPAY_TEST_KEY_SECRET;

      const res = await app.request('/api/v1/payments/razorpay/health');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.configured).toBe(true);
      expect(json.data.keyMode).toBe('TEST_SANDBOX');
      expect(typeof json.data.providerAcceptedAuth).toBe('boolean');
    });
  });
});
