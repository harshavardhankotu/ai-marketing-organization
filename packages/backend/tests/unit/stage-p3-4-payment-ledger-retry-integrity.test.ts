import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { AutonomousSystemDoctor } from '../../src/automation/autonomous-system-doctor.js';
import { createHmac, createHash } from 'node:crypto';

describe('Stage P.3.4 — First-Sale Recovery & Production Integrity: Transactions Schema SQL, Webhook Claims, Idempotency & Strict Credential Modes', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;
  const originalEnv = { ...process.env };

  function mockDomainAudit(domain: string) {
    const mockAudit = {
      auditId: `audit_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`,
      domain,
      url: `https://${domain}`,
      businessName: 'P34 Mock Business',
      scorecard: { totalScore: 84, items: [] },
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
    try { db.exec(`DELETE FROM outreach_suppression_list`); } catch {}

    d1Repo = D1RevenueRepository.getInstance();
    RazorpayStandardAdapter.resetInstance();
    BrevoMcpClient.resetInstanceForTesting();
    AutonomousSystemDoctor.resetInstanceForTesting();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // Scenario 1: Live-mode transactions insert succeeds against real schema without updated_at
  it('(1) Live-mode transactions insert succeeds against real schema without updated_at', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_live_test_live_key';
    process.env.RAZORPAY_KEY_SECRET = 'live_secret_p34_1';
    delete process.env.RAZORPAY_TEST_KEY_ID;
    delete process.env.RAZORPAY_TEST_KEY_SECRET;
    process.env.RAZORPAY_MODE = 'live';

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'live-tx-success.com';
    const email = 'buyer@live-tx-success.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email,
      customerName: 'Live Buyer'
    });

    const payId = `pay_live_${Date.now()}`;
    const sig = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${order.razorpayOrderId || order.orderId}|${payId}`)
      .digest('hex');

    const result = await adapter.verifyPaymentAndFulfill({
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId,
      razorpay_signature: sig
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('LIVE');

    const tx = await d1Repo.queryOne<any>(
      'transactions',
      `SELECT id, organization_id, business_id, amount_inr, status, classification FROM transactions WHERE id = ?`,
      [`tx_rzp_${payId}`]
    );
    expect(tx).toBeDefined();
    expect(tx.id).toBe(`tx_rzp_${payId}`);
    expect(tx.amount_inr).toBe(499);
    expect(tx.classification).toBe('REAL');
  });

  // Scenario 2: Duplicate payment ID across browser + webhook creates 1 transaction and 1 delivery_tasks row
  it('(2) Duplicate payment ID across browser + webhook creates 1 transaction and 1 delivery_tasks row', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_live_test_live_key';
    process.env.RAZORPAY_KEY_SECRET = 'live_secret_p34_2';
    delete process.env.RAZORPAY_TEST_KEY_ID;
    delete process.env.RAZORPAY_TEST_KEY_SECRET;
    process.env.RAZORPAY_MODE = 'live';

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'duplicate-dedupe.com';
    const email = 'buyer@duplicate-dedupe.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const payId = `pay_dedupe_${Date.now()}`;
    const sig = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${order.razorpayOrderId || order.orderId}|${payId}`)
      .digest('hex');

    // First call: browser verification
    const res1 = await adapter.verifyPaymentAndFulfill({
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId,
      razorpay_signature: sig
    });
    expect(res1.success).toBe(true);

    // Second call: webhook fulfillment with identical payment ID
    const res2 = await adapter.verifyPaymentAndFulfill({
      isWebhook: true,
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId
    });
    expect(res2.success).toBe(true);

    // Verify exactly 1 transaction
    const txRows = await d1Repo.query<any>(
      'transactions',
      `SELECT id FROM transactions WHERE id = ?`,
      [`tx_rzp_${payId}`]
    );
    expect(txRows.length).toBe(1);

    // Verify exactly 1 delivery_tasks row
    const expectedTaskId = `deliv_${order.orderId}_${payId}`;
    const delivRows = await d1Repo.query<any>(
      'delivery_tasks',
      `SELECT id FROM delivery_tasks WHERE id = ?`,
      [expectedTaskId]
    );
    expect(delivRows.length).toBe(1);
  });

  // Scenario 3: Failed webhook fulfillment leaves processed = 0 (RETRYABLE) and succeeds on retry
  it('(3) Failed webhook fulfillment leaves processed = 0 (RETRYABLE) and succeeds on retry', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p34_3';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p34_3';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p34_3';

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'retryable-webhook.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: 'retry@example.com'
    });

    const payId = `pay_retry_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: payId,
            order_id: order.orderId,
            amount: 49900,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const eventId = `evt_retry_${Date.now()}`;

    // First attempt: simulate transient failure in verifyPaymentAndFulfill
    const fulfillSpy = vi.spyOn(adapter, 'verifyPaymentAndFulfill').mockRejectedValueOnce(
      new Error('D1_TRANSACTION_PERSISTENCE_FAILED: Network timeout')
    );

    const res1 = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
        'content-type': 'application/json'
      },
      body: webhookPayload
    });

    expect(res1.status).toBe(503);
    const json1 = await res1.json();
    expect(json1.retryRequired).toBe(true);

    // Verify durable_events record: processed = 0 and error_message LIKE 'RETRYABLE:%'
    const eventHash = createHash('sha256').update(eventId).digest('hex');
    const dedupeKey = `rzp_wh_evt_${eventHash.slice(0, 40)}`;

    const evt1 = await d1Repo.queryOne<any>(
      'durable_events',
      `SELECT id, processed, error_message FROM durable_events WHERE id = ?`,
      [dedupeKey]
    );
    expect(evt1).toBeDefined();
    expect(evt1.processed).toBe(0);
    expect(evt1.error_message).toMatch(/^RETRYABLE:/);

    // Second attempt: retry delivery (fulfillSpy restore, succeeds)
    fulfillSpy.mockRestore();

    const res2 = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
        'content-type': 'application/json'
      },
      body: webhookPayload
    });

    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.success).toBe(true);

    // Verify durable_events record: processed = 1, error_message = null
    const evt2 = await d1Repo.queryOne<any>(
      'durable_events',
      `SELECT id, processed, error_message FROM durable_events WHERE id = ?`,
      [dedupeKey]
    );
    expect(evt2.processed).toBe(1);
    expect(evt2.error_message).toBeNull();
  });

  // Scenario 4: Concurrent duplicate webhooks cannot fulfill twice
  it('(4) Concurrent duplicate webhooks cannot fulfill twice', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p34_4';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p34_4';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p34_4';

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'concurrent-webhook.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: 'concurrent@example.com'
    });

    const payId = `pay_conc_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: payId,
            order_id: order.orderId,
            amount: 49900,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const eventId = `evt_conc_${Date.now()}`;

    // Send two concurrent webhook requests with identical event ID
    const [resA, resB] = await Promise.all([
      app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId,
          'content-type': 'application/json'
        },
        body: webhookPayload
      }),
      app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId,
          'content-type': 'application/json'
        },
        body: webhookPayload
      })
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const jsonA = await resA.json();
    const jsonB = await resB.json();

    // Exactly one handled full processing, the other returned duplicate
    const isOneDuplicate = jsonA.duplicate === true || jsonB.duplicate === true;
    expect(isOneDuplicate).toBe(true);

    // Verify delivery task was created only once
    const tasks = await d1Repo.query<any>(
      'delivery_tasks',
      `SELECT id FROM delivery_tasks WHERE id = ?`,
      [`deliv_${order.orderId}_${payId}`]
    );
    expect(tasks.length).toBe(1);
  });

  // Scenario 5: Stale PROCESSING lease is reclaimed cleanly
  it('(5) Stale PROCESSING lease is reclaimed cleanly', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p34_5';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p34_5';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p34_5';

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'stale-lease.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: 'stale@example.com'
    });

    const payId = `pay_stale_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: payId,
            order_id: order.orderId,
            amount: 49900,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const eventId = `evt_stale_${Date.now()}`;
    const eventHash = createHash('sha256').update(eventId).digest('hex');
    const dedupeKey = `rzp_wh_evt_${eventHash.slice(0, 40)}`;

    // Seed a stale PROCESSING event in durable_events created 120 seconds ago
    const staleTime = new Date(Date.now() - 120000).toISOString();
    await d1Repo.executeWrite(
      'durable_events',
      `INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
       VALUES (?, 'RAZORPAY_WEBHOOK_EVENT', 'org_owner_primary', '{}', 0, 'PROCESSING', ?)`,
      [dedupeKey, staleTime]
    );

    // Incoming retry should reclaim stale lease and succeed
    const res = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId,
        'content-type': 'application/json'
      },
      body: webhookPayload
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const evt = await d1Repo.queryOne<any>(
      'durable_events',
      `SELECT id, processed, error_message FROM durable_events WHERE id = ?`,
      [dedupeKey]
    );
    expect(evt.processed).toBe(1);
    expect(evt.error_message).toBeNull();
  });

  // Scenario 6: payment.failed does not fulfill
  it('(6) payment.failed does not fulfill', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p34_6';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p34_6';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p34_6';

    const adapter = RazorpayStandardAdapter.getInstance();
    const fulfillSpy = vi.spyOn(adapter, 'verifyPaymentAndFulfill');

    const webhookPayload = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_failed_123',
            order_id: 'ord_failed_123',
            amount: 49900,
            currency: 'INR',
            status: 'failed',
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment was declined by bank'
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const res = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'content-type': 'application/json'
      },
      body: webhookPayload
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.ignored).toBe(true);
    expect(fulfillSpy).not.toHaveBeenCalled();
  });

  // Scenario 7: Missing payment/order IDs return 400
  it('(7) Missing payment/order IDs return 400', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p34_7';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p34_7';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p34_7';

    const payloadMissingPaymentId = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            order_id: 'ord_missing_payid_123'
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(payloadMissingPaymentId)
      .digest('hex');

    const res = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'content-type': 'application/json'
      },
      body: payloadMissingPaymentId
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('MISSING_PROVIDER_PAYMENT_OR_ORDER_ID');
  });

  // Scenario 8: Brevo unconfigured/failed sets DELIVERABLE_READY_EMAIL_PENDING (never DELIVERED)
  it('(8) Brevo unconfigured/failed sets DELIVERABLE_READY_EMAIL_PENDING (never DELIVERED)', async () => {
    delete process.env.BREVO_MCP_SERVER_API;
    delete process.env.BREVO_API_KEY;

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'brevo-unconfigured.com';
    const email = 'pending-email@brevo-unconfigured.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const payId = `pay_brevo_unconf_${Date.now()}`;
    const sig = createHmac('sha256', adapter.getKeySecret())
      .update(`${order.razorpayOrderId || order.orderId}|${payId}`)
      .digest('hex');

    const result = await adapter.verifyPaymentAndFulfill({
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId,
      razorpay_signature: sig
    });

    expect(result.success).toBe(true);
    expect(result.fulfillmentStatus).toBe('DELIVERABLE_READY_EMAIL_PENDING');
    expect(result.fulfillmentStatus).not.toBe('DELIVERED');

    const dbOrder = await d1Repo.queryOne<any>(
      'universal_orders',
      `SELECT fulfillment_status FROM universal_orders WHERE id = ?`,
      [order.orderId]
    );
    expect(dbOrder.fulfillment_status).toBe('DELIVERABLE_READY_EMAIL_PENDING');
  });

  // Scenario 9: Brevo SENT sets EMAIL_ACCEPTED while delivered webhook sets EMAIL_DELIVERED
  it('(9) Brevo SENT sets EMAIL_ACCEPTED while delivered webhook sets EMAIL_DELIVERED', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-test-key-p34-9';
    const brevo = BrevoMcpClient.getInstance();

    // Mock sendTransactionalEmail returning SENT
    vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValueOnce({
      success: true,
      status: 'SENT',
      messageId: '<msg_p34_9@brevo.com>'
    });

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'brevo-lifecycle.com';
    const email = 'buyer@brevo-lifecycle.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const payId = `pay_brevo_life_${Date.now()}`;
    const sig = createHmac('sha256', adapter.getKeySecret())
      .update(`${order.razorpayOrderId || order.orderId}|${payId}`)
      .digest('hex');

    const result = await adapter.verifyPaymentAndFulfill({
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId,
      razorpay_signature: sig
    });

    expect(result.success).toBe(true);
    expect(result.fulfillmentStatus).toBe('EMAIL_ACCEPTED');

    // Simulate Brevo webhook event 'delivered'
    const whResult = await brevo.handleWebhookEvent({
      event: 'delivered',
      email,
      messageId: '<msg_p34_9@brevo.com>',
      ts: Date.now()
    });

    expect(whResult.processed).toBe(true);
    expect(whResult.status).toBe('EMAIL_DELIVERED');

    const updatedOrder = await d1Repo.queryOne<any>(
      'universal_orders',
      `SELECT fulfillment_status FROM universal_orders WHERE id = ?`,
      [order.orderId]
    );
    expect(updatedOrder.fulfillment_status).toBe('EMAIL_DELIVERED');
  });

  // Scenario 10: Signed download token works after clearing in-memory caches
  it('(10) Signed download token works after clearing in-memory caches', async () => {
    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'cache-cleared-token.com';
    const email = 'buyer@cache-cleared-token.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const payId = `pay_cache_${Date.now()}`;
    const sig = createHmac('sha256', adapter.getKeySecret())
      .update(`${order.razorpayOrderId || order.orderId}|${payId}`)
      .digest('hex');

    const result = await adapter.verifyPaymentAndFulfill({
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId,
      razorpay_signature: sig
    });

    expect(result.success).toBe(true);
    const token = result.downloadToken;
    expect(token).toBeDefined();

    // Clear in-memory caches completely
    SiteAuditService.resetInstance();
    const freshAuditService = SiteAuditService.getInstance();

    // Verify token against fresh instance (which re-verifies against D1)
    const verification = await freshAuditService.verifyDeliveryToken(token);
    expect(verification.valid).toBe(true);
    expect(verification.orderId).toBe(order.orderId);
  });

  // Scenario 11: Test-mode order uses canonical ₹499 SKU and writes 0 live revenue rows
  it('(11) Test-mode order uses canonical ₹499 SKU and writes 0 live revenue rows', async () => {
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_canon_499';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'test_secret_499';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_MODE = 'test';

    const adapter = RazorpayStandardAdapter.getInstance();
    const domain = 'canonical-test-mode.com';
    const email = 'testbuyer@canonical-test-mode.com';
    mockDomainAudit(domain);

    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    expect(order.amountPaise).toBe(49900);
    expect(order.amountINR).toBe(499);
    expect(order.sku).toBe('SITEFIX_AI_PACK_V1');

    const payId = `pay_test_${Date.now()}`;
    const sig = createHmac('sha256', adapter.getKeySecret())
      .update(`${order.razorpayOrderId || order.orderId}|${payId}`)
      .digest('hex');

    const fulfill = await adapter.verifyPaymentAndFulfill({
      orderId: order.orderId,
      razorpay_order_id: order.razorpayOrderId || order.orderId,
      razorpay_payment_id: payId,
      razorpay_signature: sig
    });

    expect(fulfill.success).toBe(true);
    expect(fulfill.mode).toBe('TEST_SANDBOX');

    // Exactly 0 live transactions recorded in transactions table
    const tx = await d1Repo.queryOne<any>(
      'transactions',
      `SELECT id FROM transactions WHERE id = ?`,
      [`tx_rzp_${payId}`]
    );
    expect(tx).toBeNull();
  });

  // Scenario 12: RAZORPAY_MODE=live never falls back to rzp_test_* keys
  it('(12) RAZORPAY_MODE=live never falls back to rzp_test_* keys', () => {
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_dedicated_only';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'test_secret_dedicated_only';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_MODE = 'live';

    const adapter = RazorpayStandardAdapter.getInstance();
    expect(() => adapter.resolveCredentials()).toThrow(/PAYMENT_PROVIDER_NOT_CONFIGURED/);

    // Also test invalid mode rejection
    process.env.RAZORPAY_MODE = 'unsupported_mode';
    expect(() => adapter.resolveCredentials()).toThrow(/INVALID_RAZORPAY_MODE/);
  });

  // Scenario 13: Bounded recovery processor retries pending orders and dispatches Brevo receipts
  it('(13) Bounded recovery processor retries pending orders and dispatches Brevo receipts', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-recovery-test';
    const brevo = BrevoMcpClient.getInstance();
    vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
      success: true,
      status: 'SENT',
      messageId: '<recovery@brevo.com>'
    });

    const domain = 'recovery-pass.com';
    const email = 'buyer@recovery-pass.com';
    mockDomainAudit(domain);

    // Insert an order stuck in DELIVERABLE_READY_EMAIL_PENDING
    const orderId = `ord_rec_${Date.now()}`;
    const meta = JSON.stringify({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email,
      paymentId: 'pay_p34_rec_123',
      deliverable_status: 'READY',
      email_receipt_status: 'PENDING_RETRY',
      downloadUrl: 'https://sitefix-domain.com/download',
      downloadToken: 'tok_123'
    });

    await d1Repo.executeWrite(
      'universal_orders',
      `INSERT INTO universal_orders (
        id, business_id, organization_id, offer_id, customer_name,
        customer_email, customer_phone, amount_minor, currency, status,
        payment_provider, provider_order_id, provider_payment_id, metadata_json, fulfillment_status, created_at, updated_at
      ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Rec Buyer', ?, '', 49900, 'INR', 'CAPTURED', 'RAZORPAY', ?, 'pay_p34_rec_123', ?, 'DELIVERABLE_READY_EMAIL_PENDING', datetime('now'), datetime('now'))`,
      [orderId, email, orderId, meta]
    );

    const doctor = AutonomousSystemDoctor.getInstance();
    const recoveryReport = await doctor.recoverPendingDeliveriesAndReceipts();
    expect(recoveryReport.processed).toBeGreaterThanOrEqual(1);
    expect(recoveryReport.recovered).toBeGreaterThanOrEqual(1);

    const updated = await d1Repo.queryOne<any>(
      'universal_orders',
      `SELECT fulfillment_status FROM universal_orders WHERE id = ?`,
      [orderId]
    );
    expect(updated.fulfillment_status).toBe('EMAIL_ACCEPTED');
  });
});
