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

describe('Stage P.3.5 — Atomic Webhook CAS, Paid-Event Allowlist, Real Recovery IDs, Idempotent Brevo Receipts, UPI Buyer-Email & Authenticated Readiness', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;
  const originalEnv = { ...process.env };

  function mockDomainAudit(domain: string) {
    const mockAudit = {
      auditId: `audit_${domain.replace(/[^a-zA-Z0-9]/g, '_')}`,
      domain,
      url: `https://${domain}`,
      businessName: 'P35 Mock Business',
      scorecard: { totalScore: 88, items: [] },
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
    try { db.exec(`DELETE FROM manual_upi_claims`); } catch {}
    try { db.exec(`DELETE FROM site_audits`); } catch {}

    d1Repo = D1RevenueRepository.getInstance();
    RazorpayStandardAdapter.resetInstance();
    BrevoMcpClient.resetInstanceForTesting();
    AutonomousSystemDoctor.resetInstanceForTesting();
    SiteAuditService.resetInstance();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // Scenario 1: Concurrent webhook retries race safely via atomic CAS rowsAffected === 1 and only one fulfills
  it('(1) Concurrent webhook retries race safely via atomic CAS rowsAffected === 1 and only one fulfills', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p35_cas';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p35_cas';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p35_cas';
    process.env.RAZORPAY_MODE = 'test';

    const domain = 'cas-race-test.com';
    const email = 'buyer@cas-race-test.com';
    mockDomainAudit(domain);

    const adapter = RazorpayStandardAdapter.getInstance();
    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const paymentId = `pay_cas_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: order.orderId,
            amount: 49900,
            currency: 'INR',
            status: 'captured',
            email: email,
            notes: { domainOrUrl: domain, sku: 'sitefix_core_499' }
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const eventId = `evt_race_${Date.now()}`;
    const eventHash = createHash('sha256').update(eventId).digest('hex');
    const dedupeKey = `rzp_wh_evt_${eventHash.slice(0, 40)}`;

    // Seed a retryable event
    await d1Repo.executeWrite(
      'durable_events',
      `INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
       VALUES (?, 'RAZORPAY_WEBHOOK_EVENT', 'org_owner_primary', '{}', 0, 'RETRYABLE:Network Timeout', datetime('now'))`,
      [dedupeKey]
    );

    // Run 2 simulated concurrent requests with identical eventId
    const [res1, res2] = await Promise.all([
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

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const json1 = await res1.json();
    const json2 = await res2.json();

    // Exactly one must fulfill and one must report duplicate / inProgress
    const fulfilledCount = (json1.eventDriven ? 1 : 0) + (json2.eventDriven ? 1 : 0);
    const duplicateCount = (json1.duplicate ? 1 : 0) + (json2.duplicate ? 1 : 0);

    expect(fulfilledCount).toBe(1);
    expect(duplicateCount).toBe(1);

    // Verify delivery tasks in database
    const db = getDb();
    const tasks = db.prepare(`SELECT COUNT(*) as count FROM delivery_tasks WHERE id = ?`).get(`deliv_${order.orderId}_${paymentId}`) as any;
    expect(tasks.count).toBe(1);
  });

  // Scenario 2: payment.authorized and payment.failed are ignored without calling fulfillment
  it('(2) payment.authorized and payment.failed are ignored without calling fulfillment', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p35_allowlist';

    // 2a. Test payment.authorized
    const authPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.authorized',
      payload: {
        payment: { entity: { id: 'pay_auth_123', order_id: 'ord_auth_123', amount: 49900 } }
      }
    });
    const authSig = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(authPayload).digest('hex');

    const authRes = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': authSig,
        'content-type': 'application/json'
      },
      body: authPayload
    });

    expect(authRes.status).toBe(200);
    const authJson = await authRes.json();
    expect(authJson.success).toBe(true);
    expect(authJson.received).toBe(true);
    expect(authJson.ignored).toBe(true);
    expect(authJson.eventType).toBe('payment.authorized');

    // 2b. Test payment.failed
    const failPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.failed',
      payload: {
        payment: { entity: { id: 'pay_fail_123', order_id: 'ord_fail_123', amount: 49900 } }
      }
    });
    const failSig = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(failPayload).digest('hex');

    const failRes = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': failSig,
        'content-type': 'application/json'
      },
      body: failPayload
    });

    expect(failRes.status).toBe(200);
    const failJson = await failRes.json();
    expect(failJson.success).toBe(true);
    expect(failJson.received).toBe(true);
    expect(failJson.ignored).toBe(true);
    expect(failJson.eventType).toBe('payment.failed');

    // Verify 0 delivery tasks created
    const db = getDb();
    const tasks = db.prepare(`SELECT COUNT(*) as count FROM delivery_tasks`).get() as any;
    expect(tasks.count).toBe(0);
  });

  // Scenario 3: D1 completion write failure returns 503 so gateway retries delivery
  it('(3) D1 completion write failure returns HTTP 503 so gateway retries delivery', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p35_fail503';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p35_fail503';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_p35_fail503';
    process.env.RAZORPAY_MODE = 'test';

    const domain = 'fail503-test.com';
    const email = 'buyer@fail503-test.com';
    mockDomainAudit(domain);

    const adapter = RazorpayStandardAdapter.getInstance();
    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const paymentId = `pay_fail503_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: order.orderId,
            amount: 49900,
            currency: 'INR',
            status: 'captured',
            email: email,
            notes: { domainOrUrl: domain, sku: 'sitefix_core_499' }
          }
        }
      }
    });

    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    // Spy on executeWrite: fail on completion write (when updating durable_events to processed = 1)
    const origExecuteWrite = d1Repo.executeWrite.bind(d1Repo);
    vi.spyOn(d1Repo, 'executeWrite').mockImplementation(async (table, sql, params) => {
      if (table === 'durable_events' && sql.includes('processed = 1')) {
        throw new Error('SIMULATED_D1_DISK_FULL');
      }
      return origExecuteWrite(table, sql, params);
    });

    const res = await app.request('/api/v1/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'x-razorpay-signature': signature,
        'content-type': 'application/json'
      },
      body: webhookPayload
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.retryRequired).toBe(true);
    expect(json.error).toContain('WEBHOOK_COMPLETION_PERSISTENCE_FAILED');
  });

  // Scenario 4: Recovery worker never generates 'pay_recovered' and preserves LIVE mode
  it('(4) Recovery worker never generates pay_recovered and preserves LIVE mode', async () => {
    const doctor = AutonomousSystemDoctor.getInstance();
    const domain = 'live-recovery-no-fake.com';
    const email = 'buyer@live-recovery-no-fake.com';
    mockDomainAudit(domain);

    // 4a. Order lacking provider_payment_id: must NOT generate pay_recovered, must log MISSING_PROVIDER_PAYMENT_ID
    const badOrderId = `ord_bad_${Date.now()}`;
    const badMeta = JSON.stringify({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email,
      deliverable_status: 'PENDING'
    });

    await d1Repo.executeWrite(
      'universal_orders',
      `INSERT INTO universal_orders (
        id, business_id, organization_id, offer_id, customer_name,
        customer_email, customer_phone, amount_minor, currency, status,
        payment_provider, provider_order_id, metadata_json, fulfillment_status, created_at, updated_at
      ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Bad Buyer', ?, '', 49900, 'INR', 'CAPTURED', 'RAZORPAY_LIVE', ?, ?, 'PAYMENT_CAPTURED_PENDING_DELIVERY', datetime('now'), datetime('now'))`,
      [badOrderId, email, badOrderId, badMeta]
    );

    const report1 = await doctor.recoverPendingDeliveriesAndReceipts();
    expect(report1.errors.some(e => e.includes('MISSING_PROVIDER_PAYMENT_ID'))).toBe(true);

    const db = getDb();
    const fakeTasks = db.prepare(`SELECT COUNT(*) as count FROM delivery_tasks WHERE id LIKE '%pay_recovered%'`).get() as any;
    expect(fakeTasks.count).toBe(0);

    // 4b. Valid live order with real payment ID: preserves LIVE classification
    const goodOrderId = `ord_good_${Date.now()}`;
    const realPaymentId = `pay_real_live_${Date.now()}`;
    const goodMeta = JSON.stringify({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email,
      mode: 'LIVE',
      isLive: true,
      paymentId: realPaymentId
    });

    await d1Repo.executeWrite(
      'universal_orders',
      `INSERT INTO universal_orders (
        id, business_id, organization_id, offer_id, customer_name,
        customer_email, customer_phone, amount_minor, currency, status,
        payment_provider, provider_order_id, provider_payment_id, metadata_json, fulfillment_status, is_test, created_at, updated_at
      ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Good Buyer', ?, '', 49900, 'INR', 'CAPTURED', 'RAZORPAY_LIVE', ?, ?, ?, 'PAYMENT_CAPTURED_PENDING_DELIVERY', 0, datetime('now'), datetime('now'))`,
      [goodOrderId, email, goodOrderId, realPaymentId, goodMeta]
    );

    const report2 = await doctor.recoverPendingDeliveriesAndReceipts();
    expect(report2.recovered).toBeGreaterThanOrEqual(1);

    // Check customer journey classification: should be REAL (not TEST)
    const journey = db.prepare(`SELECT classification FROM customer_journeys WHERE id = ?`).get(`cj_rzp_${goodOrderId}`) as any;
    expect(journey?.classification).toBe('REAL');
  });

  // Scenario 5: Browser + webhook concurrency sends at most one Brevo receipt (brevo_receipt_${paymentId})
  it('(5) Browser + webhook concurrency sends at most one Brevo receipt (brevo_receipt_${paymentId})', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_p35_receipt';
    process.env.RAZORPAY_KEY_SECRET = 'secret_p35_receipt';
    process.env.RAZORPAY_MODE = 'test';
    process.env.BREVO_API_KEY = 'xkeysib-receipt-dedupe-key';

    const brevo = BrevoMcpClient.getInstance();
    const sendMailSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
      success: true,
      status: 'SENT',
      messageId: '<prov_msg_real_12345@brevo.com>'
    });

    const domain = 'receipt-dedupe-test.com';
    const email = 'buyer@receipt-dedupe-test.com';
    mockDomainAudit(domain);

    const adapter = RazorpayStandardAdapter.getInstance();
    const order = await adapter.createStandardOrder({
      sku: 'sitefix_core_499',
      domainOrUrl: domain,
      buyerEmail: email
    });

    const paymentId = `pay_receipt_${Date.now()}`;
    const sig = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'secret_p35_receipt')
      .update(`${order.orderId}|${paymentId}`)
      .digest('hex');

    vi.spyOn(SiteAuditService.getInstance(), 'generateDeliverable').mockResolvedValue({} as any);

    // Simulate browser verification and webhook running concurrently for the same paymentId
    const [resBrowser, resWebhook] = await Promise.all([
      adapter.verifyPaymentAndFulfill({
        isWebhook: false,
        orderId: order.orderId,
        razorpay_order_id: order.orderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: sig
      }),
      adapter.verifyPaymentAndFulfill({
        isWebhook: true,
        orderId: order.orderId,
        razorpay_order_id: order.orderId,
        razorpay_payment_id: paymentId
      })
    ]);

    expect(resBrowser.success).toBe(true);
    expect(resWebhook.success).toBe(true);

    // Brevo sendTransactionalEmail should be called at most ONCE
    expect(sendMailSpy).toHaveBeenCalledTimes(1);

    // Check durable_events has processed = 1 and genuine messageId
    const receiptEvent = await d1Repo.queryOne<any>(
      'durable_events',
      `SELECT processed, payload_json FROM durable_events WHERE id = ?`,
      [`brevo_receipt_${paymentId}`]
    );
    expect(receiptEvent.processed).toBe(1);
    const parsedPayload = JSON.parse(receiptEvent.payload_json || '{}');
    expect(parsedPayload.messageId).toBe('<prov_msg_real_12345@brevo.com>');
  });

  // Scenario 6: /api/v1/offer/upi-claim requires buyerEmail (400 INVALID_EMAIL)
  it('(6) /api/v1/offer/upi-claim requires buyerEmail (400 INVALID_EMAIL)', async () => {
    const domain = 'upi-buyer-email-test.com';
    const audit = mockDomainAudit(domain);

    // Seed site_audits
    const db = getDb();
    db.prepare(`
      INSERT INTO site_audits (domain, target_url, business_name, status, created_at)
      VALUES (?, ?, 'UPI Test Biz', 'COMPLETED', datetime('now'))
    `).run(domain, `https://${domain}`);

    // Missing buyerEmail -> returns 400 INVALID_EMAIL
    const badRes = await app.request('/api/v1/offer/upi-claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        auditId: domain,
        payerName: 'Test Payer',
        utr: '123456789012',
        amountINR: 499
      })
    });

    expect(badRes.status).toBe(400);
    const badJson = await badRes.json();
    expect(badJson.error).toBe('INVALID_EMAIL');

    // Valid buyerEmail -> returns 201 PAYMENT_CLAIMED
    const goodRes = await app.request('/api/v1/offer/upi-claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        auditId: domain,
        payerName: 'Test Payer',
        payerPhone: '9999999999',
        buyerEmail: 'upi-buyer@example.com',
        utr: '123456789012',
        amountINR: 499
      })
    });

    expect(goodRes.status).toBe(201);
    const goodJson = await goodRes.json();
    expect(goodJson.success).toBe(true);
    expect(goodJson.status).toBe('PAYMENT_CLAIMED');
    expect(goodJson.bankConfirmedCashINR).toBe(0);

    // Verify universal_orders persisted with buyerEmail and PAYMENT_CLAIMED
    const orderRow = db.prepare(`SELECT status, customer_email FROM universal_orders WHERE provider_payment_id = ?`).get('123456789012') as any;
    expect(orderRow?.status).toBe('PAYMENT_CLAIMED');
    expect(orderRow?.customer_email).toBe('upi-buyer@example.com');
  });

  // Scenario 7: Owner-verified UPI confirmation triggers full SiteFix Fix-Pack + signed download token + receipt
  it('(7) Owner-verified UPI confirmation triggers full SiteFix Fix-Pack + signed download token + receipt', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-upi-owner-verify';
    const brevo = BrevoMcpClient.getInstance();
    const sendMailSpy = vi.spyOn(brevo, 'sendTransactionalEmail').mockResolvedValue({
      success: true,
      status: 'SENT',
      messageId: '<owner_upi_msg_123@brevo.com>'
    });

    const domain = 'upi-owner-confirm-delivery.com';
    const email = 'upi-delivery@example.com';
    mockDomainAudit(domain);
    vi.spyOn(SiteAuditService.getInstance(), 'generateDeliverable').mockResolvedValue({} as any);

    const db = getDb();
    db.prepare(`
      INSERT INTO site_audits (domain, target_url, business_name, status, created_at)
      VALUES (?, ?, 'UPI Owner Biz', 'COMPLETED', datetime('now'))
    `).run(domain, `https://${domain}`);

    // Claim UPI
    const utr = '987654321098';
    await app.request('/api/v1/offer/upi-claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        auditId: domain,
        payerName: 'Confirmed Payer',
        payerPhone: '8888888888',
        buyerEmail: email,
        utr,
        amountINR: 499
      })
    });

    // Owner confirms bank credit via /api/v1/owner/upi-verify
    const verifyRes = await app.request('/api/v1/owner/upi-verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-organization-id': 'org_owner_primary',
        'x-user-id': 'usr_owner_01'
      },
      body: JSON.stringify({
        utr,
        amountINR: 499,
        serviceRendered: 'SiteFix AI Core Technical Fix-Pack'
      })
    });

    expect(verifyRes.status).toBe(200);
    const verifyJson = await verifyRes.json();
    expect(verifyJson.success).toBe(true);
    expect(['FULFILLED', 'HUMAN_VERIFIED_PAYMENT']).toContain(verifyJson.status);
    expect(verifyJson.classification).toBe('MANUAL_VERIFIED');
    expect(verifyJson.downloadToken).toBeDefined();

    // Verify deterministic delivery_tasks
    const task = db.prepare(`SELECT stage, deliverables_json FROM delivery_tasks WHERE id LIKE ?`).get(`%${utr}%`) as any;
    expect(task?.stage).toBe('COMPLETED');
    expect(task?.deliverables_json).toContain(domain);

    // Verify Brevo receipt sent
    expect(sendMailSpy).toHaveBeenCalledTimes(1);

    // Verify download token works
    const tokenRes = await app.request(`/api/v1/offer/download/${verifyJson.downloadToken}`);
    expect(tokenRes.status).toBe(200);
  });

  // Scenario 8: getCheckoutReadiness() requires explicit SITE_AUDIT_TERMS_ATTESTED === 'true'
  it('(8) getCheckoutReadiness() requires explicit SITE_AUDIT_TERMS_ATTESTED === true', () => {
    const service = SiteAuditService.getInstance();

    // 8a. When unset
    delete process.env.SITE_AUDIT_TERMS_ATTESTED;
    const readinessUnset = service.getCheckoutReadiness();
    expect(readinessUnset.isReady).toBe(false);
    expect(readinessUnset.missingConfig).toContain('SITE_AUDIT_TERMS_ATTESTED');

    // 8b. When 'false'
    process.env.SITE_AUDIT_TERMS_ATTESTED = 'false';
    const readinessFalse = service.getCheckoutReadiness();
    expect(readinessFalse.isReady).toBe(false);
    expect(readinessFalse.missingConfig).toContain('SITE_AUDIT_TERMS_ATTESTED');

    // 8c. When 'true'
    process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_readiness_key';
    process.env.RAZORPAY_KEY_SECRET = 'readiness_secret_123';
    process.env.RAZORPAY_MODE = 'test';
    const readinessTrue = service.getCheckoutReadiness();
    expect(readinessTrue.missingConfig).not.toContain('SITE_AUDIT_TERMS_ATTESTED');
  });

  // Scenario 9: GET /payments/razorpay/health configured is false whenever key_id or secret is missing
  it('(9) GET /payments/razorpay/health configured is false whenever key_id or secret is missing', async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_TEST_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_TEST_KEY_SECRET;

    const res = await app.request('/api/v1/payments/razorpay/health');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.configured).toBe(false);
    expect(json.data.key_id_present).toBe(false);
    expect(json.data.secret_present).toBe(false);
  });
});
