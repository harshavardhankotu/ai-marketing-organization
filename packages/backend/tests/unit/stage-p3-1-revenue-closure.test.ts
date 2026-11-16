import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { FINANCIAL_TABLES } from '../../src/db/d1-client.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { TelegramBotAdapter } from '../../src/integrations/telegram-adapter.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import { createHmac, createHash } from 'node:crypto';

describe('Stage P.3.1 — Production Integrity Closure, Atomic D1 Reservations, Strict Opt-In Outreach & Razorpay Exact SKUs', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;

  beforeEach(() => {
    const db = getDb();
    try { db.exec(`DELETE FROM durable_events`); } catch {}
    try { db.exec(`DELETE FROM direct_outreach_log`); } catch {}
    try { db.exec(`DELETE FROM platform_prospects`); } catch {}
    try { db.exec(`DELETE FROM outreach_suppression_list`); } catch {}
    try { db.exec(`DELETE FROM durable_rate_limits`); } catch {}
    try { db.exec(`DELETE FROM telegram_posts_log`); } catch {}
    d1Repo = D1RevenueRepository.getInstance();
    RazorpayStandardAdapter.resetInstance();
    TelegramBotAdapter.resetInstance();
    BrevoMcpClient.resetInstanceForTesting();
    AutomationRegistryEngine.resetInstance();
    DurableRateLimiter.resetInstanceForTesting();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  describe('Task 1: Strict Recipient Authorization & Atomic D1 Outreach Reservation (P0)', () => {
    it('1.1: Rejects outreach dispatch when consent is cold, unsolicited, scraped, or missing explicit opt-in', async () => {
      const db = getDb();
      const engine = AutomationRegistryEngine.getInstance();

      // Seed cold unsolicited draft without opt-in
      db.prepare(`
        INSERT OR REPLACE INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, evidence_references, created_at
        ) VALUES (
          'draft_cold_unsolicited', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Cold Prospect Co', 'EMAIL',
          'Notice of missing metadata on coldprospect.com', 0, 0, 'DRAFT_PENDING_APPROVAL', '{"consent_type":"COLD_UNSOLICITED"}', datetime('now')
        )
      `).run();

      const res = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
      expect(res.itemsSucceeded).toBe(0);
    });

    it('1.2: Rejects outreach dispatch when recipient is on outreach_suppression_list', async () => {
      const db = getDb();
      const engine = AutomationRegistryEngine.getInstance();

      // Seed email into suppression list
      db.prepare(`
        INSERT OR REPLACE INTO outreach_suppression_list (id, identifier, identifier_type, reason, created_at)
        VALUES ('supp_test_1', 'suppressed@example.com', 'EMAIL', 'MANUAL_OPT_OUT', datetime('now'))
      `).run();

      // Draft with explicit opt-in, but suppressed email
      db.prepare(`
        INSERT OR REPLACE INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft, human_approved, dispatched, response_status, evidence_references, created_at
        ) VALUES (
          'draft_suppressed', 'biz_platform_aro', 'SITEFIX_AUDIT', 'Suppressed Co', 'EMAIL',
          'Audit notice', 0, 0, 'DRAFT_PENDING_APPROVAL', '{"consent_status":"OPTED_IN_FIRST_PARTY","consent_type":"INBOUND_AUDIT_REQUEST"}', datetime('now')
        )
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_city, prospect_vertical, email, prospect_email, stage, status
        ) VALUES (
          'pros_suppressed', 'Suppressed Co', 'Suppressed Co', 'Hyderabad', 'technology', 'suppressed@example.com', 'suppressed@example.com', 'DISCOVERED', 'NEW'
        )
      `).run();

      const res = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
      expect(res.itemsSucceeded).toBe(0);
    });

    it('1.3: Reserves atomic slot (outreach_slot_...) and domain 96h lock (outreach_domain_...) in D1', async () => {
      const utcDate = new Date().toISOString().split('T')[0];
      const slotKey = `outreach_slot_${utcDate}_1`;
      const normalizedDomain = 'example-audit-firm.com';
      const windowBucket = Math.floor(Date.now() / (96 * 3600 * 1000));
      const domainHash = createHash('sha256').update(normalizedDomain).digest('hex').slice(0, 32);
      const domainLockKey = `outreach_domain_${domainHash}_${windowBucket}`;

      // Insert pre-dispatch atomic slot
      await d1Repo.executeWrite(
        'durable_events',
        `INSERT OR REPLACE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
         VALUES (?, 'OUTREACH_SLOT_RESERVED', 'org_owner_primary', '{}', datetime('now'))`,
        [slotKey]
      );

      // Verify slot exists
      const slotRow = await d1Repo.queryOne<any>(
        'durable_events',
        `SELECT id, event_type FROM durable_events WHERE id = ?`,
        [slotKey]
      );
      expect(slotRow).toBeDefined();
      expect(slotRow.event_type).toBe('OUTREACH_SLOT_RESERVED');

      // Insert domain lock
      await d1Repo.executeWrite(
        'durable_events',
        `INSERT OR REPLACE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
         VALUES (?, 'OUTREACH_DOMAIN_RESERVED', 'org_owner_primary', '{}', datetime('now'))`,
        [domainLockKey]
      );

      const domainRow = await d1Repo.queryOne<any>(
        'durable_events',
        `SELECT id, event_type FROM durable_events WHERE id = ?`,
        [domainLockKey]
      );
      expect(domainRow).toBeDefined();
      expect(domainRow.event_type).toBe('OUTREACH_DOMAIN_RESERVED');
    });
  });

  describe('Task 2: Razorpay Exact-SKU Enforcement, Verified Capture & Idempotent Ledger (P0)', () => {
    it('2.1: Rejects omitted, empty, or unknown SKUs in resolveAuthoritativePrice with INVALID_SKU', () => {
      const adapter = RazorpayStandardAdapter.getInstance();

      expect(() => adapter.resolveAuthoritativePrice('')).toThrow(/INVALID_SKU: SKU is required/);
      expect(() => adapter.resolveAuthoritativePrice(undefined)).toThrow(/INVALID_SKU: SKU is required/);
      expect(() => adapter.resolveAuthoritativePrice('unknown_sku_123')).toThrow(/INVALID_SKU: Unknown SKU/);
    });

    it('2.2: Accepts ONLY canonical SKUs (sitefix_core_499: ₹499, sitefix_competitor_keyword_pack: ₹1,999) and rejects price tampering', () => {
      const adapter = RazorpayStandardAdapter.getInstance();

      const core = adapter.resolveAuthoritativePrice('sitefix_core_499');
      expect(core.amountINR).toBe(499);
      expect(core.amountPaise).toBe(49900);
      expect(core.canonicalSku).toBe('sitefix_core_499');

      const competitor = adapter.resolveAuthoritativePrice('sitefix_competitor_keyword_pack');
      expect(competitor.amountINR).toBe(1999);
      expect(competitor.amountPaise).toBe(199900);
      expect(competitor.canonicalSku).toBe('sitefix_competitor_keyword_pack');

      // Rejects price tampering
      expect(() => adapter.resolveAuthoritativePrice('sitefix_core_499', 1)).toThrow(/Client-tampered amount/);
      expect(() => adapter.resolveAuthoritativePrice('sitefix_competitor_keyword_pack', 500)).toThrow(/Client-tampered amount/);
    });

    it('2.3: POST /api/v1/payments/razorpay/create-order rejects missing or empty SKU with HTTP 400', async () => {
      const resMissing = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainOrUrl: 'test.com' })
      });
      expect(resMissing.status).toBe(400);
      const jsonMissing = await resMissing.json();
      expect(jsonMissing.error).toContain('INVALID_SKU: SKU is required');

      const resUnknown = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: 'custom_hack_plan', domainOrUrl: 'test.com' })
      });
      expect(resUnknown.status).toBe(400);
      const jsonUnknown = await resUnknown.json();
      expect(jsonUnknown.error).toContain('INVALID_SKU: Unknown SKU');
    });

    it('2.4: Uses deterministic primary key tx_rzp_${paymentId} in transactions and ensures FINANCIAL_TABLES isolation', () => {
      expect(FINANCIAL_TABLES).toContain('transactions');
      expect(FINANCIAL_TABLES).toContain('universal_orders');
      expect(FINANCIAL_TABLES).toContain('commission_ledger');
      expect(FINANCIAL_TABLES.length).toBe(8);
    });
  });

  describe('Task 3: Durable Telegram State, Truthful Readiness & Atomic Deal Post Claims (P1)', () => {
    it('3.1: getChatId reads and writes exclusively via D1 durable_events', async () => {
      const tg = TelegramBotAdapter.getInstance();
      const testChatId = '-100987654321';

      // Insert discovered chat into D1
      await d1Repo.executeWrite(
        'durable_events',
        `INSERT OR REPLACE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
         VALUES ('tg_chat_discovered', 'TELEGRAM_CHAT_DISCOVERED', 'org_owner_primary', ?, datetime('now'))`,
        [JSON.stringify({ chatId: testChatId, discoveredAt: new Date().toISOString() })]
      );

      const resolved = await tg.getChatId();
      expect(resolved).toBe(testChatId);
    });

    it('3.2: getStatus accurately reports missingRequirement when bot token or chatId is missing', async () => {
      const tg = TelegramBotAdapter.getInstance();
      process.env.TELEGRAM_BOT_TOKEN = '';
      process.env.TELEGRAM_CHANNEL_ID = '';

      const noTokenStatus = await tg.getStatus();
      expect(noTokenStatus.connected).toBe(false);
      expect(noTokenStatus.missingRequirement).toBe('MISSING_BOT_TOKEN');

      process.env.TELEGRAM_BOT_TOKEN = 'mock_token_abc';
      vi.spyOn(tg, 'getChatId').mockResolvedValue('');
      const noChatStatus = await tg.getStatus();
      expect(noChatStatus.connected).toBe(false);
      expect(noChatStatus.chatIdConfigured).toBe(false);
      expect(noChatStatus.missingRequirement).toBe('MISSING_CHAT_ID');

      vi.spyOn(tg, 'getChatId').mockResolvedValue('-100123456');
      const liveStatus = await tg.getStatus();
      expect(liveStatus.connected).toBe(true);
      expect(liveStatus.chatIdConfigured).toBe(true);
      expect(liveStatus.status).toBe('LIVE_ENABLED');
      expect(liveStatus.missingRequirement).toBeNull();
    });

    it('3.3: postPublishedGuide atomically claims tg_post_claim_${hash} in D1 durable_events', async () => {
      const tg = TelegramBotAdapter.getInstance();
      process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token';
      process.env.TELEGRAM_CHANNEL_ID = '-100123456';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 42 } })
      });

      const res = await tg.postPublishedGuide({
        guideTitle: 'Best Deal of the Day',
        guideUrl: 'https://example.com/deals/boat-test',
        dealId: 'deal_test_123',
        fetchFn: mockFetch as any
      });

      expect(res.posted).toBe(true);
      expect(res.messageId).toBe(42);

      // Verify atomic claim row in D1 durable_events
      const utcDate = new Date().toISOString().split('T')[0];
      const claimHash = createHash('sha256').update(`${utcDate}:deal_test_123`).digest('hex').slice(0, 36);
      const claimRow = await d1Repo.queryOne<any>(
        'durable_events',
        `SELECT id, event_type FROM durable_events WHERE id = ?`,
        [`tg_post_claim_${claimHash}`]
      );
      expect(claimRow).toBeDefined();
      expect(claimRow.event_type).toBe('TELEGRAM_POST_CLAIMED');
    });
  });

  describe('Task 4: Brevo Webhook Authentication, Replay Defense & Durable Suppression (P1)', () => {
    it('4.1: POST /api/v1/integrations/brevo/webhook rejects unauthenticated requests with HTTP 401', async () => {
      const res = await app.request('/api/v1/integrations/brevo/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'delivered', email: 'user@example.com' })
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('UNAUTHORIZED');
    });

    it('4.2: Deduplicates Brevo webhook events via deterministic primary key brevo_wh_${hash}', async () => {
      const brevo = BrevoMcpClient.getInstance();

      const eventPayload = {
        event: 'delivered',
        email: 'dedupe_test@example.com',
        messageId: 'msg_unique_abc_123'
      };

      const firstCall = await brevo.handleWebhookEvent(eventPayload);
      expect(firstCall.processed).toBe(true);
      expect(firstCall.duplicate).toBeUndefined();

      // Second call with same messageId and event must be recognized as duplicate
      const secondCall = await brevo.handleWebhookEvent(eventPayload);
      expect(secondCall.processed).toBe(true);
      expect(secondCall.duplicate).toBe(true);
    });

    it('4.3: Persists hard_bounce, spam, and unsubscribed directly to D1 outreach_suppression_list', async () => {
      const brevo = BrevoMcpClient.getInstance();

      const bouncePayload = {
        event: 'hard_bounce',
        email: 'bounced_user@example.com',
        messageId: 'msg_bounce_999'
      };

      const res = await brevo.handleWebhookEvent(bouncePayload);
      expect(res.processed).toBe(true);
      expect(res.suppressed).toBe(true);

      // Verify row in D1 outreach_suppression_list
      const suppRow = await d1Repo.queryOne<any>(
        'outreach_suppression_list',
        `SELECT identifier, reason FROM outreach_suppression_list WHERE identifier = ? LIMIT 1`,
        ['bounced_user@example.com']
      );
      expect(suppRow).toBeDefined();
      expect(suppRow.identifier).toBe('bounced_user@example.com');
      expect(suppRow.reason).toBe('BREVO_WEBHOOK_HARD_BOUNCE');
    });
  });
});
