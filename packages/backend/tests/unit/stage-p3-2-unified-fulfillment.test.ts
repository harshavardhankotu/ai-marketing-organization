import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { TelegramBotAdapter } from '../../src/integrations/telegram-adapter.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { createHmac, createHash } from 'node:crypto';

describe('Stage P.3.2 — Unified Razorpay Order/Capture/Delivery Pipeline, Real Buyer Domain & Email Fulfillment, Atomic Rollbacks', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;

  beforeEach(() => {
    const db = getDb();
    try { db.exec(`DELETE FROM durable_events`); } catch {}
    try { db.exec(`DELETE FROM direct_outreach_log`); } catch {}
    try { db.exec(`DELETE FROM platform_prospects`); } catch {}
    try { db.exec(`DELETE FROM outreach_suppression_list`); } catch {}
    try { db.exec(`DELETE FROM universal_orders`); } catch {}
    try { db.exec(`DELETE FROM payment_requests`); } catch {}
    try { db.exec(`DELETE FROM payment_orders`); } catch {}
    try { db.exec(`DELETE FROM delivery_tasks`); } catch {}
    try { db.exec(`DELETE FROM transactions`); } catch {}
    try { db.exec(`DELETE FROM telegram_posts_log`); } catch {}

    d1Repo = D1RevenueRepository.getInstance();
    RazorpayStandardAdapter.resetInstance();
    TelegramBotAdapter.resetInstance();
    BrevoMcpClient.resetInstanceForTesting();
    AutomationRegistryEngine.resetInstance();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  describe('Task 1: Real Buyer Domain & Email Fulfillment & D1 Ledger Closure (P0)', () => {
    it('1.1: createStandardOrder rejects requests missing valid domain or buyer email', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();

      // Missing domain
      await expect(adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        buyerEmail: 'buyer@example.com'
      })).rejects.toThrow(/INVALID_DOMAIN/);

      // Missing or invalid email
      await expect(adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: 'valid-target-site.com',
        buyerEmail: 'invalid-email-format'
      })).rejects.toThrow(/INVALID_EMAIL/);

      // HTTP endpoint validation
      const res1 = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'sitefix_core_499', buyerEmail: 'buyer@example.com' })
      });
      expect(res1.status).toBe(400);
      const json1 = await res1.json();
      expect(json1.error).toMatch(/INVALID_DOMAIN/);

      const res2 = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'sitefix_core_499', domainOrUrl: 'valid-site.com', buyerEmail: 'invalid' })
      });
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.error).toMatch(/INVALID_EMAIL/);
    });

    it('1.2: createStandardOrder stores normalized domain and buyerEmail in D1 universal_orders', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: 'https://my-company-domain.in/pricing',
        buyerEmail: 'FOUNDER@My-Company-Domain.IN',
        customerName: 'Founder Test'
      });

      expect(order.success).toBe(true);
      expect(order.orderId).toMatch(/^ord_rzp_/);
      expect(order.amount).toBe(49900);

      // Check D1 universal_orders
      const stored = await d1Repo.queryOne<any>(
        'universal_orders',
        `SELECT id, customer_email, metadata_json, amount_minor FROM universal_orders WHERE id = ?`,
        [order.orderId]
      );
      expect(stored).toBeDefined();
      expect(stored.customer_email).toBe('founder@my-company-domain.in');
      expect(stored.amount_minor).toBe(49900);

      const meta = JSON.parse(stored.metadata_json);
      expect(meta.domainOrUrl).toBe('my-company-domain.in');
      expect(meta.buyerEmail).toBe('founder@my-company-domain.in');
    });

    it('1.3: verifyPaymentAndFulfill fails closed with ORDER_NOT_FOUND_IN_D1 (HTTP 404) if order is absent from D1', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const fakeOrderId = 'ord_rzp_nonexistent_9999';
      const fakePayId = 'pay_fake_123456';
      const keySecret = adapter.getKeySecret();
      const sig = createHmac('sha256', keySecret).update(`${fakeOrderId}|${fakePayId}`).digest('hex');

      await expect(adapter.verifyPaymentAndFulfill({
        orderId: fakeOrderId,
        razorpay_order_id: fakeOrderId,
        razorpay_payment_id: fakePayId,
        razorpay_signature: sig
      })).rejects.toThrow(/ORDER_NOT_FOUND_IN_D1/);

      // HTTP endpoint mapping to 404
      const res = await app.request('/api/v1/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: fakeOrderId,
          razorpay_order_id: fakeOrderId,
          razorpay_payment_id: fakePayId,
          razorpay_signature: sig
        })
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toMatch(/ORDER_NOT_FOUND_IN_D1/);
    });

    it('1.4: verifyPaymentAndFulfill generates real Fix-Pack for stored domain, emails buyer, and marks DELIVERED', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const targetDomain = 'verified-client-portal.org';
      const buyerEmail = 'ops@verified-client-portal.org';

      const order = await adapter.createStandardOrder({
        sku: 'sitefix_core_499',
        domainOrUrl: targetDomain,
        buyerEmail: buyerEmail,
        customerName: 'Portal Lead'
      });

      const keySecret = adapter.getKeySecret();
      const fakePayId = `pay_test_${Date.now()}`;
      const sig = createHmac('sha256', keySecret).update(`${order.razorpayOrderId || order.orderId}|${fakePayId}`).digest('hex');

      const result = await adapter.verifyPaymentAndFulfill({
        orderId: order.orderId,
        razorpay_order_id: order.razorpayOrderId || order.orderId,
        razorpay_payment_id: fakePayId,
        razorpay_signature: sig
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('TEST_CAPTURED');
      expect(result.downloadUrl).toMatch(/\/api\/v1\/offer\/download\//);

      // Confirm universal_orders status is TEST_CAPTURED and fulfillment_status is DELIVERED
      const updatedOrder = await d1Repo.queryOne<any>(
        'universal_orders',
        `SELECT status, fulfillment_status, provider_payment_id FROM universal_orders WHERE id = ?`,
        [order.orderId]
      );
      expect(updatedOrder.status).toBe('TEST_CAPTURED');
      expect(updatedOrder.fulfillment_status).toBe('DELIVERED');
      expect(updatedOrder.provider_payment_id).toBe(fakePayId);

      // Confirm deliverable task created in delivery_tasks table
      const task = await d1Repo.queryOne<any>(
        'delivery_tasks',
        `SELECT * FROM delivery_tasks WHERE customer_journey_id = ? OR customer_journey_id = ?`,
        [order.orderId, `cj_rzp_${order.orderId}`]
      );
      expect(task).toBeDefined();
      expect(task.stage).toBe('COMPLETED');
      const delivMeta = JSON.parse(task.deliverables_json);
      expect(delivMeta.domain).toBe(targetDomain);
      expect(delivMeta.downloadToken).toBeDefined();
    });
  });

  describe('Task 2: Brevo Webhook Fail-Closed Suppression & Deduplication (P1)', () => {
    it('2.1: handleWebhookEvent fails closed (throws error / 503) if D1 suppression write fails', async () => {
      const brevo = BrevoMcpClient.getInstance();

      // Spy on d1Repo executeWrite to simulate D1 outage during suppression write
      const origExecuteWrite = d1Repo.executeWrite.bind(d1Repo);
      const spy = vi.spyOn(d1Repo, 'executeWrite').mockImplementation(async (table, sql, params) => {
        if (table === 'outreach_suppression_list') {
          throw new Error('D1_STORAGE_FAULT: database disk image is malformed');
        }
        return origExecuteWrite(table, sql, params);
      });

      try {
        await expect(brevo.handleWebhookEvent({
          event: 'hard_bounce',
          email: 'bounced-failure@test.com',
          reason: '550 User Unknown',
          messageId: 'msg_fail_001'
        })).rejects.toThrow(/D1_SUPPRESSION_WRITE_FAILED/);

        // HTTP endpoint mapping returns 503 so Brevo retries (using distinct messageId to avoid replay detection)
        process.env.BREVO_WEBHOOK_SECRET = 'whsec_test_secret_123';
        const res = await app.request('/api/v1/webhooks/brevo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-brevo-secret': 'whsec_test_secret_123'
          },
          body: JSON.stringify({
            event: 'hard_bounce',
            email: 'bounced-failure-http@test.com',
            reason: '550 User Unknown',
            messageId: 'msg_fail_http_002'
          })
        });
        expect(res.status).toBe(503);
      } finally {
        spy.mockRestore();
      }
    });

    it('2.2: Deduplication key does not collide for different events on the same email', async () => {
      const brevo = BrevoMcpClient.getInstance();
      const testEmail = 'lead-multi-event@example.com';

      // 1. Delivered event with timestamp 1000
      const res1 = await brevo.handleWebhookEvent({
        event: 'delivered',
        email: testEmail,
        messageId: 'msg_shared_123',
        ts: 1000
      });
      expect(res1.processed).toBe(true);
      expect(res1.duplicate).toBeFalsy();

      // 2. Unsubscribed event with timestamp 2000 on same email
      const res2 = await brevo.handleWebhookEvent({
        event: 'unsubscribed',
        email: testEmail,
        messageId: 'msg_shared_123',
        ts: 2000
      });
      expect(res2.processed).toBe(true);
      expect(res2.suppressed).toBe(true);
      expect(res2.duplicate).toBeFalsy();

      // 3. Exact replay of unsubscribed event (same email, event, messageId, ts) -> duplicate true
      const res3 = await brevo.handleWebhookEvent({
        event: 'unsubscribed',
        email: testEmail,
        messageId: 'msg_shared_123',
        ts: 2000
      });
      expect(res3.processed).toBe(true);
      expect(res3.duplicate).toBe(true);
    });
  });

  describe('Task 3: Atomic Slot Rollbacks for Outreach & Telegram Daily Quotas (P1)', () => {
    it('3.1: Outreach autopilot releases claimed slot key if domain 96h lock reservation fails', async () => {
      const db = getDb();
      const utcDate = new Date().toISOString().split('T')[0];
      const targetDomain = 'locked-out-company.com';
      const windowBucket = Math.floor(Date.now() / (96 * 3600 * 1000));
      const domainHash = createHash('sha256').update(targetDomain).digest('hex').slice(0, 32);
      const domainLockKey = `outreach_domain_${domainHash}_${windowBucket}`;

      // Pre-seed 96h domain lock to simulate another worker having locked this domain
      await d1Repo.executeWrite(
        'durable_events',
        `INSERT INTO durable_events (id, event_type, organization_id, payload_json, created_at)
         VALUES (?, 'OUTREACH_DOMAIN_RESERVED', 'org_owner_primary', '{}', datetime('now'))`,
        [domainLockKey]
      );

      // Seed approved first-party opt-in prospect
      db.prepare(`
        INSERT OR REPLACE INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_city, prospect_vertical, email, prospect_email, stage, status
        ) VALUES (
          'pros_lock_test', 'Locked Out Co', 'Locked Out Co', 'Bangalore', 'technology', 'admin@locked-out-company.com', 'admin@locked-out-company.com', 'DISCOVERED', 'NEW'
        )
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, evidence_references, created_at
        ) VALUES (
          'draft_lock_test', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Locked Out Co', 'EMAIL',
          'Audit notice', 0, 0, 'DRAFT_PENDING_APPROVAL', '{"consent_status":"OPTED_IN_FIRST_PARTY","consent_type":"INBOUND_AUDIT_REQUEST"}', datetime('now')
        )
      `).run();

      const engine = AutomationRegistryEngine.getInstance();
      const res = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
      expect(res.itemsSucceeded).toBe(0);

      // Verify that slot 1 (outreach_slot_${utcDate}_1) was NOT leaked and was cleaned up
      const slotRow = await d1Repo.queryOne<any>(
        'durable_events',
        `SELECT id FROM durable_events WHERE id = ?`,
        [`outreach_slot_${utcDate}_1`]
      );
      expect(slotRow).toBeNull();
    });

    it('3.2: Telegram adapter rolls back atomic slot and claim if Telegram API returns 4xx rejection', async () => {
      const adapter = TelegramBotAdapter.getInstance();
      process.env.TELEGRAM_BOT_TOKEN = 'mock_tg_token_12345';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';
      const utcDate = new Date().toISOString().split('T')[0];

      // Custom fetch simulating Telegram 400 Bad Request (e.g. Chat not found)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}'
      } as any);

      const postRes = await adapter.postPublishedGuide({
        guideTitle: 'Special Deal',
        guideUrl: 'https://ai-marketing-organization.onrender.com/deals/deal-1',
        dealId: 'deal_rejection_test_1',
        fetchFn: mockFetch
      });

      expect(postRes.posted).toBe(false);
      expect(postRes.reason).toMatch(/TELEGRAM_API_ERROR: HTTP 400/);

      // Verify slot 1 was cleanly rolled back
      const slotRow = await d1Repo.queryOne<any>(
        'durable_events',
        `SELECT id FROM durable_events WHERE id = ?`,
        [`tg_daily_slot_${utcDate}_1`]
      );
      expect(slotRow).toBeNull();
    });
  });

  describe('Task 4: Universal Offer Download Route & Security (P0)', () => {
    it('4.1: Serves deliverable JSON/HTML when provided valid signed download token', async () => {
      const auditService = SiteAuditService.getInstance();
      const testDomain = 'download-test-service.com';
      const auditId = `audit_test_${Date.now()}`;
      const audit = {
        auditId,
        url: `https://${testDomain}`,
        domain: testDomain,
        scannedAt: new Date().toISOString(),
        overallStatus: 'ACTION_REQUIRED' as const,
        score: 65,
        scoreExplanation: 'Test audit',
        findings: [],
        metrics: {
          brokenLinksCount: 0,
          redirectChainsCount: 0,
          missingMetaDescription: true,
          missingTitle: false,
          missingCanonical: true,
          missingOpenGraph: true,
          missingTwitterCards: true,
          schemaTypesFound: [],
          insecureHttpLinksCount: 0,
          isMobileResponsive: true
        },
        preview: { sampleFindings: [], maskedIssuesCount: 0, freeTierMessage: '' },
        disclosures: { dataCollectedExplanation: '', botDisclosure: '', statutoryNotice: '' }
      };
      await auditService.persistAuditToD1(audit);

      // Seed captured order
      const orderId = 'ord_rzp_download_test_01';
      const paymentId = 'pay_download_test_01';
      await d1Repo.executeWrite(
        'universal_orders',
        `INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name,
          customer_email, customer_phone, amount_minor, currency, status,
          payment_provider, provider_order_id, provider_payment_id, metadata_json, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Customer', 'cust@test.com', '', 49900, 'INR', 'TEST_CAPTURED', 'RAZORPAY', ?, ?, '{}', datetime('now'), datetime('now'))`,
        [orderId, orderId, paymentId]
      );

      const downloadToken = auditService.generateSignedDeliveryToken(orderId, audit.auditId, paymentId, 72);

      const res = await app.request(`/api/v1/offer/download/${encodeURIComponent(downloadToken)}?format=json`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.deliverable).toBeDefined();
    });

    it('4.2: Rejects forged, expired, or invalid download tokens with HTTP 403', async () => {
      const forgedToken = 'fake_order.fake_audit.fake_pay.9999999999.bad_signature';
      const res = await app.request(`/api/v1/offer/download/${encodeURIComponent(forgedToken)}`);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toMatch(/DELIVERY_UNAUTHORIZED/);
    });
  });
});
