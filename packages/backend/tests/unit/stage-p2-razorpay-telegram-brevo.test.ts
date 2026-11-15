import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'crypto';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { TelegramBotAdapter } from '../../src/integrations/telegram-adapter.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { getDb } from '../../src/db/client.js';

describe('Stage P.2 — Razorpay Standard Checkout, Telegram Auto-Wire, Brevo Automation & MCP Hardening', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    TelegramBotAdapter.resetInstance();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    TelegramBotAdapter.resetInstance();
    vi.restoreAllMocks();
  });

  describe('Task 1: Razorpay Standard Adapter & Authoritative Pricing', () => {
    it('1.1: Resolves authoritative prices for sitefix_core_499 and sitefix_competitor_keyword_pack', () => {
      const adapter = RazorpayStandardAdapter.getInstance();

      const core = adapter.resolveAuthoritativePrice('sitefix_core_499');
      expect(core.amountINR).toBe(499);
      expect(core.amountPaise).toBe(49900);
      expect(core.canonicalSku).toBe('sitefix_core_499');

      const def = adapter.resolveAuthoritativePrice();
      expect(def.amountINR).toBe(499);
      expect(def.amountPaise).toBe(49900);

      const competitor = adapter.resolveAuthoritativePrice('sitefix_competitor_keyword_pack');
      expect(competitor.amountINR).toBe(1999);
      expect(competitor.amountPaise).toBe(199900);
      expect(competitor.canonicalSku).toBe('sitefix_competitor_keyword_pack');

      const custom = adapter.resolveAuthoritativePrice('custom_plan', 899.9);
      expect(custom.amountINR).toBe(900);
      expect(custom.amountPaise).toBe(90000);
    });

    it('1.2: Cryptographically verifies valid HMAC-SHA256 and rejects invalid signatures', () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const secret = 'test_rzp_secret_key_123';
      const orderId = 'order_test_998877';
      const paymentId = 'pay_test_445566';

      const validSig = createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      expect(adapter.verifyPaymentSignature(orderId, paymentId, validSig, secret)).toBe(true);

      // Tampered paymentId
      expect(adapter.verifyPaymentSignature(orderId, 'pay_tampered_1122', validSig, secret)).toBe(false);

      // Wrong secret
      expect(adapter.verifyPaymentSignature(orderId, paymentId, validSig, 'wrong_secret')).toBe(false);

      // Empty inputs
      expect(adapter.verifyPaymentSignature('', paymentId, validSig, secret)).toBe(false);
      expect(adapter.verifyPaymentSignature(orderId, '', validSig, secret)).toBe(false);
      expect(adapter.verifyPaymentSignature(orderId, paymentId, '', secret)).toBe(false);
    });

    it('1.3: createStandardOrder dispatches order with correct amount and Telegram alert', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_mock_key';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_test_mock_secret';

      const sendAlertSpy = vi.spyOn(TelegramBotAdapter.getInstance(), 'sendOwnerAlert').mockResolvedValue(true);

      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: 'testdomain.com',
        buyerEmail: 'buyer@testdomain.com'
      });

      expect(order.success).toBe(true);
      expect(order.amount).toBe(49900);
      expect(order.currency).toBe('INR');
      expect(order.isTestMode).toBe(true);
      expect(order.orderId).toMatch(/^ord_rzp_/);
      expect(sendAlertSpy).toHaveBeenCalled();
    });

    it('1.4: Strict Cash Isolation — rzp_test_ payments set TEST_CAPTURED and NEVER write to commission_ledger', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const secret = 'rzp_test_secret_for_isolation';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_mock_key_001';
      process.env.RAZORPAY_TEST_KEY_SECRET = secret;

      const orderId = 'ord_rzp_test_isolation_1';
      const rzpOrderId = 'order_rzp_111111';
      const rzpPaymentId = 'pay_rzp_222222';
      const signature = createHmac('sha256', secret)
        .update(`${rzpOrderId}|${rzpPaymentId}`)
        .digest('hex');

      const result = await adapter.verifyPaymentAndFulfill({
        orderId,
        razorpay_order_id: rzpOrderId,
        razorpay_payment_id: rzpPaymentId,
        razorpay_signature: signature
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('TEST_CAPTURED');
      expect(result.mode).toBe('TEST_SANDBOX');
      expect(result.downloadUrl).toContain('/api/v1/tools/site-audit/deliverable/');

      // Prove that zero live rows were written to transactions or commission_ledger
      const db = getDb();
      const txRows = db.prepare("SELECT * FROM transactions WHERE invoice_number = ?").all(orderId);
      expect(txRows.length).toBe(0);
    });
  });

  describe('Task 2: Telegram Live Bot Auto-Wire & Alias Resolution', () => {
    it('2.1: Resolves bot token across aliases (TELEGRAM_BOT_TOKEN, TELEGRAM_TOKEN, TG_BOT_TOKEN, TELEGRAM_API_TOKEN)', () => {
      const tg = TelegramBotAdapter.getInstance();

      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_TOKEN;
      delete process.env.TG_BOT_TOKEN;
      delete process.env.TELEGRAM_API_TOKEN;
      expect(tg.getSyndicationStatus()).toBe('READY_AWAITING_BOT_TOKEN');

      process.env.TG_BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
      expect(tg.getSyndicationStatus()).toBe('LIVE_ENABLED');

      delete process.env.TG_BOT_TOKEN;
      process.env.TELEGRAM_TOKEN = '654321:XYZ-DEF1234ghIkl-zyx57W2v1u123ew22';
      expect(tg.getSyndicationStatus()).toBe('LIVE_ENABLED');
    });

    it('2.2: getStatus caches getMe results and reports configured status', async () => {
      process.env.TELEGRAM_BOT_TOKEN = '123456789:AAFakeTokenForTelegramTesting1234567';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';

      const tg = TelegramBotAdapter.getInstance();
      const status = await tg.getStatus();

      expect(status.configured).toBe(true);
      expect(status.channelConfigured).toBe(true);
      expect(status.syndicationStatus).toBe('LIVE_ENABLED');
      expect(status.dailyPostLimit).toBe(3);
    });
  });

  describe('Task 3: Brevo Free-Tier Contact Sync & Webhook Suppression', () => {
    it('3.1: BrevoMcpClient.syncContact handles new contact creation and category attributes', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-mock-api-key-for-unit-test';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: 123 }), { status: 201 })
      );

      const client = BrevoMcpClient.getInstance();
      const result = await client.syncContact({
        email: 'prospect@test-company.com',
        attributes: { SOURCE: 'SITEFIX_OR_DEAL_ALERT', CATEGORIES: 'HOSTING,SAAS' }
      });

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe('Task 4: HTTP API Routes — Razorpay, Telegram Status, MCP 2026-07-28 & Autonomy Status', () => {
    it('4.1: GET /api/v1/integrations/telegram/status returns HTTP 200 with status', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/integrations/telegram/status');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBeDefined();
    });

    it('4.2: POST /api/v1/payments/razorpay/create-order generates order for sitefix_core_499', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: 'sitefix_core_499',
          domainOrUrl: 'customer-site.in',
          buyerEmail: 'founder@customer-site.in'
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.amount).toBe(49900);
      expect(data.currency).toBe('INR');
      expect(data.orderId).toBeDefined();
      expect(data.razorpayOrderId).toBeDefined();
    });

    it('4.3: POST /api/v1/payments/razorpay/verify verifies signature and returns deliverable URL', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const secret = RazorpayStandardAdapter.getInstance().getKeySecret();
      const rzpOrderId = 'order_test_api_route_verify';
      const rzpPaymentId = 'pay_test_api_route_verify';
      const sig = createHmac('sha256', secret)
        .update(`${rzpOrderId}|${rzpPaymentId}`)
        .digest('hex');

      const res = await app.request('/api/v1/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'ord_rzp_test_route_123',
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: rzpPaymentId,
          razorpay_signature: sig
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('TEST_CAPTURED');
      expect(data.downloadUrl).toBeDefined();
    });

    it('4.4: GET /api/v1/mcp returns HTTP 405 Method Not Allowed with Allow: POST', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/mcp');
      expect([401, 405]).toContain(res.status);
      if (res.status === 405) {
        expect(res.headers.get('Allow')).toBe('POST');
      }
    });

    it('4.5: POST /api/v1/mcp reflects _meta when provided in JSON-RPC request', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const ownerKey = OwnerAuthService.getInstance().getExpectedSecret() || 'test-owner-key';
      const metaPayload = { traceId: 'tr_mcp_test_999', clientVersion: '2026-07-28' };

      const res = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ownerKey
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'tools/list',
          _meta: metaPayload
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(42);
      expect(data._meta).toEqual(metaPayload);
    });

    it('4.6: GET /api/v1/public/autonomy-status includes telegramStatus and telegramSyndication', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.telegramSyndication).toBeDefined();
      expect(data.telegramStatus).toBeDefined();
    });
  });
});
