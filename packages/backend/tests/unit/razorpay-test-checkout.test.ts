import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { apiRouter } from '../../src/routes/api.js';
import { RazorpayTestService } from '../../src/integrations/razorpay-test-service.js';
import { getDb } from '../../src/db/client.js';

describe('V6.2.2 Razorpay Test Checkout & Verification Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.RAZORPAY_MODE = 'TEST';
    process.env.RAZORPAY_TEST_CHECKOUT_ENABLED = 'true';
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_mockValidKey123';
    process.env.RAZORPAY_TEST_KEY_SECRET = 'mockValidSecret456789';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. GET /api/v1/integrations/razorpay/test-readiness reports ready when properly configured', async () => {
    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-readiness');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ready).toBe(true);
    expect(data.mode).toBe('TEST');
    expect(data.testCheckoutEnabled).toBe(true);
    expect(data.hasValidTestKeyId).toBe(true);
    expect(data.hasValidTestKeySecret).toBe(true);
    expect(data.redactedKeyId).toContain('rzp_test_');
    expect(data.missingConfig.length).toBe(0);
  });

  it('2. Missing credentials keeps test checkout disabled (503)', async () => {
    delete process.env.RAZORPAY_TEST_KEY_ID;
    delete process.env.RAZORPAY_TEST_KEY_SECRET;

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('RAZORPAY_TEST_CREDENTIALS_MISSING');
    expect(data.missingConfig).toContain('RAZORPAY_TEST_KEY_ID');
    expect(data.missingConfig).toContain('RAZORPAY_TEST_KEY_SECRET');
  });

  it('3. Rejects live key in test mode or invalid prefix', async () => {
    process.env.RAZORPAY_TEST_KEY_ID = 'rzp_live_forbidden123456';
    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('RAZORPAY_TEST_KEY_ID_INVALID');
  });

  it('4. Rejects test checkout if RAZORPAY_MODE is not TEST', async () => {
    process.env.RAZORPAY_MODE = 'LIVE';
    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('RAZORPAY_MODE_NOT_TEST');
  });

  it('5. Matching Test key pair creates an actual provider order with 100 paise INR', async () => {
    const mockOrderId = 'order_test_provider_' + Date.now();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      if (String(url).includes('api.razorpay.com/v1/orders')) {
        const auth = init?.headers?.Authorization;
        expect(auth).toBe('Basic ' + Buffer.from('rzp_test_mockValidKey123:mockValidSecret456789').toString('base64'));
        const body = JSON.parse(init.body);
        expect(body.amount).toBe(100);
        expect(body.currency).toBe('INR');
        return new Response(JSON.stringify({
          id: mockOrderId,
          amount: 100,
          currency: 'INR',
          status: 'created'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.createdViaRazorpayApi).toBe(true);
    expect(data.order_id).toBe(mockOrderId);
    expect(data.amount).toBe(100);
    expect(data.currency).toBe('INR');
    expect(data.key_id).toBe('rzp_test_mockValidKey123');
    expect(data.mode).toBe('TEST');
  });

  it('6. Wrong Test Key Secret causes a clear 502 authentication failure (RAZORPAY_TEST_AUTH_FAILED)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('api.razorpay.com/v1/orders')) {
        return new Response(JSON.stringify({
          error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' }
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('RAZORPAY_TEST_AUTH_FAILED');
    expect(data.message).toContain('RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET');
    expect(data.diagnostics?.redactedKeyId).toContain('rzp_test_');
    expect(data.order_id).toBeUndefined();
  });

  it('7. Razorpay API failure never returns success', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('api.razorpay.com/v1/orders')) {
        return new Response('Gateway timeout', { status: 504 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('RAZORPAY_ORDER_CREATION_FAILED');
  });

  it('8. Test verification requires order_id, payment_id, and signature (400)', async () => {
    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ razorpay_payment_id: 'pay_test_only_123' })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('MISSING_TEST_VERIFICATION_FIELDS');
  });

  it('9. Rejects unrecorded or fabricated order IDs (404)', async () => {
    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: 'order_nonexistent_9999',
        razorpay_payment_id: 'pay_test_123',
        razorpay_signature: 'fake_signature'
      })
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('TEST_ORDER_NOT_FOUND');
  });

  it('10. Invalid HMAC signature is strictly rejected (400)', async () => {
    // Seed real order in DB
    const realOrderId = 'order_test_sig_check_01';
    getDb().prepare(`
      INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
      VALUES ('po_test_sig_01', 'biz_platform_aro', ?, 1.0, 'INR', 'TEST_ORDER_CREATED', 'rcpt_sig_1', '{}', datetime('now'), datetime('now'))
    `).run(realOrderId);

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: realOrderId,
        razorpay_payment_id: 'pay_test_sig_123',
        razorpay_signature: 'invalid_tampered_hmac_signature_hex_0000000000000000000000000000'
      })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('INVALID_PAYMENT_SIGNATURE');
  });

  it('11. Authorized-only payment reports PAYMENT_AUTHORIZED_PENDING_CAPTURE', async () => {
    const realOrderId = 'order_test_auth_only_01';
    const paymentId = 'pay_test_auth_only_99';
    getDb().prepare(`
      INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
      VALUES ('po_test_auth_01', 'biz_platform_aro', ?, 1.0, 'INR', 'TEST_ORDER_CREATED', 'rcpt_auth_1', '{}', datetime('now'), datetime('now'))
    `).run(realOrderId);

    const validSig = crypto.createHmac('sha256', 'mockValidSecret456789')
      .update(`${realOrderId}|${paymentId}`)
      .digest('hex');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('api.razorpay.com/v1/payments/')) {
        return new Response(JSON.stringify({
          id: paymentId,
          order_id: realOrderId,
          amount: 100,
          currency: 'INR',
          status: 'authorized'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: realOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSig
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.status).toBe('PAYMENT_AUTHORIZED_PENDING_CAPTURE');
  });

  it('12. Captured payment produces TEST_PAYMENT_CAPTURED and excludes from revenue metrics', async () => {
    const realOrderId = 'order_test_capture_success_01';
    const paymentId = 'pay_test_capture_success_99';
    getDb().prepare(`
      INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
      VALUES ('po_test_cap_01', 'biz_platform_aro', ?, 1.0, 'INR', 'TEST_ORDER_CREATED', 'rcpt_cap_1', '{}', datetime('now'), datetime('now'))
    `).run(realOrderId);

    const validSig = crypto.createHmac('sha256', 'mockValidSecret456789')
      .update(`${realOrderId}|${paymentId}`)
      .digest('hex');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('api.razorpay.com/v1/payments/')) {
        return new Response(JSON.stringify({
          id: paymentId,
          order_id: realOrderId,
          amount: 100,
          currency: 'INR',
          status: 'captured'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: realOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSig
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('TEST_PAYMENT_CAPTURED');
    expect(data.message).toBe('Razorpay Test Mode transaction successfully captured and verified.');
    expect(data.classification).toBe('TEST');
    expect(data.mode).toBe('TEST');

    // Confirm that transactions table has NO real revenue entry
    const tx = getDb().prepare("SELECT * FROM transactions WHERE transaction_ref = ?").get(paymentId);
    expect(tx).toBeUndefined();

    // Confirm order updated in payment_orders
    const updated = getDb().prepare("SELECT status, payment_id FROM payment_orders WHERE order_id = ?").get(realOrderId) as any;
    expect(updated.status).toBe('TEST_PAYMENT_CAPTURED');
    expect(updated.payment_id).toBe(paymentId);
  });

  it('13. Rejects payment with mismatched amount', async () => {
    const realOrderId = 'order_test_wrong_amt_01';
    const paymentId = 'pay_test_wrong_amt_99';
    getDb().prepare(`
      INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
      VALUES ('po_test_amt_01', 'biz_platform_aro', ?, 1.0, 'INR', 'TEST_ORDER_CREATED', 'rcpt_amt_1', '{}', datetime('now'), datetime('now'))
    `).run(realOrderId);

    const validSig = crypto.createHmac('sha256', 'mockValidSecret456789')
      .update(`${realOrderId}|${paymentId}`)
      .digest('hex');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('api.razorpay.com/v1/payments/')) {
        return new Response(JSON.stringify({
          id: paymentId,
          order_id: realOrderId,
          amount: 50000, // ₹500 instead of ₹1
          currency: 'INR',
          status: 'captured'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: realOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSig
      })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('PAYMENT_AMOUNT_MISMATCH');
  });

  it('14. Payment belonging to a different order is rejected', async () => {
    const realOrderId = 'order_test_diff_order_01';
    const paymentId = 'pay_test_diff_order_99';
    getDb().prepare(`
      INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
      VALUES ('po_test_diff_01', 'biz_platform_aro', ?, 1.0, 'INR', 'TEST_ORDER_CREATED', 'rcpt_diff_1', '{}', datetime('now'), datetime('now'))
    `).run(realOrderId);

    const validSig = crypto.createHmac('sha256', 'mockValidSecret456789')
      .update(`${realOrderId}|${paymentId}`)
      .digest('hex');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('api.razorpay.com/v1/payments/')) {
        return new Response(JSON.stringify({
          id: paymentId,
          order_id: 'order_some_other_order_777',
          amount: 100,
          currency: 'INR',
          status: 'captured'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not Found', { status: 404 });
    });

    const res = await apiRouter.request('/api/v1/integrations/razorpay/test-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: realOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: validSig
      })
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('PAYMENT_ORDER_MISMATCH');
  });

  it('15. Generic /create-order and /verify-payment routes are purged and not in public policy', async () => {
    // Attempting to call old generic routes should return 404 or 401
    const res1 = await apiRouter.request('/api/v1/create-order', { method: 'POST' });
    expect([401, 404]).toContain(res1.status);

    const res2 = await apiRouter.request('/api/v1/verify-payment', { method: 'POST' });
    expect([401, 404]).toContain(res2.status);
  });
});
